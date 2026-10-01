// Castor by IT Leonard
package tlsmgr

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"

	"github.com/gtek-it/castor/server/internal/config"
)

// ErrInvalidMode wraps SetMode failures (400 in the API).
var ErrInvalidMode = errors.New("tlsmgr: invalid TLS mode")

// ResolveMode applies the TLS mode precedence shared by main.go and the API.
// CASTOR_TLS_MODE=off forces "off": the persisted tls.mode is ignored and
// managedByEnv is true (the API then refuses every TLS change). Otherwise the
// persisted value wins when it is self-signed, custom or acme, and the env
// default applies when it is absent or anything else, a persisted "off"
// included: TLS can only be turned off from the environment.
func ResolveMode(envMode, persisted string) (mode string, managedByEnv bool) {
	env := strings.ToLower(strings.TrimSpace(envMode))
	if env == config.TLSModeOff {
		return config.TLSModeOff, true
	}
	switch p := strings.ToLower(strings.TrimSpace(persisted)); p {
	case config.TLSModeSelfSigned, config.TLSModeCustom, config.TLSModeACME:
		return p, false
	}
	if !config.IsValidTLSMode(env) {
		env = config.TLSModeSelfSigned
	}
	return env, false
}

// certGetter is the slice of *autocert.Manager the Manager depends on; tests
// substitute a fake to exercise the fallback path without a CA.
type certGetter interface {
	GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error)
}

// Options configures New.
type Options struct {
	// Dir holds the self-signed pair and the ACME cache (created 0700).
	Dir string
	// Mode is the mode at startup, already resolved by the caller (see
	// ResolveMode). "off" means no HTTPS listener: no certificate is generated
	// and EffectiveMode stays "off" until a restart.
	Mode string
	// ManagedByEnv is true when CASTOR_TLS_MODE=off forced the mode; the API
	// then refuses TLS changes. Reported by ManagedByEnv and Status.
	ManagedByEnv bool
	// TrustProxy mirrors CASTOR_TRUST_PROXY: the HTTP->HTTPS redirect then
	// honors X-Forwarded-Proto and leaves proxied HTTPS requests alone.
	TrustProxy bool
	// SelfSignedHosts are extra SANs for the self-signed certificate.
	SelfSignedHosts []string
	// HTTPSAddr is the HTTPS listen address, used for the HTTP->HTTPS redirect
	// and reported in Status.
	HTTPSAddr string
	// Logf receives operational log lines; nil means log.Printf.
	Logf func(format string, args ...any)
	// Now overrides the clock (tests); nil means time.Now.
	Now func() time.Time
}

// state is the immutable snapshot GetCertificate reads lock-free; writers
// build a modified copy under Manager.mu and swap it in.
type state struct {
	mode       string
	selfSigned *tls.Certificate
	custom     *tls.Certificate
	acme       *acmeConfig
}

// acmeConfig is one applied ACME configuration: its backend plus the served
// set, the certificates handshakes may use. gen distinguishes it from earlier
// configurations whose background issuance may still be running.
type acmeConfig struct {
	gen     uint64
	domains []string
	email   string
	staging bool
	getter  certGetter
	cache   autocert.Cache
	http    http.Handler
	// ctx ends when the configuration is replaced or the manager closed; the
	// refresh loop and pending issuances stop with it.
	ctx    context.Context
	cancel context.CancelFunc

	mu       sync.Mutex
	certs    map[string]*tls.Certificate // served set, by configured domain
	inflight map[string]*pending
}

// match returns the configured domain serverName designates, if any.
func (a *acmeConfig) match(serverName string) (string, bool) {
	name := strings.ToLower(strings.TrimSuffix(serverName, "."))
	for _, d := range a.domains {
		if d == name {
			return d, true
		}
	}
	return "", false
}

// allows reports whether serverName is one of the configured domains.
func (a *acmeConfig) allows(serverName string) bool {
	_, ok := a.match(serverName)
	return ok
}

