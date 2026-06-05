package authz

import (
	"net/http"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/store"
)

// Can reports whether the user holds perm at the given scope. A "*" grant or a
// matching domain wildcard ("docker.*", "docker.container.*") satisfies any
// permission within it. Global-scoped grants match every scope.
func (u *User) Can(perm string, s Scope) bool {
	if u == nil {
		return false
	}
	// Global grants always apply; scoped grants apply only to the matching scope.
	keys := []string{""} // global
	if k := scopeKey(s.Type, s.ID); k != "" {
		keys = append(keys, k)
	}
	for _, key := range keys {
		set, ok := u.perms[key]
		if !ok {
			continue
		}
		if permSetGrants(set, perm) {
			return true
		}
	}
	return false
}

// permSetGrants reports whether a permission set grants perm, honoring "*" and
// hierarchical wildcards (e.g. "docker.container.*" grants "docker.container.start").
func permSetGrants(set map[string]struct{}, perm string) bool {
	if _, ok := set["*"]; ok {
		return true
	}
	if _, ok := set[perm]; ok {
		return true
	}
	// Hierarchical wildcard: walk prefixes "a.b.c" -> "a.b.*", "a.*".
	parts := strings.Split(perm, ".")
	for i := len(parts) - 1; i >= 1; i-- {
		wild := strings.Join(parts[:i], ".") + ".*"
		if _, ok := set[wild]; ok {
			return true
		}
	}
	return false
}

// ScopeFunc derives the resource scope of a request (e.g. host id from the URL).
type ScopeFunc func(r *http.Request) Scope

// GlobalScope is the default scope function: everything is global in V1.
func GlobalScope(*http.Request) Scope { return Scope{Type: "global"} }

// Deps bundles the cross-cutting dependencies the authz middlewares need.
// Wiring it once avoids threading the store/config through every handler.
type Deps struct {
	Store      *store.Store
	TrustProxy bool
	// AllowedOrigins is the explicit allowlist for mutation/WS Origin checks.
	// Empty means same-origin only (derived from the request Host).
	AllowedOrigins []string
	// SecretKey is the AES key (for any middleware-level crypto needs).
	SecretKey []byte
	// AdminRoleID is the built-in admin role id (last-admin protection).
	AdminRoleID string
	// SessionTTL is the env-derived sliding session lifetime (CASTOR_SESSION_TTL,
	// default 12h). It is the fallback when the persisted session.ttl_seconds
	// setting is absent; the persisted setting takes precedence at runtime.
	SessionTTL time.Duration
	// SessionAbsoluteTTL is the env-derived hard cap on a session's total lifetime
	// (CASTOR_SESSION_ABSOLUTE_TTL, default 24h), measured from created_at. The
	// sliding TTL is never extended past this cap.
	SessionAbsoluteTTL time.Duration
}

// RequirePermission is the single RBAC choke point. It rejects the request with
// 403 forbidden (and an audit 'denied' marker) when the user lacks perm at the
// scope derived by scopeFn. No Docker mutation handler may run before this gate.
func (d *Deps) RequirePermission(perm string, scopeFn ScopeFunc) func(http.Handler) http.Handler {
	if scopeFn == nil {
		scopeFn = GlobalScope
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFrom(r)
			if u == nil {
				WriteError(w, r, ErrUnauthenticated)
				return
			}
			if !u.Can(perm, scopeFn(r)) {
				markDenied(r, perm)
				WriteError(w, r, ErrForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
