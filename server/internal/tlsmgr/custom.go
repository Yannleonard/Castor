// Castor by IT Leonard
package tlsmgr

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"
)

// MaxPEMBytes caps each PEM input (certificate, chain, key) accepted by
// SetCustom. Real-world bundles are a few KiB; the cap bounds memory and the
// database row.
const MaxPEMBytes = 64 << 10

// MinRSABits is the smallest RSA modulus accepted for an imported certificate.
const MinRSABits = 2048

// ErrInvalidCertificate is matched (errors.Is) by every validation failure of
// an imported certificate, which is a *CertError, so the API layer can map it
// to a 422.
var ErrInvalidCertificate = errors.New("tlsmgr: invalid certificate")

// CertErrorKind selects the machine code the API gives a rejected import.
type CertErrorKind int

const (
	// CertErrorInvalid is any failure not listed below (tls_invalid_certificate).
	CertErrorInvalid CertErrorKind = iota
	// CertErrorKeyMismatch: no certificate pairs with the private key
	// (tls_key_mismatch).
	CertErrorKeyMismatch
	// CertErrorExpired: the leaf has expired (tls_certificate_expired).
	CertErrorExpired
)

// CertError is one validation failure of an imported certificate. Message is
// the operator-facing explanation, precise enough to act on and shown as is by
// the UI: it names subjects and key identifiers, never key material. It
// matches ErrInvalidCertificate in errors.Is.
type CertError struct {
	Kind    CertErrorKind
	Message string
}

func (e *CertError) Error() string { return ErrInvalidCertificate.Error() + ": " + e.Message }

// Is makes errors.Is(err, ErrInvalidCertificate) true for every CertError.
func (e *CertError) Is(target error) bool { return target == ErrInvalidCertificate }

func certErrorf(kind CertErrorKind, format string, args ...any) error {
	return &CertError{Kind: kind, Message: fmt.Sprintf(format, args...)}
}

// msgNoSAN is the rejection of a leaf without any DNS or IP Subject
// Alternative Name.
const msgNoSAN = "The certificate has no Subject Alternative Name; browsers reject such certificates. Re-issue it with DNS and/or IP names for the address you use to reach Castor (e.g. castor.example.com, localhost)."