// same reports whether a was built from exactly these parameters (domains
// compared in order, as normalized by validateDomains).
func (a *acmeConfig) same(domains []string, email string, staging bool) bool {
	if a.email != email || a.staging != staging || len(a.domains) != len(domains) {
		return false
	}
	for i := range domains {
		if a.domains[i] != domains[i] {
			return false
		}
	}
	return true
}

// put installs cert as domain's served certificate. It reports whether the
// certificate differs from the previous one (serial or validity start) and
// whether there was a previous one.
func (a *acmeConfig) put(domain string, cert *tls.Certificate) (changed, replaced bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	prev := a.certs[domain]
	a.certs[domain] = cert
	return !sameCert(prev, cert), prev != nil
}

// cached returns domain's served certificate when it is valid at now.
func (a *acmeConfig) cached(domain string, now time.Time) *tls.Certificate {
	a.mu.Lock()
	defer a.mu.Unlock()
	if c := a.certs[domain]; c != nil && certValid(c, now) {
		return c
	}
	return nil
}

// served returns what a visitor of the first configured domain with a valid
// certificate gets, and whether the set holds material that has all expired.
func (a *acmeConfig) served(now time.Time) (cert *tls.Certificate, expired bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, d := range a.domains {
		if c := a.certs[d]; c != nil {
			if certValid(c, now) {
				return c, false
			}
			expired = true
		}
	}
	return nil, expired
}

// inherit copies the served certificates of prev for the domains a still
// configures, so visitors keep the current certificate while a obtains its own.
func (a *acmeConfig) inherit(prev *acmeConfig) {
	prev.mu.Lock()
	defer prev.mu.Unlock()
	for _, d := range a.domains {
		if c := prev.certs[d]; c != nil {
			a.certs[d] = c
		}
	}
}

// acmeStats is the mutable ACME bookkeeping (guarded by Manager.acmeMu): the
// outcome of the issuances run for the current configuration.
type acmeStats struct {
	gen         uint64
	ok          bool
	lastError   string
	lastErrorAt time.Time
}

// Manager serves certificates for the HTTPS listener and lets the API switch
// mode / install certificates at runtime.
type Manager struct {
	dir          string
	httpsAddr    string
	serving      bool
	managedByEnv bool
	trustProxy   bool
	logf         func(string, ...any)
	now          func() time.Time
	// newBackend builds the ACME backend for a configuration (autocert in
	// production; tests inject fakes).
	newBackend func(dir string, domains []string, email string, staging bool) acmeBackend

	mu    sync.Mutex // serializes state writers
	state atomic.Pointer[state]

	acmeMu  sync.Mutex
	acmeGen uint64
	acme    acmeStats
}

// New prepares the manager for opts.Mode. Unless the mode is "off" it loads or
// generates the self-signed certificate under opts.Dir so that GetCertificate
// always has something to serve. It starts no listener.
func New(opts Options) (*Manager, error) {
	if !config.IsValidTLSMode(opts.Mode) {
		return nil, fmt.Errorf("%w: %q", ErrInvalidMode, opts.Mode)
	}
	m := &Manager{
		dir:          opts.Dir,
		httpsAddr:    opts.HTTPSAddr,
		serving:      opts.Mode != config.TLSModeOff,
		managedByEnv: opts.ManagedByEnv,
		trustProxy:   opts.TrustProxy,
		logf:         opts.Logf,
		now:          opts.Now,
		newBackend:   newACMEBackend,
	}
	if m.logf == nil {
		m.logf = log.Printf
	}
	if m.now == nil {
		m.now = time.Now
	}
	st := &state{mode: opts.Mode}
	if m.serving {
		if err := os.MkdirAll(m.dir, 0o700); err != nil {
			return nil, fmt.Errorf("tlsmgr: create %s: %w", m.dir, err)
		}
		cert, generated, err := loadOrCreateSelfSigned(m.dir, opts.SelfSignedHosts, m.now())
		if err != nil {
			return nil, err
		}
		st.selfSigned = cert
		info := certInfo(cert, config.TLSModeSelfSigned, m.now())
		if generated {
			m.logf("castor: tls: generated self-signed certificate in %s (sans %s, sha256 %s)", m.dir, strings.Join(info.SANs, ","), info.FingerprintSHA256)
		} else {
			m.logf("castor: tls: loaded self-signed certificate from %s (expires %s)", m.dir, time.Unix(info.NotAfter, 0).UTC().Format("2006-01-02"))
		}
	}
	m.state.Store(st)
	return m, nil
}

