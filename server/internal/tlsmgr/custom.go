package tlsmgr

import (
	"bytes"
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

// ErrInvalidCertificate wraps every validation failure of an imported
// certificate so the API layer can map it to a 422. The wrapped message is
// safe to show to the operator and never contains key material.
var ErrInvalidCertificate = errors.New("tlsmgr: invalid certificate")

// ParseCustom validates an operator-supplied certificate: the leaf and its
// optional chain must pair with the private key, the leaf must be valid at
// now, the key must be ECDSA or RSA of at least MinRSABits, and the chain
// (intermediates after the leaf, in the certificate input or the chain input)
// must be valid at now and link up to the leaf (see verifyChain). A private
// key pasted in either certificate input is refused. The returned certificate
// has Leaf populated and is ready to serve.
func ParseCustom(certPEM, chainPEM, keyPEM []byte, now time.Time) (*tls.Certificate, error) {
	if len(certPEM) == 0 || len(keyPEM) == 0 {
		return nil, fmt.Errorf("%w: certificate and private key are required", ErrInvalidCertificate)
	}
	for name, b := range map[string][]byte{"certificate": certPEM, "chain": chainPEM, "private key": keyPEM} {
		if len(b) > MaxPEMBytes {
			return nil, fmt.Errorf("%w: %s exceeds %d KiB", ErrInvalidCertificate, name, MaxPEMBytes>>10)
		}
	}
	if blk, _ := pem.Decode(keyPEM); blk != nil && (strings.Contains(blk.Type, "ENCRYPTED") || blk.Headers["Proc-Type"] != "") {
		return nil, fmt.Errorf("%w: encrypted private keys are not supported, decrypt the key first", ErrInvalidCertificate)
	}
	if err := rejectPrivateKey("certificate", certPEM); err != nil {
		return nil, err
	}
	if err := rejectPrivateKey("chain", chainPEM); err != nil {
		return nil, err
	}

	bundle := append(append([]byte{}, certPEM...), '\n')
	bundle = append(bundle, chainPEM...)
	cert, err := tls.X509KeyPair(bundle, keyPEM)
	if err != nil {
		// The crypto/tls messages are operator-actionable ("private key does not
		// match public key", "failed to find any PEM data") and carry no secret.
		return nil, fmt.Errorf("%w: %s", ErrInvalidCertificate, strings.TrimPrefix(err.Error(), "tls: "))
	}
	leaf := cert.Leaf
	if leaf == nil {
		leaf, err = x509.ParseCertificate(cert.Certificate[0])
		if err != nil {
			return nil, fmt.Errorf("%w: parse leaf: %v", ErrInvalidCertificate, err)
		}
		cert.Leaf = leaf
	}
	if now.Before(leaf.NotBefore) {
		return nil, fmt.Errorf("%w: certificate is not valid before %s", ErrInvalidCertificate, leaf.NotBefore.UTC().Format(time.RFC3339))
	}
	if !now.Before(leaf.NotAfter) {
		return nil, fmt.Errorf("%w: certificate expired on %s", ErrInvalidCertificate, leaf.NotAfter.UTC().Format(time.RFC3339))
	}
	switch pub := leaf.PublicKey.(type) {
	case *rsa.PublicKey:
		if bits := pub.N.BitLen(); bits < MinRSABits {
			return nil, fmt.Errorf("%w: RSA key is %d bits, minimum is %d", ErrInvalidCertificate, bits, MinRSABits)
		}
	case *ecdsa.PublicKey:
		// Any NIST curve Go's TLS stack serves is fine.
	default:
		return nil, fmt.Errorf("%w: unsupported public key type %T (use RSA >= %d bits or ECDSA)", ErrInvalidCertificate, leaf.PublicKey, MinRSABits)
	}
	if err := verifyChain(leaf, cert.Certificate[1:], now); err != nil {
		return nil, err
	}
	return &cert, nil
}

// rejectPrivateKey refuses a PRIVATE KEY block (any flavour: PKCS#8, RSA, EC,
// encrypted) in a certificate input. The key pair parser skips such a block
// silently, so a combined "cert + key" file pasted in the certificate field
// would otherwise be accepted, and the key would travel with the public
// material. The message names the field, never the block content.
func rejectPrivateKey(field string, in []byte) error {
	for rest := in; len(rest) > 0; {
		blk, next := pem.Decode(rest)
		if blk == nil {
			return nil
		}
		if strings.HasSuffix(blk.Type, "PRIVATE KEY") {
			return fmt.Errorf("%w: the %s field contains a private key block; paste only CERTIFICATE blocks there and the key in the private key field", ErrInvalidCertificate, field)
		}
		rest = next
	}
	return nil
}

// verifyChain checks the intermediates supplied with the leaf (chain, DER, in
// bundle order): each parses and is valid at now, chain[0] signed the leaf and
// chain[i+1] signed chain[i], and none is a copy of the leaf. No trust anchor
// is required: a private CA is a legitimate issuer, and the browser decides
// what it trusts. Errors avoid the words the API maps to the key-mismatch and
// expired-leaf codes, so a bad chain always reports as an invalid certificate.
func verifyChain(leaf *x509.Certificate, chain [][]byte, now time.Time) error {
	child := leaf
	for i, der := range chain {
		n := i + 1
		if bytes.Equal(der, leaf.Raw) {
			return fmt.Errorf("%w: chain certificate #%d duplicates the leaf certificate", ErrInvalidCertificate, n)
		}
		c, err := x509.ParseCertificate(der)
		if err != nil {
			return fmt.Errorf("%w: parse chain certificate #%d: %v", ErrInvalidCertificate, n, err)
		}
		if now.Before(c.NotBefore) {
			return fmt.Errorf("%w: chain certificate #%d (%s) is not valid before %s", ErrInvalidCertificate, n, c.Subject, c.NotBefore.UTC().Format(time.RFC3339))
		}
		if !now.Before(c.NotAfter) {
			return fmt.Errorf("%w: chain certificate #%d (%s) is not valid after %s", ErrInvalidCertificate, n, c.Subject, c.NotAfter.UTC().Format(time.RFC3339))
		}
		if err := child.CheckSignatureFrom(c); err != nil {
			return fmt.Errorf("%w: chain certificate #%d (%s) did not sign %s: %v", ErrInvalidCertificate, n, c.Subject, child.Subject, err)
		}
		child = c
	}
	return nil
}

// EncodeChainPEM re-serializes a parsed certificate as PEM CERTIFICATE blocks:
// the leaf alone in leafPEM, the intermediates (in order) in chainPEM. This is
// the form to persist for an imported certificate: only what was parsed and
// validated, never the operator's raw input, which may carry comments, stray
// blocks or a private key pasted in the wrong field. Nil for a nil or empty
// certificate.
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
