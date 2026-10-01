// Castor by IT Leonard
// Package tlsmgr owns Castor's TLS material: the persisted self-signed fallback
// certificate, an operator-imported certificate (DigiCert, Thawte, an internal
// CA, ...) and ACME (Let's Encrypt) issuance through autocert. One Manager
// answers GetCertificate for the HTTPS listener and picks the certificate from
// the current mode, which can change at runtime without restarting the
// listener. Whatever the mode, a handshake is never refused and never waits on
// a certificate authority: when the selected source has no usable certificate
// the self-signed one is served so the UI stays reachable and the operator can
// fix the configuration from it.
package tlsmgr

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	selfSignedCertFile = "self-signed.crt"
	selfSignedKeyFile  = "self-signed.key"
	// selfSignedValidity is the lifetime of a generated certificate (10 years).
	selfSignedValidity = 10 * 365 * 24 * time.Hour
	// selfSignedCN is the subject common name of the generated certificate.
	selfSignedCN = "Castor"
)

// hostname is os.Hostname, replaceable by tests to simulate a container whose
// name changes between recreations.
var hostname = os.Hostname

// sanSet accumulates subject alternative names, lower-cased and de-duplicated,
// split into DNS names and IP addresses.
type sanSet struct {
	seen map[string]bool
	dns  []string
	ips  []net.IP
}

func (s *sanSet) add(h string) {
	h = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(h, ".")))
	if h == "" || s.seen[h] || !isIA5(h) {
		return
	}
	s.seen[h] = true
	if ip := net.ParseIP(strings.Trim(h, "[]")); ip != nil {
		s.ips = append(s.ips, ip)
		return
	}
	s.dns = append(s.dns, h)
}

// newSANSet seeds a set with the loopback names and the operator extras.
func newSANSet(extra []string) *sanSet {
	s := &sanSet{seen: map[string]bool{}}
	s.add("localhost")
	s.add("127.0.0.1")
	s.add("::1")
	for _, h := range extra {
		s.add(h)
	}
	return s
}

// requiredSANs returns the names a persisted self-signed certificate must cover
// to be reused: the loopback names and CASTOR_TLS_SELF_SIGNED_HOSTS. The
// machine hostname is deliberately not part of it: a container gets a fresh
// random hostname on every recreation, and requiring it would mint a new key
// pair (and a fingerprint browsers no longer trust) each time.
func requiredSANs(extra []string) (dns []string, ips []net.IP) {
	s := newSANSet(extra)
	return s.dns, s.ips
}

// selfSignedHosts returns the SAN set of a certificate about to be generated:
// the required names plus, best effort, the current hostname.
func selfSignedHosts(extra []string) (dns []string, ips []net.IP) {
	s := newSANSet(extra)
	if hn, err := hostname(); err == nil {
		s.add(hn)
	}
	return s.dns, s.ips
}

// isIA5 reports whether s is printable ASCII without spaces, the only form
// x509 accepts in a dNSName SAN.
func isIA5(s string) bool {
	for _, r := range s {
		if r <= ' ' || r > '~' {
			return false
		}
	}
	return true
}

// generateSelfSigned mints an ECDSA P-256 self-signed server certificate for
// the given SANs, valid from one hour before now (clock skew) for
// selfSignedValidity. It returns the PEM-encoded certificate and private key.
func generateSelfSigned(dns []string, ips []net.IP, now time.Time) (certPEM, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsmgr: generate key: %w", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, fmt.Errorf("tlsmgr: serial: %w", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: selfSignedCN},
		NotBefore:             now.Add(-1 * time.Hour),
		NotAfter:              now.Add(selfSignedValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              dns,
		IPAddresses:           ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsmgr: create certificate: %w", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsmgr: marshal key: %w", err)
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM, nil
}

// loadOrCreateSelfSigned returns the persisted self-signed certificate from
// dir, generating (and persisting) a fresh one only when the files are missing,
// unreadable, expired, or no longer cover every required SAN (see
// requiredSANs). A valid persisted pair is always reused, whatever the current
// hostname. The second result reports whether a new certificate was generated.
func loadOrCreateSelfSigned(dir string, extra []string, now time.Time) (*tls.Certificate, bool, error) {
	certPath := filepath.Join(dir, selfSignedCertFile)
	keyPath := filepath.Join(dir, selfSignedKeyFile)

	reqDNS, reqIPs := requiredSANs(extra)
	if cert, err := loadKeyPair(certPath, keyPath); err == nil && selfSignedUsable(cert.Leaf, reqDNS, reqIPs, now) {
		return cert, false, nil
	}

	dns, ips := selfSignedHosts(extra)
	certPEM, keyPEM, err := generateSelfSigned(dns, ips, now)
	if err != nil {
		return nil, false, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, false, fmt.Errorf("tlsmgr: create %s: %w", dir, err)
	}
	// Key first: if the process dies between the two writes, the next start sees
	// a mismatched pair, fails loadKeyPair and simply regenerates.
	if err := writeFileAtomic(keyPath, keyPEM, 0o600); err != nil {
		return nil, false, err
	}
	if err := writeFileAtomic(certPath, certPEM, 0o644); err != nil {
		return nil, false, err
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, false, fmt.Errorf("tlsmgr: load generated pair: %w", err)
	}
	if cert.Leaf == nil {
		cert.Leaf, _ = x509.ParseCertificate(cert.Certificate[0])
	}
	return &cert, true, nil
}

// loadKeyPair reads a PEM certificate + key pair from disk with Leaf parsed.
func loadKeyPair(certPath, keyPath string) (*tls.Certificate, error) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, err
	}
	if cert.Leaf == nil {
		leaf, err := x509.ParseCertificate(cert.Certificate[0])
		if err != nil {
			return nil, err
		}
		cert.Leaf = leaf
	}
	return &cert, nil
}

// selfSignedUsable reports whether leaf is currently valid and covers every
// required DNS name and IP.
func selfSignedUsable(leaf *x509.Certificate, dns []string, ips []net.IP, now time.Time) bool {
	if leaf == nil || now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) {
		return false
	}
	have := map[string]bool{}
	for _, d := range leaf.DNSNames {
		have[strings.ToLower(d)] = true
	}
	for _, d := range dns {
		if !have[d] {
			return false
		}
	}
outer:
	for _, want := range ips {
		for _, got := range leaf.IPAddresses {
			if got.Equal(want) {
				continue outer
			}
		}
		return false
	}
	return true
}

// writeFileAtomic writes data to a temp file in the same directory, then
// renames it over path, so a reader never observes a partial file.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return fmt.Errorf("tlsmgr: write %s: %w", path, err)
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }
	if err := tmp.Chmod(perm); err != nil && !errors.Is(err, errors.ErrUnsupported) {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("tlsmgr: chmod %s: %w", path, err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("tlsmgr: write %s: %w", path, err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("tlsmgr: close %s: %w", path, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return fmt.Errorf("tlsmgr: rename %s: %w", path, err)
	}
	return nil
}