// ParseCustom validates an operator-supplied certificate and returns it ready
// to serve: Leaf populated, PrivateKey set, Certificate holding the leaf then
// its chain.
//
// Each input may hold any number of PEM blocks: a combined file (certificate +
// key + CA) pasted in one field is as good as three separate fields, since the
// three inputs are pooled and every block is classified by type. The pool
// must contain exactly one unencrypted private key (PKCS#8 "PRIVATE KEY",
// PKCS#1 "RSA PRIVATE KEY" or SEC1 "EC PRIVATE KEY"). The leaf is the
// certificate whose public key is the key's; every other certificate is chain
// material, ordered by signature from the leaf's issuer towards the root,
// duplicates dropped, certificates off that path ignored.
//
// The leaf must be valid at now, carry at least one DNS or IP Subject
// Alternative Name (browsers reject certificates without one) and use an RSA
// key of at least MinRSABits or an ECDSA key. When chain material is supplied,
// one of its certificates must have signed the leaf and every link must be a
// CA valid at now; no trust anchor is required, a private CA being a
// legitimate issuer. Without chain material the leaf is accepted as is: either
// self-signed (see SelfSigned) or issued by a CA the clients already trust.
//
// Every failure is a *CertError whose Message says what to fix. Only parsed
// blocks matter: callers persist the re-serialized certificates
// (EncodeChainPEM) and seal the re-serialized key (EncodeKeyPEM), never the
// raw input, so a key pasted in a certificate field never travels with the
// public material.
func ParseCustom(certPEM, chainPEM, keyPEM []byte, now time.Time) (*tls.Certificate, error) {
	inputs := []struct {
		name string
		pem  []byte
	}{{"certificate", certPEM}, {"chain", chainPEM}, {"private key", keyPEM}}
	var (
		certs []*x509.Certificate
		key   crypto.Signer
	)
	for _, in := range inputs {
		if len(in.pem) > MaxPEMBytes {
			return nil, certErrorf(CertErrorInvalid, "The %s field exceeds %d KiB.", in.name, MaxPEMBytes>>10)
		}
		nth := 0 // CERTIFICATE blocks seen in this field, to name an unparseable one
		for _, blk := range pemBlocks(in.pem) {
			switch {
			case blk.Type == "CERTIFICATE":
				nth++
				c, err := x509.ParseCertificate(blk.Bytes)
				if err != nil {
					return nil, certParseError(in.name, nth, err)
				}
				certs = appendCert(certs, c)
			case strings.HasSuffix(blk.Type, "PRIVATE KEY"):
				k, err := parsePrivateKey(blk)
				if err != nil {
					return nil, err
				}
				switch {
				case key == nil:
					key = k
				case publicKeyEqual(k.Public(), key.Public()):
					// The same key pasted twice (a combined file plus the key field).
				default:
					return nil, certErrorf(CertErrorInvalid, "More than one private key found. Provide exactly one private key, the one of the certificate to serve.")
				}
			}
			// Other block types (PUBLIC KEY, CERTIFICATE REQUEST, DH PARAMETERS,
			// ...) carry nothing to serve and are ignored.
		}
	}
	if len(certs) == 0 {
		return nil, certErrorf(CertErrorInvalid, "No certificate found. Paste the PEM certificate (a CERTIFICATE block) in the certificate field.")
	}
	if key == nil {
		return nil, certErrorf(CertErrorInvalid, "No private key found. Paste the unencrypted PEM private key (PKCS#8, PKCS#1 RSA or SEC1 EC) in the private key field, or a combined certificate + key file in the certificate field.")
	}

	// The leaf is the certificate the key belongs to; the rest is chain material.
	var (
		leaf *x509.Certificate
		pool []*x509.Certificate
	)
	for _, c := range certs {
		if !publicKeyEqual(c.PublicKey, key.Public()) {
			pool = append(pool, c)
			continue
		}
		if leaf != nil {
			return nil, certErrorf(CertErrorInvalid, "Two certificates match the private key (%s and %s); keep only the one to serve.", leaf.Subject, c.Subject)
		}
		leaf = c
	}
	if leaf == nil {
		return nil, certErrorf(CertErrorKeyMismatch, "No certificate matches the private key (found %s). Import the key that was generated with the certificate signing request (CSR) of the certificate to serve.", subjects(certs))
	}

	switch pub := leaf.PublicKey.(type) {
	case *rsa.PublicKey:
		if bits := pub.N.BitLen(); bits < MinRSABits {
			return nil, certErrorf(CertErrorInvalid, "RSA key is too short (min %d bits): %d bits. Generate a new key and re-issue the certificate.", MinRSABits, bits)
		}
	case *ecdsa.PublicKey:
		// Any NIST curve Go's TLS stack serves is fine.
	default:
		return nil, certErrorf(CertErrorInvalid, "Unsupported key type %T: browsers require an RSA (%d bits or more) or ECDSA server certificate.", leaf.PublicKey, MinRSABits)
	}
	if now.Before(leaf.NotBefore) {
		return nil, certErrorf(CertErrorInvalid, "The certificate is not yet valid (not before %s). Check the clock of this host or wait until then.", leaf.NotBefore.UTC().Format(time.RFC3339))
	}
	if !now.Before(leaf.NotAfter) {
		return nil, certErrorf(CertErrorExpired, "The certificate has expired (not after %s). Renew it and import the new certificate.", leaf.NotAfter.UTC().Format(time.RFC3339))
	}

	// A leaf that needs re-issuing for two reasons (not signed by the given CA,
	// no SAN) gets both in one message: one round trip to the CA, not two.
	noSAN := len(leaf.DNSNames) == 0 && len(leaf.IPAddresses) == 0
	chain, rest := linkChain(leaf, pool)
	if len(chain) == 0 && len(rest) > 0 {
		msg := notSignedMessage(leaf, rest)
		if noSAN {
			msg += " " + msgNoSAN
		}
		return nil, certErrorf(CertErrorInvalid, "%s", msg)
	}
	if noSAN {
		return nil, certErrorf(CertErrorInvalid, "%s", msgNoSAN)
	}
	for i, c := range chain {
		if now.Before(c.NotBefore) {
			return nil, certErrorf(CertErrorInvalid, "The CA certificate %s (chain #%d) is not yet valid (not before %s).", c.Subject, i+1, c.NotBefore.UTC().Format(time.RFC3339))
		}
		if !now.Before(c.NotAfter) {
			return nil, certErrorf(CertErrorInvalid, "The CA certificate %s (chain #%d) expired on %s; browsers reject the chain. Obtain the current CA certificate from your CA.", c.Subject, i+1, c.NotAfter.UTC().Format(time.RFC3339))
		}
	}

	cert := &tls.Certificate{Certificate: make([][]byte, 0, 1+len(chain)), PrivateKey: key, Leaf: leaf}
	cert.Certificate = append(cert.Certificate, leaf.Raw)
	for _, c := range chain {
		cert.Certificate = append(cert.Certificate, c.Raw)
	}
	return cert, nil
}

