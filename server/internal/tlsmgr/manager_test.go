// Castor by IT Leonard
package tlsmgr

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/acme/autocert"

	"github.com/gtek-it/castor/server/internal/config"
)

// fakeGetter stands in for autocert: it returns a fixed certificate or fails,
// blocks until release is closed when one is set (a slow CA), and counts calls
// so tests can prove the whitelist gate and the per-domain de-duplication.
type fakeGetter struct {
	mu      sync.Mutex
	cert    *tls.Certificate
	err     error
	release chan struct{}
	calls   atomic.Int32
}

func (f *fakeGetter) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	f.calls.Add(1)
	if f.release != nil {
		<-f.release
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cert, f.err
}

func fakeBackend(g certGetter, cache autocert.Cache, h http.Handler) acmeBackend {
	if h == nil {
		h = http.NotFoundHandler()
	}
	return acmeBackend{getter: g, cache: cache, http: h}
}

// testLogf forwards to t.Logf until the test ends; background issuances may
// still log after that, which t.Logf would turn into a panic.
func testLogf(t *testing.T) func(string, ...any) {
	var mu sync.Mutex
	done := false
	t.Cleanup(func() {
		mu.Lock()
		done = true
		mu.Unlock()
	})
	return func(format string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		if !done {
			t.Logf(format, args...)
		}
	}
}

func newTestManager(t *testing.T, mode string) *Manager {
	t.Helper()
	m, err := New(Options{Dir: filepath.Join(t.TempDir(), "tls"), Mode: mode, HTTPSAddr: ":8443", Logf: testLogf(t)})
	if err != nil {
		t.Fatalf("New(%s): %v", mode, err)
	}
	t.Cleanup(m.Close)
	return m
}

// waitFor polls cond for a few seconds; background issuance is asynchronous.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// issuedCertAt builds a certificate that plays the role of an ACME-issued one.
func issuedCertAt(t *testing.T, cn string, notBefore, notAfter time.Time) *tls.Certificate {
	t.Helper()
	k := ecKey(t)
	certPEM, _ := testCert(t, cn, &k.PublicKey, notBefore, notAfter, false, nil, k)
	cert, err := tls.X509KeyPair(certPEM, pemKey(t, k))
	if err != nil {
		t.Fatal(err)
	}
	if cert.Leaf == nil {
		cert.Leaf, _ = x509.ParseCertificate(cert.Certificate[0])
	}
	return &cert
}

func issuedCert(t *testing.T, cn string) *tls.Certificate {
	t.Helper()
	now := time.Now()
	return issuedCertAt(t, cn, now.Add(-time.Hour), now.Add(24*time.Hour))
}

func fp(t *testing.T, c *tls.Certificate) string {
	t.Helper()
	return certInfo(c, "x", time.Now()).FingerprintSHA256
}

func TestResolveMode(t *testing.T) {
	cases := []struct {
		env, persisted, want string
		managed              bool
	}{
		{"off", "", "off", true},
		{"off", "acme", "off", true},
		{" OFF ", "custom", "off", true},
		{"self-signed", "", "self-signed", false},
		{"self-signed", "custom", "custom", false},
		{"self-signed", " ACME ", "acme", false},
		{"acme", "self-signed", "self-signed", false},
		{"custom", "off", "custom", false},
		{"self-signed", "bogus", "self-signed", false},
		{"", "", "self-signed", false},
	}
	for _, c := range cases {
		mode, managed := ResolveMode(c.env, c.persisted)
		if mode != c.want || managed != c.managed {
			t.Errorf("ResolveMode(%q, %q) = %q, %t want %q, %t", c.env, c.persisted, mode, managed, c.want, c.managed)
		}
	}
}

func TestManagedByEnvIsReported(t *testing.T) {
	m, err := New(Options{Dir: filepath.Join(t.TempDir(), "tls"), Mode: config.TLSModeOff, ManagedByEnv: true, HTTPSAddr: ":8443", Logf: testLogf(t)})
	if err != nil {
		t.Fatal(err)
	}
	st := m.Status()
	if !m.ManagedByEnv() || !st.ManagedByEnv || st.Serving || m.Serving() || st.HSTS || st.Expired {
		t.Errorf("env-managed off status = %+v", st)
	}
	if m := newTestManager(t, config.TLSModeSelfSigned); m.ManagedByEnv() || !m.Status().Serving {
		t.Errorf("a resolved mode must not report ManagedByEnv, and must report Serving")
	}
}

