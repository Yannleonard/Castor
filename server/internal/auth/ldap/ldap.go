// Package ldap performs LDAP/LDAPS authentication for Castor's enterprise SSO.
//
// The flow (see Authenticate):
//  1. Dial the directory honoring TLS mode (none|starttls|ldaps) and
//     SkipVerify (self-signed labs).
//  2. Bind as the service account (BindDN/BindPassword) — or anonymously when
//     no BindDN is configured — to perform the user search.
//  3. Search BaseDN with UserFilter (its sole %s replaced by the
//     ldap.EscapeFilter'd username) to resolve the user entry (DN + attributes).
//  4. RE-BIND as the resolved user DN with the supplied password to actually
//     verify the credentials (a successful search alone proves nothing).
//  5. Collect group memberships: from the user entry's member attribute
//     (e.g. memberOf), and/or via a group search (GroupFilter, %s = user DN).
//
// Network operations are individually deadline-bounded inside this package
// (dialTimeout / operationTimeout), so callers need not thread a context. Secrets
// (the service-account BindPassword) arrive already decrypted from the API layer;
// this package imports neither store nor authz, so it stays trivially testable.
package ldap

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
)

// TLS modes for LDAPConfig.TLS.
const (
	TLSNone     = "none"     // plain ldap:// on Port (typically 389)
	TLSStartTLS = "starttls" // ldap:// then StartTLS upgrade on Port (typically 389)
	TLSLDAPS    = "ldaps"    // implicit TLS ldaps:// on Port (typically 636)
)

// dialTimeout bounds the TCP/TLS connect; operationTimeout bounds bind/search.
const (
	dialTimeout      = 10 * time.Second
	operationTimeout = 15 * time.Second
)

// LDAPConfig is the connection + search configuration for one LDAP provider. It
// is assembled by the API layer from a store.AuthProvider (with the bind password
// already decrypted). All search filters use a SINGLE %s placeholder.
type LDAPConfig struct {
	Host       string // directory hostname/IP
	Port       int    // directory port (389 plain/starttls, 636 ldaps)
	TLS        string // none|starttls|ldaps
	SkipVerify bool   // skip TLS cert verification (self-signed labs only)

	BindDN       string // service-account DN for the user search ("" => anonymous)
	BindPassword string // service-account password (already decrypted)

	BaseDN     string // search base for users
	UserFilter string // %s = escaped username, e.g. (&(objectClass=person)(sAMAccountName=%s))

	AttrUsername string // attribute holding the canonical username
	AttrEmail    string // attribute holding the email
	AttrDisplay  string // attribute holding the display name

	// Group resolution. AttrMember (e.g. memberOf) is read off the user entry.
	// When GroupBaseDN/GroupFilter are set, an additional group search is run
	// (GroupFilter %s = the user's DN) and those group DNs are unioned in.
	GroupBaseDN string
	GroupFilter string
	AttrMember  string // e.g. memberOf
}

// ExternalIdentity is the normalized result of a successful LDAP authentication,
// consumed by the JIT provisioning layer. ExternalID is the stable subject:
// entryUUID when present, else the (normalized) DN.
type ExternalIdentity struct {
	ExternalID string   // entryUUID or DN — stable IdP subject
	Username   string   // canonical username (AttrUsername, falls back to the login name)
	Email      string   // AttrEmail (may be empty)
	Display    string   // AttrDisplay (may be empty)
	Groups     []string // group DNs/values (memberOf + group search union)
}

// Common authentication errors. ErrInvalidCredentials is returned for both a
// missing user and a failed user-DN bind so callers cannot distinguish the two
// (anti-enumeration); ErrConfig signals a misconfiguration (bad base DN, etc.).
var (
	ErrInvalidCredentials = errors.New("ldap: invalid credentials")
	ErrConfig             = errors.New("ldap: configuration error")
)

