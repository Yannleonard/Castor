package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// authproviders.go holds the auth_providers + group_role_mappings persistence
// (migration 0003): one row per configured external IdP (LDAP/LDAPS or OIDC /
// Microsoft Entra ID) and the external-group -> Castor-role mappings used by JIT
// provisioning. The short-lived OIDC redirect state machine and the external
// role-binding resync live in sso_states.go.

// AuthProvider is a row of the auth_providers table. `Kind` selects which subset
// of fields is meaningful (ldap_* vs oidc_*).
//
// The sealed secret BLOBs (LDAPBindPWEnc / OIDCClientSecretEnc) are NEVER
// serialized (json:"-"). Sealing/opening happens in the API layer via
// authz.SealSecret/OpenSecret — the store persists and returns the already
// sealed BLOB and never imports authz (that would create an import cycle: authz
// already imports store). This mirrors registries.go (marketplace creds).
type AuthProvider struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Kind          string `json:"kind"` // ldap|oidc
	Enabled       bool   `json:"enabled"`
	DefaultRoleID string `json:"defaultRoleId,omitempty"`

	// LDAP
	LDAPHost         string `json:"ldapHost"`
	LDAPPort         int    `json:"ldapPort"`
	LDAPTLS          string `json:"ldapTls"` // none|starttls|ldaps
	LDAPSkipVerify   bool   `json:"ldapSkipVerify"`
	LDAPBindDN       string `json:"ldapBindDn"`
	LDAPBindPWEnc    []byte `json:"-"`
	LDAPBaseDN       string `json:"ldapBaseDn"`
	LDAPUserFilter   string `json:"ldapUserFilter"`
	LDAPAttrUsername string `json:"ldapAttrUsername"`
	LDAPAttrEmail    string `json:"ldapAttrEmail"`
	LDAPAttrDisplay  string `json:"ldapAttrDisplay"`
	LDAPGroupBaseDN  string `json:"ldapGroupBaseDn"`
	LDAPGroupFilter  string `json:"ldapGroupFilter"`
	LDAPAttrMember   string `json:"ldapAttrMember"`

	// OIDC (Entra ID)
	OIDCIssuer          string `json:"oidcIssuer"`
	OIDCClientID        string `json:"oidcClientId"`
	OIDCClientSecretEnc []byte `json:"-"`
	OIDCRedirectURL     string `json:"oidcRedirectUrl"`
	OIDCScopes          string `json:"oidcScopes"`
	OIDCGroupsClaim     string `json:"oidcGroupsClaim"`
	OIDCUsernameClaim   string `json:"oidcUsernameClaim"`
	OIDCEmailClaim      string `json:"oidcEmailClaim"`

	CreatedAt int64 `json:"createdAt"`
	UpdatedAt int64 `json:"updatedAt"`
}

// HasBindPW reports whether a sealed LDAP bind credential is stored (drives the
// API's hasBindPassword flag without exposing the secret).
func (p *AuthProvider) HasBindPW() bool { return len(p.LDAPBindPWEnc) > 0 }

// HasClientSecret reports whether a sealed OIDC client secret is stored.
func (p *AuthProvider) HasClientSecret() bool { return len(p.OIDCClientSecretEnc) > 0 }

// authProviderCols lists auth_providers columns in a FIXED order. scanProvider
// binds to this EXACT order; keep them in sync or scans misalign.
const authProviderCols = `id, name, kind, enabled, default_role_id,
	ldap_host, ldap_port, ldap_tls, ldap_skip_verify, ldap_bind_dn,
	ldap_bind_pw_enc, ldap_base_dn, ldap_user_filter, ldap_attr_username,
	ldap_attr_email, ldap_attr_display, ldap_group_base_dn, ldap_group_filter,
	ldap_attr_member,
	oidc_issuer, oidc_client_id, oidc_client_secret_enc, oidc_redirect_url,
	oidc_scopes, oidc_groups_claim, oidc_username_claim, oidc_email_claim,
	created_at, updated_at`

