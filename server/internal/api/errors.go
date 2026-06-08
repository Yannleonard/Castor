package api

import (
	"errors"
	"net/http"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
)

// mapError translates provider/store errors into the shared API error envelope:
//
//	provider.ErrUnsupported      -> 405 method_not_allowed
//	provider.ErrNotFound         -> 404 not_found
//	provider.ErrContainerRunning -> 409 conflict (with MsgContainerRunning)
//	provider.ErrConflict         -> 409 conflict
//	provider.ErrForbidden        -> 403 forbidden (e.g. ErrHostMountDenied)
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
	case errors.Is(err, provider.ErrContainerRunning):
		// Specific 409: a clear, actionable message the UI can act on (offer a
		// force-remove) instead of the generic "conflicts with current state".
		return authz.Errorf(authz.ErrConflict, provider.MsgContainerRunning)
	case errors.Is(err, provider.ErrConflict):
		return authz.ErrConflict
	case errors.Is(err, provider.ErrForbidden):
		// Server-side policy denial (e.g. a host bind mount from a non-admin).
		// Preserve the specific message so the UI can explain why.
		return authz.Errorf(authz.ErrForbidden, err.Error())
	case errors.Is(err, store.ErrNotFound):
		return authz.ErrNotFound
	default:
		return authz.ErrInternal
	}
}

// writeMapped writes err through mapError using the shared envelope.
func writeMapped(w http.ResponseWriter, r *http.Request, err error) {
	authz.WriteError(w, r, mapError(err))
}
