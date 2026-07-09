package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// NotificationChannel is a row of notification_channels: one outbound webhook
// endpoint (Discord/Slack/ntfy/generic) subscribed to a set of event kinds.
// The sealed webhook URL (url_enc) is NEVER serialized — the URL embeds the
// secret token, so it carries json:"-" and the API surfaces only urlSet.
// Sealing and opening happen in the API layer via authz.SealSecret/OpenSecret
// (mirrors registries.go); the store persists and returns the opaque BLOB and
// never imports the crypto/authz package (import cycle: authz imports store).
type NotificationChannel struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Type      string   `json:"type"` // discord|slack|ntfy|webhook
	URLEnc    []byte   `json:"-"`
	Events    []string `json:"events"`
	Enabled   bool     `json:"enabled"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
}

// SubscribedTo reports whether the channel subscribes to the given event kind.
func (c *NotificationChannel) SubscribedTo(kind string) bool {
	for _, e := range c.Events {
		if e == kind {
			return true
		}
	}
	return false
}

const notificationChannelCols = `id, name, type, url_enc, events, enabled, created_at, updated_at`

func scanNotificationChannel(row interface{ Scan(...any) error }) (*NotificationChannel, error) {
	var c NotificationChannel
	var eventsJSON string
	var enabled int
	if err := row.Scan(&c.ID, &c.Name, &c.Type, &c.URLEnc, &eventsJSON,
		&enabled, &c.CreatedAt, &c.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Enabled = enabled != 0
	if err := json.Unmarshal([]byte(eventsJSON), &c.Events); err != nil {
		return nil, err
	}
	return &c, nil
}

// ListNotificationChannels returns all channels ordered by name.
func (s *Store) ListNotificationChannels(ctx context.Context) ([]*NotificationChannel, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+notificationChannelCols+` FROM notification_channels ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*NotificationChannel
	for rows.Next() {
		c, err := scanNotificationChannel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetNotificationChannel returns one channel by id.
func (s *Store) GetNotificationChannel(ctx context.Context, id string) (*NotificationChannel, error) {
	return scanNotificationChannel(s.db.QueryRowContext(ctx,
		`SELECT `+notificationChannelCols+` FROM notification_channels WHERE id = ?`, id))
}

// CreateNotificationChannel inserts a channel. c.URLEnc must already be sealed
// by the caller (authz.SealSecret); the plaintext URL is never seen here. The
// caller assigns c.ID (store.NewUUID()) before calling.
func (s *Store) CreateNotificationChannel(ctx context.Context, c *NotificationChannel) error {
	eventsJSON, err := json.Marshal(normEvents(c.Events))
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	c.CreatedAt = now
	c.UpdatedAt = now
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO notification_channels (`+notificationChannelCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.Name, c.Type, c.URLEnc, string(eventsJSON), boolInt(c.Enabled), now, now)
	return err
}

// UpdateNotificationChannel replaces the mutable fields (name, type, events,
// enabled). The sealed URL is only touched when setURL is true: pass the new
// sealed BLOB in c.URLEnc. When setURL is false the stored URL is left
// untouched (url_enc is NOT NULL, so it can never be cleared, only replaced).
// Returns ErrNotFound when no row matched.
func (s *Store) UpdateNotificationChannel(ctx context.Context, c *NotificationChannel, setURL bool) error {
	eventsJSON, err := json.Marshal(normEvents(c.Events))
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx,
		`UPDATE notification_channels SET name = ?, type = ?, events = ?, enabled = ?, updated_at = ? WHERE id = ?`,
		c.Name, c.Type, string(eventsJSON), boolInt(c.Enabled), now, c.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if setURL {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE notification_channels SET url_enc = ? WHERE id = ?`,
			c.URLEnc, c.ID); err != nil {
			return err
		}
	}
	c.UpdatedAt = now
	return nil
}

// DeleteNotificationChannel removes a channel by id.
func (s *Store) DeleteNotificationChannel(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM notification_channels WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// normEvents maps a nil slice to an empty one so events always serializes as a
// JSON array (never "null").
func normEvents(events []string) []string {
	if events == nil {
		return []string{}
	}
	return events
}
