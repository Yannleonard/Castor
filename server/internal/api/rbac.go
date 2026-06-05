package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// --- users ---

type userListItem struct {
	ID          string                  `json:"id"`
	Username    string                  `json:"username"`
	Email       string                  `json:"email"`
	IsActive    bool                    `json:"isActive"`
	TOTPEnabled bool                    `json:"totpEnabled"`
	LastLoginAt *int64                  `json:"lastLoginAt"`
	CreatedAt   int64                   `json:"createdAt"`
	Roles       []store.RoleBindingView `json:"roles"`
}

type createUserRequest struct {
	Username     string `json:"username"`
	Password     string `json:"password"`
	Email        string `json:"email"`
	MustChangePW bool   `json:"mustChangePassword"`
}

type updateUserRequest struct {
	Email    *string `json:"email"`
	IsActive *bool   `json:"isActive"`
}

type createBindingRequest struct {
	RoleID    string `json:"roleId"`
	ScopeType string `json:"scopeType"`
	ScopeID   string `json:"scopeId"`
}

// ListUsers returns all users with their role bindings (never secrets).
func (s *Server) ListUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	bindings, err := s.store.RoleBindingsView(ctx)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]userListItem, 0, len(users))
	for _, u := range users {
		roles := bindings[u.ID]
		if roles == nil {
			roles = []store.RoleBindingView{}
		}
		out = append(out, userListItem{
			ID:          u.ID,
			Username:    u.Username,
			Email:       u.Email,
			IsActive:    u.IsActive,
			TOTPEnabled: u.TOTPEnabled,
			LastLoginAt: u.LastLoginAt,
			CreatedAt:   u.CreatedAt,
			Roles:       roles,
		})
	}
	ok(w, out)
}

// CreateUser creates a user (perm rbac.user.create).
func (s *Server) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := validateUsername(req.Username); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := validatePassword(req.Password); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	hash, err := authz.HashPassword(req.Password)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	u := &store.User{
		ID:           store.NewUUID(),
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: hash,
		IsActive:     true,
		MustChangePW: req.MustChangePW,
	}
	if err := s.store.CreateUser(r.Context(), u); err != nil {
		// Likely a UNIQUE(username) collision.
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A user with that username already exists."))
		return
	}
	authz.SetAuditTarget(r, "user", u.ID, u.Username)
	created(w, toUserView(u))
}

// UpdateUser updates email/is_active (perm rbac.user.update).
func (s *Server) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateUserRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "user", id, "")

	if _, err := s.store.GetUserByID(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	if err := s.store.UpdateUserProfile(r.Context(), id, req.Email, req.IsActive); err != nil {
		writeMapped(w, r, err)
		return
	}
	u, _ := s.store.GetUserByID(r.Context(), id)
	ok(w, toUserView(u))
}

// DeleteUser deletes a user (perm rbac.user.delete). Cannot delete self or the
// last global admin.
func (s *Server) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "user", id, "")
	ctx := r.Context()

	actor := authz.UserFrom(r)
	if actor != nil && actor.ID == id {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "You cannot delete your own account."))
		return
	}

	// Last-admin protection: if the target is a global admin and the only one.
	isAdmin, _ := s.store.UserHasGlobalRole(ctx, id, store.RoleIDAdmin)
	if isAdmin {
		n, _ := s.store.CountAdminBindings(ctx, store.RoleIDAdmin)
		if n <= 1 {
			authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "Cannot delete the last administrator."))
			return
		}
	}

	if err := s.store.DeleteUser(ctx, id); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// CreateBinding grants a role to a user at a scope (perm rbac.binding.create).
func (s *Server) CreateBinding(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var req createBindingRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.ScopeType == "" {
		req.ScopeType = "global"
	}
	switch req.ScopeType {
	case "global", "host", "cluster":
	default:
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "scopeType must be global, host or cluster."))
		return
	}
	ctx := r.Context()
	if _, err := s.store.GetUserByID(ctx, userID); err != nil {
		writeMapped(w, r, err)
		return
	}
	role, err := s.store.GetRole(ctx, req.RoleID)
	if err != nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Unknown role."))
		return
	}
	// Grant-only-what-you-hold: binding a role grants its whole permission set to
	// the target user at the binding's scope, so the actor must already hold every
	// one of those permissions AT THAT SCOPE. This stops a user with
	// rbac.binding.create but narrow Docker perms from binding the admin ("*") role
	// (to themselves or anyone) and self-escalating.
	if !s.requireActorHolds(w, r, role.Permissions, authz.Scope{Type: req.ScopeType, ID: req.ScopeID}) {
		return
	}
	b := &store.Binding{
		ID:        store.NewUUID(),
		UserID:    userID,
		RoleID:    req.RoleID,
		ScopeType: req.ScopeType,
		ScopeID:   req.ScopeID,
	}
	if err := s.store.CreateBinding(ctx, b); err != nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "That role binding already exists."))
		return
	}
	authz.SetAuditTarget(r, "binding", b.ID, "")
	created(w, b)
}