// Authenticate verifies username/password against the directory and returns the
// resolved external identity. A blank password is rejected outright (RFC 4513
// "unauthenticated bind" would otherwise succeed against the user DN).
func Authenticate(cfg LDAPConfig, username, password string) (*ExternalIdentity, error) {
	if strings.TrimSpace(username) == "" || password == "" {
		return nil, ErrInvalidCredentials
	}

	conn, err := dial(cfg)
	if err != nil {
		return nil, err
	}
	defer func() { _ = conn.Close() }()
	conn.SetTimeout(operationTimeout)

	// 1) Bind as the service account (or anonymously) to run the user search.
	if err := serviceBind(conn, cfg); err != nil {
		return nil, fmt.Errorf("%w: service bind failed: %v", ErrConfig, err)
	}

	// 2) Resolve the user entry.
	entry, err := findUser(conn, cfg, username)
	if err != nil {
		return nil, err
	}

	// 3) RE-BIND as the user DN with their password to verify credentials. Any
	//    bind failure is reported as invalid credentials (no enumeration).
	if err := conn.Bind(entry.DN, password); err != nil {
		return nil, ErrInvalidCredentials
	}

	id := buildIdentity(cfg, username, entry)

	// 4) Optional group search (GroupFilter %s = user DN), unioned with memberOf.
	//    Re-bind as the service account first: some directories restrict group
	//    reads for the just-bound user.
	if cfg.GroupBaseDN != "" && cfg.GroupFilter != "" {
		if err := serviceBind(conn, cfg); err == nil {
			if groups, gerr := searchGroups(conn, cfg, entry.DN); gerr == nil {
				id.Groups = unionStrings(id.Groups, groups)
			}
		}
	}
	return id, nil
}

// Test validates the connection + service bind + a sample user search WITHOUT
// verifying any user password. It returns the DN of a sample user when the base
// DN / filter resolve one (empty otherwise), or an error describing a
// connectivity/configuration failure (the API renders that as ok:false).
func Test(cfg LDAPConfig) (sampleUser string, err error) {
	conn, err := dial(cfg)
	if err != nil {
		return "", err
	}
	defer func() { _ = conn.Close() }()
	conn.SetTimeout(operationTimeout)

	if err := serviceBind(conn, cfg); err != nil {
		return "", fmt.Errorf("%w: service bind failed: %v", ErrConfig, err)
	}

	if strings.TrimSpace(cfg.BaseDN) == "" {
		return "", nil // connected + bound; nothing to sample
	}

	// Sample search: replace %s with a broad matcher to confirm the base DN and
	// filter shape resolve. "*" keeps the filter well-formed; EscapeFilter is
	// intentionally NOT applied to the wildcard.
	filter := buildFilter(cfg.UserFilter, "*")
	req := ldap.NewSearchRequest(
		cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		1, int(operationTimeout/time.Second), false,
		filter, attrList(cfg), nil,
	)
	res, serr := conn.Search(req)
	if serr != nil {
		// SizeLimitExceeded means the directory matched entries but capped the
		// result — that's a SUCCESSFUL connectivity/filter test.
		if ldap.IsErrorWithCode(serr, ldap.LDAPResultSizeLimitExceeded) && res != nil && len(res.Entries) > 0 {
			return res.Entries[0].DN, nil
		}
		return "", fmt.Errorf("%w: sample search failed: %v", ErrConfig, serr)
	}
	if len(res.Entries) > 0 {
		return res.Entries[0].DN, nil
	}
	return "", nil // connected + bound, but the base/filter matched no users
}

// dial opens the LDAP connection per the configured TLS mode.
func dial(cfg LDAPConfig) (*ldap.Conn, error) {
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, fmt.Errorf("%w: ldap host is empty", ErrConfig)
	}
	port := cfg.Port
	if port == 0 {
		if cfg.TLS == TLSLDAPS {
			port = 636
		} else {
			port = 389
		}
	}
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(port))
	tlsCfg := &tls.Config{
		ServerName:         cfg.Host,
		InsecureSkipVerify: cfg.SkipVerify, // gated by ldap_skip_verify (self-signed labs)
		MinVersion:         tls.VersionTLS12,
	}
	dialer := &net.Dialer{Timeout: dialTimeout}

	switch cfg.TLS {
	case TLSLDAPS:
		conn, err := ldap.DialURL("ldaps://"+addr,
			ldap.DialWithDialer(dialer), ldap.DialWithTLSConfig(tlsCfg))
		if err != nil {
			return nil, fmt.Errorf("%w: dial failed: %v", ErrConfig, err)
		}
		return conn, nil
	case TLSStartTLS:
		conn, err := ldap.DialURL("ldap://"+addr, ldap.DialWithDialer(dialer))
		if err != nil {
			return nil, fmt.Errorf("%w: dial failed: %v", ErrConfig, err)
		}
		if err := conn.StartTLS(tlsCfg); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("%w: starttls failed: %v", ErrConfig, err)
		}
		return conn, nil
	case TLSNone, "":
		conn, err := ldap.DialURL("ldap://"+addr, ldap.DialWithDialer(dialer))
		if err != nil {
			return nil, fmt.Errorf("%w: dial failed: %v", ErrConfig, err)
		}
		return conn, nil
	default:
		return nil, fmt.Errorf("%w: unknown tls mode %q", ErrConfig, cfg.TLS)
	}
}

