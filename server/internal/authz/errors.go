package authz

import (
	"encoding/json"
	"net/http"
)

// APIError is one machine-readable error in the shared envelope. Every non-2xx
// API response uses this single shape:
//
//	{"error":{"code":"<machine_code>","message":"<human>","requestId":"<id>"}}
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// Status is the HTTP status to emit; not serialized inside the envelope.
	Status int `json:"-"`
	// Extra carries optional top-level fields merged into the response body
	// (e.g. {"upgrade":"ws"} on a 426). Not part of the error object itself.
	Extra map[string]any `json:"-"`
}

// Error implements the error interface.
func (e *APIError) Error() string { return e.Code + ": " + e.Message }

// newErr builds an APIError.
func newErr(status int, code, msg string) *APIError {
	return &APIError{Code: code, Message: msg, Status: status}
}

// Canonical errors (locked codes/statuses from the REST contract).
var (
	ErrBootstrapRequired = newErr(http.StatusConflict, "bootstrap_required", "Castor has not been initialized yet.")
	ErrUnauthenticated   = newErr(http.StatusUnauthorized, "unauthenticated", "Authentication required.")
	ErrAALRequired       = newErr(http.StatusForbidden, "aal_required", "Two-factor verification required for this action.")
	ErrForbidden         = newErr(http.StatusForbidden, "forbidden", "You do not have permission to perform this action.")
	ErrCSRFFailed        = newErr(http.StatusForbidden, "csrf_failed", "CSRF validation failed.")
	ErrNotFound          = newErr(http.StatusNotFound, "not_found", "The requested resource was not found.")
	ErrMethodNotAllowed  = newErr(http.StatusMethodNotAllowed, "method_not_allowed", "This operation is not supported by the target orchestrator.")
	ErrProtected         = newErr(http.StatusConflict, "protected_resource", "This resource is protected and cannot be modified.")
	ErrConflict          = newErr(http.StatusConflict, "conflict", "The request conflicts with the current state.")
	ErrValidation        = newErr(http.StatusUnprocessableEntity, "validation_failed", "The request payload is invalid.")
	ErrRateLimited       = newErr(http.StatusTooManyRequests, "rate_limited", "Too many requests. Please slow down.")
	ErrInternal          = newErr(http.StatusInternalServerError, "internal", "An internal error occurred.")
	ErrAccountLocked     = newErr(http.StatusForbidden, "account_locked", "This account is temporarily locked. Try again later.")
)

// Errorf returns a copy of a canonical error with a custom message.
func Errorf(base *APIError, msg string) *APIError {
	cp := *base
	cp.Message = msg
	return &cp
}

// WithExtra returns a copy of an error carrying extra top-level body fields.
func WithExtra(base *APIError, extra map[string]any) *APIError {
	cp := *base
	cp.Extra = extra
	return &cp
}

// WriteError writes any error as the shared JSON envelope. Non-APIError values
// are mapped to a generic 500 (their detail is not leaked to the client).
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	ae, ok := err.(*APIError)
	if !ok || ae == nil {
		ae = ErrInternal
	}
	reqID := RequestIDFromContext(r.Context())

	body := map[string]any{
		"error": map[string]any{
			"code":      ae.Code,
			"message":   ae.Message,
			"requestId": reqID,
		},
	}
	for k, v := range ae.Extra {
		body[k] = v
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(ae.Status)
	_ = json.NewEncoder(w).Encode(body)
}

// WriteJSON writes v as a JSON response with the given status and no-store.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