func TestACMEFailureFallsBackToSelfSigned(t *testing.T) {
	m := newTestManager(t, config.TLSModeACME)
	self := m.state.Load().selfSigned
	fg := &fakeGetter{err: errors.New("acme: dns problem: NXDOMAIN")}
	m.installACME([]string{"castor.example.test"}, "", false, fakeBackend(fg, nil, nil))

	got, err := m.GetCertificate(&tls.ClientHelloInfo{ServerName: "castor.example.test"})
	if err != nil {
		t.Fatalf("GetCertificate must never fail while TLS is on: %v", err)
	}
	if fp(t, got) != fp(t, self) {
		t.Errorf("expected the self-signed fallback")
	}
	waitFor(t, "issuance error", func() bool { return m.Status().ACME.LastError != "" })
	if n := fg.calls.Load(); n != 1 {
		t.Errorf("autocert calls = %d want 1", n)
	}
	if em := m.EffectiveMode(); em != config.TLSModeSelfSigned {
		t.Errorf("EffectiveMode = %q want self-signed", em)
	}
	st := m.Status()
	if st.Mode != config.TLSModeACME || st.ACME == nil || st.ACME.Ready || !strings.Contains(st.ACME.LastError, "NXDOMAIN") || st.ACME.LastErrorAt == 0 || st.ACME.LastIssued != 0 {
		t.Errorf("Status.ACME = %+v", st.ACME)
	}
	if st.Certificate == nil || st.Certificate.Source != config.TLSModeSelfSigned {
		t.Errorf("Status.Certificate = %+v want self-signed source", st.Certificate)
	}
	if st.HSTS || st.Expired || m.HSTS() {
		t.Errorf("the fallback must neither advertise HSTS nor expiry: %+v", st)
	}

	// A hostname outside the whitelist never reaches autocert and records no error.
	fg2 := &fakeGetter{err: errors.New("should not be called")}
	m.installACME([]string{"castor.example.test"}, "", false, fakeBackend(fg2, nil, nil))
	got, _ = m.GetCertificate(&tls.ClientHelloInfo{ServerName: "192.0.2.1"})
	if fp(t, got) != fp(t, self) || fg2.calls.Load() != 0 {
		t.Errorf("unknown SNI must serve self-signed without calling autocert (calls=%d)", fg2.calls.Load())
	}
	if le := m.Status().ACME.LastError; le != "" {
		t.Errorf("unknown SNI must not record an ACME error, got %q", le)
	}
}

