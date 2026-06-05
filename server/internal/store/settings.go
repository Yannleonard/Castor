package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Settings keys (single source of truth for the settings surface).
const (
	SettingBootstrapCompleted = "bootstrap.completed"
	SettingInstanceID         = "instance.id"
	SettingTOTPRequiredForMut = "security.totp_required_for_mutations"
	SettingSessionTTLSeconds  = "session.ttl_seconds"
	SettingProtectedLabels    = "security.protected_labels"
)

// GetSetting returns a setting value by key.
func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return v, err
}

// GetSettingDefault returns a setting value or a default if absent.
func (s *Store) GetSettingDefault(ctx context.Context, key, def string) string {
	v, err := s.GetSetting(ctx, key)
	if err != nil {
		return def
	}
	return v
}

// SetSetting upserts a setting value.
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, time.Now().Unix())
	return err
}

// AllSettings returns every setting as a key->value map.
func (s *Store) AllSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// BootstrapCompleted reports whether bootstrap has been finished.
func (s *Store) BootstrapCompleted(ctx context.Context) (bool, error) {
	v, err := s.GetSetting(ctx, SettingBootstrapCompleted)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return v == "true", nil
}
