package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const sessionCols = `id, user_id, csrf_token, user_agent, ip, amr,
	created_at, last_seen_at, expires_at, revoked_at`

func scanSession(row interface{ Scan(...any) error }) (*Session, error) {
	var s Session
	var ua, ip sql.NullString
	var revoked sql.NullInt64
	if err := row.Scan(
		&s.ID, &s.UserID, &s.CSRFToken, &ua, &ip, &s.AMR,
		&s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt, &revoked,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.UserAgent = ua.String
	s.IP = ip.String
	if revoked.Valid {
		v := revoked.Int64
		s.RevokedAt = &v
	}
	return &s, nil
}

// CreateSession inserts a session row. The caller passes the SHA-256 hash of the
// raw session id as Session.ID.
func (s *Store) CreateSession(ctx context.Context, sess *Session) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (`+sessionCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sess.ID, sess.UserID, sess.CSRFToken, nullStr(sess.UserAgent), nullStr(sess.IP),
		sess.AMR, sess.CreatedAt, sess.LastSeenAt, sess.ExpiresAt, nullInt(sess.RevokedAt),
	)
	return err
}

// GetSession returns a session by its hashed id.
func (s *Store) GetSession(ctx context.Context, hashedID string) (*Session, error) {
	return scanSession(s.db.QueryRowContext(ctx,
		`SELECT `+sessionCols+` FROM sessions WHERE id = ?`, hashedID))
}

// TouchSession slides last_seen_at and expires_at forward (sliding TTL, capped
// by the absolute cap which the caller computes and passes as newExpiry).
func (s *Store) TouchSession(ctx context.Context, hashedID string, newExpiry int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`,
		time.Now().Unix(), newExpiry, hashedID)
	return err
}

// UpgradeSessionAMR sets the session amr (e.g. pwd -> pwd+totp).
func (s *Store) UpgradeSessionAMR(ctx context.Context, hashedID, amr string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET amr = ? WHERE id = ?`, amr, hashedID)
	return err
}

// RevokeSession sets revoked_at on a single session.
func (s *Store) RevokeSession(ctx context.Context, hashedID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		time.Now().Unix(), hashedID)
	return err
}

// RevokeAllUserSessions revokes every active session for a user (password change).
func (s *Store) RevokeAllUserSessions(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
		time.Now().Unix(), userID)
	return err
}

// RevokeOtherUserSessions revokes all of a user's sessions except keepHashedID.
func (s *Store) RevokeOtherUserSessions(ctx context.Context, userID, keepHashedID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = ?
		 WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
		time.Now().Unix(), userID, keepHashedID)
	return err
}

// DeleteExpiredSessions prunes sessions past their absolute expiry (housekeeping).
func (s *Store) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM sessions WHERE expires_at < ?`, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