// pemBlocks decodes every PEM block of in, in order. Text outside the blocks
// (comments, openssl's "subject=" lines, PKCS#12 Bag Attributes) is skipped,
// as are a UTF-8 BOM, surrounding whitespace and CRLF line endings.
func pemBlocks(in []byte) []*pem.Block {
	rest := bytes.TrimSpace(bytes.TrimPrefix(in, []byte("\xef\xbb\xbf")))
	var out []*pem.Block
	for len(rest) > 0 {
		blk, next := pem.Decode(rest)
		if blk == nil {
			break
		}
		out = append(out, blk)
		rest = next
	}
	return out
}

// certParseError explains the nth CERTIFICATE block of a field that Go's
// parser refused; the block is numbered because its subject cannot be read.
// The one refusal operators actually meet has its own message: a negative
// serial number (RFC 5280 requires a positive one; openssl -set_serial with a
// random hex value whose first digit is 8 or above produces one), which Go
// rejects since 1.23 and only a re-issue fixes.
func certParseError(field string, nth int, err error) error {
	if strings.Contains(err.Error(), "negative serial number") {
		return certErrorf(CertErrorInvalid, "Certificate #%d in the %s field has a negative serial number, which RFC 5280 forbids and Go refuses to parse. Re-issue it with a positive serial number (with openssl -set_serial, a hex value whose first digit is below 8); if it is your CA certificate, re-create the CA, then re-issue the server certificate from it.", nth, field)
	}
	return certErrorf(CertErrorInvalid, "Certificate #%d in the %s field could not be parsed: %v.", nth, field, err)
}

// appendCert adds c unless the same certificate (DER-identical) is already
// there: a root pasted both in the bundle and in the chain field counts once.
func appendCert(certs []*x509.Certificate, c *x509.Certificate) []*x509.Certificate {
	for _, have := range certs {
		if bytes.Equal(have.Raw, c.Raw) {
			return certs
		}
	}
	return append(certs, c)
}

// parsePrivateKey parses one PEM private key block: PKCS#8 (any key type),
// PKCS#1 RSA or SEC1 EC. An encrypted block (PKCS#8 "ENCRYPTED PRIVATE KEY",
// or the legacy Proc-Type/DEK-Info headers) is refused with the fix. Errors
// never quote the block, and name its type in lower case so the "PRIVATE KEY"
// marker in a response can only ever be leaked material.
func parsePrivateKey(blk *pem.Block) (crypto.Signer, error) {
	if strings.Contains(blk.Type, "ENCRYPTED") || strings.Contains(blk.Headers["Proc-Type"], "ENCRYPTED") || blk.Headers["DEK-Info"] != "" {
		return nil, certErrorf(CertErrorInvalid, "Private key is encrypted (remove the passphrase first): openssl pkey -in key.pem -out key-plain.pem, then import key-plain.pem.")
	}
	var (
		k   any
		err error
	)
	switch blk.Type {
	case "PRIVATE KEY":
		k, err = x509.ParsePKCS8PrivateKey(blk.Bytes)
	case "RSA PRIVATE KEY":
		k, err = x509.ParsePKCS1PrivateKey(blk.Bytes)
	case "EC PRIVATE KEY":
		k, err = x509.ParseECPrivateKey(blk.Bytes)
	default:
		// OPENSSH PRIVATE KEY, DSA PRIVATE KEY, ...
		return nil, certErrorf(CertErrorInvalid, "Unsupported private key format (%s block): provide an unencrypted PKCS#8, PKCS#1 (RSA) or SEC1 (EC) key.", strings.ToLower(blk.Type))
	}
	if err != nil {
		return nil, certErrorf(CertErrorInvalid, "The private key (%s block) could not be parsed: %v.", strings.ToLower(blk.Type), err)
	}
	signer, ok := k.(crypto.Signer)
	if !ok {
		return nil, certErrorf(CertErrorInvalid, "Unsupported private key type %T: use an RSA (%d bits or more) or ECDSA key.", k, MinRSABits)
	}
	return signer, nil
}

