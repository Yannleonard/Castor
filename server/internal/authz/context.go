package authz

import (
	"context"
	"net/http"

	"github.com/gtek-it/castor/server/internal/store"
)

// Scope identifies the resource scope a permission check applies to. An empty
// (or "global") scope matches everything.
type Scope struct {
	Type string // "global" | "host" | "cluster"
	ID   string
}

// User is the authenticated principal resolved once by SessionAuth and stashed
// in the request context. It carries the store user, the active session, and
// the precomputed effective permission set.
type User struct {
	store.User
	SessionHashID string
	AMR           string
	// perms maps a scope key to the set of granted permission strings. The
	// special scope key "" holds global-scoped grants (match everything).
	perms map[string]map[string]struct{}
	roles []store.EffectiveRole
}

// Roles returns the user's effective roles (role + scope), for /auth/me.
func (u *User) Roles() []store.EffectiveRole { return u.roles }

// HasGlobalSuperuser reports whether the user holds "*" at global scope.
func (u *User) HasGlobalSuperuser() bool {
	if g, ok := u.perms[""]; ok {
		if _, star := g["*"]; star {
			return true
		}
	}
	return false
}

// AllPermissions returns the flattened, de-duplicated set of permission strings
// the user holds across all scopes (used to populate /auth/me.permissions).
func (u *User) AllPermissions() []string {
	seen := map[string]struct{}{}
	for _, byScope := range u.perms {
		for p := range byScope {
			seen[p] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for p := range seen {
		out = append(out, p)
	}
	return out
}

// buildUser assembles a *User from a store user, session, and effective roles.
func buildUser(su *store.User, sessHashID, amr string, roles []store.EffectiveRole) *User {
	u := &User{
		User:          *su,
		SessionHashID: sessHashID,
		AMR:           amr,
		perms:         make(map[string]map[string]struct{}),
		roles:         roles,
	}
	for _, r := range roles {
		key := scopeKey(r.ScopeType, r.ScopeID)
		if u.perms[key] == nil {
			u.perms[key] = make(map[string]struct{})
		}
		for _, p := range r.Permissions {
			u.perms[key][p] = struct{}{}
		}
	}
	return u
}

// scopeKey normalizes a (type,id) pair into a map key. Global scope keys to "".
func scopeKey(typ, id string) string {
	if typ == "" || typ == "global" {
		return ""
	}
	return typ + ":" + id
}

type ctxKey int

const (
	ctxKeyUser ctxKey = iota
	ctxKeyRequestID
)

// WithUser stores the authenticated user in the context.
func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, ctxKeyUser, u)
}

// UserFromContext returns the authenticated user, or nil.
func UserFromContext(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKeyUser).(*User)
	return u
}

// UserFrom returns the authenticated user from a request, or nil.
func UserFrom(r *http.Request) *User { return UserFromContext(r.Context()) }

// WithRequestID stores the request id in the context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKeyRequestID, id)
}

// RequestIDFromContext returns the request id, or "".
func RequestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(ctxKeyRequestID).(string)
	return id
}
