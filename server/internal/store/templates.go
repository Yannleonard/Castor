package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// CustomTemplateEnvVar mirrors templates.EnvVar but lives in the store layer to
// avoid a store->templates import. The JSON tags match the REST contract and the
// built-in catalog shape so the API can merge built-in + custom transparently.
type CustomTemplateEnvVar struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Required bool   `json:"required"`
}

// CustomTemplate is a row of the templates_custom table: an operator-authored
// app template layered on top of the built-in catalog. Ports/Env/Volumes are
// stored as TEXT JSON columns (mirrors roles.permissions) and are guaranteed
// non-nil on read so JSON output is arrays, never null. LogoURL is optional
// (nil/"" -> the UI renders an initials fallback).
type CustomTemplate struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Slug        string                 `json:"slug"`
	Category    string                 `json:"category"`
	Image       string                 `json:"image"`
	Description string                 `json:"description"`
	Ports       []int                  `json:"ports"`
	Env         []CustomTemplateEnvVar `json:"env"`
	Volumes     []string               `json:"volumes"`
	LogoURL     string                 `json:"logoUrl"`
	CreatedBy   string                 `json:"createdBy"`
	CreatedAt   int64                  `json:"createdAt"`
}

const customTemplateCols = `id, name, slug, category, image, description, ports, env, volumes, logo_url, created_by, created_at`

func scanCustomTemplate(row interface{ Scan(...any) error }) (*CustomTemplate, error) {
	var t CustomTemplate
	var portsJSON, envJSON, volsJSON string
	var logoURL, createdBy sql.NullString
	if err := row.Scan(&t.ID, &t.Name, &t.Slug, &t.Category, &t.Image, &t.Description,
		&portsJSON, &envJSON, &volsJSON, &logoURL, &createdBy, &t.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	t.LogoURL = logoURL.String
	t.CreatedBy = createdBy.String
	t.Ports = decodeIntArray(portsJSON)
	t.Env = decodeTemplateEnv(envJSON)
	t.Volumes = decodePerms(volsJSON) // reuse: JSON []string decoder, tolerant
	return &t, nil
}

// ListCustomTemplates returns all custom templates, newest first.
func (s *Store) ListCustomTemplates(ctx context.Context) ([]*CustomTemplate, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+customTemplateCols+` FROM templates_custom ORDER BY created_at DESC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*CustomTemplate
	for rows.Next() {
		t, err := scanCustomTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetCustomTemplate returns one custom template by id.
func (s *Store) GetCustomTemplate(ctx context.Context, id string) (*CustomTemplate, error) {
	return scanCustomTemplate(s.db.QueryRowContext(ctx,
		`SELECT `+customTemplateCols+` FROM templates_custom WHERE id = ?`, id))
}

// CreateCustomTemplate inserts a new custom template. Ports/env/volumes are
// marshaled to TEXT JSON; created_at is unix epoch seconds. The caller assigns
// t.ID (store.NewUUID()) before calling.
func (s *Store) CreateCustomTemplate(ctx context.Context, t *CustomTemplate) error {
	now := time.Now().Unix()
	t.CreatedAt = now
	ports, env, vols, err := marshalTemplateJSON(t)
	if err != nil {
		return err
	}
	category := t.Category
	if category == "" {
		category = "Custom"
	}
	t.Category = category
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO templates_custom (`+customTemplateCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.Name, t.Slug, category, t.Image, t.Description,
		ports, env, vols, nullStr(t.LogoURL), nullStr(t.CreatedBy), now)
	return err
}

// UpdateCustomTemplate replaces the mutable fields of an existing custom
// template. Returns ErrNotFound when no row matched.
func (s *Store) UpdateCustomTemplate(ctx context.Context, t *CustomTemplate) error {
	ports, env, vols, err := marshalTemplateJSON(t)
	if err != nil {
		return err
	}
	category := t.Category
	if category == "" {
		category = "Custom"
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE templates_custom
		   SET name = ?, slug = ?, category = ?, image = ?, description = ?,
		       ports = ?, env = ?, volumes = ?, logo_url = ?
		 WHERE id = ?`,
		t.Name, t.Slug, category, t.Image, t.Description,
		ports, env, vols, nullStr(t.LogoURL), t.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteCustomTemplate removes a custom template by id.
func (s *Store) DeleteCustomTemplate(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM templates_custom WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// marshalTemplateJSON encodes the three JSON-typed columns, normalizing nil
// slices to empty arrays so stored documents are "[]" not "null".
func marshalTemplateJSON(t *CustomTemplate) (ports, env, vols string, err error) {
	p := t.Ports
	if p == nil {
		p = []int{}
	}
	e := t.Env
	if e == nil {
		e = []CustomTemplateEnvVar{}
	}
	v := t.Volumes
	if v == nil {
		v = []string{}
	}
	pb, err := json.Marshal(p)
	if err != nil {
		return "", "", "", err
	}
	eb, err := json.Marshal(e)
	if err != nil {
		return "", "", "", err
	}
	vb, err := json.Marshal(v)
	if err != nil {
		return "", "", "", err
	}
	return string(pb), string(eb), string(vb), nil
}

// decodeIntArray parses a JSON array of ints, tolerating empty/invalid input.
func decodeIntArray(j string) []int {
	if j == "" {
		return []int{}
	}
	var out []int
	if err := json.Unmarshal([]byte(j), &out); err != nil || out == nil {
		return []int{}
	}
	return out
}

// decodeTemplateEnv parses a JSON array of env-var objects, tolerating empty
// or invalid input.
func decodeTemplateEnv(j string) []CustomTemplateEnvVar {
	if j == "" {
		return []CustomTemplateEnvVar{}
	}
	var out []CustomTemplateEnvVar
	if err := json.Unmarshal([]byte(j), &out); err != nil || out == nil {
		return []CustomTemplateEnvVar{}
	}
	return out
}
