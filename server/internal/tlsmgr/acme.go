package tlsmgr

import (
	"context"
	"crypto/tls"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"
)

// ACMEChallengePrefix is the HTTP-01 challenge path served on the plain-HTTP
// listener. Let's Encrypt must reach it on port 80 of every requested domain,
// so CASTOR_HTTP_ADDR must be published on 80 (and CASTOR_HTTPS_ADDR on 443 for
// TLS-ALPN-01, which is attempted as well).
const ACMEChallengePrefix = "/.well-known/acme-challenge/"

// letsEncryptStagingURL is the Let's Encrypt staging directory: real
// issuance flow, untrusted certificates, generous rate limits. Use it to
// validate DNS + port reachability before switching to production.
const letsEncryptStagingURL = "https://acme-staging-v02.api.letsencrypt.org/directory"

// ErrInvalidACMEConfig wraps SetACME validation failures (400 in the API).
var ErrInvalidACMEConfig = errors.New("tlsmgr: invalid ACME configuration")

// acmeObtainTimeout bounds one issuance attempt (autocert's own ceiling).
const acmeObtainTimeout = 5 * time.Minute

// acmeRefreshInterval is how often the background loop asks autocert for
// every configured domain again, so certificates it renewed on its own timers
// reach the served set without waiting for a handshake.
const acmeRefreshInterval = 12 * time.Hour

// acmePreloadTimeout bounds the synchronous read of the on-disk cache when a
// configuration is applied.
const acmePreloadTimeout = 5 * time.Second

// dnsLabel matches one LDH hostname label (RFC 1123).
var dnsLabel = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// validateDomains normalizes (lower-case, trailing dot stripped, de-duplicated)
// and checks the ACME domain list: at least one entry, each a public-looking
// hostname with at least one dot, no wildcard (needs DNS-01, not supported), no
// IP literal.
func validateDomains(in []string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, raw := range in {
		d := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(raw), "."))
		if d == "" || seen[d] {
			continue
		}
		if strings.Contains(d, "*") {
			return nil, fmt.Errorf("%w: wildcard %q needs a DNS-01 challenge, which is not supported", ErrInvalidACMEConfig, d)
		}
		if net.ParseIP(d) != nil {
			return nil, fmt.Errorf("%w: %q is an IP address; Let's Encrypt issues for hostnames only", ErrInvalidACMEConfig, d)
		}
		if len(d) > 253 || !strings.Contains(d, ".") {
			return nil, fmt.Errorf("%w: %q is not a fully-qualified hostname", ErrInvalidACMEConfig, d)
		}
		for _, l := range strings.Split(d, ".") {
			if !dnsLabel.MatchString(l) {
				return nil, fmt.Errorf("%w: %q is not a valid hostname", ErrInvalidACMEConfig, d)
			}
		}
		seen[d] = true
		out = append(out, d)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: at least one domain is required", ErrInvalidACMEConfig)
	}
	return out, nil
}

// validateEmail applies a minimal sanity check; the CA does the real one.
func validateEmail(email string) (string, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return "", nil
	}
	at := strings.LastIndex(email, "@")
	if at < 1 || at == len(email)-1 || strings.ContainsAny(email, " \t\r\n") {
		return "", fmt.Errorf("%w: %q is not an email address", ErrInvalidACMEConfig, email)
	}
	return email, nil
}

// acmeCacheDir keeps staging and production material apart: a staging
// certificate cached under the production directory would be served (and
// trusted by nobody) until it expired.
func acmeCacheDir(dir string, staging bool) string {
	if staging {
		return filepath.Join(dir, "acme-staging")
	}
	return filepath.Join(dir, "acme")
}

