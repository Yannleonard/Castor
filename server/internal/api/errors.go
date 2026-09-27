package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/tlsmgr"
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
// The network sentinels (ErrNetworkExists, ErrSubnetOverlap, ErrIPInUse,
// ErrAlreadyConnected, ErrStaticIPUnsupported, ErrNetworkInUse,
// ErrAliasUnsupported, ErrIPPoolExhausted -> 409; ErrNotConnected -> 404;
// ErrInvalidNetworkConfig -> 422) each keep a distinct machine code and are
// matched before the generic sentinel they wrap.
//
// The TLS manager sentinels map to 422: tlsmgr.ErrInvalidCertificate (a
// *tlsmgr.CertError) becomes tls_key_mismatch / tls_certificate_expired /
// tls_invalid_certificate by its Kind, carrying the manager's message verbatim
// (see tlsCertificateError); ErrInvalidACMEConfig and ErrInvalidMode become
// validation_failed carrying the manager's explanation.
// The TLS state conflicts (409 tls_managed_by_env, tls_https_off,
// tls_no_custom_certificate) are emitted by the handlers as *authz.APIError
// and pass through.
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
	case errors.Is(err, provider.ErrImageNotFound):
		// Specific 404 (distinct code image_not_found) for a bad/unpullable image,
		// checked before the generic ErrNotFound it wraps.
		return authz.Errorf(authz.ErrImageNotFound, provider.MsgImageNotFound)
	case errors.Is(err, provider.ErrNotConnected):
		// Specific 404 for a disconnect from a network the container is not on.
		return authz.Errorf(authz.ErrNotConnected, provider.MsgNotConnected)
	case errors.Is(err, provider.ErrNotFound):
		return authz.ErrNotFound
	case errors.Is(err, provider.ErrContainerRunning):
		// Specific 409: a clear, actionable message the UI can act on (offer a
		// force-remove) instead of the generic "conflicts with current state".
		return authz.Errorf(authz.ErrConflict, provider.MsgContainerRunning)
	case errors.Is(err, provider.ErrNameConflict):
		// Distinct code name_conflict so the UI can localize + explain.
		return authz.Errorf(authz.ErrNameConflict, provider.MsgNameConflict)
	case errors.Is(err, provider.ErrPortConflict):
		// Distinct code port_conflict for a host-port clash on start.
		return authz.Errorf(authz.ErrPortConflict, provider.MsgPortConflict)
	case errors.Is(err, provider.ErrNetworkExists):
		return authz.Errorf(authz.ErrNetworkExists, provider.MsgNetworkExists)
	case errors.Is(err, provider.ErrSubnetOverlap):
		return authz.Errorf(authz.ErrSubnetOverlap, provider.MsgSubnetOverlap)
	case errors.Is(err, provider.ErrIPInUse):
		return authz.Errorf(authz.ErrIPInUse, provider.MsgIPInUse)
	case errors.Is(err, provider.ErrAlreadyConnected):
		return authz.Errorf(authz.ErrAlreadyConnected, provider.MsgAlreadyConnected)
	case errors.Is(err, provider.ErrStaticIPUnsupported):
		return authz.Errorf(authz.ErrStaticIPUnsupported, provider.MsgStaticIPUnsupported)
	case errors.Is(err, provider.ErrNetworkInUse):
		return authz.Errorf(authz.ErrNetworkInUse, provider.MsgNetworkInUse)
	case errors.Is(err, provider.ErrAliasUnsupported):
		return authz.Errorf(authz.ErrAliasUnsupported, provider.MsgAliasUnsupported)
	case errors.Is(err, provider.ErrIPPoolExhausted):
		return authz.Errorf(authz.ErrIPPoolExhausted, provider.MsgIPPoolExhausted)
	case errors.Is(err, provider.ErrConflict):
		return authz.ErrConflict
	case errors.Is(err, provider.ErrInvalidNetworkConfig):
		// 422 carrying the daemon's cleaned explanation when the wrap has one.
		return authz.Errorf(authz.ErrInvalidNetworkConfig, invalidNetworkConfigMsg(err))
	case errors.Is(err, provider.ErrForbidden):
		// Server-side policy denial (e.g. a host bind mount from a non-admin).
		// Preserve the specific message so the UI can explain why.
		return authz.Errorf(authz.ErrForbidden, err.Error())
	case errors.Is(err, store.ErrNotFound):
		return authz.ErrNotFound
	case errors.Is(err, tlsmgr.ErrInvalidCertificate):
		return tlsCertificateError(err)
	case errors.Is(err, tlsmgr.ErrInvalidACMEConfig):
		return authz.Errorf(authz.ErrValidation, withSentinelDetail(authz.ErrValidation.Message, err, tlsmgr.ErrInvalidACMEConfig))
	case errors.Is(err, tlsmgr.ErrInvalidMode):
		return authz.Errorf(authz.ErrValidation, withSentinelDetail(authz.ErrValidation.Message, err, tlsmgr.ErrInvalidMode))
	default:
		return authz.ErrInternal
	}
}

// invalidNetworkConfigMsg builds the 422 message for an ErrInvalidNetworkConfig
// chain: the detail the provider appended after the sentinel text (already
// stripped of the daemon prefix and folded onto one line), or the canonical
// message when the wrap carries none.
func invalidNetworkConfigMsg(err error) string {
	return withSentinelDetail(authz.ErrInvalidNetworkConfig.Message, err, provider.ErrInvalidNetworkConfig)
}

// tlsCertificateError picks the machine code for a rejected certificate
// import from the *tlsmgr.CertError kind: no certificate pairing with the key
// (tls_key_mismatch), an expired leaf (tls_certificate_expired), anything else
// (tls_invalid_certificate). The response message is the manager's explanation
// verbatim: it is precise, operator-facing and secret-free, and the UI shows
// it as is. A bare ErrInvalidCertificate wrap (none is produced today) keeps
// the canonical message plus whatever detail it carries.
func tlsCertificateError(err error) *authz.APIError {
	var ce *tlsmgr.CertError
	if !errors.As(err, &ce) {
		return authz.Errorf(authz.ErrTLSInvalidCertificate, withSentinelDetail(authz.ErrTLSInvalidCertificate.Message, err, tlsmgr.ErrInvalidCertificate))
	}
	switch ce.Kind {
	case tlsmgr.CertErrorKeyMismatch:
		return authz.Errorf(authz.ErrTLSKeyMismatch, ce.Message)
	case tlsmgr.CertErrorExpired:
		return authz.Errorf(authz.ErrTLSCertificateExpired, ce.Message)
	default:
		return authz.Errorf(authz.ErrTLSInvalidCertificate, ce.Message)
	}
}

// sentinelDetail returns the text an error chain appended after sentinel's own
// message ("<sentinel>: <detail>"), trimmed, or "" when there is none.
func sentinelDetail(err, sentinel error) string {
	msg := err.Error()
	marker := sentinel.Error()
	i := strings.Index(msg, marker)
	if i < 0 {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(msg[i+len(marker):], ":"))
}

// withSentinelDetail appends the detail wrapped after sentinel to a canonical
// message ("Base: detail"), or returns the base message unchanged when the
// chain carries no detail.
func withSentinelDetail(base string, err, sentinel error) string {
	detail := sentinelDetail(err, sentinel)
	if detail == "" {
		return base
	}
	return strings.TrimSuffix(base, ".") + ": " + detail
}

// writeMapped writes err through mapError using the shared envelope.
func writeMapped(w http.ResponseWriter, r *http.Request, err error) {
	authz.WriteError(w, r, mapError(err))
}
