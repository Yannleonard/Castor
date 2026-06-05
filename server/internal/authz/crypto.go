// Package authz is Castor's single security choke point: authentication
// (sessions + TOTP), authorization (RBAC), the destructive-action guard, the
// security middleware chain, and audit logging. See ADR-CASTOR-003 §6/§7.
package authz

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
)

// errInvalidKey is returned when a non-32-byte AES key is used.
var errInvalidKey = errors.New("authz: AES key must be 32 bytes")

// SealSecret encrypts plaintext with AES-256-GCM under key (32 bytes). The
// nonce is prepended to the ciphertext. Used for TOTP secrets at rest.
func SealSecret(key, plaintext []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errInvalidKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// OpenSecret decrypts data produced by SealSecret under key.
func OpenSecret(key, data []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errInvalidKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, errors.New("authz: ciphertext too short")
	}
	nonce, ct := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}

// RandomToken returns a base64url (no padding) token from n random bytes.
func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashSessionID returns the hex SHA-256 of a raw session id. The raw id lives
// only in the cookie; we store its hash so a DB leak does not yield live ids.
func HashSessionID(rawID string) string {
	sum := sha256.Sum256([]byte(rawID))
	return hex.EncodeToString(sum[:])
}

// GenerateRecoveryCodes returns n human-friendly recovery codes (groups of
// base32 chars) for display, plus their argon2id hashes for storage.
func GenerateRecoveryCodes(n int) (plain []string, hashes []string, err error) {
	plain = make([]string, 0, n)
	hashes = make([]string, 0, n)
	for i := 0; i < n; i++ {
		raw := make([]byte, 10)
		if _, err = io.ReadFull(rand.Reader, raw); err != nil {
			return nil, nil, err
		}
		// 10 bytes -> 16 base32 chars; format as XXXX-XXXX-XXXX-XXXX.
		enc := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw))
		code := fmt.Sprintf("%s-%s-%s-%s", enc[0:4], enc[4:8], enc[8:12], enc[12:16])
		h, herr := HashPassword(code)
		if herr != nil {
			return nil, nil, herr
		}
		plain = append(plain, code)
		hashes = append(hashes, h)
	}
	return plain, hashes, nil
}

// ConstantTimeEqualString compares two strings without leaking length-position.
func ConstantTimeEqualString(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
