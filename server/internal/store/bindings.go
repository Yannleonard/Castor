package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// EffectiveRole is a role joined to one of a user's bindings (for permission
// resolution): the role's permissions plus the binding scope.
type EffectiveRole struct {
	RoleID      string
	RoleName    string
	Permissions []string
	ScopeType   string
	ScopeID     string
}

// CreateBinding inserts a role binding for a user.
func (s *Store) CreateBinding(ctx context.Context, b *Binding) error {
	b.CreatedAt = time.Now().Unix()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO role_bindings (id, user_id, role_id, scope_type, scope_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		b.ID, b.UserID, b.RoleID, b.ScopeType, nullStr(b.ScopeID), b.CreatedAt)
	return err
}

// DeleteBinding removes a role binding by id (must belong to userID).
func (s *Store) DeleteBinding(ctx context.Context, userID, bindingID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM role_bindings WHERE id = ? AND user_id = ?`, bindingID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListBindingsForUser returns a user's bindings (id + role + scope).
func (s *Store) ListBindingsForUser(ctx context.Context, userID string) ([]*Binding, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, role_id, scope_type, scope_id, created_at
		 FROM role_bindings WHERE user_id = ? ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Binding
	for rows.Next() {
		var b Binding
		var scopeID sql.NullString
		if err := rows.Scan(&b.ID, &b.UserID, &b.RoleID, &b.ScopeType, &scopeID, &b.CreatedAt); err != nil {
			return nil, err
		}
		b.ScopeID = scopeID.String
		out = append(out, &b)
	}
	return out, rows.Err()
}

// EffectiveRolesForUser joins a user's bindings to roles, returning each role's
// permissions plus the binding scope. The authz layer unions these.
func (s *Store) EffectiveRolesForUser(ctx context.Context, userID string) ([]EffectiveRole, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT rb.role_id, r.name, r.permissions, rb.scope_type, rb.scope_id
		 FROM role_bindings rb
		 JOIN roles r ON r.id = rb.role_id
		 WHERE rb.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []EffectiveRole
	for rows.Next() {
		var er EffectiveRole
		var permsJSON string
		var scopeID sql.NullString
		if err := rows.Scan(&er.RoleID, &er.RoleName, &permsJSON, &er.ScopeType, &scopeID); err != nil {
			return nil, err
		}
		er.ScopeID = scopeID.String
		er.Permissions = decodePerms(permsJSON)
		out = append(out, er)
	}
	return out, rows.Err()
}

// RoleBindingView is a binding decorated with its role name (for the users API).
type RoleBindingView struct {
	BindingID string `json:"bindingId"`
	RoleID    string `json:"roleId"`
	RoleName  string `json:"roleName"`
	ScopeType string `json:"scopeType"`
	ScopeID   string `json:"scopeId"`
}

// RoleBindingsView returns each user's bindings decorated with role names,
// keyed by user id (used to assemble the users list response).
func (s *Store) RoleBindingsView(ctx context.Context) (map[string][]RoleBindingView, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT rb.user_id, rb.id, rb.role_id, r.name, rb.scope_type, rb.scope_id
		 FROM role_bindings rb JOIN roles r ON r.id = rb.role_id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make(map[string][]RoleBindingView)
	for rows.Next() {
		var userID string
		var v RoleBindingView
		var scopeID sql.NullString
		if err := rows.Scan(&userID, &v.BindingID, &v.RoleID, &v.RoleName, &v.ScopeType, &scopeID); err != nil {
			return nil, err
		}
		v.ScopeID = scopeID.String
		out[userID] = append(out[userID], v)
	}
	return out, rows.Err()
}

// CountAdminBindings counts active global-admin bindings (used to prevent
// deleting the last admin). adminRoleID is the builtin admin role id.
func (s *Store) CountAdminBindings(ctx context.Context, adminRoleID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM role_bindings WHERE role_id = ? AND scope_type = 'global'`,
		adminRoleID).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return n, err
}

// UserHasGlobalRole reports whether a user holds a given role at global scope.
func (s *Store) UserHasGlobalRole(ctx context.Context, userID, roleID string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM role_bindings
		 WHERE user_id = ? AND role_id = ? AND scope_type = 'global'`,
		userID, roleID).Scan(&n)
	return n > 0, err
}
