package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// RemoteCatalog is a row of the remote_catalogs table: an external template
// catalog served as JSON at URL. Its templates are fetched on demand and merged
// into the marketplace listing as source="remote:<name>"; the templates
// themselves are NOT persisted — only this catalog source row is. LastFetchedAt
// and LastError are nil until the first refresh.
type RemoteCatalog struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	URL           string  `json:"url"`
	Enabled       bool    `json:"enabled"`
	LastFetchedAt *int64  `json:"lastFetchedAt"`
	TemplateCount int     `json:"templateCount"`
	LastError     *string `json:"lastError"`
	CreatedAt     int64   `json:"createdAt"`
}

const remoteCatalogCols = `id, name, url, enabled, last_fetched_at, template_count, last_error, created_at`

func scanRemoteCatalog(row interface{ Scan(...any) error }) (*RemoteCatalog, error) {
	var c RemoteCatalog
	var enabled int
	var fetched sql.NullInt64
	var lastErr sql.NullString
	if err := row.Scan(&c.ID, &c.Name, &c.URL, &enabled, &fetched,
		&c.TemplateCount, &lastErr, &c.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Enabled = enabled == 1
	if fetched.Valid {
		v := fetched.Int64
		c.LastFetchedAt = &v
	}
	if lastErr.Valid {
		v := lastErr.String
		c.LastError = &v
	}
	return &c, nil
}

// ListRemoteCatalogs returns all remote catalogs ordered by name.
func (s *Store) ListRemoteCatalogs(ctx context.Context) ([]*RemoteCatalog, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+remoteCatalogCols+` FROM remote_catalogs ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*RemoteCatalog
	for rows.Next() {
		c, err := scanRemoteCatalog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetRemoteCatalog returns one remote catalog by id.
func (s *Store) GetRemoteCatalog(ctx context.Context, id string) (*RemoteCatalog, error) {
	return scanRemoteCatalog(s.db.QueryRowContext(ctx,
		`SELECT `+remoteCatalogCols+` FROM remote_catalogs WHERE id = ?`, id))
}

// CreateRemoteCatalog inserts a catalog source (enabled, never-fetched). The
// caller assigns c.ID (store.NewUUID()) before calling.
func (s *Store) CreateRemoteCatalog(ctx context.Context, c *RemoteCatalog) error {
	now := time.Now().Unix()
	c.CreatedAt = now
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO remote_catalogs (id, name, url, enabled, last_fetched_at, template_count, last_error, created_at)
		 VALUES (?, ?, ?, ?, NULL, 0, NULL, ?)`,
		c.ID, c.Name, c.URL, boolInt(c.Enabled), now)
	return err
}

// UpdateRemoteCatalog replaces the mutable identity fields (name, url, enabled).
// Fetch bookkeeping (template_count/last_fetched_at/last_error) is updated only
// by SetRemoteCatalogFetchResult. Returns ErrNotFound when no row matched.
func (s *Store) UpdateRemoteCatalog(ctx context.Context, c *RemoteCatalog) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE remote_catalogs SET name = ?, url = ?, enabled = ? WHERE id = ?`,
		c.Name, c.URL, boolInt(c.Enabled), c.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteRemoteCatalog removes a catalog source by id.
func (s *Store) DeleteRemoteCatalog(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM remote_catalogs WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetRemoteCatalogFetchResult records the outcome of a refresh: on success pass
// a non-negative count and errMsg == "" (clears last_error); on failure pass
// errMsg != "" (count is left untouched by passing a negative value). It always
// stamps last_fetched_at.
func (s *Store) SetRemoteCatalogFetchResult(ctx context.Context, id string, count int, errMsg string) error {
	now := time.Now().Unix()
	if errMsg != "" {
		_, err := s.db.ExecContext(ctx,
			`UPDATE remote_catalogs SET last_fetched_at = ?, last_error = ? WHERE id = ?`,
			now, errMsg, id)
		return err
	}
	if count < 0 {
		count = 0
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE remote_catalogs SET last_fetched_at = ?, template_count = ?, last_error = NULL WHERE id = ?`,
		now, count, id)
	return err
}