// Serving reports whether the HTTPS listener was started (startup mode != off).
func (m *Manager) Serving() bool { return m.serving }

// ManagedByEnv reports whether CASTOR_TLS_MODE=off forced the mode, in which
// case the persisted setting is ignored and the API refuses TLS changes.
func (m *Manager) ManagedByEnv() bool { return m.managedByEnv }

// Close stops the ACME background work (refresh loop, pending issuances).
func (m *Manager) Close() {
	if a := m.state.Load().acme; a != nil {
		a.cancel()
	}
}

// Mode returns the configured mode (the persisted setting after a SetMode).
func (m *Manager) Mode() string { return m.state.Load().mode }

// EffectiveMode returns the mode actually in effect for handshakes: "off" when
// no HTTPS listener runs; "custom" or "acme" only when that source currently
// has a valid (unexpired) certificate; otherwise "self-signed" (the fallback).
func (m *Manager) EffectiveMode() string {
	if !m.serving {
		return config.TLSModeOff
	}
	st := m.state.Load()
	now := m.now()
	switch st.mode {
	case config.TLSModeCustom:
		if st.custom != nil && certValid(st.custom, now) {
			return config.TLSModeCustom
		}
	case config.TLSModeACME:
		if st.acme != nil {
			if c, _ := st.acme.served(now); c != nil {
				return config.TLSModeACME
			}
		}
	}
	return config.TLSModeSelfSigned
}

// HSTS reports whether Strict-Transport-Security should be sent on HTTPS
// responses right now: only while a certificate browsers can trust (custom or
// ACME) is in effect, never while the self-signed fallback is served, and
// never for an expired certificate (EffectiveMode already falls back then).
func (m *Manager) HSTS() bool {
	switch m.EffectiveMode() {
	case config.TLSModeCustom, config.TLSModeACME:
		return true
	}
	return false
}

// SetMode switches the configured mode at runtime. Switching between "off" and
// any other mode needs a restart (listeners are bound at startup); Status
// reports RestartRequired in that case.
func (m *Manager) SetMode(mode string) error {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if !config.IsValidTLSMode(mode) {
		return fmt.Errorf("%w: %q (want self-signed, custom, acme or off)", ErrInvalidMode, mode)
	}
	m.mu.Lock()
	st := *m.state.Load()
	st.mode = mode
	m.state.Store(&st)
	m.mu.Unlock()
	m.logf("castor: tls: mode set to %s (effective %s)", mode, m.EffectiveMode())
	return nil
}

// SetCustom validates and installs an imported certificate (leaf, optional
// chain, private key, all PEM). It does not change the mode; the caller
// persists the sealed key and switches to "custom". The returned CertInfo
// carries the metadata to store (subject, issuer, validity, fingerprint);
// CustomPEM gives the re-serialized chain to persist.
func (m *Manager) SetCustom(certPEM, chainPEM, keyPEM []byte) (*CertInfo, error) {
	cert, err := ParseCustom(certPEM, chainPEM, keyPEM, m.now())
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	st := *m.state.Load()
	st.custom = cert
	m.state.Store(&st)
	m.mu.Unlock()
	info := certInfo(cert, config.TLSModeCustom, m.now())
	m.logf("castor: tls: custom certificate installed (subject %q, issuer %q, expires %s)", info.Subject, info.Issuer, time.Unix(info.NotAfter, 0).UTC().Format("2006-01-02"))
	return info, nil
}