func TestACMESuccessServesIssuedCertificate(t *testing.T) {
	m := newTestManager(t, config.TLSModeACME)
	issued := issuedCert(t, "castor.example.test")
	fg := &fakeGetter{cert: issued}
	m.installACME([]string{"Castor.Example.Test"}, "ops@example.test", true, fakeBackend(fg, nil, nil))
	hello := &tls.ClientHelloInfo{ServerName: "castor.example.test."}

	// The first handshake gets the fallback at once and triggers the issuance.
	got, err := m.GetCertificate(hello)
	if err != nil {
		t.Fatal(err)
	}
	if fp(t, got) == fp(t, issued) {
		t.Fatalf("the first handshake must not wait for the issuance")
	}
	waitFor(t, "issued certificate", func() bool { c, _ := m.GetCertificate(hello); return fp(t, c) == fp(t, issued) })
	if em := m.EffectiveMode(); em != config.TLSModeACME {
		t.Errorf("EffectiveMode = %q want acme", em)
	}
	st := m.Status()
	if st.Certificate == nil || st.Certificate.Source != config.TLSModeACME || st.Certificate.Subject != "CN=castor.example.test" || st.Certificate.Expired {
		t.Errorf("Status.Certificate = %+v", st.Certificate)
	}
	if st.ACME == nil || !st.ACME.Ready || st.ACME.LastIssued != issued.Leaf.NotBefore.Unix() || !st.ACME.Staging || st.ACME.Email != "ops@example.test" {
		t.Errorf("Status.ACME = %+v", st.ACME)
	}
	if !st.HSTS || st.Expired {
		t.Errorf("a served ACME certificate must enable HSTS: %+v", st)
	}

	// CurrentCertPEM is public material only.
	pemOut := m.CurrentCertPEM()
	if strings.Contains(string(pemOut), "PRIVATE KEY") {
		t.Fatalf("CurrentCertPEM leaked key material")
	}
	blk, _ := pem.Decode(pemOut)
	if blk == nil || blk.Type != "CERTIFICATE" {
		t.Fatalf("CurrentCertPEM is not a certificate PEM")
	}
	leaf, err := x509.ParseCertificate(blk.Bytes)
	if err != nil || leaf.Subject.CommonName != "castor.example.test" {
		t.Errorf("CurrentCertPEM leaf = %v, %v", leaf, err)
	}

	// A TLS-ALPN-01 validation hello reaches autocert even without a matching SNI.
	before := fg.calls.Load()
	if _, err := m.GetCertificate(&tls.ClientHelloInfo{ServerName: "other.example.test", SupportedProtos: []string{"acme-tls/1"}}); err != nil {
		t.Fatal(err)
	}
	if fg.calls.Load() != before+1 {
		t.Errorf("ALPN challenge hello must be forwarded to autocert")
	}

	// Re-obtaining the same certificate (the refresh loop) leaves LastIssued
	// alone; a renewed certificate moves it.
	cfg := m.state.Load().acme
	for _, p := range m.warmACME(cfg) {
		<-p.done
	}
	if got := m.Status().ACME.LastIssued; got != issued.Leaf.NotBefore.Unix() {
		t.Errorf("LastIssued changed on a re-obtain of the same certificate: %d", got)
	}
	renewed := issuedCertAt(t, "castor.example.test", time.Now().Add(-30*time.Minute), time.Now().Add(48*time.Hour))
	fg.set(renewed, nil)
	for _, p := range m.warmACME(cfg) {
		<-p.done
	}
	if c, _ := m.GetCertificate(hello); fp(t, c) != fp(t, renewed) {
		t.Errorf("renewed certificate must be served")
	}
	if got := m.Status().ACME.LastIssued; got != renewed.Leaf.NotBefore.Unix() {
		t.Errorf("LastIssued = %d want the renewed certificate's NotBefore %d", got, renewed.Leaf.NotBefore.Unix())
	}

	// A replacement configuration for the same domain inherits the served
	// certificate: visitors keep it while the new issuance fails.
	fg3 := &fakeGetter{err: errors.New("rate limited")}
	cfg3 := m.installACME([]string{"castor.example.test"}, "", false, fakeBackend(fg3, nil, nil))
	if c, _ := m.GetCertificate(hello); fp(t, c) != fp(t, renewed) {
		t.Errorf("the served certificate must survive a configuration change for the same domain")
	}
	for _, p := range m.warmACME(cfg3) {
		<-p.done
	}
	st = m.Status()
	if st.EffectiveMode != config.TLSModeACME || st.ACME.Ready || !strings.Contains(st.ACME.LastError, "rate limited") || !st.HSTS {
		t.Errorf("after a failed re-issuance: %+v / %+v", st, st.ACME)
	}

	// A configuration for another domain has nothing to serve: fallback.
	m.installACME([]string{"other.example.test"}, "", false, fakeBackend(&fakeGetter{err: errors.New("x")}, nil, nil))
	if em := m.EffectiveMode(); em != config.TLSModeSelfSigned {
		t.Errorf("EffectiveMode for an unserved domain = %q want self-signed", em)
	}
	if c, _ := m.GetCertificate(hello); c.Leaf.Subject.CommonName != selfSignedCN {
		t.Errorf("a domain no longer configured must get the fallback")
	}
}

func (f *fakeGetter) set(cert *tls.Certificate, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cert, f.err = cert, err
}

// TestACMEHandshakeNeverBlocks: with a CA that never answers, handshakes still
// complete immediately with the fallback and a single issuance runs for the
// domain however many hellos arrive.
func TestACMEHandshakeNeverBlocks(t *testing.T) {
	m := newTestManager(t, config.TLSModeACME)
	issued := issuedCert(t, "castor.example.test")
	fg := &fakeGetter{cert: issued, release: make(chan struct{})}
	m.installACME([]string{"castor.example.test"}, "", false, fakeBackend(fg, nil, nil))
	hello := &tls.ClientHelloInfo{ServerName: "castor.example.test"}

	start := time.Now()
	var wg sync.WaitGroup
	var wrong atomic.Int32
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, err := m.GetCertificate(hello)
			if err != nil || c == nil || c.Leaf == nil || c.Leaf.Subject.CommonName != selfSignedCN {
				wrong.Add(1)
			}
		}()
	}
	wg.Wait()
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Errorf("16 handshakes took %s against a stalled issuer; they must not block", d)
	}
	if wrong.Load() != 0 {
		t.Errorf("%d handshakes did not get the self-signed fallback", wrong.Load())
	}
	// Exactly one issuance is started for the domain, however many hellos.
	waitFor(t, "issuance to start", func() bool { return fg.calls.Load() >= 1 })
	if _, err := m.GetCertificate(hello); err != nil {
		t.Fatal(err)
	}
	if n := fg.calls.Load(); n != 1 {
		t.Errorf("issuance must run once per domain, got %d calls", n)
	}
	if st := m.Status(); st.ACME.Ready || st.EffectiveMode != config.TLSModeSelfSigned || st.HSTS {
		t.Errorf("status while the issuer stalls = %+v / %+v", st, st.ACME)
	}

	close(fg.release)
	waitFor(t, "issued certificate", func() bool { c, _ := m.GetCertificate(hello); return fp(t, c) == fp(t, issued) })
	if st := m.Status(); !st.ACME.Ready || st.EffectiveMode != config.TLSModeACME {
		t.Errorf("status once issued = %+v / %+v", st, st.ACME)
	}
	if n := fg.calls.Load(); n != 1 {
		t.Errorf("serving from the cache must not call the issuer again, got %d calls", n)
	}
}

