package tlsmgr

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"
)

// mintCert signs tmpl (serial filled in) for pub with signer under parent, or
// self-signed when parent is nil. It returns the PEM and the parsed form.
func mintCert(t *testing.T, tmpl, parent *x509.Certificate, pub any, signer crypto.Signer) ([]byte, *x509.Certificate) {
	t.Helper()
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 64))
	tmpl.SerialNumber = serial
	if parent == nil {
		parent = tmpl
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, signer)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("ParseCertificate: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), parsed
}

// certTemplate is the template of a server certificate (with cn as DNS SAN) or
// of a CA for cn.
func certTemplate(cn string, notBefore, notAfter time.Time, isCA bool) *x509.Certificate {
	tmpl := &x509.Certificate{
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
	return tmpl
}

// testCert mints a certificate for pub signed by parentKey (self-signed when
// parent is nil). It returns the PEM certificate and the parsed x509 form.
func testCert(t *testing.T, cn string, pub any, notBefore, notAfter time.Time, isCA bool, parent *x509.Certificate, parentKey crypto.Signer) ([]byte, *x509.Certificate) {
	t.Helper()
	return mintCert(t, certTemplate(cn, notBefore, notAfter, isCA), parent, pub, parentKey)
}

// misSignedCert mints the classic mistake: a certificate naming ca as its
// issuer but signed with its own key (openssl x509 -req -signkey without -CA),
// so its Authority Key Identifier is its own Subject Key Identifier.
func misSignedCert(t *testing.T, cn string, key crypto.Signer, ca *x509.Certificate, notBefore, notAfter time.Time, withSAN bool) ([]byte, *x509.Certificate) {
	t.Helper()
	ski := []byte{0xAF, 0xCA, 0x29, 0xFE, 0xAD, 0x5E, 0x8A, 0x89, 0x55, 0x85, 0x11, 0x28, 0x34, 0x0A, 0xA5, 0x25, 0xCC, 0xB1, 0xC3, 0x9E}
	tmpl := certTemplate(cn, notBefore, notAfter, false)
	tmpl.SubjectKeyId = ski
	if !withSAN {
		tmpl.DNSNames = nil
	}
	// A bare parent carries the issuer name and the SKI copied into the AKI; its
	// nil PublicKey skips CreateCertificate's signer check.
	fakeParent := &x509.Certificate{RawSubject: ca.RawSubject, SubjectKeyId: ski}
	return mintCert(t, tmpl, fakeParent, key.Public(), key)
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

// concat joins PEM fragments.
func concat(parts ...[]byte) []byte {
	return bytes.Join(parts, nil)
}

// wantCertError asserts err is a CertError of kind whose message contains want.
func wantCertError(t *testing.T, err error, kind CertErrorKind, want string) {
	t.Helper()
	var ce *CertError
	if !errors.As(err, &ce) || !errors.Is(err, ErrInvalidCertificate) {
		t.Fatalf("err = %v, want a *CertError matching ErrInvalidCertificate", err)
	}
	if ce.Kind != kind {
		t.Errorf("kind = %d want %d (%s)", ce.Kind, kind, ce.Message)
	}
	if !strings.Contains(ce.Message, want) {
		t.Errorf("message %q does not contain %q", ce.Message, want)
	}
	// The upper-case marker is what the API tests grep for as a leak, so no
	// message may spell it out.
	if strings.Contains(err.Error(), "-----") || strings.Contains(err.Error(), "PRIVATE KEY") {
		t.Errorf("message quotes PEM material: %q", err.Error())
	}
}

// chainCNs lists the common names of a served chain, leaf first.
func chainCNs(t *testing.T, cert *tls.Certificate) []string {
	t.Helper()
	var out []string
	for _, der := range cert.Certificate {
		c, err := x509.ParseCertificate(der)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, c.Subject.CommonName)
	}
	return out
}

func TestParseCustomAcceptsECDSAAndRSA2048(t *testing.T) {
	now := time.Now()
	ek := ecKey(t)
	certPEM, _ := testCert(t, "ec.example.test", &ek.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, ek)
	cert, err := ParseCustom(certPEM, nil, pemKey(t, ek), now)
	if err != nil {
		t.Fatalf("ECDSA cert rejected: %v", err)
	}
	if cert.Leaf == nil || cert.Leaf.Subject.CommonName != "ec.example.test" || cert.PrivateKey == nil || len(cert.Certificate) != 1 {
		t.Errorf("parsed = leaf %v, key %T, %d certificates", cert.Leaf, cert.PrivateKey, len(cert.Certificate))
	}

	rk := rsaKey(t, 2048)
	certPEM, _ = testCert(t, "rsa.example.test", &rk.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, rk)
	if _, err := ParseCustom(certPEM, nil, pemKey(t, rk), now); err != nil {
		t.Fatalf("RSA 2048 cert rejected: %v", err)
	}
	// PKCS#1 and SEC1 encodings of the key work as well as PKCS#8.
	pkcs1 := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(rk)})
	if _, err := ParseCustom(certPEM, nil, pkcs1, now); err != nil {
		t.Fatalf("RSA PKCS#1 key rejected: %v", err)
	}
	ecCertPEM, _ := testCert(t, "sec1.example.test", &ek.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, ek)
	sec1DER, err := x509.MarshalECPrivateKey(ek)
	if err != nil {
		t.Fatal(err)
	}
	sec1 := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: sec1DER})
	if _, err := ParseCustom(ecCertPEM, nil, sec1, now); err != nil {
		t.Fatalf("EC SEC1 key rejected: %v", err)
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
	if got := chainCNs(t, cert); strings.Join(got, ",") != "app.example.test,Test CA" {
		t.Errorf("chain = %v want leaf then CA", got)
	}
	if SelfSigned(cert) {
		t.Errorf("a CA-issued certificate must not report as self-signed")
	}
}

