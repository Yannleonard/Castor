// Castor by IT Leonard
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
	// Deploy-specific conflicts carry a distinct machine code so the UI can both
	// show the actionable server message and localize it by code.
	ErrNameConflict  = newErr(http.StatusConflict, "name_conflict", "A container with this name already exists.")
	ErrPortConflict  = newErr(http.StatusConflict, "port_conflict", "A published port is already in use on the host.")
	ErrImageNotFound = newErr(http.StatusNotFound, "image_not_found", "Image not found or could not be pulled.")
	ErrValidation    = newErr(http.StatusUnprocessableEntity, "validation_failed", "The request payload is invalid.")
	ErrRateLimited   = newErr(http.StatusTooManyRequests, "rate_limited", "Too many requests. Please slow down.")
	ErrInternal      = newErr(http.StatusInternalServerError, "internal", "An internal error occurred.")
	ErrAccountLocked = newErr(http.StatusForbidden, "account_locked", "This account is temporarily locked. Try again later.")

	// Network-specific outcomes, one machine code per daemon refusal so the UI
	// can offer the right fix (pick another subnet, disconnect first, ...).
	ErrNetworkExists        = newErr(http.StatusConflict, "network_exists", "A network with this name already exists.")
	ErrSubnetOverlap        = newErr(http.StatusConflict, "subnet_overlap", "This subnet overlaps an existing network's address space.")
	ErrIPInUse              = newErr(http.StatusConflict, "ip_in_use", "That IP address is already used on this network.")
	ErrAlreadyConnected     = newErr(http.StatusConflict, "already_connected", "This container is already connected to that network.")
	ErrNotConnected         = newErr(http.StatusNotFound, "not_connected", "This container is not connected to that network.")
	ErrStaticIPUnsupported  = newErr(http.StatusConflict, "static_ip_unsupported", "Static IP addresses are only supported on user-defined networks.")
	ErrNetworkInUse         = newErr(http.StatusConflict, "network_in_use", "This network still has connected containers.")
	ErrAliasUnsupported     = newErr(http.StatusConflict, "alias_unsupported", "Network aliases are only supported on user-defined networks.")
	ErrIPPoolExhausted      = newErr(http.StatusConflict, "ip_pool_exhausted", "This network has no free IP address left.")
	ErrInvalidNetworkConfig = newErr(http.StatusUnprocessableEntity, "invalid_network_config", "Invalid network configuration.")

	// TLS settings outcomes (Settings > HTTPS). Import failures carry a distinct
	// code per cause so the UI can point at the right field; the messages never
	// contain key material.
	ErrTLSInvalidCertificate  = newErr(http.StatusUnprocessableEntity, "tls_invalid_certificate", "The certificate could not be imported.")
	ErrTLSKeyMismatch         = newErr(http.StatusUnprocessableEntity, "tls_key_mismatch", "The private key does not match the certificate.")
	ErrTLSCertificateExpired  = newErr(http.StatusUnprocessableEntity, "tls_certificate_expired", "The certificate has expired.")
	ErrTLSNoCustomCertificate = newErr(http.StatusConflict, "tls_no_custom_certificate", "No custom certificate has been imported; import one before selecting the custom mode.")
	// ErrTLSManagedByEnv: CASTOR_TLS_MODE=off forces TLS off and the persisted
	// settings are ignored, so no TLS change is accepted until it is unset.
	ErrTLSManagedByEnv = newErr(http.StatusConflict, "tls_managed_by_env", "TLS is managed by the environment (CASTOR_TLS_MODE=off); unset it and restart before changing these settings.")
	// ErrTLSHTTPSOff: ACME needs the HTTPS listener (TLS-ALPN-01, and a
	// certificate to serve), which is only bound at startup.
	ErrTLSHTTPSOff = newErr(http.StatusConflict, "tls_https_off", "HTTPS listener is off — set CASTOR_TLS_MODE and restart.")
	ErrACME        = newErr(http.StatusBadGateway, "acme_error", "The ACME certificate request failed.")
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