func scanProvider(row interface{ Scan(...any) error }) (*AuthProvider, error) {
	var p AuthProvider
	var enabled, ldapSkipVerify int
	var defaultRoleID sql.NullString
	var bindPW, clientSecret []byte
	if err := row.Scan(
		&p.ID, &p.Name, &p.Kind, &enabled, &defaultRoleID,
		&p.LDAPHost, &p.LDAPPort, &p.LDAPTLS, &ldapSkipVerify, &p.LDAPBindDN,
		&bindPW, &p.LDAPBaseDN, &p.LDAPUserFilter, &p.LDAPAttrUsername,
		&p.LDAPAttrEmail, &p.LDAPAttrDisplay, &p.LDAPGroupBaseDN, &p.LDAPGroupFilter,
		&p.LDAPAttrMember,
		&p.OIDCIssuer, &p.OIDCClientID, &clientSecret, &p.OIDCRedirectURL,
		&p.OIDCScopes, &p.OIDCGroupsClaim, &p.OIDCUsernameClaim, &p.OIDCEmailClaim,
		&p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.Enabled = enabled == 1
	p.LDAPSkipVerify = ldapSkipVerify == 1
	p.DefaultRoleID = defaultRoleID.String
	p.LDAPBindPWEnc = bindPW
	p.OIDCClientSecretEnc = clientSecret
	return &p, nil
}

// ListAuthProviders returns every configured provider ordered by name.
func (s *Store) ListAuthProviders(ctx context.Context) ([]*AuthProvider, error) {
	return s.queryProviders(ctx,
		`SELECT `+authProviderCols+` FROM auth_providers ORDER BY name ASC`)
}

// ListEnabledAuthProviders returns only enabled providers (login-screen rendering
// + the LDAP/OIDC login flows).
func (s *Store) ListEnabledAuthProviders(ctx context.Context) ([]*AuthProvider, error) {
	return s.queryProviders(ctx,
		`SELECT `+authProviderCols+` FROM auth_providers WHERE enabled = 1 ORDER BY name ASC`)
}

func (s *Store) queryProviders(ctx context.Context, q string, args ...any) ([]*AuthProvider, error) {
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*AuthProvider
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetAuthProvider returns one provider by id (ErrNotFound when absent).
func (s *Store) GetAuthProvider(ctx context.Context, id string) (*AuthProvider, error) {
	return scanProvider(s.db.QueryRowContext(ctx,
		`SELECT `+authProviderCols+` FROM auth_providers WHERE id = ?`, id))
}

// applyProviderDefaults fills empty schema-defaulted text fields so a partially
// populated struct still persists to sane values matching the DDL defaults. The
// API layer already applies these (applyProviderRequest); this is defense for any
// direct store caller. It only sets EMPTY fields, so it never overrides intent.
func applyProviderDefaults(p *AuthProvider) {
	if p.LDAPPort == 0 {
		p.LDAPPort = 389
	}
	if p.LDAPTLS == "" {
		p.LDAPTLS = "starttls"
	}
	if p.LDAPUserFilter == "" {
		p.LDAPUserFilter = "(&(objectClass=person)(sAMAccountName=%s))"
	}
	if p.LDAPAttrUsername == "" {
		p.LDAPAttrUsername = "sAMAccountName"
	}
	if p.LDAPAttrEmail == "" {
		p.LDAPAttrEmail = "mail"
	}
	if p.LDAPAttrDisplay == "" {
		p.LDAPAttrDisplay = "displayName"
	}
	if p.LDAPGroupFilter == "" {
		p.LDAPGroupFilter = "(&(objectClass=group)(member=%s))"
	}
	if p.LDAPAttrMember == "" {
		p.LDAPAttrMember = "memberOf"
	}
	if p.OIDCScopes == "" {
		p.OIDCScopes = "openid profile email"
	}
	if p.OIDCGroupsClaim == "" {
		p.OIDCGroupsClaim = "groups"
	}
	if p.OIDCUsernameClaim == "" {
		p.OIDCUsernameClaim = "preferred_username"
	}
	if p.OIDCEmailClaim == "" {
		p.OIDCEmailClaim = "email"
	}
}

// CreateAuthProvider inserts a provider. The caller assigns p.ID (store.NewUUID())
// and must have sealed the secret BLOBs (authz.SealSecret) into LDAPBindPWEnc /
// OIDCClientSecretEnc, or left them nil. created_at/updated_at are stamped here.
func (s *Store) CreateAuthProvider(ctx context.Context, p *AuthProvider) error {
	now := time.Now().Unix()
	p.CreatedAt, p.UpdatedAt = now, now
	applyProviderDefaults(p)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO auth_providers (`+authProviderCols+`)
		 VALUES (?, ?, ?, ?, ?,
		         ?, ?, ?, ?, ?,
		         ?, ?, ?, ?,
		         ?, ?, ?, ?,
		         ?,
		         ?, ?, ?, ?,
		         ?, ?, ?, ?,
		         ?, ?)`,
		p.ID, p.Name, p.Kind, boolInt(p.Enabled), nullStr(p.DefaultRoleID),
		p.LDAPHost, p.LDAPPort, p.LDAPTLS, boolInt(p.LDAPSkipVerify), p.LDAPBindDN,
		nullBlob(p.LDAPBindPWEnc), p.LDAPBaseDN, p.LDAPUserFilter, p.LDAPAttrUsername,
		p.LDAPAttrEmail, p.LDAPAttrDisplay, p.LDAPGroupBaseDN, p.LDAPGroupFilter,
		p.LDAPAttrMember,
		p.OIDCIssuer, p.OIDCClientID, nullBlob(p.OIDCClientSecretEnc), p.OIDCRedirectURL,
		p.OIDCScopes, p.OIDCGroupsClaim, p.OIDCUsernameClaim, p.OIDCEmailClaim,
		now, now,
	)
	return err
}

// UpdateAuthProvider replaces all mutable config fields. The sealed secrets are
// only rewritten when their set* flag is true (pass the new sealed BLOB in the
// matching field; nil/empty clears it). When a flag is false the stored secret is
// left untouched. Returns ErrNotFound when no row matched.
func (s *Store) UpdateAuthProvider(ctx context.Context, p *AuthProvider, setBindPW, setClientSecret bool) error {
	now := time.Now().Unix()
	p.UpdatedAt = now
	applyProviderDefaults(p)
	res, err := s.db.ExecContext(ctx,
		`UPDATE auth_providers SET
			name = ?, kind = ?, enabled = ?, default_role_id = ?,
			ldap_host = ?, ldap_port = ?, ldap_tls = ?, ldap_skip_verify = ?, ldap_bind_dn = ?,
			ldap_base_dn = ?, ldap_user_filter = ?, ldap_attr_username = ?,
			ldap_attr_email = ?, ldap_attr_display = ?, ldap_group_base_dn = ?,
			ldap_group_filter = ?, ldap_attr_member = ?,
			oidc_issuer = ?, oidc_client_id = ?, oidc_redirect_url = ?,
			oidc_scopes = ?, oidc_groups_claim = ?, oidc_username_claim = ?, oidc_email_claim = ?,
			updated_at = ?
		 WHERE id = ?`,
		p.Name, p.Kind, boolInt(p.Enabled), nullStr(p.DefaultRoleID),
		p.LDAPHost, p.LDAPPort, p.LDAPTLS, boolInt(p.LDAPSkipVerify), p.LDAPBindDN,
		p.LDAPBaseDN, p.LDAPUserFilter, p.LDAPAttrUsername,
		p.LDAPAttrEmail, p.LDAPAttrDisplay, p.LDAPGroupBaseDN,
		p.LDAPGroupFilter, p.LDAPAttrMember,
		p.OIDCIssuer, p.OIDCClientID, p.OIDCRedirectURL,
		p.OIDCScopes, p.OIDCGroupsClaim, p.OIDCUsernameClaim, p.OIDCEmailClaim,
		now,
		p.ID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if setBindPW {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE auth_providers SET ldap_bind_pw_enc = ? WHERE id = ?`,
			nullBlob(p.LDAPBindPWEnc), p.ID); err != nil {
			return err
		}
	}
	if setClientSecret {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE auth_providers SET oidc_client_secret_enc = ? WHERE id = ?`,
			nullBlob(p.OIDCClientSecretEnc), p.ID); err != nil {
			return err
		}
	}
	return nil
}

// DeleteAuthProvider removes a provider by id (cascades its group mappings and
// oidc_auth_states via FK ON DELETE CASCADE).
func (s *Store) DeleteAuthProvider(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM auth_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// group_role_mappings
// ---------------------------------------------------------------------------

// GroupRoleMapping is a row of group_role_mappings: an external group (LDAP
// group DN/CN, or an Entra group object-id/name) -> a Castor role for a provider.
type GroupRoleMapping struct {
	ID            string `json:"id"`
	ProviderID    string `json:"providerId"`
	ExternalGroup string `json:"externalGroup"`
	RoleID        string `json:"roleId"`
	CreatedAt     int64  `json:"createdAt"`
}

// ListGroupRoleMappings returns a provider's group->role mappings ordered by group.
func (s *Store) ListGroupRoleMappings(ctx context.Context, providerID string) ([]*GroupRoleMapping, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, provider_id, external_group, role_id, created_at
		 FROM group_role_mappings WHERE provider_id = ? ORDER BY external_group ASC`, providerID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*GroupRoleMapping
	for rows.Next() {
		var m GroupRoleMapping
		if err := rows.Scan(&m.ID, &m.ProviderID, &m.ExternalGroup, &m.RoleID, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &m)
	}
	return out, rows.Err()
}

// CreateGroupRoleMapping inserts a group->role mapping. Caller assigns m.ID
// (NewUUID()). The UNIQUE(provider_id, external_group, role_id) constraint (and
// the role_id FK) makes a duplicate / invalid role fail; the API maps that to a
// 409.
func (s *Store) CreateGroupRoleMapping(ctx context.Context, m *GroupRoleMapping) error {
	m.CreatedAt = time.Now().Unix()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO group_role_mappings (id, provider_id, external_group, role_id, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		m.ID, m.ProviderID, m.ExternalGroup, m.RoleID, m.CreatedAt)
	return err
}

// DeleteGroupRoleMapping removes a mapping by id (scoped to providerID for safety).
func (s *Store) DeleteGroupRoleMapping(ctx context.Context, providerID, mappingID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM group_role_mappings WHERE id = ? AND provider_id = ?`, mappingID, providerID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ResolveRolesForGroups maps a user's external groups to Castor role ids for a
// provider. It returns the UNION of every role whose mapping's external_group
// matches one of the user's groups, compared case-insensitively against BOTH the
// raw group value AND its CN (the first RDN of a DN, e.g. "CN=Admins,OU=...").
//
// The result is de-duplicated and may be empty (no mapping matched). The caller
// decides the fallback (typically the provider's default_role_id) — this method
// deliberately does NOT apply a default so the JIT layer stays the single place
// that policy lives (see api.finishExternalLogin).
func (s *Store) ResolveRolesForGroups(ctx context.Context, providerID string, groups []string) ([]string, error) {
	mappings, err := s.ListGroupRoleMappings(ctx, providerID)
	if err != nil {
		return nil, err
	}

	// Build a case-insensitive lookup of the user's groups (raw + CN forms).
	have := make(map[string]struct{}, len(groups)*2)
	for _, g := range groups {
		g = strings.TrimSpace(g)
		if g == "" {
			continue
		}
		have[strings.ToLower(g)] = struct{}{}
		if cn := groupCN(g); cn != "" {
			have[strings.ToLower(cn)] = struct{}{}
		}
	}

	seen := map[string]struct{}{}
	var out []string
	for _, m := range mappings {
		key := strings.ToLower(strings.TrimSpace(m.ExternalGroup))
		cnKey := strings.ToLower(groupCN(m.ExternalGroup))
		_, hit := have[key]
		if !hit && cnKey != "" {
			_, hit = have[cnKey]
		}
		if !hit {
			continue
		}
		if _, dup := seen[m.RoleID]; dup {
			continue
		}
		seen[m.RoleID] = struct{}{}
		out = append(out, m.RoleID)
	}
	return out, nil
}

// groupCN extracts the CN (first RDN value) from a DN-like group string, e.g.
// "CN=Castor Admins,OU=Groups,DC=corp" -> "Castor Admins". For a value that is
// not a DN it returns "" (the caller matches the raw value separately).
func groupCN(g string) string {
	g = strings.TrimSpace(g)
	if g == "" {
		return ""
	}
	first := g
	if i := strings.IndexByte(g, ','); i >= 0 {
		first = g[:i]
	}
	if eq := strings.IndexByte(first, '='); eq >= 0 {
		if strings.EqualFold(strings.TrimSpace(first[:eq]), "cn") {
			return strings.TrimSpace(first[eq+1:])
		}
	}
	return ""
}