// publicKeyEqual reports whether a certificate's public key is the private
// key's (RSA modulus and exponent, ECDSA curve and point, Ed25519 bytes), via
// the Equal method every crypto public key type implements.
func publicKeyEqual(certPub, keyPub crypto.PublicKey) bool {
	e, ok := certPub.(interface{ Equal(crypto.PublicKey) bool })
	return ok && e.Equal(keyPub)
}

// linkChain orders pool by signature from the leaf's issuer towards the root:
// each step takes the first pool certificate that is a CA and verifiably
// signed the previous link, and stops at a self-signed root or when no
// candidate is left. It returns the ordered chain and the certificates left
// out, which are not on the leaf's path (an unrelated CA, a cross-signed
// duplicate, or, when the chain is empty, a CA that did not sign the leaf).
func linkChain(leaf *x509.Certificate, pool []*x509.Certificate) (chain, rest []*x509.Certificate) {
	rest = append([]*x509.Certificate(nil), pool...)
	child := leaf
	for len(rest) > 0 {
		i := -1
		for j, c := range rest {
			if child.CheckSignatureFrom(c) == nil {
				i = j
				break
			}
		}
		if i < 0 {
			break
		}
		c := rest[i]
		rest = append(rest[:i], rest[i+1:]...)
		chain = append(chain, c)
		if selfSigned(c) {
			break
		}
		child = c
	}
	return chain, rest
}

// notSignedMessage explains why none of cas (all provided, none matching)
// signed the leaf, from the key identifiers: a leaf whose AKI is its own SKI
// was signed with its own key (the usual "forgot -CA" mistake), a leaf whose
// signature verifies under a provided certificate that is not a valid CA
// needs that CA fixed, and otherwise the intermediate that did sign it is
// missing.
func notSignedMessage(leaf *x509.Certificate, cas []*x509.Certificate) string {
	const head = "The certificate is not signed by the provided CA certificate: "
	if selfSigned(leaf) {
		if len(leaf.AuthorityKeyId) > 0 {
			return head + fmt.Sprintf("its Authority Key Identifier (%s) matches its own Subject Key Identifier, so it is self-signed. Re-issue it from your CA.", keyID(leaf.AuthorityKeyId))
		}
		return head + "it has no Authority Key Identifier and its signature verifies with its own public key, so it is self-signed. Re-issue it from your CA."
	}
	for _, c := range cas {
		if signedWithKeyOf(leaf, c) {
			return fmt.Sprintf("The certificate is signed by %s, which is not a valid CA certificate (it lacks the CA basic constraint or the keyCertSign key usage), so browsers reject the chain. Re-issue the CA certificate with CA:TRUE and keyCertSign, then re-issue this certificate from it.", c.Subject)
		}
	}
	var b strings.Builder
	b.WriteString(head)
	if len(leaf.AuthorityKeyId) > 0 {
		fmt.Fprintf(&b, "its Authority Key Identifier (%s) names another issuer and ", keyID(leaf.AuthorityKeyId))
	}
	if len(cas) == 1 {
		fmt.Fprintf(&b, "the provided CA (%s) did not sign it; export the intermediate that did.", caLabel(cas[0]))
		return b.String()
	}
	labels := make([]string, 0, len(cas))
	for _, c := range cas {
		labels = append(labels, caLabel(c))
	}
	fmt.Fprintf(&b, "none of the %d provided CA certificates (%s) signed it; export the intermediate that did.", len(cas), strings.Join(labels, ", "))
	return b.String()
}