// newAutocert builds the autocert manager for the given domains. HostPolicy is
// a strict whitelist so a stray SNI can never trigger an issuance.
func newAutocert(dir string, domains []string, email string, staging bool) *autocert.Manager {
	directory := acme.LetsEncryptURL
	if staging {
		directory = letsEncryptStagingURL
	}
	return &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		Cache:      autocert.DirCache(acmeCacheDir(dir, staging)),
		HostPolicy: autocert.HostWhitelist(domains...),
		Email:      email,
		Client:     &acme.Client{DirectoryURL: directory},
	}
}

// acmeBackend is what one ACME configuration talks to: the autocert manager as
// a certGetter, its cache (nil when the backend keeps none) and its HTTP-01
// handler. Tests substitute fakes through Manager.newBackend.
type acmeBackend struct {
	getter certGetter
	cache  autocert.Cache
	http   http.Handler
}

// newACMEBackend is the production backend factory.
func newACMEBackend(dir string, domains []string, email string, staging bool) acmeBackend {
	ac := newAutocert(dir, domains, email, staging)
	return acmeBackend{getter: ac, cache: ac.Cache, http: ac.HTTPHandler(nil)}
}

// isACMEALPN reports whether hello is a TLS-ALPN-01 validation handshake from
// the CA, using autocert's own criterion (acme-tls/1 as the only protocol).
// Those must reach autocert regardless of SNI bookkeeping; autocert answers
// them from its in-memory token set without contacting the CA.
func isACMEALPN(hello *tls.ClientHelloInfo) bool {
	return len(hello.SupportedProtos) == 1 && hello.SupportedProtos[0] == acme.ALPNProto
}

// warmupHello is the synthetic ClientHello used to obtain a domain's
// certificate outside any handshake. It advertises ECDSA so autocert requests
// the same (ECDSA) certificate modern browsers ask for, avoiding a second RSA
// issuance; the served set is keyed by domain only.
func warmupHello(domain string) *tls.ClientHelloInfo {
	return &tls.ClientHelloInfo{
		ServerName:        domain,
		SupportedProtos:   []string{"h2", "http/1.1"},
		SupportedVersions: []uint16{tls.VersionTLS13, tls.VersionTLS12},
		CipherSuites:      []uint16{tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, tls.TLS_AES_128_GCM_SHA256},
		SupportedCurves:   []tls.CurveID{tls.CurveP256},
		SignatureSchemes:  []tls.SignatureScheme{tls.ECDSAWithP256AndSHA256},
	}
}

// acmeResult carries one issuance attempt's outcome out of its goroutine.
type acmeResult struct {
	cert *tls.Certificate
	err  error
}

// pending is one in-flight issuance for a domain; done is closed once err is
// final. Concurrent handshakes, the refresh loop and Renew share it.
type pending struct {
	done chan struct{}
	err  error
}

// obtainAsync starts the issuance of domain's certificate under a, or joins
// the attempt already running for it, and returns it without waiting. This is
// what a handshake calls on a cache miss: it never blocks the handshake.
func (m *Manager) obtainAsync(a *acmeConfig, domain string) *pending {
	a.mu.Lock()
	if p := a.inflight[domain]; p != nil {
		a.mu.Unlock()
		return p
	}
	p := &pending{done: make(chan struct{})}
	a.inflight[domain] = p
	a.mu.Unlock()
	go func() {
		defer func() {
			a.mu.Lock()
			delete(a.inflight, domain)
			a.mu.Unlock()
			close(p.done)
		}()
		p.err = m.obtain(a, domain)
	}()
	return p
}