// TestSetACMEReuseAndRenew: unchanged parameters keep the backend; Renew wipes
// the cache entries, builds a fresh backend and swaps the certificate in while
// the previous one stays served; dropped domains leave the cache.
func TestSetACMEReuseAndRenew(t *testing.T) {
	m := newTestManager(t, config.TLSModeACME)
	dir := t.TempDir()
	cache := autocert.DirCache(dir)
	hello := &tls.ClientHelloInfo{ServerName: "castor.example.test"}
	first := issuedCert(t, "castor.example.test")
	second := issuedCertAt(t, "castor.example.test", time.Now().Add(-30*time.Minute), time.Now().Add(48*time.Hour))

	var made atomic.Int32
	current := &fakeGetter{cert: first}
	m.newBackend = func(_ string, _ []string, _ string, _ bool) acmeBackend {
		made.Add(1)
		return fakeBackend(current, cache, nil)
	}
	if err := m.SetACME([]string{"castor.example.test"}, "ops@example.test", false); err != nil {
		t.Fatal(err)
	}
	cfg := m.state.Load().acme
	waitFor(t, "first issuance", func() bool { return m.Status().ACME.Ready })
	if c, _ := m.GetCertificate(hello); fp(t, c) != fp(t, first) {
		t.Fatalf("first certificate not served")
	}

	// Same parameters (modulo normalization): the backend is kept.
	if err := m.SetACME([]string{" CASTOR.example.test. "}, "ops@example.test", false); err != nil {
		t.Fatal(err)
	}
	if m.state.Load().acme != cfg || made.Load() != 1 {
		t.Errorf("unchanged parameters must reuse the configuration (backends built: %d)", made.Load())
	}

	// Renew: cache entries go, a fresh backend obtains the new certificate,
	// and the old one is served until it lands.
	for _, name := range []string{"castor.example.test", "castor.example.test+rsa"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("stale"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	current = &fakeGetter{cert: second, release: make(chan struct{})}
	renewErr := make(chan error, 1)
	go func() { renewErr <- m.Renew(context.Background()) }()
	waitFor(t, "renewal to start", func() bool { return m.state.Load().acme != cfg })
	if c, _ := m.GetCertificate(hello); fp(t, c) != fp(t, first) {
		t.Errorf("the previous certificate must stay served during the renewal")
	}
	if st := m.Status(); st.ACME.Ready || st.EffectiveMode != config.TLSModeACME || st.ACME.LastIssued != first.Leaf.NotBefore.Unix() {
		t.Errorf("status during renewal = %+v / %+v", st, st.ACME)
	}
	for _, name := range []string{"castor.example.test", "castor.example.test+rsa"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("cache entry %s must be deleted before re-obtaining (err=%v)", name, err)
		}
	}
	close(current.release)
	if err := <-renewErr; err != nil {
		t.Fatalf("Renew: %v", err)
	}
	if c, _ := m.GetCertificate(hello); fp(t, c) != fp(t, second) {
		t.Errorf("renewed certificate not served")
	}
	if st := m.Status(); !st.ACME.Ready || st.ACME.LastIssued != second.Leaf.NotBefore.Unix() || made.Load() != 2 {
		t.Errorf("status after renewal = %+v / %+v (backends built: %d)", st, st.ACME, made.Load())
	}

	// A failed renewal reports the issuer error and keeps the certificate.
	current = &fakeGetter{err: errors.New("acme: rate limited")}
	if err := m.Renew(context.Background()); err == nil || !strings.Contains(err.Error(), "rate limited") {
		t.Errorf("Renew with a failing issuer = %v", err)
	}
	if c, _ := m.GetCertificate(hello); fp(t, c) != fp(t, second) {
		t.Errorf("a failed renewal must keep the current certificate")
	}
	if st := m.Status(); st.ACME.Ready || !strings.Contains(st.ACME.LastError, "rate limited") || st.EffectiveMode != config.TLSModeACME {
		t.Errorf("status after failed renewal = %+v / %+v", st, st.ACME)
	}

	// A renewal cut short by ctx returns its error; issuance goes on.
	current = &fakeGetter{cert: second, release: make(chan struct{})}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := m.Renew(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("Renew with an expired ctx = %v", err)
	}
	close(current.release)
	waitFor(t, "background completion", func() bool { return m.Status().ACME.Ready })

	// Changing the domain set removes the dropped domain from the cache.
	if err := os.WriteFile(filepath.Join(dir, "castor.example.test"), []byte("stale"), 0o600); err != nil {
		t.Fatal(err)
	}
	current = &fakeGetter{cert: issuedCert(t, "new.example.test")}
	if err := m.SetACME([]string{"new.example.test"}, "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "castor.example.test")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("a dropped domain must leave the cache (err=%v)", err)
	}
	if c, _ := m.GetCertificate(hello); c.Leaf.Subject.CommonName != selfSignedCN {
		t.Errorf("a dropped domain must get the fallback")
	}
	waitFor(t, "new domain", func() bool {
		c, _ := m.GetCertificate(&tls.ClientHelloInfo{ServerName: "new.example.test"})
		return c.Leaf.Subject.CommonName == "new.example.test"
	})
}

// TestACMEPreloadFromCache: on SetACME the on-disk autocert cache seeds the
// served set, so a restart serves the obtained certificate before (and
// regardless of) the issuer answering; expired entries are skipped.
func TestACMEPreloadFromCache(t *testing.T) {
	m := newTestManager(t, config.TLSModeACME)
	dir := t.TempDir()
	cache := autocert.DirCache(dir)
	ctx := context.Background()
	now := time.Now()

	entry := func(cn string, notBefore, notAfter time.Time) []byte {
		k := ecKey(t)
		certPEM, _ := testCert(t, cn, &k.PublicKey, notBefore, notAfter, false, nil, k)
		keyDER, err := x509.MarshalECPrivateKey(k)
		if err != nil {
			t.Fatal(err)
		}
		return append(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), certPEM...)
	}
	if err := cache.Put(ctx, "castor.example.test", entry("castor.example.test", now.Add(-time.Hour), now.Add(24*time.Hour))); err != nil {
		t.Fatal(err)
	}
	if err := cache.Put(ctx, "old.example.test", entry("old.example.test", now.Add(-48*time.Hour), now.Add(-time.Hour))); err != nil {
		t.Fatal(err)
	}

	fg := &fakeGetter{err: errors.New("offline"), release: make(chan struct{})}
	defer close(fg.release)
	m.newBackend = func(_ string, _ []string, _ string, _ bool) acmeBackend { return fakeBackend(fg, cache, nil) }
	if err := m.SetACME([]string{"castor.example.test", "old.example.test"}, "", false); err != nil {
		t.Fatal(err)
	}
	c, err := m.GetCertificate(&tls.ClientHelloInfo{ServerName: "castor.example.test"})
	if err != nil || c.Leaf == nil || c.Leaf.Subject.CommonName != "castor.example.test" {
		t.Fatalf("the cached certificate must be served right after SetACME: %v, %v", c, err)
	}
	if c, _ := m.GetCertificate(&tls.ClientHelloInfo{ServerName: "old.example.test"}); c.Leaf.Subject.CommonName != selfSignedCN {
		t.Errorf("an expired cache entry must not be served")
	}
	st := m.Status()
	if !st.ACME.Ready || st.EffectiveMode != config.TLSModeACME || st.Certificate == nil || st.Certificate.Subject != "CN=castor.example.test" || !st.HSTS {
		t.Errorf("status after preload = %+v / %+v", st, st.ACME)
	}
}

