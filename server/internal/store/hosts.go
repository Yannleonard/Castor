package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var ErrLocalHost = errors.New("store: the local host cannot be revoked")

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

// CreateAgentHostEnrollment creates a pending remote-agent host and its hashed,
// expiring enrollment credential atomically. The raw credential is never passed
// to or persisted by the store.
func (s *Store) CreateAgentHostEnrollment(ctx context.Context, id, name string, tokenHash []byte, expiresAt int64, createdBy string) error {
	if len(tokenHash) != 32 {
		return fmt.Errorf("store: agent enrollment digest must be 32 bytes")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().Unix()
	if _, err := tx.ExecContext(ctx, `INSERT INTO registered_hosts
		(id, name, kind, connection, endpoint, status, created_at)
		VALUES (?, ?, 'docker', 'remote-agent', '', 'pending', ?)`, id, name, now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO agent_enrollments
		(id, host_id, token_hash, expires_at, created_by, created_at)
		VALUES (?, ?, ?, ?, NULLIF(?, ''), ?)`, NewUUID(), id, tokenHash, expiresAt, createdBy, now); err != nil {
		return err
	}
	return tx.Commit()
}

// ConsumeAgentEnrollment atomically redeems a SHA-256 credential digest once.
// Expired, consumed, revoked, or host-revoked credentials return ErrNotFound.
func (s *Store) ConsumeAgentEnrollment(ctx context.Context, tokenHash []byte) (string, error) {
	if len(tokenHash) != 32 {
		return "", ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().Unix()
	var hostID string
	err = tx.QueryRowContext(ctx, `UPDATE agent_enrollments
		SET consumed_at = ?
		WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
		AND EXISTS (SELECT 1 FROM registered_hosts h WHERE h.id = agent_enrollments.host_id AND h.status != 'revoked')
		RETURNING host_id`, now, tokenHash, now).Scan(&hostID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return hostID, nil
}

// RedeemAgentEnrollment consumes a valid one-time enrollment digest and binds
// the agent's Ed25519 public key in the same transaction. A failed bind rolls
// back token consumption, and an already-bound or revoked host cannot be rebound.
func (s *Store) RedeemAgentEnrollment(ctx context.Context, tokenHash, publicKey []byte) (string, error) {
	if len(tokenHash) != 32 || len(publicKey) != 32 {
		return "", ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().Unix()
	var hostID string
	err = tx.QueryRowContext(ctx, `UPDATE agent_enrollments
		SET consumed_at = ?
		WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
		AND EXISTS (SELECT 1 FROM registered_hosts h WHERE h.id = agent_enrollments.host_id AND h.status = 'pending' AND h.agent_pubkey IS NULL)
		RETURNING host_id`, now, tokenHash, now).Scan(&hostID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	res, err := tx.ExecContext(ctx, `UPDATE registered_hosts
		SET agent_pubkey = ?, enrolled_at = ?, status = 'down', last_seen_at = ?
		WHERE id = ? AND connection = 'remote-agent' AND status = 'pending' AND agent_pubkey IS NULL`,
		publicKey, now, now, hostID)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return "", ErrNotFound
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return hostID, nil
}

// AgentPublicKey returns the bound key for an active remote-agent host.
func (s *Store) AgentPublicKey(ctx context.Context, id string) ([]byte, error) {
	var key []byte
	err := s.db.QueryRowContext(ctx, `SELECT agent_pubkey FROM registered_hosts
		WHERE id = ? AND connection = 'remote-agent' AND status != 'revoked' AND agent_pubkey IS NOT NULL`, id).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, ErrNotFound
	}
	return key, nil
}

// FindAgentHostByPublicKey supports recovery if the first enrollment response
// is lost after atomic key binding but before the agent persists its host ID.
func (s *Store) FindAgentHostByPublicKey(ctx context.Context, publicKey []byte) (string, error) {
	if len(publicKey) != 32 {
		return "", ErrNotFound
	}
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM registered_hosts
		WHERE connection = 'remote-agent' AND status != 'revoked' AND agent_pubkey = ?`, publicKey).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// SetAgentConnectionState updates only an enrolled, non-revoked remote host.
func (s *Store) SetAgentConnectionState(ctx context.Context, id, status string) error {
	if status != "connected" && status != "down" {
		return fmt.Errorf("store: invalid agent connection status")
	}
	res, err := s.db.ExecContext(ctx, `UPDATE registered_hosts SET status = ?, last_seen_at = ?
		WHERE id = ? AND connection = 'remote-agent' AND status != 'revoked' AND agent_pubkey IS NOT NULL`,
		status, time.Now().Unix(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return ErrNotFound
	}
	return nil
}

// RevokeAgentHost revokes every outstanding enrollment for a remote host and
// marks the host revoked. Revoke is idempotent; the local engine is immutable.
func (s *Store) RevokeAgentHost(ctx context.Context, id string) error {
	if id == "local" {
		return ErrLocalHost
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var connection string
	if err := tx.QueryRowContext(ctx, `SELECT connection FROM registered_hosts WHERE id = ?`, id).Scan(&connection); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if connection != "remote-agent" {
		return ErrLocalHost
	}
	now := time.Now().Unix()
	if _, err := tx.ExecContext(ctx, `UPDATE agent_enrollments SET revoked_at = ? WHERE host_id = ? AND revoked_at IS NULL`, now, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE registered_hosts SET status = 'revoked' WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}