// CustomPEM returns the installed custom certificate re-serialized as PEM
// CERTIFICATE blocks (leaf, then intermediates), the only form to persist; see
// EncodeChainPEM. Nil when no custom certificate is installed.
func (m *Manager) CustomPEM() (leafPEM, chainPEM []byte) {
	return EncodeChainPEM(m.state.Load().custom)
}

// ClearCustom drops the imported certificate; "custom" mode then falls back
// to the self-signed certificate.
func (m *Manager) ClearCustom() {
	m.mu.Lock()
	st := *m.state.Load()
	st.custom = nil
	m.state.Store(&st)
	m.mu.Unlock()
	m.logf("castor: tls: custom certificate removed (effective %s)", m.EffectiveMode())
}

// SetACME validates and applies the ACME parameters. Unchanged parameters keep
// the current autocert manager (and its renewal timers); otherwise a new one
// replaces it, the served certificates of domains still configured are carried
// over, and the cache entries of dropped domains are removed. Issuance runs in
// the background: the call returns at once and Status reports the outcome. It
// does not change the mode. Let's Encrypt must reach port 80 (HTTP-01, served
// on CASTOR_HTTP_ADDR) or 443 (TLS-ALPN-01, on CASTOR_HTTPS_ADDR) of every
// domain.
func (m *Manager) SetACME(domains []string, email string, staging bool) error {
	doms, err := validateDomains(domains)
	if err != nil {
		return err
	}
	mail, err := validateEmail(email)
	if err != nil {
		return err
	}
	if cur := m.state.Load().acme; cur != nil && cur.same(doms, mail, staging) {
		m.warmACME(cur)
		return nil
	}
	cfg := m.installACME(doms, mail, staging, m.newBackend(m.dir, doms, mail, staging))
	m.logf("castor: tls: acme configured for %s (staging=%t); Let's Encrypt must reach port 80/443 of these names", strings.Join(cfg.domains, ","), staging)
	m.startACME(cfg, true)
	return nil
}

