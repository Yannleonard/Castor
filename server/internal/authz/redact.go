package authz

import "strings"

// redactSentinel replaces any value whose key looks secret.
const redactSentinel = "[REDACTED]"

// secretKeyHints are substrings that mark a key as secret-bearing. Matching is
// case-insensitive. Used to scrub audit detail and inspect env masking.
var secretKeyHints = []string{
	"password",
	"passwd",
	"secret",
	"token",
	"authorization",
	"auth",
	"apikey",
	"api_key",
	"accesskey",
	"access_key",
	"privatekey",
	"private_key",
	"credential",
	"session",
	"cookie",
	"_key",
}

// IsSecretKey reports whether a key name looks like it carries a secret value.
func IsSecretKey(key string) bool {
	k := strings.ToLower(key)
	for _, hint := range secretKeyHints {
		if strings.Contains(k, hint) {
			return true
		}
	}
	return false
}

// Redact deep-copies v, replacing values under secret-looking keys with a
// sentinel. It handles map[string]any and []any recursively; other types pass
// through unchanged. Use it on anything before it reaches a log or audit row.
func Redact(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if IsSecretKey(k) {
				out[k] = redactSentinel
				continue
			}
			out[k] = Redact(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = Redact(val)
		}
		return out
	default:
		return v
	}
}

// RedactMap redacts a map in place-friendly way, returning a new sanitized map.
func RedactMap(m map[string]any) map[string]any {
	r, _ := Redact(m).(map[string]any)
	if r == nil {
		return map[string]any{}
	}
	return r
}