// TestCustomCertificateExpiryFallsBack: an imported certificate that expires
// while installed stops being served (self-signed fallback), Status reports
// it and HSTS is withdrawn so the operator can still reach the UI.
func TestCustomCertificateExpiryFallsBack(t *testing.T) {
	var mu sync.Mutex
	clock := time.Now()
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return clock
	}
	m, err := New(Options{Dir: filepath.Join(t.TempDir(), "tls"), Mode: config.TLSModeCustom, HTTPSAddr: ":8443", Logf: testLogf(t), Now: now})
	if err != nil {
		t.Fatal(err)
	}
	self := m.state.Load().selfSigned
	k := ecKey(t)
	certPEM, _ := testCert(t, "short.example.test", &k.PublicKey, clock.Add(-time.Hour), clock.Add(2*time.Hour), false, nil, k)
	if _, err := m.SetCustom(certPEM, nil, pemKey(t, k)); err != nil {
		t.Fatal(err)
	}
	hello := &tls.ClientHelloInfo{ServerName: "short.example.test"}
	if c, _ := m.GetCertificate(hello); c.Leaf.Subject.CommonName != "short.example.test" {
		t.Fatalf("custom certificate not served")
	}
	st := m.Status()
	if st.EffectiveMode != config.TLSModeCustom || !st.HSTS || st.Expired || st.Certificate.Expired || st.Custom.Expired || !m.HSTS() {
		t.Errorf("status before expiry = %+v", st)
	}
	leafPEM, chainPEM := m.CustomPEM()
	if string(leafPEM) != string(certPEM) || chainPEM != nil {
		t.Errorf("CustomPEM must re-serialize the installed leaf (chain empty)")
	}

	mu.Lock()
	clock = clock.Add(3 * time.Hour)
	mu.Unlock()
	c, err := m.GetCertificate(hello)
	if err != nil || fp(t, c) != fp(t, self) {
		t.Errorf("an expired custom certificate must fall back to self-signed (err=%v)", err)
	}
	if em := m.EffectiveMode(); em != config.TLSModeSelfSigned {
		t.Errorf("EffectiveMode after expiry = %q", em)
	}
	st = m.Status()
	if !st.Expired || st.HSTS || m.HSTS() || st.Certificate == nil || st.Certificate.Source != config.TLSModeSelfSigned || st.Certificate.Expired {
		t.Errorf("status after expiry = %+v", st)
	}
	if st.Custom == nil || !st.Custom.Expired || st.Custom.DaysLeft != 0 {
		t.Errorf("Status.Custom after expiry = %+v", st.Custom)
	}

	// A fresh import restores the custom mode.
	certPEM, _ = testCert(t, "fresh.example.test", &k.PublicKey, clock.Add(-time.Hour), clock.Add(24*time.Hour), false, nil, k)
	if _, err := m.SetCustom(certPEM, nil, pemKey(t, k)); err != nil {
		t.Fatal(err)
	}
	if st := m.Status(); st.EffectiveMode != config.TLSModeCustom || st.Expired || !st.HSTS {
		t.Errorf("status after re-import = %+v", st)
	}
}

