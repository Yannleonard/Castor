package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ErrBootstrapAlreadyDone is returned by BootstrapFirstAdmin when the instance
// has already been initialized (race-guard / single-shot).
var ErrBootstrapAlreadyDone = errors.New("store: bootstrap already completed")

// BootstrapFirstAdmin creates the first user, grants them the built-in admin
// role at global scope, and flips bootstrap.completed=true — all in ONE
// transaction. It is race-guarded: if a user already exists or bootstrap is
// already completed, it returns ErrBootstrapAlreadyDone and writes nothing.
func (s *Store) BootstrapFirstAdmin(ctx context.Context, userID, username, email, passwordHash, bindingID string) (*User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Guard: bootstrap not already completed.
	var completed sql.NullString
	if err := tx.QueryRowContext(ctx,
		`SELECT value FROM settings WHERE key = ?`, SettingBootstrapCompleted).Scan(&completed); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if completed.Valid && completed.String == "true" {
		return nil, ErrBootstrapAlreadyDone
	}

	// Guard: no users yet.
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return nil, err
	}
	if n > 0 {
		return nil, ErrBootstrapAlreadyDone
	}

	now := time.Now().Unix()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO users (id, username, email, password_hash, totp_enabled,
			is_active, must_change_pw, failed_logins, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 0, 1, 0, 0, ?, ?)`,
		userID, username, nullStr(email), passwordHash, now, now); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO role_bindings (id, user_id, role_id, scope_type, scope_id, created_at)
		 VALUES (?, ?, ?, 'global', NULL, ?)`,
		bindingID, userID, RoleIDAdmin, now); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO settings (key, value, updated_at) VALUES (?, 'true', ?)
		 ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at`,
		SettingBootstrapCompleted, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &User{
		ID:         userID,
		Username:   username,
		Email:      email,
		IsActive:   true,
		AuthSource: "local",
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}
