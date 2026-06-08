package api

import (
	"errors"
	"net/http"
	"strings"
	"unicode"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
)

// mapError translates provider/store errors into the shared API error envelope:
//
//	provider.ErrUnsupported -> 405 method_not_allowed
//	provider.ErrNotFound    -> 404 not_found
//	provider.ErrConflict    -> 409 conflict
//	provider.ErrForbidden   -> 403 forbidden (e.g. ErrHostMountDenied)
//	store.ErrNotFound       -> 404 not_found
//	(*authz.APIError)        -> passed through verbatim
//	anything else            -> 500 internal
//
// RBAC denials (403 forbidden) and guard denials (409 protected_resource) are
// produced directly by the middleware/guard as *authz.APIError, so they reach
// here already shaped and pass through.
func mapError(err error) error {
	if err == nil {
		return nil
	}
	var ae *authz.APIError
	if errors.As(err, &ae) {
		return ae
	}
	switch {
	case errors.Is(err, provider.ErrUnsupported):
		return authz.ErrMethodNotAllowed
	case errors.Is(err, provider.ErrNotFound):
		return authz.ErrNotFound
	case errors.Is(err, provider.ErrConflict):
		// Preserve the specific message (e.g. "Container is running — stop it
		// first, or remove with force") so the UI can explain the 409, without the
		// internal "provider: …" sentinel prefix.
		if msg := detailMessage(err, provider.ErrConflict); msg != "" {
			return authz.Errorf(authz.ErrConflict, msg)
		}
		return authz.ErrConflict
	case errors.Is(err, provider.ErrForbidden):
		// Server-side policy denial (e.g. a host bind mount from a non-admin).
		// Preserve the specific message so the UI can explain why.
		if msg := detailMessage(err, provider.ErrForbidden); msg != "" {
			return authz.Errorf(authz.ErrForbidden, msg)
		}
		return authz.ErrForbidden
	case errors.Is(err, store.ErrNotFound):
		return authz.ErrNotFound
	default:
		return authz.ErrInternal
	}
}

// detailMessage returns the human-facing detail wrapped onto a provider sentinel,
// i.e. the text after the sentinel's own message, with a leading ": " trimmed.
// For `fmt.Errorf("%w: container is running …", ErrConflict)` it returns
// "Container is running …" (capitalized); if there is no extra detail it returns
// "" so the caller can fall back to the generic envelope message.
func detailMessage(err, sentinel error) string {
	full := err.Error()
	base := sentinel.Error()
	detail := strings.TrimPrefix(full, base)
	detail = strings.TrimPrefix(detail, ":")
	detail = strings.TrimSpace(detail)
	if detail == "" {
		return ""
	}
	// Capitalize the first rune for a clean, sentence-like message.
	r := []rune(detail)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// writeMapped writes err through mapError using the shared envelope.
func writeMapped(w http.ResponseWriter, r *http.Request, err error) {
	authz.WriteError(w, r, mapError(err))
}