func TestCustomModeServesImportedCertificate(t *testing.T) {
	m := newTestManager(t, config.TLSModeSelfSigned)
	self := m.state.Load().selfSigned
	now := time.Now()
	k := ecKey(t)
	certPEM, _ := testCert(t, "imported.example.test", &k.PublicKey, now.Add(-time.Hour), now.Add(90*24*time.Hour), false, nil, k)

	info, err := m.SetCustom(certPEM, nil, pemKey(t, k))
	if err != nil {
		t.Fatalf("SetCustom: %v", err)
	}
	if info.Subject != "CN=imported.example.test" || info.DaysLeft < 88 || info.DaysLeft > 90 || info.FingerprintSHA256 == "" || info.Expired {
		t.Errorf("CertInfo = %+v", info)
	}
	// Installing does not switch the mode: self-signed still served.
	if got, _ := m.GetCertificate(&tls.ClientHelloInfo{}); fp(t, got) != fp(t, self) {
		t.Errorf("SetCustom must not change the served certificate before SetMode")
	}
	if st := m.Status(); st.Custom == nil || st.Custom.Subject != "CN=imported.example.test" || st.HSTS {
		t.Errorf("Status.Custom = %+v (hsts=%t)", st.Custom, st.HSTS)
	}

	if err := m.SetMode(config.TLSModeCustom); err != nil {
		t.Fatal(err)
	}
	got, _ := m.GetCertificate(&tls.ClientHelloInfo{ServerName: "whatever"})
	if got.Leaf == nil || got.Leaf.Subject.CommonName != "imported.example.test" {
		t.Errorf("custom mode must serve the imported certificate")
	}
	if em := m.EffectiveMode(); em != config.TLSModeCustom {
		t.Errorf("EffectiveMode = %q want custom", em)
	}
	if !m.HSTS() {
		t.Errorf("HSTS must be on while a valid custom certificate is served")
	}

	m.ClearCustom()
	if got, _ := m.GetCertificate(&tls.ClientHelloInfo{}); fp(t, got) != fp(t, self) {
		t.Errorf("after ClearCustom the self-signed fallback must be served")
	}
	if em := m.EffectiveMode(); em != config.TLSModeSelfSigned {
		t.Errorf("EffectiveMode after ClearCustom = %q", em)
	}
	if st := m.Status(); st.Custom != nil || st.Expired {
		t.Errorf("Status after ClearCustom = %+v", st)
	}
	if leaf, chain := m.CustomPEM(); leaf != nil || chain != nil {
		t.Errorf("CustomPEM must be nil without a custom certificate")
	}

	// A bad import is rejected and leaves the state untouched.
	if _, err := m.SetCustom([]byte("junk"), nil, pemKey(t, k)); !errors.Is(err, ErrInvalidCertificate) {
		t.Errorf("junk import err = %v", err)
	}
}