// obtain runs one issuance attempt to completion: autocert returns the cached
// or freshly issued certificate, or the CA/DNS error. The outcome updates a's
// served set and the ACME statistics; a superseded configuration records
// nothing.
func (m *Manager) obtain(a *acmeConfig, domain string) error {
	ctx, cancel := context.WithTimeout(a.ctx, acmeObtainTimeout)
	defer cancel()
	res := make(chan acmeResult, 1)
	go func() {
		c, err := a.getter.GetCertificate(warmupHello(domain))
		res <- acmeResult{cert: c, err: err}
	}()
	var r acmeResult
	select {
	case r = <-res:
	case <-ctx.Done():
		if err := a.ctx.Err(); err != nil {
			// The configuration was replaced; whatever comes back is stale.
			return err
		}
		r.err = fmt.Errorf("issuance for %s timed out after %s", domain, acmeObtainTimeout)
	}
	if r.err == nil && leafOf(r.cert) == nil {
		r.err = fmt.Errorf("issuer returned no certificate for %s", domain)
	}
	if r.err != nil {
		m.recordACME(a.gen, nil, r.err)
		return r.err
	}
	if changed, replaced := a.put(domain, r.cert); changed && replaced {
		m.logf("castor: tls: acme certificate for %s renewed (expires %s)", domain, leafOf(r.cert).NotAfter.UTC().Format("2006-01-02"))
	}
	m.recordACME(a.gen, r.cert, nil)
	return nil
}

// warmACME starts (or joins) an issuance for every configured domain.
func (m *Manager) warmACME(a *acmeConfig) []*pending {
	out := make([]*pending, 0, len(a.domains))
	for _, d := range a.domains {
		out = append(out, m.obtainAsync(a, d))
	}
	return out
}

// runACMERefresh re-asks autocert for every domain each acmeRefreshInterval
// until the configuration is replaced. autocert answers from its state when
// the certificate is current, so this is cheap; when it renewed the
// certificate in the meantime, the new one enters the served set here.
func (m *Manager) runACMERefresh(a *acmeConfig) {
	t := time.NewTicker(acmeRefreshInterval)
	defer t.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-t.C:
			m.warmACME(a)
		}
	}
}

// preloadACME fills a's served set from the autocert cache, so a restart keeps
// serving the certificates already obtained without a self-signed window
// while the warm-up runs. Misses, expired or corrupt entries are left to the
// warm-up to (re)obtain.
func (m *Manager) preloadACME(a *acmeConfig) {
	if a.cache == nil {
		return
	}
	ctx, cancel := context.WithTimeout(a.ctx, acmePreloadTimeout)
	defer cancel()
	now := m.now()
	for _, d := range a.domains {
		cert, err := loadCachedACME(ctx, a.cache, d, now)
		if err != nil {
			continue
		}
		a.put(d, cert)
		m.recordACME(a.gen, cert, nil)
	}
}

// loadCachedACME reads and validates domain's entry in the autocert cache.
// autocert stores, under the bare domain (ECDSA key), the PEM private key
// followed by the PEM chain; the entry is usable when the pair matches, the
// leaf is valid now and it covers the domain.
func loadCachedACME(ctx context.Context, cache autocert.Cache, domain string, now time.Time) (*tls.Certificate, error) {
	data, err := cache.Get(ctx, domain)
	if err != nil {
		return nil, err
	}
	key, rest := pem.Decode(data)
	if key == nil || !strings.Contains(key.Type, "PRIVATE") {
		return nil, errors.New("tlsmgr: cached entry has no private key")
	}
	cert, err := tls.X509KeyPair(rest, pem.EncodeToMemory(key))
	if err != nil {
		return nil, err
	}
	leaf := leafOf(&cert)
	if leaf == nil {
		return nil, errors.New("tlsmgr: cached entry has no certificate")
	}
	if now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) {
		return nil, errors.New("tlsmgr: cached certificate is not valid now")
	}
	if err := leaf.VerifyHostname(domain); err != nil {
		return nil, err
	}
	cert.Leaf = leaf
	return &cert, nil
}

// deleteCached removes domain's entries from cache: the ECDSA one autocert
// keys by the bare domain and the RSA variant a legacy client may have caused.
// A nil cache or a missing entry is not an error.
func deleteCached(ctx context.Context, cache autocert.Cache, domain string) {
	if cache == nil {
		return
	}
	_ = cache.Delete(ctx, domain)
	_ = cache.Delete(ctx, domain+"+rsa")
}