// TestParseCustomCombinedBundle: a single file holding the certificate, the
// key and the CA (in any field, any order, CRLF, BOM, junk around) is split by
// block type; the key is found wherever it was pasted and the re-serialized
// material carries certificates only.
func TestParseCustomCombinedBundle(t *testing.T) {
	now := time.Now()
	caKey := rsaKey(t, 2048)
	caPEM, caCert := testCert(t, "Test CA", &caKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, nil, caKey)
	leafKey := rsaKey(t, 2048)
	leafPEM, _ := testCert(t, "app.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, caCert, caKey)
	pkcs1 := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(leafKey)})
	pkcs8 := pemKey(t, leafKey)

	crlf := bytes.ReplaceAll(concat(leafPEM, pkcs1, caPEM), []byte("\n"), []byte("\r\n"))
	cases := []struct {
		name             string
		cert, chain, key []byte
	}{
		{"cert+key+ca in the certificate field", concat(leafPEM, pkcs1, caPEM), nil, nil},
		{"ca+key+cert in the certificate field", concat(caPEM, pkcs8, leafPEM), nil, nil},
		{"key in the chain field", leafPEM, concat(pkcs8, caPEM), nil},
		{"cert in the key field", nil, caPEM, concat(pkcs8, leafPEM)},
		{"CRLF, BOM and junk", concat([]byte("\xef\xbb\xbf# exported bundle\r\n"), crlf, []byte("\r\nsubject=CN=Test CA\r\n")), nil, nil},
		{"root duplicated across fields", concat(leafPEM, caPEM), caPEM, pkcs8},
		{"same key in two fields", concat(leafPEM, pkcs1, caPEM), nil, pkcs8},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cert, err := ParseCustom(c.cert, c.chain, c.key, now)
			if err != nil {
				t.Fatalf("rejected: %v", err)
			}
			if got := chainCNs(t, cert); strings.Join(got, ",") != "app.example.test,Test CA" {
				t.Errorf("chain = %v want leaf then CA", got)
			}
			leaf, chain := EncodeChainPEM(cert)
			if string(leaf) != string(leafPEM) || string(chain) != string(caPEM) {
				t.Errorf("re-serialized material differs from the parsed blocks")
			}
			if strings.Contains(string(leaf)+string(chain), "PRIVATE KEY") {
				t.Fatalf("re-serialized certificates contain a private key")
			}
			keyPEM, err := EncodeKeyPEM(cert)
			if err != nil {
				t.Fatalf("EncodeKeyPEM: %v", err)
			}
			if string(keyPEM) != string(pkcs8) {
				t.Errorf("EncodeKeyPEM must yield the PKCS#8 form of the key")
			}
		})
	}
	if _, err := EncodeKeyPEM(nil); err == nil {
		t.Errorf("EncodeKeyPEM(nil) must fail")
	}
}

