package authz

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id default parameters (ADR-CASTOR-003 §argon2id). Params are encoded in
// the stored PHC string, so they can evolve without breaking existing hashes.
const (
	argonTime    = 2
	argonMemory  = 19456 // KiB (19 MiB)
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// errBadHash is returned when a stored PHC hash cannot be parsed.
var errBadHash = errors.New("authz: malformed argon2id hash")

// HashPassword returns a PHC-encoded argon2id hash of the password with a fresh
// random salt:
//
//	$argon2id$v=19$m=19456,t=2,p=1$<b64salt>$<b64hash>
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

// VerifyPassword reports whether password matches the stored PHC hash, using a
// constant-time comparison. Parameters are read from the stored hash itself.
func VerifyPassword(password, encoded string) (bool, error) {
	mem, time, threads, salt, want, err := parsePHC(encoded)
	if err != nil {
		return false, err
	}
	got := argon2.IDKey([]byte(password), salt, time, mem, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// parsePHC decodes a $argon2id$ PHC string into its parameters, salt and hash.
func parsePHC(encoded string) (mem uint32, t uint32, threads uint8, salt, hash []byte, err error) {
	parts := strings.Split(encoded, "$")
	// ["", "argon2id", "v=19", "m=..,t=..,p=..", "<salt>", "<hash>"]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return 0, 0, 0, nil, nil, errBadHash
	}
	var version int
	if _, err = fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return 0, 0, 0, nil, nil, errBadHash
	}
	var p int
	if _, err = fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &t, &p); err != nil {
		return 0, 0, 0, nil, nil, errBadHash
	}
	threads = uint8(p)
	if salt, err = base64.RawStdEncoding.DecodeString(parts[4]); err != nil {
		return 0, 0, 0, nil, nil, errBadHash
	}
	if hash, err = base64.RawStdEncoding.DecodeString(parts[5]); err != nil {
		return 0, 0, 0, nil, nil, errBadHash
	}
	if len(hash) == 0 {
		return 0, 0, 0, nil, nil, errBadHash
	}
	return mem, t, threads, salt, hash, nil
}
