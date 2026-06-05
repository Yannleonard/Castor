package authz

import (
	"net/http"
	"time"
)

// Cookie names. castor_session carries the opaque session id (HttpOnly);
// castor_csrf carries the CSRF token (readable by JS so the SPA can echo it in
// the X-Castor-CSRF header).
const (
	SessionCookieName = "castor_session"
	CSRFCookieName    = "castor_csrf"
	CSRFHeaderName    = "X-Castor-CSRF"

	// SessionIDBytes is the entropy of the opaque session id (256 bits).
	SessionIDBytes = 32
	// CSRFTokenBytes is the entropy of the CSRF token.
	CSRFTokenBytes = 32

	// AMRPassword is a password-only authentication context.
	AMRPassword = "pwd"
	// AMRPasswordTOTP is a password + TOTP (AAL2) authentication context.
	AMRPasswordTOTP = "pwd+totp"
	// AMRLDAP is an LDAP/LDAPS bind authentication context (external IdP).
	AMRLDAP = "ldap"
	// AMROIDC is an OIDC (Microsoft Entra ID) authentication context (external IdP).
	AMROIDC = "oidc"
)

// nowFunc is overridable in tests; production uses time.Now.
var nowFunc = time.Now

// SetSessionCookie writes the session cookie. secure is set on HTTPS requests.
func SetSessionCookie(w http.ResponseWriter, rawID string, secure bool, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    rawID,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(maxAge.Seconds()),
	})
}

// SetCSRFCookie writes the (non-HttpOnly) CSRF companion cookie.
func SetCSRFCookie(w http.ResponseWriter, token string, secure bool, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(maxAge.Seconds()),
	})
}

// ClearSessionCookies expires both auth cookies (logout).
func ClearSessionCookies(w http.ResponseWriter, secure bool) {
	for _, name := range []string{SessionCookieName, CSRFCookieName} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			HttpOnly: name == SessionCookieName,
			Secure:   secure,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
		})
	}
}

// IsHTTPS reports whether the request arrived over TLS, honoring a trusted
// X-Forwarded-Proto when trustProxy is enabled.
func IsHTTPS(r *http.Request, trustProxy bool) bool {
	if r.TLS != nil {
		return true
	}
	if trustProxy && r.Header.Get("X-Forwarded-Proto") == "https" {
		return true
	}
	return false
}
