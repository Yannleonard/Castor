// Castor by IT Leonard
package store

import (
	"context"
	"database/sql"
	"errors"
)

// APIToken is a row of the api_tokens table (personal access tokens). The id
// is the hex SHA-256 of the raw token — the raw value is shown once at
// creation and never persisted, mirroring sessions. The id itself is safe to
// expose (it cannot be inverted) and serves as the revocation handle.
type APIToken struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	CreatedAt  int64  `json:"createdAt"`
	ExpiresAt  *int64 `json:"expiresAt,omitempty"` // nil = never expires
	LastUsedAt *int64 `json:"lastUsedAt,omitempty"`
	RevokedAt  *int64 `json:"revokedAt,omitempty"`
}

const apiTokenCols = `id, user_id, name, prefix, created_at, expires_at, last_used_at, revoked_at`

func scanAPIToken(row interface{ Scan(...any) error }) (*APIToken, error) {
	var t APIToken
	var expires, lastUsed, revoked sql.NullInt64
	if err := row.Scan(
		&t.ID, &t.UserID, &t.Name, &t.Prefix, &t.CreatedAt,
		&expires, &lastUsed, &revoked,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if expires.Valid {
		v := expires.Int64
		t.ExpiresAt = &v
	}
	if lastUsed.Valid {
		v := lastUsed.Int64
		t.LastUsedAt = &v
	}
	if revoked.Valid {
		v := revoked.Int64
		t.RevokedAt = &v
	}
	return &t, nil
}

// CreateAPIToken inserts a token row. The caller passes the SHA-256 hash of
// the raw token as APIToken.ID and sets CreatedAt (same contract as
// CreateSession — the raw token never reaches the store).
func (s *Store) CreateAPIToken(ctx context.Context, t *APIToken) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO api_tokens (`+apiTokenCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.UserID, t.Name, t.Prefix, t.CreatedAt,
		nullInt(t.ExpiresAt), nullInt(t.LastUsedAt), nullInt(t.RevokedAt),
	)
	return err
}

// GetAPITokenByID returns a token by its hashed id. Revocation/expiry checks
// are the caller's responsibility (the authz layer needs the raw row).
func (s *Store) GetAPITokenByID(ctx context.Context, hashedID string) (*APIToken, error) {
	return scanAPIToken(s.db.QueryRowContext(ctx,
		`SELECT `+apiTokenCols+` FROM api_tokens WHERE id = ?`, hashedID))
}

// ListAPITokensForUser returns a user's tokens (including revoked/expired
// ones, for the UI list), newest first.
func (s *Store) ListAPITokensForUser(ctx context.Context, userID string) ([]*APIToken, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+apiTokenCols+` FROM api_tokens
		 WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*APIToken
	for rows.Next() {
		t, err := scanAPIToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TouchAPIToken stamps last_used_at. The authz layer throttles calls (at most
// one write per token per minute) so this stays an unconditional update.
func (s *Store) TouchAPIToken(ctx context.Context, hashedID string, ts int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, ts, hashedID)
	return err
}

// RevokeAPIToken soft-deletes a token. The user_id predicate ensures users can
// only revoke their OWN tokens; an unknown id, a foreign owner, or an already
// revoked token all return ErrNotFound (no ownership enumeration).
func (s *Store) RevokeAPIToken(ctx context.Context, hashedID, userID string, ts int64) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE api_tokens SET revoked_at = ?
		 WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
		ts, hashedID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
