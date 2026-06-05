package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Registry is a row of the registries table: image-registry credentials used
// for authenticated pulls. The sealed password/token (secret_enc) is NEVER
// serialized — it carries json:"-" and the API surfaces only HasSecret. Sealing
// and opening of the secret happen in the API layer via authz.SealSecret/
// OpenSecret (mirrors how TOTP secrets are handled); the store persists and
// returns the already-sealed BLOB and never imports the crypto/authz package
// (that would create an import cycle: authz already imports store). Type is one
// of dockerhub|ghcr|gitlab|quay|ecr|custom.
type Registry struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	Username  string `json:"username"`
	SecretEnc []byte `json:"-"`
	Email     string `json:"email"`
	CreatedAt int64  `json:"createdAt"`
}

// HasSecret reports whether a sealed credential is stored (drives the API's
// hasSecret flag without ever exposing the secret itself).
func (rg *Registry) HasSecret() bool { return len(rg.SecretEnc) > 0 }

const registryCols = `id, name, type, url, username, secret_enc, email, created_at`

func scanRegistry(row interface{ Scan(...any) error }) (*Registry, error) {
	var rg Registry
	var secret []byte
	if err := row.Scan(&rg.ID, &rg.Name, &rg.Type, &rg.URL, &rg.Username,
		&secret, &rg.Email, &rg.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rg.SecretEnc = secret
	return &rg, nil
}

// ListRegistries returns all registries ordered by name.
func (s *Store) ListRegistries(ctx context.Context) ([]*Registry, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+registryCols+` FROM registries ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Registry
	for rows.Next() {
		rg, err := scanRegistry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rg)
	}
	return out, rows.Err()
}

// GetRegistry returns one registry by id.
func (s *Store) GetRegistry(ctx context.Context, id string) (*Registry, error) {
	return scanRegistry(s.db.QueryRowContext(ctx,
		`SELECT `+registryCols+` FROM registries WHERE id = ?`, id))
}

// CreateRegistry inserts a registry. rg.SecretEnc must already be sealed by the
// caller (authz.SealSecret) or nil/empty when no credential is supplied; the
// plaintext is never seen here. The caller assigns rg.ID (store.NewUUID())
// before calling. created_at is unix epoch seconds.
func (s *Store) CreateRegistry(ctx context.Context, rg *Registry) error {
	now := time.Now().Unix()
	rg.CreatedAt = now
	if rg.Type == "" {
		rg.Type = "custom"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO registries (`+registryCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		rg.ID, rg.Name, rg.Type, rg.URL, rg.Username, nullBlob(rg.SecretEnc), rg.Email, now)
	return err
}

// UpdateRegistry replaces the mutable identity fields. The sealed secret is only
// touched when setSecret is true: pass the new sealed BLOB in rg.SecretEnc (nil/
// empty clears it). When setSecret is false the stored secret is left untouched.
// Returns ErrNotFound when no row matched.
func (s *Store) UpdateRegistry(ctx context.Context, rg *Registry, setSecret bool) error {
	if rg.Type == "" {
		rg.Type = "custom"
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE registries SET name = ?, type = ?, url = ?, username = ?, email = ? WHERE id = ?`,
		rg.Name, rg.Type, rg.URL, rg.Username, rg.Email, rg.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if setSecret {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE registries SET secret_enc = ? WHERE id = ?`,
			nullBlob(rg.SecretEnc), rg.ID); err != nil {
			return err
		}
	}
	return nil
}

// DeleteRegistry removes a registry by id.
func (s *Store) DeleteRegistry(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM registries WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// nullBlob maps an empty/nil byte slice to a SQL NULL so secret_enc stays NULL
// (not an empty BLOB) when no credential is stored.
func nullBlob(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