// Renew forces a fresh issuance for every configured domain: the cache entries
// are deleted, a new autocert manager replaces the current one (autocert keeps
// serving from memory otherwise) and each domain is obtained again, while
// visitors keep getting the current certificates until the new ones land. It
// returns nil once every domain has a fresh certificate, the first issuance
// error otherwise, or ctx's error when ctx ends first; issuance then carries
// on in the background and Status reports its outcome.
func (m *Manager) Renew(ctx context.Context) error {
	cur := m.state.Load().acme
	if cur == nil {
		return fmt.Errorf("%w: no domain is configured", ErrInvalidACMEConfig)
	}
	for _, d := range cur.domains {
		deleteCached(ctx, cur.cache, d)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	cfg := m.installACME(cur.domains, cur.email, cur.staging, m.newBackend(m.dir, cur.domains, cur.email, cur.staging))
	m.logf("castor: tls: acme renewal requested for %s", strings.Join(cfg.domains, ","))
	var first error
	for _, p := range m.startACME(cfg, false) {
		select {
		case <-p.done:
			if p.err != nil && first == nil {
				first = p.err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return first
}

// installACME swaps in a new ACME configuration and resets its statistics.
// Domains are normalized (lower-case, no trailing dot) so the SNI whitelist
// matches whatever the caller passed. The previous configuration, if any, is
// stopped, its served certificates for domains still configured are inherited,
// and its cache entries for dropped domains are deleted. Split from SetACME so
// tests can install a fake backend without a CA.
func (m *Manager) installACME(domains []string, email string, staging bool, b acmeBackend) *acmeConfig {
	norm := make([]string, 0, len(domains))
	for _, d := range domains {
		norm = append(norm, strings.ToLower(strings.TrimSuffix(strings.TrimSpace(d), ".")))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cfg := &acmeConfig{
		domains: norm, email: email, staging: staging,
		getter: b.getter, cache: b.cache, http: b.http,
		ctx: ctx, cancel: cancel,
		certs: map[string]*tls.Certificate{}, inflight: map[string]*pending{},
	}
	m.mu.Lock()
	prev := m.state.Load().acme
	m.acmeMu.Lock()
	m.acmeGen++
	cfg.gen = m.acmeGen
	m.acme = acmeStats{gen: cfg.gen}
	m.acmeMu.Unlock()
	if prev != nil {
		cfg.inherit(prev)
	}
	st := *m.state.Load()
	st.acme = cfg
	m.state.Store(&st)
	m.mu.Unlock()
	if prev != nil {
		prev.cancel()
		dctx, dcancel := context.WithTimeout(context.Background(), acmePreloadTimeout)
		defer dcancel()
		for _, d := range prev.domains {
			if !cfg.allows(d) {
				deleteCached(dctx, prev.cache, d)
			}
		}
	}
	return cfg
}

// startACME brings a configuration to life: optionally seeds the served set
// from the on-disk cache, starts an issuance for every domain and the refresh
// loop. It returns the pending issuances.
func (m *Manager) startACME(cfg *acmeConfig, preload bool) []*pending {
	if preload {
		m.preloadACME(cfg)
	}
	go m.runACMERefresh(cfg)
	return m.warmACME(cfg)
}

// recordACME updates the ACME bookkeeping for one issuance outcome, ignoring
// results from a superseded configuration. Errors are logged when they change
// so a misconfigured DNS/port does not flood the log on every attempt.
func (m *Manager) recordACME(gen uint64, cert *tls.Certificate, err error) {
	m.acmeMu.Lock()
	defer m.acmeMu.Unlock()
	if gen != m.acme.gen {
		return
	}
	now := m.now()
	if err != nil {
		msg := err.Error()
		if msg != m.acme.lastError {
			if m.acme.ok {
				m.logf("castor: tls: acme renewal failed, the current certificate stays in use: %s", msg)
			} else {
				m.logf("castor: tls: acme issuance failed, serving the self-signed certificate meanwhile: %s", msg)
			}
		}
		m.acme.lastError = msg
		m.acme.lastErrorAt = now
		return
	}
	if !m.acme.ok {
		info := certInfo(cert, config.TLSModeACME, now)
		m.logf("castor: tls: acme certificate ready (%s, expires %s)", info.Subject, time.Unix(info.NotAfter, 0).UTC().Format("2006-01-02"))
	}
	m.acme.ok = true
	m.acme.lastError = ""
	m.acme.lastErrorAt = time.Time{}
}

// GetCertificate implements tls.Config.GetCertificate. It never returns an
// error while TLS is on and never waits on a certificate authority: it serves
// only material already at hand (the imported certificate while it is valid,
// the ACME served set) and otherwise the self-signed certificate. An ACME
// domain without a served certificate triggers its issuance in the background
// (one attempt per domain at a time) so a later handshake gets it.
func (m *Manager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	st := m.state.Load()
	now := m.now()
	switch st.mode {
	case config.TLSModeCustom:
		if st.custom != nil && certValid(st.custom, now) {
			return st.custom, nil
		}
	case config.TLSModeACME:
		if a := st.acme; a != nil {
			if isACMEALPN(hello) {
				if cert, err := a.getter.GetCertificate(hello); err == nil {
					return cert, nil
				}
			} else if domain, ok := a.match(hello.ServerName); ok {
				if cert := a.cached(domain, now); cert != nil {
					return cert, nil
				}
				m.obtainAsync(a, domain)
			}
		}
	}
	if st.selfSigned == nil {
		return nil, errors.New("tlsmgr: no certificate available (TLS is off)")
	}
	return st.selfSigned, nil
}

// TLSConfig returns the listener configuration: TLS 1.2+, certificates from
// GetCertificate, HTTP/2 + HTTP/1.1 via ALPN plus the ACME TLS-ALPN-01 proto.
func (m *Manager) TLSConfig() *tls.Config {
	return &tls.Config{
		GetCertificate: m.GetCertificate,
		MinVersion:     tls.VersionTLS12,
		NextProtos:     []string{"h2", "http/1.1", acme.ALPNProto},
	}
}

// currentCert returns the certificate a regular visitor gets right now and
// its source label, or nil when TLS is off.
func (m *Manager) currentCert() (*tls.Certificate, string) {
	st := m.state.Load()
	now := m.now()
	switch st.mode {
	case config.TLSModeCustom:
		if st.custom != nil && certValid(st.custom, now) {
			return st.custom, config.TLSModeCustom
		}
	case config.TLSModeACME:
		if st.acme != nil {
			if c, _ := st.acme.served(now); c != nil {
				return c, config.TLSModeACME
			}
		}
	}
	if st.selfSigned == nil {
		return nil, ""
	}
	return st.selfSigned, config.TLSModeSelfSigned
}

// CurrentCertPEM returns the PEM chain (leaf first) of the certificate
// currently served — public material only, never the key — so the operator can
// download and trust the self-signed certificate. Nil when TLS is off.
func (m *Manager) CurrentCertPEM() []byte {
	cert, _ := m.currentCert()
	if cert == nil {
		return nil
	}
	var out []byte
	for _, der := range cert.Certificate {
		out = append(out, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}
	return out
}

// CertInfo describes a certificate without exposing key material.
type CertInfo struct {
	// Source is self-signed, custom or acme.
	Source            string   `json:"source"`
	Subject           string   `json:"subject"`
	Issuer            string   `json:"issuer"`
	NotBefore         int64    `json:"notBefore"`
	NotAfter          int64    `json:"notAfter"`
	SANs              []string `json:"sans"`
	FingerprintSHA256 string   `json:"fingerprintSha256"`
	// DaysLeft is the whole days until NotAfter, floored at 0.
	DaysLeft   int  `json:"daysLeft"`
	SelfSigned bool `json:"selfSigned"`
	// Expired is true once NotAfter has passed.
	Expired bool `json:"expired"`
}

// ACMEStatus reports the ACME configuration and the last issuance outcome.
type ACMEStatus struct {
	Domains []string `json:"domains"`
	Email   string   `json:"email"`
	Staging bool     `json:"staging"`
	// Ready is true once a certificate has been obtained for this configuration.
	Ready       bool   `json:"ready"`
	LastError   string `json:"lastError,omitempty"`
	LastErrorAt int64  `json:"lastErrorAt,omitempty"`
	// LastIssued is the validity start of the ACME certificate currently served
	// (the CA's issuance time, minus its backdating); it changes only when that
	// certificate does. Zero while none is served.
	LastIssued int64 `json:"lastIssued,omitempty"`
}

// Status is the read model for the Settings UI.
type Status struct {
	Mode          string `json:"mode"`
	EffectiveMode string `json:"effectiveMode"`
	HTTPSAddr     string `json:"httpsAddr"`
	// ManagedByEnv is true when CASTOR_TLS_MODE=off forces the mode.
	ManagedByEnv bool `json:"managedByEnv"`
	// Serving is true when the HTTPS listener is active.
	Serving bool `json:"serving"`
	// RestartRequired is true when the configured mode toggles the HTTPS
	// listener on or off relative to what was bound at startup.
	RestartRequired bool `json:"restartRequired"`
	// Expired is true when the configured mode's certificate (custom or ACME)
	// has expired, so the self-signed fallback is in effect.
	Expired bool `json:"expired"`
	// HSTS is true when Strict-Transport-Security is currently sent.
	HSTS bool `json:"hsts"`
	// Certificate is what visitors currently get; nil when TLS is off.
	Certificate *CertInfo `json:"certificate"`
	// Custom is the imported certificate, present even when another mode is
	// active so the UI can show what would be served after switching.
	Custom *CertInfo   `json:"custom,omitempty"`
	ACME   *ACMEStatus `json:"acme,omitempty"`
}

// Status returns a snapshot for the API. It performs no I/O.
func (m *Manager) Status() Status {
	st := m.state.Load()
	now := m.now()
	s := Status{
		Mode:            st.mode,
		EffectiveMode:   m.EffectiveMode(),
		HTTPSAddr:       m.httpsAddr,
		ManagedByEnv:    m.managedByEnv,
		Serving:         m.serving,
		RestartRequired: m.serving != (st.mode != config.TLSModeOff),
		HSTS:            m.HSTS(),
	}
	if cert, src := m.currentCert(); cert != nil {
		s.Certificate = certInfo(cert, src, now)
	}
	if st.custom != nil {
		s.Custom = certInfo(st.custom, config.TLSModeCustom, now)
	}
	if m.serving {
		switch st.mode {
		case config.TLSModeCustom:
			s.Expired = st.custom != nil && !certValid(st.custom, now)
		case config.TLSModeACME:
			if st.acme != nil {
				_, s.Expired = st.acme.served(now)
			}
		}
	}
	if a := st.acme; a != nil {
		as := &ACMEStatus{Domains: append([]string(nil), a.domains...), Email: a.email, Staging: a.staging}
		m.acmeMu.Lock()
		if m.acme.gen == a.gen {
			as.Ready = m.acme.ok
			as.LastError = m.acme.lastError
			if !m.acme.lastErrorAt.IsZero() {
				as.LastErrorAt = m.acme.lastErrorAt.Unix()
			}
		}
		m.acmeMu.Unlock()
		if c, _ := a.served(now); c != nil {
			if leaf := leafOf(c); leaf != nil {
				as.LastIssued = leaf.NotBefore.Unix()
			}
		}
		s.ACME = as
	}
	return s
}

// leafOf returns the parsed leaf of cert, parsing it when Leaf is unset.
func leafOf(cert *tls.Certificate) *x509.Certificate {
	if cert == nil {
		return nil
	}
	if cert.Leaf != nil {
		return cert.Leaf
	}
	if len(cert.Certificate) == 0 {
		return nil
	}
	leaf, _ := x509.ParseCertificate(cert.Certificate[0])
	return leaf
}

// certValid reports whether cert's leaf has not expired at now.
func certValid(cert *tls.Certificate, now time.Time) bool {
	leaf := leafOf(cert)
	return leaf != nil && now.Before(leaf.NotAfter)
}

// sameCert reports whether a and b are the same certificate (serial number
// and validity start), both nil included.
func sameCert(a, b *tls.Certificate) bool {
	la, lb := leafOf(a), leafOf(b)
	if la == nil || lb == nil {
		return la == lb
	}
	return la.SerialNumber.Cmp(lb.SerialNumber) == 0 && la.NotBefore.Equal(lb.NotBefore)
}

// certInfo extracts the public description of cert.
func certInfo(cert *tls.Certificate, source string, now time.Time) *CertInfo {
	leaf := leafOf(cert)
	if leaf == nil {
		return &CertInfo{Source: source}
	}
	sum := sha256.Sum256(leaf.Raw)
	info := &CertInfo{
		Source:            source,
		Subject:           leaf.Subject.String(),
		Issuer:            leaf.Issuer.String(),
		NotBefore:         leaf.NotBefore.Unix(),
		NotAfter:          leaf.NotAfter.Unix(),
		SANs:              make([]string, 0, len(leaf.DNSNames)+len(leaf.IPAddresses)),
		FingerprintSHA256: fingerprint(sum[:]),
		SelfSigned:        leaf.Subject.String() == leaf.Issuer.String() && len(cert.Certificate) == 1,
		Expired:           !now.Before(leaf.NotAfter),
	}
	info.SANs = append(info.SANs, leaf.DNSNames...)
	for _, ip := range leaf.IPAddresses {
		info.SANs = append(info.SANs, ip.String())
	}
	if d := leaf.NotAfter.Sub(now); d > 0 {
		info.DaysLeft = int(d / (24 * time.Hour))
	}
	return info
}

// fingerprint formats a digest as upper-case colon-separated hex pairs, the
// form browsers and openssl display.
func fingerprint(sum []byte) string {
	h := strings.ToUpper(hex.EncodeToString(sum))
	parts := make([]string, 0, len(h)/2)
	for i := 0; i+2 <= len(h); i += 2 {
		parts = append(parts, h[i:i+2])
	}
	return strings.Join(parts, ":")
}
