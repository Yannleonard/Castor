package authz

import (
	"bytes"
	"testing"
)

func key32() []byte {
	k := make([]byte, 32)
	for i := range k {
		k[i] = byte(i + 1)
	}
	return k
}

func TestSealOpenRoundTrip(t *testing.T) {
	key := key32()
	plaintext := []byte("JBSWY3DPEHPK3PXP") // a base32 TOTP secret
	ct, err := SealSecret(key, plaintext)
	if err != nil {
		t.Fatalf("SealSecret: %v", err)
	}
	if bytes.Equal(ct, plaintext) {
		t.Fatalf("ciphertext equals plaintext")
	}
	got, err := OpenSecret(key, ct)
	if err != nil {
		t.Fatalf("OpenSecret: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round-trip mismatch: %q != %q", got, plaintext)
	}
}

func TestOpenSecretWrongKeyFails(t *testing.T) {
	ct, _ := SealSecret(key32(), []byte("secret"))
	wrong := key32()
	wrong[0] ^= 0xFF
	if _, err := OpenSecret(wrong, ct); err == nil {
		t.Fatalf("OpenSecret with wrong key must fail")
	}
}

func TestSealRejectsBadKeyLen(t *testing.T) {
	if _, err := SealSecret([]byte("short"), []byte("x")); err == nil {
		t.Fatalf("SealSecret must reject non-32-byte key")
	}
}

func TestSealUsesRandomNonce(t *testing.T) {
	key := key32()
	a, _ := SealSecret(key, []byte("same"))
	b, _ := SealSecret(key, []byte("same"))
	if bytes.Equal(a, b) {
		t.Fatalf("two seals of same plaintext must differ (random nonce)")
	}
}

func TestHashSessionIDStable(t *testing.T) {
	h1 := HashSessionID("abc")
	h2 := HashSessionID("abc")
	if h1 != h2 {
		t.Fatalf("HashSessionID not stable")
	}
	if h1 == HashSessionID("abd") {
		t.Fatalf("HashSessionID collision on different inputs")
	}
	if len(h1) != 64 {
		t.Fatalf("expected 64 hex chars, got %d", len(h1))
	}
}

func TestGenerateRecoveryCodes(t *testing.T) {
	plain, hashes, err := GenerateRecoveryCodes(10)
	if err != nil {
		t.Fatalf("GenerateRecoveryCodes: %v", err)
	}
	if len(plain) != 10 || len(hashes) != 10 {
		t.Fatalf("expected 10 codes, got %d/%d", len(plain), len(hashes))
	}
	// Each plaintext must verify against its own hash and not another's.
	if ok, _ := VerifyPassword(plain[0], hashes[0]); !ok {
		t.Fatalf("recovery code 0 does not verify against its hash")
	}
	if ok, _ := VerifyPassword(plain[0], hashes[1]); ok {
		t.Fatalf("recovery code 0 wrongly verified against hash 1")
	}
	// Codes must be unique.
	seen := map[string]bool{}
	for _, c := range plain {
		if seen[c] {
			t.Fatalf("duplicate recovery code %q", c)
		}
		seen[c] = true
	}
}