func TestParseCustomRejectsKeyProblems(t *testing.T) {
	now := time.Now()
	k, other := ecKey(t), ecKey(t)
	certPEM, _ := testCert(t, "ok.example.test", &k.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, k)
	keyPEM := pemKey(t, k)
	enc := pem.EncodeToMemory(&pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: []byte{1, 2, 3}})
	legacy := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Headers: map[string]string{"Proc-Type": "4,ENCRYPTED", "DEK-Info": "AES-256-CBC,00112233445566778899AABBCCDDEEFF"}, Bytes: []byte{1, 2, 3}})
	edPub, edPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	edCertPEM, _ := testCert(t, "ed.example.test", edPub, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, edPriv)

	cases := []struct {
		name             string
		cert, chain, key []byte
		kind             CertErrorKind
		want             string
	}{
		{"no key", certPEM, nil, nil, CertErrorInvalid, "No private key found"},
		{"no certificate", nil, nil, keyPEM, CertErrorInvalid, "No certificate found"},
		{"garbage certificate", []byte("not a pem"), nil, keyPEM, CertErrorInvalid, "No certificate found"},
		{"two keys", concat(certPEM, keyPEM), nil, pemKey(t, other), CertErrorInvalid, "More than one private key found"},
		{"encrypted PKCS#8", certPEM, nil, enc, CertErrorInvalid, "Private key is encrypted (remove the passphrase first)"},
		{"legacy encrypted", certPEM, nil, legacy, CertErrorInvalid, "Private key is encrypted (remove the passphrase first)"},
		{"mismatch", certPEM, nil, pemKey(t, other), CertErrorKeyMismatch, "No certificate matches the private key (found CN=ok.example.test)"},
		{"unsupported openssh", certPEM, nil, pem.EncodeToMemory(&pem.Block{Type: "OPENSSH PRIVATE KEY", Bytes: []byte{1}}), CertErrorInvalid, "Unsupported private key format (openssh private key block)"},
		{"corrupt key", certPEM, nil, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte{1, 2, 3}}), CertErrorInvalid, "could not be parsed"},
		{"ed25519", edCertPEM, nil, pemKey(t, edPriv), CertErrorInvalid, "Unsupported key type ed25519.PublicKey"},
		{"oversized certificate", append(append([]byte{}, certPEM...), bytes.Repeat([]byte("#"), MaxPEMBytes)...), nil, keyPEM, CertErrorInvalid, "certificate field exceeds 64 KiB"},
		{"oversized chain", certPEM, bytes.Repeat([]byte("#"), MaxPEMBytes+1), keyPEM, CertErrorInvalid, "chain field exceeds 64 KiB"},
		{"oversized key", certPEM, nil, append(append([]byte{}, keyPEM...), bytes.Repeat([]byte("#"), MaxPEMBytes)...), CertErrorInvalid, "private key field exceeds 64 KiB"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseCustom(c.cert, c.chain, c.key, now)
			wantCertError(t, err, c.kind, c.want)
		})
	}
}

func TestParseCustomRejectsRSA1024(t *testing.T) {
	now := time.Now()
	rk := rsaKey(t, 1024)
	certPEM, _ := testCert(t, "weak.example.test", &rk.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, rk)
	_, err := ParseCustom(certPEM, nil, pemKey(t, rk), now)
	wantCertError(t, err, CertErrorInvalid, "RSA key is too short (min 2048 bits): 1024 bits")
}

