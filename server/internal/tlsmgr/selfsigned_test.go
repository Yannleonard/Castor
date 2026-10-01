// Castor by IT Leonard
package tlsmgr

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func hasDNS(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}

func hasIP(ips []net.IP, want string) bool {
	w := net.ParseIP(want)
	for _, ip := range ips {
		if ip.Equal(w) {
			return true
		}
	}
	return false
}

func TestSelfSignedGenerateAndPersist(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tls")
	now := time.Now()
	cert, generated, err := loadOrCreateSelfSigned(dir, []string{"castor.example.test", "10.0.0.5", " Castor.Example.TEST "}, now)
	if err != nil {
		t.Fatalf("loadOrCreateSelfSigned: %v", err)
	}
	if !generated {
		t.Fatalf("first call must generate")
	}
	leaf := cert.Leaf
	if leaf == nil {
		t.Fatalf("Leaf must be populated")
	}
	if leaf.Subject.CommonName != selfSignedCN {
		t.Errorf("CN = %q want %q", leaf.Subject.CommonName, selfSignedCN)
	}
	if _, ok := leaf.PublicKey.(*ecdsa.PublicKey); !ok || leaf.PublicKey.(*ecdsa.PublicKey).Curve != elliptic.P256() {
		t.Errorf("key must be ECDSA P-256, got %T", leaf.PublicKey)
	}
	for _, want := range []string{"localhost", "castor.example.test"} {
		if !hasDNS(leaf.DNSNames, want) {
			t.Errorf("DNS SANs %v missing %q", leaf.DNSNames, want)
		}
	}
	if hn, err := os.Hostname(); err == nil && hn != "" && !hasDNS(leaf.DNSNames, hn) && !hasIP(leaf.IPAddresses, hn) && isIA5(hn) {
		// Hostname is lower-cased in the SAN set.
		found := false
		for _, n := range leaf.DNSNames {
			if len(n) == len(hn) && equalFoldASCII(n, hn) {
				found = true
			}
		}
		if !found {
			t.Errorf("DNS SANs %v missing hostname %q", leaf.DNSNames, hn)
		}
	}
	for _, want := range []string{"127.0.0.1", "::1", "10.0.0.5"} {
		if !hasIP(leaf.IPAddresses, want) {
			t.Errorf("IP SANs %v missing %s", leaf.IPAddresses, want)
		}
	}
	// De-duplication: the extra host repeated with different case counts once.
	n := 0
	for _, d := range leaf.DNSNames {
		if d == "castor.example.test" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("castor.example.test appears %d times, want 1", n)
	}
	if got := leaf.NotAfter.Sub(now); got < selfSignedValidity-time.Hour || got > selfSignedValidity+time.Hour {
		t.Errorf("validity = %s want ~%s", got, selfSignedValidity)
	}

	// Persisted files with restrictive key permissions.
	keyPath := filepath.Join(dir, selfSignedKeyFile)
	certPath := filepath.Join(dir, selfSignedCertFile)
	for _, p := range []string{keyPath, certPath} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("expected %s to exist: %v", p, err)
		}
	}
	if runtime.GOOS != "windows" {
		fi, _ := os.Stat(keyPath)
		if fi.Mode().Perm() != 0o600 {
			t.Errorf("key mode = %o want 0600", fi.Mode().Perm())
		}
		di, _ := os.Stat(dir)
		if di.Mode().Perm() != 0o700 {
			t.Errorf("dir mode = %o want 0700", di.Mode().Perm())
		}
	}

	// Second call reloads the same pair.
	again, generated, err := loadOrCreateSelfSigned(dir, []string{"castor.example.test", "10.0.0.5"}, now)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if generated {
		t.Errorf("second call must reload, not regenerate")
	}
	if certInfo(again, "x", now).FingerprintSHA256 != certInfo(cert, "x", now).FingerprintSHA256 {
		t.Errorf("reloaded certificate differs from the generated one")
	}
}

func equalFoldASCII(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		x, y := a[i], b[i]
		if 'A' <= x && x <= 'Z' {
			x += 'a' - 'A'
		}
		if 'A' <= y && y <= 'Z' {
			y += 'a' - 'A'
		}
		if x != y {
			return false
		}
	}
	return true
}