func TestEncodeChainPEM(t *testing.T) {
	now := time.Now()
	caKey := ecKey(t)
	caPEM, caCert := testCert(t, "Test CA", &caKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, nil, caKey)
	leafKey := ecKey(t)
	leafPEM, _ := testCert(t, "app.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, caCert, caKey)

	// Raw input with junk around the blocks and a stray non-certificate block in
	// the chain field: only the parsed CERTIFICATE blocks come back out. (A
	// private key pasted there is refused outright, see custom_test.go.)
	pubDER, err := x509.MarshalPKIXPublicKey(&leafKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	rawCert := append([]byte("# my cert\n"), leafPEM...)
	rawChain := append(append([]byte{}, caPEM...), pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})...)
	cert, err := ParseCustom(rawCert, rawChain, pemKey(t, leafKey), now)
	if err != nil {
		t.Fatal(err)
	}
	gotLeaf, gotChain := EncodeChainPEM(cert)
	if string(gotLeaf) != string(leafPEM) {
		t.Errorf("leaf PEM differs from the parsed leaf")
	}
	if string(gotChain) != string(caPEM) {
		t.Errorf("chain PEM = %q want the CA only", gotChain)
	}
	if strings.Contains(string(gotLeaf)+string(gotChain), "PRIVATE KEY") {
		t.Fatalf("re-serialized material contains a private key")
	}
	if l, c := EncodeChainPEM(nil); l != nil || c != nil {
		t.Errorf("EncodeChainPEM(nil) must be nil")
	}
}

func TestSetModeValidationAndRestartRequired(t *testing.T) {
	m := newTestManager(t, config.TLSModeSelfSigned)
	if err := m.SetMode("bogus"); !errors.Is(err, ErrInvalidMode) {
		t.Errorf("bogus mode err = %v", err)
	}
	if err := m.SetMode(" OFF "); err != nil {
		t.Fatal(err)
	}
	st := m.Status()
	if st.Mode != config.TLSModeOff || !st.RestartRequired || !st.Serving {
		t.Errorf("mode off while serving must flag RestartRequired: %+v", st)
	}
	// Still serving the fallback until the restart.
	if got, err := m.GetCertificate(&tls.ClientHelloInfo{}); err != nil || got == nil {
		t.Errorf("handshakes must keep working after SetMode(off): %v", err)
	}
	if em := m.EffectiveMode(); em != config.TLSModeSelfSigned {
		t.Errorf("EffectiveMode = %q want self-signed", em)
	}
	if err := m.SetMode(config.TLSModeACME); err != nil {
		t.Fatal(err)
	}
	if st := m.Status(); st.RestartRequired || st.ACME != nil || st.HSTS {
		t.Errorf("acme mode without configuration: %+v", st)
	}
	if err := m.Renew(context.Background()); !errors.Is(err, ErrInvalidACMEConfig) {
		t.Errorf("Renew without configuration err = %v", err)
	}
	// TLSConfig wires the callback and ALPN set.
	tc := m.TLSConfig()
	if tc.GetCertificate == nil || tc.MinVersion != tls.VersionTLS12 || !hasDNS(tc.NextProtos, "h2") || !hasDNS(tc.NextProtos, "acme-tls/1") {
		t.Errorf("TLSConfig = %+v", tc)
	}
}

