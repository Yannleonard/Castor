package tlsmgr

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"
)

// testCert mints a certificate for pub signed by parentKey (self-signed when
// parent is nil). It returns the PEM certificate and the parsed x509 form.
func testCert(t *testing.T, cn string, pub any, notBefore, notAfter time.Time, isCA bool, parent *x509.Certificate, parentKey crypto.Signer) ([]byte, *x509.Certificate) {
	t.Helper()
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 64))
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  isCA,
		DNSNames:              []string{cn},
	}
	if isCA {
		tmpl.KeyUsage |= x509.KeyUsageCertSign
	}
	if parent == nil {
		parent = tmpl
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, parentKey)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("ParseCertificate: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), parsed
}

func pemKey(t *testing.T, key crypto.Signer) []byte {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func ecKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func rsaKey(t *testing.T, bits int) *rsa.PrivateKey {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func TestParseCustomAcceptsECDSAAndRSA2048(t *testing.T) {
	now := time.Now()
	ek := ecKey(t)
	certPEM, _ := testCert(t, "ec.example.test", &ek.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, ek)
	cert, err := ParseCustom(certPEM, nil, pemKey(t, ek), now)
	if err != nil {
		t.Fatalf("ECDSA cert rejected: %v", err)
	}
	if cert.Leaf == nil || cert.Leaf.Subject.CommonName != "ec.example.test" {
		t.Errorf("Leaf not populated correctly: %+v", cert.Leaf)
	}

	rk := rsaKey(t, 2048)
	certPEM, _ = testCert(t, "rsa.example.test", &rk.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, rk)
	if _, err := ParseCustom(certPEM, nil, pemKey(t, rk), now); err != nil {
		t.Fatalf("RSA 2048 cert rejected: %v", err)
	}
}

func TestParseCustomAcceptsChain(t *testing.T) {
	now := time.Now()
	caKey := ecKey(t)
	caPEM, caCert := testCert(t, "Test CA", &caKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, nil, caKey)
	leafKey := ecKey(t)
	leafPEM, _ := testCert(t, "app.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, caCert, caKey)

	cert, err := ParseCustom(leafPEM, caPEM, pemKey(t, leafKey), now)
	if err != nil {
		t.Fatalf("leaf+chain rejected: %v", err)
	}
	if len(cert.Certificate) != 2 {
		t.Errorf("chain length = %d want 2", len(cert.Certificate))
	}
}

func TestParseCustomRejectsRSA1024(t *testing.T) {
	now := time.Now()
	rk := rsaKey(t, 1024)
	certPEM, _ := testCert(t, "weak.example.test", &rk.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, rk)
	_, err := ParseCustom(certPEM, nil, pemKey(t, rk), now)
	if !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), "2048") {
		t.Fatalf("RSA 1024 must be refused with a 2048 hint, got %v", err)
	}
}

func TestParseCustomRejectsExpiredAndNotYetValid(t *testing.T) {
	now := time.Now()
	k := ecKey(t)
	expired, _ := testCert(t, "old.example.test", &k.PublicKey, now.Add(-48*time.Hour), now.Add(-time.Hour), false, nil, k)
	if _, err := ParseCustom(expired, nil, pemKey(t, k), now); !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), "expired") {
		t.Errorf("expired cert err = %v", err)
	}
	future, _ := testCert(t, "future.example.test", &k.PublicKey, now.Add(time.Hour), now.Add(48*time.Hour), false, nil, k)
	if _, err := ParseCustom(future, nil, pemKey(t, k), now); !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), "not valid before") {
		t.Errorf("not-yet-valid cert err = %v", err)
	}
}

func TestParseCustomRejectsKeyMismatch(t *testing.T) {
	now := time.Now()
	k1, k2 := ecKey(t), ecKey(t)
	certPEM, _ := testCert(t, "mm.example.test", &k1.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, k1)
	_, err := ParseCustom(certPEM, nil, pemKey(t, k2), now)
	if !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("mismatched key err = %v", err)
	}
}

func TestParseCustomRejectsGarbageOversizedEncrypted(t *testing.T) {
	now := time.Now()
	k := ecKey(t)
	certPEM, _ := testCert(t, "ok.example.test", &k.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, k)
	keyPEM := pemKey(t, k)

	if _, err := ParseCustom([]byte("not a pem"), nil, keyPEM, now); !errors.Is(err, ErrInvalidCertificate) {
		t.Errorf("garbage cert err = %v", err)
	}
	if _, err := ParseCustom(nil, nil, keyPEM, now); !errors.Is(err, ErrInvalidCertificate) {
		t.Errorf("empty cert err = %v", err)
	}
	big := append(certPEM, bytes.Repeat([]byte("#"), MaxPEMBytes)...)
	if _, err := ParseCustom(big, nil, keyPEM, now); !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), "KiB") {
		t.Errorf("oversized cert err = %v", err)
	}
	if _, err := ParseCustom(certPEM, bytes.Repeat([]byte("#"), MaxPEMBytes+1), keyPEM, now); !errors.Is(err, ErrInvalidCertificate) {
		t.Errorf("oversized chain err = %v", err)
	}
	enc := pem.EncodeToMemory(&pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: []byte{1, 2, 3}})
	if _, err := ParseCustom(certPEM, nil, enc, now); !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), "encrypted") {
		t.Errorf("encrypted key err = %v", err)
	}
}

