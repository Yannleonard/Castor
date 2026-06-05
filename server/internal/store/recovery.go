package store

import (
	"context"
	"time"
)

// ReplaceRecoveryCodes deletes any existing recovery codes for a user and
// inserts the supplied argon2id-hashed codes, in one transaction.
func (s *Store) ReplaceRecoveryCodes(ctx context.Context, userID string, ids, hashes []string) error {
	if len(ids) != len(hashes) {
		panic("store: ReplaceRecoveryCodes ids/hashes length mismatch")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE user_id = ?`, userID); err != nil {
		return err
	}
	now := time.Now().Unix()
	for i := range ids {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)`,
			ids[i], userID, hashes[i], now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListUnusedRecoveryCodes returns a user's not-yet-consumed recovery codes.
func (s *Store) ListUnusedRecoveryCodes(ctx context.Context, userID string) ([]RecoveryCode, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []RecoveryCode
	for rows.Next() {
		var rc RecoveryCode
		rc.UserID = userID
		if err := rows.Scan(&rc.ID, &rc.CodeHash); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}

// ConsumeRecoveryCode marks one recovery code used (single-use). Returns
// ErrNotFound if the code was already used or does not exist.
func (s *Store) ConsumeRecoveryCode(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
		time.Now().Unix(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