// DeleteBinding removes a role binding (perm rbac.binding.delete). Protects the
// last global admin binding.
func (s *Server) DeleteBinding(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	bindingID := chi.URLParam(r, "bindingId")
	authz.SetAuditTarget(r, "binding", bindingID, "")
	ctx := r.Context()

	// If this is the last admin binding, refuse.
	isAdmin, _ := s.store.UserHasGlobalRole(ctx, userID, store.RoleIDAdmin)
	if isAdmin {
		n, _ := s.store.CountAdminBindings(ctx, store.RoleIDAdmin)
		if n <= 1 {
			authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "Cannot remove the last administrator binding."))
			return
		}
	}

	if err := s.store.DeleteBinding(ctx, userID, bindingID); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// --- privilege-escalation guard (grant-only-what-you-hold) ---
//
// RBAC's foot-gun is self-escalation: a user with rbac.role.* / rbac.binding.*
// but only narrow Docker perms could otherwise mint a role carrying "*" (or
// "docker.*") and bind it to themselves. To close it, every permission written
// into a role — or carried by a role being bound — must be one the ACTING user
// already holds at the relevant scope. We reuse the exact wildcard-matching the
// runtime check uses (authz User.Can -> permSetGrants), so "holding" a permission
// means holding it, a covering domain wildcard, or "*". Holding a narrow perm
// (docker.container.start) does NOT let you grant a broad one (docker.* or *).

// unheldPermissions returns the subset of perms the actor does NOT hold at the
// given scope (wildcards honored). An empty result means the actor may grant all
// of them. A nil actor holds nothing.
func unheldPermissions(actor *authz.User, perms []string, scope authz.Scope) []string {
	var bad []string
	for _, p := range perms {
		if !actor.Can(p, scope) {
			bad = append(bad, p)
		}
	}
	return bad
}

// requireActorHolds rejects (403, audited) when the actor does not hold every
// permission in perms at scope. The error lists the offending permissions so the
// UI can explain the denial. Returns true when the check passed.
func (s *Server) requireActorHolds(w http.ResponseWriter, r *http.Request, perms []string, scope authz.Scope) bool {
	bad := unheldPermissions(authz.UserFrom(r), perms, scope)
	if len(bad) == 0 {
		return true
	}
	authz.AddAuditDetail(r, "deniedPermissions", bad)
	authz.SetAuditResult(r, "denied")
	authz.WriteError(w, r, authz.Errorf(authz.ErrForbidden,
		"You cannot grant permissions you do not hold: "+strings.Join(bad, ", ")+"."))
	return false
}

// --- roles ---

type createRoleRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

type updateRoleRequest struct {
	Description *string  `json:"description"`
	Permissions []string `json:"permissions"`
}

// ListRoles returns all roles.
func (s *Server) ListRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := s.store.ListRoles(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if roles == nil {
		roles = []*store.Role{}
	}
	ok(w, roles)
}

// CreateRole creates a custom role (perm rbac.role.create).
func (s *Server) CreateRole(w http.ResponseWriter, r *http.Request) {
	var req createRoleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Name == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Role name is required."))
		return
	}
	if err := validatePermissions(req.Permissions); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	// Grant-only-what-you-hold: the actor must hold every permission they put in
	// the role. Roles are global definitions (bindable at any scope), so the
	// conservative target is global scope.
	if !s.requireActorHolds(w, r, req.Permissions, authz.Scope{Type: "global"}) {
		return
	}
	role := &store.Role{
		ID:          store.NewUUID(),
		Name:        req.Name,
		Description: req.Description,
		IsBuiltin:   false,
		Permissions: req.Permissions,
	}
	if err := s.store.CreateRole(r.Context(), role); err != nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A role with that name already exists."))
		return
	}
	authz.SetAuditTarget(r, "role", role.ID, role.Name)
	created(w, role)
}

// UpdateRole updates a custom role (perm rbac.role.update). Built-in -> 409.
func (s *Server) UpdateRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateRoleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	role, err := s.store.GetRole(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if role.IsBuiltin {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "Built-in roles are immutable."))
		return
	}
	if req.Permissions != nil {
		if err := validatePermissions(req.Permissions); err != nil {
			authz.WriteError(w, r, err)
			return
		}
		// Grant-only-what-you-hold: the actor cannot raise a role's permission set
		// above their own. Checked against the NEW set (a no-op for unchanged
		// perms the actor already holds; a denial for any added perm they lack).
		if !s.requireActorHolds(w, r, req.Permissions, authz.Scope{Type: "global"}) {
			return
		}
	}
	authz.SetAuditTarget(r, "role", id, role.Name)
	if err := s.store.UpdateRole(ctx, id, req.Description, req.Permissions); err != nil {
		writeMapped(w, r, err)
		return
	}
	updated, _ := s.store.GetRole(ctx, id)
	ok(w, updated)
}

// DeleteRole deletes a custom role (perm rbac.role.delete). Built-in -> 409.
func (s *Server) DeleteRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	role, err := s.store.GetRole(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if role.IsBuiltin {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "Built-in roles cannot be deleted."))
		return
	}
	authz.SetAuditTarget(r, "role", id, role.Name)
	if err := s.store.DeleteRole(ctx, id); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// Permissions returns the catalog of known permission strings for the editor.
func (s *Server) Permissions(w http.ResponseWriter, r *http.Request) {
	ok(w, PermissionCatalog())
}