// TestParseCustomRejectsPrivateKeyInCertificateInputs: a combined "cert + key"
// file pasted in the certificate or chain field is refused instead of having
// its key silently skipped (and later persisted with the public material).
func TestParseCustomRejectsPrivateKeyInCertificateInputs(t *testing.T) {
	now := time.Now()
	k := ecKey(t)
	certPEM, _ := testCert(t, "ok.example.test", &k.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, k)
	keyPEM := pemKey(t, k)
	combined := append(append([]byte{}, certPEM...), keyPEM...)

	// Other key flavours are caught too (the RSA PKCS#1 header, an encrypted key).
	rk := rsaKey(t, 2048)
	rsaPKCS1 := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(rk)})
	enc := pem.EncodeToMemory(&pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: []byte{1, 2, 3}})

	cases := []struct {
		name  string
		cert  []byte
		chain []byte
		want  string
	}{
		{"combined cert+key in the certificate field", combined, nil, "certificate field contains a private key"},
		{"key in the chain field", certPEM, keyPEM, "chain field contains a private key"},
		{"RSA PRIVATE KEY block in the certificate field", append(append([]byte{}, certPEM...), rsaPKCS1...), nil, "private key block"},
		{"ENCRYPTED PRIVATE KEY block in the chain field", certPEM, enc, "private key block"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseCustom(c.cert, c.chain, keyPEM, now)
			if !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v want ErrInvalidCertificate containing %q", err, c.want)
			}
			if msg := err.Error(); strings.Contains(msg, "does not match") || strings.Contains(msg, "expired") {
				t.Errorf("message %q would be mapped to another error code", msg)
			}
		})
	}
}

// TestParseCustomVerifiesChain: the intermediates must link up to the leaf in
// order and be valid; a root is optional (private CAs) and a copy of the leaf
// in the chain is refused. A full bundle in the certificate field works too.
func TestParseCustomVerifiesChain(t *testing.T) {
	now := time.Now()
	rootKey := ecKey(t)
	rootPEM, rootCert := testCert(t, "Test Root", &rootKey.PublicKey, now.Add(-2*time.Hour), now.Add(72*time.Hour), true, nil, rootKey)
	interKey := ecKey(t)
	interPEM, interCert := testCert(t, "Test Intermediate", &interKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, rootCert, rootKey)
	leafKey := ecKey(t)
	leafPEM, _ := testCert(t, "app.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, interCert, interKey)
	keyPEM := pemKey(t, leafKey)

	// Accepted: intermediate alone, intermediate + root, and the same material
	// as a single bundle in the certificate field.
	for name, in := range map[string][2][]byte{
		"intermediate only":   {leafPEM, interPEM},
		"intermediate + root": {leafPEM, append(append([]byte{}, interPEM...), rootPEM...)},
		"bundle in cert":      {append(append([]byte{}, leafPEM...), interPEM...), nil},
	} {
		cert, err := ParseCustom(in[0], in[1], keyPEM, now)
		if err != nil {
			t.Errorf("%s: rejected: %v", name, err)
			continue
		}
		if cert.Leaf == nil || cert.Leaf.Subject.CommonName != "app.example.test" || len(cert.Certificate) < 2 {
			t.Errorf("%s: parsed = leaf %v, %d certificates", name, cert.Leaf, len(cert.Certificate))
		}
	}

	otherKey := ecKey(t)
	otherPEM, _ := testCert(t, "Other CA", &otherKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, nil, otherKey)
	expiredKey := ecKey(t)
	expiredPEM, expiredCert := testCert(t, "Expired CA", &expiredKey.PublicKey, now.Add(-48*time.Hour), now.Add(-time.Hour), true, nil, expiredKey)
	leafOfExpiredPEM, _ := testCert(t, "old.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, expiredCert, expiredKey)
	notCAKey := ecKey(t)
	notCAPEM, notCACert := testCert(t, "Not a CA", &notCAKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), false, nil, notCAKey)
	leafOfNotCAPEM, _ := testCert(t, "nca.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, notCACert, notCAKey)

	rejected := []struct {
		name  string
		cert  []byte
		chain []byte
		want  string
	}{
		{"unrelated CA", leafPEM, otherPEM, "did not sign"},
		{"wrong order", leafPEM, append(append([]byte{}, rootPEM...), interPEM...), "did not sign"},
		{"expired intermediate", leafOfExpiredPEM, expiredPEM, "not valid after"},
		{"issuer without CA constraint", leafOfNotCAPEM, notCAPEM, "did not sign"},
		{"leaf duplicated in chain", leafPEM, append(append([]byte{}, leafPEM...), interPEM...), "duplicates the leaf"},
		{"leaf duplicated after chain", leafPEM, append(append([]byte{}, interPEM...), leafPEM...), "duplicates the leaf"},
		{"garbage chain block", leafPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: []byte{1, 2, 3}}), "parse chain certificate"},
	}
	for _, c := range rejected {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseCustom(c.cert, c.chain, keyPEM, now)
			if !errors.Is(err, ErrInvalidCertificate) || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v want ErrInvalidCertificate containing %q", err, c.want)
			}
			if msg := err.Error(); strings.Contains(msg, "does not match") || strings.Contains(msg, "expired") {
				t.Errorf("message %q would be mapped to another error code", msg)
			}
		})
	}
}