func TestSelfSignedRegeneratedWhenExpired(t *testing.T) {
	dir := t.TempDir()
	// Mint a pair 11 years in the past so it is expired today, and persist it
	// exactly as the manager would.
	past := time.Now().Add(-11 * 365 * 24 * time.Hour)
	dns, ips := selfSignedHosts(nil)
	certPEM, keyPEM, err := generateSelfSigned(dns, ips, past)
	if err != nil {
		t.Fatalf("generateSelfSigned: %v", err)
	}
	if err := writeFileAtomic(filepath.Join(dir, selfSignedKeyFile), keyPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeFileAtomic(filepath.Join(dir, selfSignedCertFile), certPEM, 0o644); err != nil {
		t.Fatal(err)
	}
	old, err := loadKeyPair(filepath.Join(dir, selfSignedCertFile), filepath.Join(dir, selfSignedKeyFile))
	if err != nil {
		t.Fatalf("loadKeyPair: %v", err)
	}

	now := time.Now()
	cert, generated, err := loadOrCreateSelfSigned(dir, nil, now)
	if err != nil {
		t.Fatalf("loadOrCreateSelfSigned: %v", err)
	}
	if !generated {
		t.Fatalf("expired pair must be regenerated")
	}
	if certInfo(cert, "x", now).FingerprintSHA256 == certInfo(old, "x", now).FingerprintSHA256 {
		t.Errorf("regenerated certificate must differ from the expired one")
	}
	if !now.Before(cert.Leaf.NotAfter) {
		t.Errorf("regenerated certificate is not valid now")
	}
}

func TestSelfSignedRegeneratedWhenSANMissing(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	first, _, err := loadOrCreateSelfSigned(dir, nil, now)
	if err != nil {
		t.Fatal(err)
	}
	second, generated, err := loadOrCreateSelfSigned(dir, []string{"new.example.test"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if !generated {
		t.Fatalf("a new extra SAN must trigger regeneration")
	}
	if !hasDNS(second.Leaf.DNSNames, "new.example.test") {
		t.Errorf("regenerated cert lacks the new SAN: %v", second.Leaf.DNSNames)
	}
	if certInfo(first, "x", now).FingerprintSHA256 == certInfo(second, "x", now).FingerprintSHA256 {
		t.Errorf("fingerprint unchanged after regeneration")
	}
}

func TestSelfSignedUnreadableFilesRegenerate(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	if err := os.WriteFile(filepath.Join(dir, selfSignedCertFile), []byte("garbage"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, selfSignedKeyFile), []byte("garbage"), 0o600); err != nil {
		t.Fatal(err)
	}
	cert, generated, err := loadOrCreateSelfSigned(dir, nil, now)
	if err != nil {
		t.Fatalf("loadOrCreateSelfSigned: %v", err)
	}
	if !generated || cert.Leaf == nil {
		t.Fatalf("corrupt files must be replaced by a fresh pair")
	}
}

// TestSelfSignedReusedAcrossHostnameChange: a container gets a new hostname on
// every recreation; the persisted certificate must be reloaded regardless so
// its fingerprint (and the trust the operator granted it) stays stable. The
// hostname is only a best-effort SAN at generation time.
func TestSelfSignedReusedAcrossHostnameChange(t *testing.T) {
	orig := hostname
	t.Cleanup(func() { hostname = orig })

	dir := t.TempDir()
	now := time.Now()
	hostname = func() (string, error) { return "node-a1b2c3", nil }
	first, generated, err := loadOrCreateSelfSigned(dir, []string{"castor.example.test"}, now)
	if err != nil || !generated {
		t.Fatalf("first: generated=%t err=%v", generated, err)
	}
	if !hasDNS(first.Leaf.DNSNames, "node-a1b2c3") {
		t.Errorf("generation must add the hostname best effort: %v", first.Leaf.DNSNames)
	}

	hostname = func() (string, error) { return "node-d4e5f6", nil }
	second, generated, err := loadOrCreateSelfSigned(dir, []string{"castor.example.test"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if generated {
		t.Fatalf("a hostname change must not regenerate the certificate")
	}
	if certInfo(second, "x", now).FingerprintSHA256 != certInfo(first, "x", now).FingerprintSHA256 {
		t.Errorf("reloaded certificate differs from the persisted one")
	}
	if hasDNS(second.Leaf.DNSNames, "node-d4e5f6") {
		t.Errorf("the new hostname must not appear on the reloaded certificate")
	}

	// A hostname that cannot be resolved is simply skipped.
	hostname = func() (string, error) { return "", os.ErrNotExist }
	third, generated, err := loadOrCreateSelfSigned(t.TempDir(), nil, now)
	if err != nil || !generated {
		t.Fatalf("third: generated=%t err=%v", generated, err)
	}
	for _, want := range []string{"localhost"} {
		if !hasDNS(third.Leaf.DNSNames, want) {
			t.Errorf("required SAN %q missing: %v", want, third.Leaf.DNSNames)
		}
	}
	if !hasIP(third.Leaf.IPAddresses, "127.0.0.1") {
		t.Errorf("required IP SAN 127.0.0.1 missing")
	}
}