func TestParseCustomRejectsExpiredAndNotYetValid(t *testing.T) {
	now := time.Now()
	k := ecKey(t)
	expired, _ := testCert(t, "old.example.test", &k.PublicKey, now.Add(-48*time.Hour), now.Add(-time.Hour), false, nil, k)
	_, err := ParseCustom(expired, nil, pemKey(t, k), now)
	wantCertError(t, err, CertErrorExpired, "The certificate has expired")
	future, _ := testCert(t, "future.example.test", &k.PublicKey, now.Add(time.Hour), now.Add(48*time.Hour), false, nil, k)
	_, err = ParseCustom(future, nil, pemKey(t, k), now)
	wantCertError(t, err, CertErrorInvalid, "The certificate is not yet valid")
}

// TestParseCustomRejectsMissingSAN: browsers ignore the CN, so a leaf without
// any DNS or IP SAN is refused with the re-issue instruction.
func TestParseCustomRejectsMissingSAN(t *testing.T) {
	now := time.Now()
	k := ecKey(t)
	tmpl := certTemplate("nosan.example.test", now.Add(-time.Hour), now.Add(24*time.Hour), false)
	tmpl.DNSNames = nil
	certPEM, _ := mintCert(t, tmpl, nil, &k.PublicKey, k)
	_, err := ParseCustom(certPEM, nil, pemKey(t, k), now)
	wantCertError(t, err, CertErrorInvalid, msgNoSAN)

	// An IP SAN alone is enough.
	tmpl = certTemplate("ip.example.test", now.Add(-time.Hour), now.Add(24*time.Hour), false)
	tmpl.DNSNames = nil
	tmpl.IPAddresses = []net.IP{net.ParseIP("192.0.2.10")}
	ipPEM, _ := mintCert(t, tmpl, nil, &k.PublicKey, k)
	if _, err := ParseCustom(ipPEM, nil, pemKey(t, k), now); err != nil {
		t.Errorf("IP-only SAN rejected: %v", err)
	}
}

// TestParseCustomRejectsMisSignedLeaf: a certificate naming the CA as issuer
// but signed with its own key (AKI == SKI) is refused when that CA is supplied,
// with the diagnosis; without a SAN either, both problems come in one message.
func TestParseCustomRejectsMisSignedLeaf(t *testing.T) {
	now := time.Now()
	caKey := ecKey(t)
	caPEM, caCert := testCert(t, "Test CA", &caKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, nil, caKey)
	k := ecKey(t)
	leafPEM, leaf := misSignedCert(t, "castor.example.test", k, caCert, now.Add(-time.Hour), now.Add(24*time.Hour), true)
	if leaf.Issuer.CommonName != "Test CA" || !bytes.Equal(leaf.AuthorityKeyId, leaf.SubjectKeyId) {
		t.Fatalf("fixture: issuer %q AKI==SKI %t", leaf.Issuer.CommonName, bytes.Equal(leaf.AuthorityKeyId, leaf.SubjectKeyId))
	}

	_, err := ParseCustom(concat(leafPEM, pemKey(t, k), caPEM), nil, nil, now)
	wantCertError(t, err, CertErrorInvalid, "The certificate is not signed by the provided CA certificate: its Authority Key Identifier (AF:CA:29:FE:AD:5E:8A:89…) matches its own Subject Key Identifier, so it is self-signed. Re-issue it from your CA.")
	if strings.Contains(err.Error(), msgNoSAN) {
		t.Errorf("a leaf with a SAN must not get the SAN message: %v", err)
	}

	noSANPEM, _ := misSignedCert(t, "castor.example.test", k, caCert, now.Add(-time.Hour), now.Add(24*time.Hour), false)
	_, err = ParseCustom(noSANPEM, caPEM, pemKey(t, k), now)
	wantCertError(t, err, CertErrorInvalid, "so it is self-signed. Re-issue it from your CA. "+msgNoSAN)

	// Without the CA the same certificate is what it is: self-signed, accepted
	// and flagged.
	cert, err := ParseCustom(leafPEM, nil, pemKey(t, k), now)
	if err != nil {
		t.Fatalf("self-signed leaf without chain rejected: %v", err)
	}
	if !SelfSigned(cert) {
		t.Errorf("SelfSigned must be true for a leaf signed with its own key")
	}
}