func TestOffModeTouchesNothing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tls")
	m, err := New(Options{Dir: dir, Mode: config.TLSModeOff, HTTPSAddr: ":8443", Logf: testLogf(t)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("off mode must not create the TLS dir")
	}
	if m.Serving() || m.EffectiveMode() != config.TLSModeOff || m.HSTS() {
		t.Errorf("off mode must report effective off")
	}
	st := m.Status()
	if st.Certificate != nil || st.RestartRequired || st.Serving || st.HSTS || m.CurrentCertPEM() != nil {
		t.Errorf("off status = %+v", st)
	}
	if err := m.SetMode(config.TLSModeSelfSigned); err != nil {
		t.Fatal(err)
	}
	if !m.Status().RestartRequired || m.EffectiveMode() != config.TLSModeOff {
		t.Errorf("enabling TLS from off must require a restart")
	}
}

func TestSetACMEValidation(t *testing.T) {
	m := newTestManager(t, config.TLSModeACME)
	var made atomic.Int32
	m.newBackend = func(_ string, _ []string, _ string, _ bool) acmeBackend {
		made.Add(1)
		return fakeBackend(&fakeGetter{err: errors.New("x")}, nil, nil)
	}
	cases := map[string]struct {
		domains []string
		email   string
	}{
		"empty":     {nil, ""},
		"wildcard":  {[]string{"*.example.test"}, ""},
		"ip":        {[]string{"192.0.2.10"}, ""},
		"no dot":    {[]string{"localhost"}, ""},
		"bad label": {[]string{"bad_host.example.test"}, ""},
		"bad email": {[]string{"ok.example.test"}, "not-an-email"},
	}
	for name, c := range cases {
		if err := m.SetACME(c.domains, c.email, true); !errors.Is(err, ErrInvalidACMEConfig) {
			t.Errorf("%s: err = %v want ErrInvalidACMEConfig", name, err)
		}
	}
	if m.Status().ACME != nil || made.Load() != 0 {
		t.Errorf("rejected configurations must not be installed")
	}
	doms, err := validateDomains([]string{" App.Example.Test. ", "app.example.test", "api.example.test"})
	if err != nil || len(doms) != 2 || doms[0] != "app.example.test" || doms[1] != "api.example.test" {
		t.Errorf("validateDomains = %v, %v", doms, err)
	}
}

func TestHTTPHandlerRoutesChallengesAndRedirects(t *testing.T) {
	m := newTestManager(t, config.TLSModeACME)
	app := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("app")) })
	challenge := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("token")) })

	// Without ACME the challenge path is never redirected; the app answers.
	h := m.HTTPHandler(app, true)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://castor.local:8080/.well-known/acme-challenge/abc", nil))
	if rec.Code != 200 || rec.Body.String() != "app" {
		t.Errorf("no-acme challenge path: %d %q want the app", rec.Code, rec.Body.String())
	}

	m.installACME([]string{"castor.local"}, "", false, fakeBackend(&fakeGetter{err: errors.New("x")}, nil, challenge))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://castor.local:8080/.well-known/acme-challenge/abc", nil))
	if rec.Code != 200 || rec.Body.String() != "token" {
		t.Errorf("challenge not routed to autocert: %d %q", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://castor.local:8080/", nil))
	if rec.Code != http.StatusPermanentRedirect || rec.Header().Get("Location") != "https://castor.local:8443/" {
		t.Errorf("root: code=%d location=%q", rec.Code, rec.Header().Get("Location"))
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://castor.local:8080"+HealthzPath, nil))
	if rec.Code != 200 || rec.Body.String() != "app" {
		t.Errorf("healthz must pass through: %d %q", rec.Code, rec.Body.String())
	}

	// redirect=false: dual-stack, the app answers on plain HTTP too.
	dual := m.HTTPHandler(app, false)
	rec = httptest.NewRecorder()
	dual.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://castor.local:8080/", nil))
	if rec.Code != 200 || rec.Body.String() != "app" {
		t.Errorf("dual mode must serve the app: %d %q", rec.Code, rec.Body.String())
	}

	// Behind a trusted proxy that terminated TLS, nothing is redirected.
	mp, err := New(Options{Dir: filepath.Join(t.TempDir(), "tls"), Mode: config.TLSModeSelfSigned, HTTPSAddr: ":8443", TrustProxy: true, Logf: testLogf(t)})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://castor.local/", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	rec = httptest.NewRecorder()
	mp.HTTPHandler(app, true).ServeHTTP(rec, req)
	if rec.Code != 200 || rec.Body.String() != "app" {
		t.Errorf("proxied https must not be redirected: %d %q", rec.Code, rec.Body.String())
	}
}
