package store

import (
	"context"
	"database/sql"
	"time"
)

const hostCols = `id, name, kind, connection, endpoint, status, last_seen_at, created_at`

func scanHost(row interface{ Scan(...any) error }) (*Host, error) {
	var h Host
	var endpoint sql.NullString
	var lastSeen sql.NullInt64
	if err := row.Scan(&h.ID, &h.Name, &h.Kind, &h.Connection, &endpoint, &h.Status, &lastSeen, &h.CreatedAt); err != nil {
		return nil, err
	}
	h.Endpoint = endpoint.String
	if lastSeen.Valid {
		v := lastSeen.Int64
		h.LastSeenAt = &v
	}
	return &h, nil
}

// ListHosts returns all registered hosts.
func (s *Store) ListHosts(ctx context.Context) ([]*Host, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+hostCols+` FROM registered_hosts ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Host
	for rows.Next() {
		h, err := scanHost(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// GetHost returns one host by id.
func (s *Store) GetHost(ctx context.Context, id string) (*Host, error) {
	h, err := scanHost(s.db.QueryRowContext(ctx, `SELECT `+hostCols+` FROM registered_hosts WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return h, err
}

// SetHostStatus updates a host's status and last_seen_at.
func (s *Store) SetHostStatus(ctx context.Context, id, status string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE registered_hosts SET status = ?, last_seen_at = ? WHERE id = ?`,
		status, time.Now().Unix(), id)
	return err
}