// TestParseCustomChainOrdering: chain material is ordered by signature and
// deduplicated whatever the pasted order; certificates off the leaf's path are
// dropped; a chain that does not reach the leaf is refused with the identifiers
// that explain it.
func TestParseCustomChainOrdering(t *testing.T) {
	now := time.Now()
	rootKey := ecKey(t)
	rootPEM, rootCert := testCert(t, "Test Root", &rootKey.PublicKey, now.Add(-2*time.Hour), now.Add(72*time.Hour), true, nil, rootKey)
	interKey := ecKey(t)
	interPEM, interCert := testCert(t, "Test Intermediate", &interKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, rootCert, rootKey)
	leafKey := ecKey(t)
	leafPEM, leaf := testCert(t, "app.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, interCert, interKey)
	keyPEM := pemKey(t, leafKey)
	otherKey := ecKey(t)
	otherPEM, otherCert := testCert(t, "Other CA", &otherKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, nil, otherKey)

	accepted := []struct {
		name        string
		cert, chain []byte
		want        string
	}{
		{"intermediate only", leafPEM, interPEM, "app.example.test,Test Intermediate"},
		{"intermediate + root", leafPEM, concat(interPEM, rootPEM), "app.example.test,Test Intermediate,Test Root"},
		{"reversed order", leafPEM, concat(rootPEM, interPEM), "app.example.test,Test Intermediate,Test Root"},
		{"bundle in cert, root in chain", concat(leafPEM, interPEM), rootPEM, "app.example.test,Test Intermediate,Test Root"},
		{"leaf and root duplicated", concat(leafPEM, rootPEM), concat(interPEM, leafPEM, rootPEM), "app.example.test,Test Intermediate,Test Root"},
		{"unrelated CA alongside the chain", leafPEM, concat(otherPEM, interPEM, rootPEM), "app.example.test,Test Intermediate,Test Root"},
	}
	for _, c := range accepted {
		t.Run(c.name, func(t *testing.T) {
			cert, err := ParseCustom(c.cert, c.chain, keyPEM, now)
			if err != nil {
				t.Fatalf("rejected: %v", err)
			}
			if got := chainCNs(t, cert); strings.Join(got, ",") != c.want {
				t.Errorf("chain = %v want %s", got, c.want)
			}
			if cert.Leaf == nil || cert.Leaf.Subject.CommonName != "app.example.test" || SelfSigned(cert) {
				t.Errorf("leaf = %v selfSigned = %t", cert.Leaf, SelfSigned(cert))
			}
		})
	}

	expiredKey := ecKey(t)
	expiredPEM, expiredCert := testCert(t, "Expired CA", &expiredKey.PublicKey, now.Add(-48*time.Hour), now.Add(-time.Hour), true, nil, expiredKey)
	leafOfExpiredPEM, _ := testCert(t, "old.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, expiredCert, expiredKey)
	notCAKey := ecKey(t)
	notCAPEM, notCACert := testCert(t, "Not a CA", &notCAKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), false, nil, notCAKey)
	leafOfNotCAPEM, _ := testCert(t, "nca.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, notCACert, notCAKey)
	renewedPEM, _ := testCert(t, "app.example.test", &leafKey.PublicKey, now.Add(-time.Hour), now.Add(30*24*time.Hour), false, interCert, interKey)

	rejected := []struct {
		name        string
		cert, chain []byte
		want        string
	}{
		{"unrelated CA only", leafPEM, otherPEM, "its Authority Key Identifier (" + keyID(leaf.AuthorityKeyId) + ") names another issuer and the provided CA (SKI " + keyID(otherCert.SubjectKeyId) + ") did not sign it; export the intermediate that did."},
		{"root without the intermediate", leafPEM, rootPEM, "the provided CA (SKI " + keyID(rootCert.SubjectKeyId) + ") did not sign it; export the intermediate that did."},
		{"two wrong CAs", leafPEM, concat(otherPEM, rootPEM), "none of the 2 provided CA certificates (SKI " + keyID(otherCert.SubjectKeyId) + ", SKI " + keyID(rootCert.SubjectKeyId) + ") signed it; export the intermediate that did."},
		{"expired intermediate", leafOfExpiredPEM, expiredPEM, "The CA certificate CN=Expired CA (chain #1) expired on"},
		{"issuer without CA constraint", leafOfNotCAPEM, notCAPEM, "The certificate is signed by CN=Not a CA, which is not a valid CA certificate"},
		{"two leaves for the key", concat(leafPEM, renewedPEM), interPEM, "Two certificates match the private key"},
		{"garbage chain block", leafPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: []byte{1, 2, 3}}), "Certificate #1 in the chain field could not be parsed"},
	}
	for _, c := range rejected {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseCustom(c.cert, c.chain, keyPEM, now)
			wantCertError(t, err, CertErrorInvalid, c.want)
		})
	}
}

