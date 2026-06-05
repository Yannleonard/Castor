package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Stack is a row of the stacks table: a deployed multi-container compose stack.
// ComposeYAML is the validated source document. Status is the lifecycle marker
// (pending|running|partial|stopped|error). ProjectName is the compose project
// label (com.docker.compose.project) used to enumerate/teardown the containers.
type Stack struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ProjectName  string `json:"projectName"`
	HostID       string `json:"hostId"`
	ComposeYAML  string `json:"composeYaml"`
	Status       string `json:"status"`
	ServiceCount int    `json:"serviceCount"`
	CreatedBy    string `json:"createdBy"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

const stackCols = `id, name, project_name, host_id, compose_yaml, status, service_count, created_by, created_at, updated_at`

func scanStack(row interface{ Scan(...any) error }) (*Stack, error) {
	var s Stack
	var createdBy sql.NullString
	if err := row.Scan(&s.ID, &s.Name, &s.ProjectName, &s.HostID, &s.ComposeYAML,
		&s.Status, &s.ServiceCount, &createdBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.CreatedBy = createdBy.String
	return &s, nil
}

// ListStacks returns all stacks for a host, newest first.
func (s *Store) ListStacks(ctx context.Context, hostID string) ([]*Stack, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+stackCols+` FROM stacks WHERE host_id = ? ORDER BY created_at DESC, name ASC`, hostID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Stack
	for rows.Next() {
		st, err := scanStack(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// GetStack returns one stack by id.
func (s *Store) GetStack(ctx context.Context, id string) (*Stack, error) {
	return scanStack(s.db.QueryRowContext(ctx,
		`SELECT `+stackCols+` FROM stacks WHERE id = ?`, id))
}

// GetStackByProject returns one stack by its (unique) project name.
func (s *Store) GetStackByProject(ctx context.Context, project string) (*Stack, error) {
	return scanStack(s.db.QueryRowContext(ctx,
		`SELECT `+stackCols+` FROM stacks WHERE project_name = ?`, project))
}

// CreateStack inserts a new stack row. The caller assigns st.ID (store.NewUUID())
// before calling; created_at/updated_at are set to now (unix seconds). A
// UNIQUE(project_name) violation surfaces as the raw driver error so the API can
// map it to a 409.
func (s *Store) CreateStack(ctx context.Context, st *Stack) error {
	now := time.Now().Unix()
	st.CreatedAt, st.UpdatedAt = now, now
	if st.HostID == "" {
		st.HostID = "local"
	}
	if st.Status == "" {
		st.Status = "pending"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO stacks (`+stackCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		st.ID, st.Name, st.ProjectName, st.HostID, st.ComposeYAML,
		st.Status, st.ServiceCount, nullStr(st.CreatedBy), now, now)
	return err
}

// UpdateStackStatus updates a stack's status (and bumps updated_at). Returns
// ErrNotFound when no row matched.
func (s *Store) UpdateStackStatus(ctx context.Context, id, status string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE stacks SET status = ?, updated_at = ? WHERE id = ?`,
		status, time.Now().Unix(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteStack removes a stack row by id. Returns ErrNotFound when no row matched.
func (s *Store) DeleteStack(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM stacks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
