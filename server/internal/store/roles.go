package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

const roleCols = `id, name, description, is_builtin, permissions, created_at, updated_at`

func scanRole(row interface{ Scan(...any) error }) (*Role, error) {
	var r Role
	var desc sql.NullString
	var builtin int
	var permsJSON string
	if err := row.Scan(&r.ID, &r.Name, &desc, &builtin, &permsJSON, &r.CreatedAt, &r.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	r.Description = desc.String
	r.IsBuiltin = builtin == 1
	if permsJSON == "" {
		permsJSON = "[]"
	}
	if err := json.Unmarshal([]byte(permsJSON), &r.Permissions); err != nil {
		return nil, err
	}
	if r.Permissions == nil {
		r.Permissions = []string{}
	}
	return &r, nil
}

// CreateRole inserts a new role with a JSON-encoded permission list.
func (s *Store) CreateRole(ctx context.Context, r *Role) error {
	now := time.Now().Unix()
	r.CreatedAt, r.UpdatedAt = now, now
	perms, err := json.Marshal(normPerms(r.Permissions))
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO roles (`+roleCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.Name, nullStr(r.Description), boolInt(r.IsBuiltin), string(perms), now, now)
	return err
}

// GetRole returns one role by id.
func (s *Store) GetRole(ctx context.Context, id string) (*Role, error) {
	return scanRole(s.db.QueryRowContext(ctx, `SELECT `+roleCols+` FROM roles WHERE id = ?`, id))
}

// ListRoles returns all roles ordered by name.
func (s *Store) ListRoles(ctx context.Context) ([]*Role, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+roleCols+` FROM roles ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Role
	for rows.Next() {
		r, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpdateRole updates description and/or permissions of a non-builtin role.
func (s *Store) UpdateRole(ctx context.Context, id string, description *string, permissions []string) error {
	now := time.Now().Unix()
	if description != nil {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE roles SET description = ?, updated_at = ? WHERE id = ?`,
			nullStr(*description), now, id); err != nil {
			return err
		}
	}
	if permissions != nil {
		perms, err := json.Marshal(normPerms(permissions))
		if err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx,
			`UPDATE roles SET permissions = ?, updated_at = ? WHERE id = ?`,
			string(perms), now, id); err != nil {
			return err
		}
	}
	return nil
}

// DeleteRole removes a role (cascades its bindings).
func (s *Store) DeleteRole(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM roles WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// normPerms guarantees a non-nil slice for JSON encoding ("[]" not "null").
func normPerms(p []string) []string {
	if p == nil {
		return []string{}
	}
	return p
}

// decodePerms parses a JSON permission array, tolerating empty/invalid input.
func decodePerms(j string) []string {
	if j == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(j), &out); err != nil || out == nil {
		return []string{}
	}
	return out
}