// TestParseCustomRejectsNegativeSerial: Go refuses a certificate whose serial
// number is negative (RFC 5280 violation, typically an openssl -set_serial
// with a random hex value); the message names the fix instead of the parser.
func TestParseCustomRejectsNegativeSerial(t *testing.T) {
	now := time.Now()
	k := ecKey(t)
	certPEM, _ := testCert(t, "neg.example.test", &k.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, k)
	blk, _ := pem.Decode(certPEM)
	der := append([]byte(nil), blk.Bytes...)
	// The serial INTEGER follows the explicit version ([0] { INTEGER 2 });
	// setting the top bit of its first content byte makes it negative.
	i := bytes.Index(der, []byte{0xA0, 0x03, 0x02, 0x01, 0x02, 0x02})
	if i < 0 {
		t.Fatalf("serial number not located in the DER")
	}
	der[i+7] |= 0x80
	negPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	_, err := ParseCustom(negPEM, nil, pemKey(t, k), now)
	wantCertError(t, err, CertErrorInvalid, "Certificate #1 in the certificate field has a negative serial number, which RFC 5280 forbids and Go refuses to parse. Re-issue it with a positive serial number")
	_, err = ParseCustom(certPEM, negPEM, pemKey(t, k), now)
	wantCertError(t, err, CertErrorInvalid, "Certificate #1 in the chain field has a negative serial number")
	// The block is numbered within its field: a CA pasted after the leaf is #2.
	_, err = ParseCustom(concat(certPEM, negPEM), nil, pemKey(t, k), now)
	wantCertError(t, err, CertErrorInvalid, "Certificate #2 in the certificate field has a negative serial number")
}

// TestParseCustomSelfSignedWithoutChain: a self-signed certificate imported on
// purpose is accepted and flagged; a CA-issued leaf without its chain is
// accepted (the CA may sit in the clients' trust store) and not flagged.
func TestParseCustomSelfSignedWithoutChain(t *testing.T) {
	now := time.Now()
	k := ecKey(t)
	selfPEM, _ := testCert(t, "self.example.test", &k.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, nil, k)
	cert, err := ParseCustom(selfPEM, nil, pemKey(t, k), now)
	if err != nil {
		t.Fatalf("self-signed rejected: %v", err)
	}
	if !SelfSigned(cert) {
		t.Errorf("SelfSigned = false for a self-signed leaf")
	}
	leafPEM, chainPEM := EncodeChainPEM(cert)
	if !SelfSignedPEM(leafPEM, chainPEM) {
		t.Errorf("SelfSignedPEM = false for the re-serialized self-signed leaf")
	}

	caKey := ecKey(t)
	caPEM, caCert := testCert(t, "Test CA", &caKey.PublicKey, now.Add(-time.Hour), now.Add(48*time.Hour), true, nil, caKey)
	issuedPEM, _ := testCert(t, "issued.example.test", &k.PublicKey, now.Add(-time.Hour), now.Add(24*time.Hour), false, caCert, caKey)
	cert, err = ParseCustom(issuedPEM, nil, pemKey(t, k), now)
	if err != nil {
		t.Fatalf("CA-issued leaf without chain rejected: %v", err)
	}
	if SelfSigned(cert) || SelfSignedPEM(issuedPEM, nil) {
		t.Errorf("a CA-issued leaf must not report as self-signed")
	}
	if SelfSignedPEM(selfPEM, caPEM) || SelfSignedPEM(nil, nil) || SelfSignedPEM([]byte("junk"), nil) {
		t.Errorf("SelfSignedPEM must be false with a chain or without a certificate")
	}
	if SelfSigned(nil) {
		t.Errorf("SelfSigned(nil) must be false")
	}
}
