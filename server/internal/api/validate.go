package api

import (
	"regexp"

	"github.com/gtek-it/castor/server/internal/authz"
)

// usernamePattern allows letters, digits, dot, dash, underscore (3..32 chars).
var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{3,32}$`)

// validateUsername enforces the username policy.
func validateUsername(u string) error {
	if !usernamePattern.MatchString(u) {
		return authz.Errorf(authz.ErrValidation,
			"Username must be 3-32 characters of letters, digits, '.', '-' or '_'.")
	}
	return nil
}

// validatePassword enforces a minimum password length (12) and cap (1024).
func validatePassword(p string) error {
	if len(p) < 12 {
		return authz.Errorf(authz.ErrValidation, "Password must be at least 12 characters.")
	}
	if len(p) > 1024 {
		return authz.Errorf(authz.ErrValidation, "Password is too long.")
	}
	return nil
}