// selfSigned reports whether c is signed with its own key: no Authority Key
// Identifier, or one equal to its Subject Key Identifier, and a signature
// that verifies under its own public key. The issuer name is not consulted: a
// certificate signed with its own key but naming a CA as issuer is self-signed
// all the same.
func selfSigned(c *x509.Certificate) bool {
	if len(c.AuthorityKeyId) > 0 && !bytes.Equal(c.AuthorityKeyId, c.SubjectKeyId) {
		return false
	}
	return c.CheckSignature(c.SignatureAlgorithm, c.RawTBSCertificate, c.Signature) == nil
}

// signedWithKeyOf reports whether child's signature verifies under c's public
// key, whatever c's CA constraints (which CheckSignatureFrom enforces).
func signedWithKeyOf(child, c *x509.Certificate) bool {
	holder := &x509.Certificate{PublicKey: c.PublicKey}
	return holder.CheckSignature(child.SignatureAlgorithm, child.RawTBSCertificate, child.Signature) == nil
}

// keyID formats a key identifier as colon-separated hex, truncated to its first
// 8 bytes so messages stay readable while still matching what openssl prints.
func keyID(id []byte) string {
	if len(id) <= 8 {
		return fingerprint(id)
	}
	return fingerprint(id[:8]) + "…"
}

// caLabel identifies a chain certificate for a message: its SKI when it has
// one (what the leaf's AKI is compared to), its subject otherwise.
func caLabel(c *x509.Certificate) string {
	if len(c.SubjectKeyId) > 0 {
		return "SKI " + keyID(c.SubjectKeyId)
	}
	return c.Subject.String()
}

// subjects lists the subjects of certs, comma separated.
func subjects(certs []*x509.Certificate) string {
	names := make([]string, 0, len(certs))
	for _, c := range certs {
		names = append(names, c.Subject.String())
	}
	return strings.Join(names, ", ")
}

// SelfSigned reports whether a certificate parsed by ParseCustom is a single,
// self-signed certificate (see selfSigned): it was accepted as is, but clients
// will not trust it until it is added to their trust store, which the UI warns
// about. False for nil and for any certificate served with a chain.
func SelfSigned(cert *tls.Certificate) bool {
	if cert == nil || len(cert.Certificate) != 1 {
		return false
	}
	leaf := leafOf(cert)
	return leaf != nil && selfSigned(leaf)
}

// SelfSignedPEM is SelfSigned for PEM material as CustomPEM returns it: true
// when chainPEM holds no certificate and leafPEM holds exactly one, which is
// self-signed. False for unparseable input.
func SelfSignedPEM(leafPEM, chainPEM []byte) bool {
	if len(pemBlocks(chainPEM)) != 0 {
		return false
	}
	blocks := pemBlocks(leafPEM)
	if len(blocks) != 1 || blocks[0].Type != "CERTIFICATE" {
		return false
	}
	leaf, err := x509.ParseCertificate(blocks[0].Bytes)
	return err == nil && selfSigned(leaf)
}

// EncodeChainPEM re-serializes a parsed certificate as PEM CERTIFICATE blocks:
// the leaf alone in leafPEM, the intermediates (in order) in chainPEM. This is
// the form to persist for an imported certificate: only what was parsed and
// validated, never the operator's raw input, which may carry comments, stray
// blocks or the private key. Nil for a nil or empty certificate.
func EncodeChainPEM(cert *tls.Certificate) (leafPEM, chainPEM []byte) {
	if cert == nil || len(cert.Certificate) == 0 {
		return nil, nil
	}
	leafPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]})
	for _, der := range cert.Certificate[1:] {
		chainPEM = append(chainPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}
	return leafPEM, chainPEM
}

// EncodeKeyPEM re-serializes the private key of a parsed certificate as an
// unencrypted PKCS#8 PRIVATE KEY block, the form to seal and persist (and the
// form SetCustom gets back at startup) whatever encoding the operator pasted.
// The caller seals it at once; it must never be logged or returned.
func EncodeKeyPEM(cert *tls.Certificate) ([]byte, error) {
	if cert == nil || cert.PrivateKey == nil {
		return nil, errors.New("tlsmgr: no private key to encode")
	}
	der, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("tlsmgr: encode private key: %w", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}