// serviceBind binds as the configured service account, or anonymously when no
// BindDN is set (some directories permit anonymous search).
func serviceBind(conn *ldap.Conn, cfg LDAPConfig) error {
	if cfg.BindDN == "" {
		return conn.UnauthenticatedBind("")
	}
	return conn.Bind(cfg.BindDN, cfg.BindPassword)
}

// findUser resolves the single user entry matching UserFilter for username.
func findUser(conn *ldap.Conn, cfg LDAPConfig, username string) (*ldap.Entry, error) {
	if strings.TrimSpace(cfg.BaseDN) == "" {
		return nil, fmt.Errorf("%w: base DN is empty", ErrConfig)
	}
	filter := buildFilter(cfg.UserFilter, ldap.EscapeFilter(username))
	req := ldap.NewSearchRequest(
		cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		2, int(operationTimeout/time.Second), false,
		filter, attrList(cfg), nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		return nil, fmt.Errorf("%w: user search failed: %v", ErrConfig, err)
	}
	if len(res.Entries) == 0 {
		return nil, ErrInvalidCredentials // unknown user: do not leak via error type
	}
	return res.Entries[0], nil
}

// buildIdentity assembles the ExternalIdentity from a resolved user entry.
func buildIdentity(cfg LDAPConfig, loginName string, entry *ldap.Entry) *ExternalIdentity {
	id := &ExternalIdentity{
		ExternalID: firstNonEmpty(entry.GetAttributeValue("entryUUID"), normalizeDN(entry.DN)),
		Username:   entry.GetAttributeValue(cfg.AttrUsername),
		Email:      entry.GetAttributeValue(cfg.AttrEmail),
		Display:    entry.GetAttributeValue(cfg.AttrDisplay),
	}
	if strings.TrimSpace(id.Username) == "" {
		id.Username = loginName
	}
	if cfg.AttrMember != "" {
		id.Groups = entry.GetAttributeValues(cfg.AttrMember)
	}
	return id
}

// searchGroups runs the configured group search (GroupFilter %s = userDN) and
// returns the matched group DNs.
func searchGroups(conn *ldap.Conn, cfg LDAPConfig, userDN string) ([]string, error) {
	filter := buildFilter(cfg.GroupFilter, ldap.EscapeFilter(userDN))
	req := ldap.NewSearchRequest(
		cfg.GroupBaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		0, int(operationTimeout/time.Second), false,
		filter, []string{"cn"}, nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(res.Entries))
	for _, e := range res.Entries {
		out = append(out, e.DN)
	}
	return out, nil
}

// attrList is the set of attributes requested during a user search.
func attrList(cfg LDAPConfig) []string {
	attrs := []string{"entryUUID"}
	for _, a := range []string{cfg.AttrUsername, cfg.AttrEmail, cfg.AttrDisplay, cfg.AttrMember} {
		if a != "" {
			attrs = append(attrs, a)
		}
	}
	return attrs
}

// buildFilter substitutes the single %s placeholder with value. When the filter
// template has no %s it is returned verbatim (defensive: avoids fmt's
// %!(EXTRA ...) noise on a malformed template).
func buildFilter(tmpl, value string) string {
	if !strings.Contains(tmpl, "%s") {
		return tmpl
	}
	return strings.Replace(tmpl, "%s", value, 1)
}

// normalizeDN lowercases a DN for use as a stable identifier (DNs are
// case-insensitive). Best-effort: returns the input lowercased on parse failure.
func normalizeDN(dn string) string {
	if parsed, err := ldap.ParseDN(dn); err == nil {
		parts := make([]string, 0, len(parsed.RDNs))
		for _, rdn := range parsed.RDNs {
			for _, ava := range rdn.Attributes {
				parts = append(parts, strings.ToLower(ava.Type)+"="+strings.ToLower(ava.Value))
			}
		}
		return strings.Join(parts, ",")
	}
	return strings.ToLower(strings.TrimSpace(dn))
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// unionStrings returns the de-duplicated union of a and b (case-insensitive key,
// preserving the first-seen original casing/order).
func unionStrings(a, b []string) []string {
	seen := make(map[string]struct{}, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	for _, s := range append(append([]string{}, a...), b...) {
		k := strings.ToLower(strings.TrimSpace(s))
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, s)
	}
	return out
}
