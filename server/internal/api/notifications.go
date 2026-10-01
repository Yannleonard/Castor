// Castor by IT Leonard
package api

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/notify"
	"github.com/gtek-it/castor/server/internal/store"
)

// notificationTestTimeout caps one test delivery from the /test route.
const notificationTestTimeout = 15 * time.Second

// notifySender is the shared sender for the /test route (its own 15s timeout;
// the dispatcher in cache/notifier.go owns a separate instance).
var notifySender = notify.NewSender()

// validChannelTypes is the accepted set for NotificationChannel.Type (mirrors
// the CHECK constraint in migration 0005).
var validChannelTypes = map[string]struct{}{
	"discord": {}, "slack": {}, "ntfy": {}, "webhook": {},
}

// validNotificationEvents is the accepted set of subscribable event kinds.
var validNotificationEvents = map[string]struct{}{
	"container.down": {}, "update.available": {},
}

// notificationChannelView is the SAFE projection of a store.NotificationChannel
// returned to clients. The webhook URL embeds a secret token, so it is NEVER
// returned — only urlSet, which is always true (url_enc is NOT NULL).
type notificationChannelView struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Events    []string `json:"events"`
	Enabled   bool     `json:"enabled"`
	URLSet    bool     `json:"urlSet"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
}

func toNotificationChannelView(c *store.NotificationChannel) notificationChannelView {
	events := c.Events
	if events == nil {
		events = []string{}
	}
	return notificationChannelView{
		ID:        c.ID,
		Name:      c.Name,
		Type:      c.Type,
		Events:    events,
		Enabled:   c.Enabled,
		URLSet:    len(c.URLEnc) > 0,
		CreatedAt: c.CreatedAt,
		UpdatedAt: c.UpdatedAt,
	}
}

type createNotificationChannelRequest struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	URL     string   `json:"url"`
	Events  []string `json:"events"`
	Enabled *bool    `json:"enabled"` // omitted -> true
}

// updateNotificationChannelRequest mirrors create, but URL is optional: omit
// it (or send "") to keep the stored URL, send a value to replace it. The URL
// can never be cleared (a channel without an endpoint is meaningless).
type updateNotificationChannelRequest struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	URL     string   `json:"url"`
	Events  []string `json:"events"`
	Enabled *bool    `json:"enabled"` // omitted -> true
}

// validateNotificationChannel checks the shared create/update fields and
// returns the normalized type.
func validateNotificationChannel(name, chType string, events []string) (string, error) {
	if strings.TrimSpace(name) == "" {
		return "", authz.Errorf(authz.ErrValidation, "Channel name is required.")
	}
	chType = strings.TrimSpace(strings.ToLower(chType))
	if _, ok := validChannelTypes[chType]; !ok {
		return "", authz.Errorf(authz.ErrValidation, "type must be one of discord, slack, ntfy, webhook.")
	}
	for _, e := range events {
		if _, ok := validNotificationEvents[e]; !ok {
			return "", authz.Errorf(authz.ErrValidation, "Unknown event kind: "+e)
		}
	}
	return chType, nil
}

// validateWebhookURL enforces an absolute http(s) URL (never echoed back).
// Literal loopback/link-local hosts are rejected here for a clear error at
// configuration time; hostname-based URLs are checked again at dial time on
// the resolved IP (notify.Sender), which is what actually holds against DNS
// rebinding.
func validateWebhookURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return authz.Errorf(authz.ErrValidation, "Webhook URL must be an absolute http(s) URL.")
	}
	if err := notify.CheckLiteralHost(u.Hostname()); err != nil {
		return authz.Errorf(authz.ErrValidation, "Webhook URL is not allowed: "+err.Error()+".")
	}
	return nil
}

// ListNotificationChannels returns all channels (never their URLs).
func (s *Server) ListNotificationChannels(w http.ResponseWriter, r *http.Request) {
	chans, err := s.store.ListNotificationChannels(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]notificationChannelView, 0, len(chans))
	for _, c := range chans {
		out = append(out, toNotificationChannelView(c))
	}
	ok(w, out)
}

// CreateNotificationChannel creates a channel (perm notifications.manage). The
// webhook URL is sealed in the API layer (pattern: CreateRegistry) — the store
// and the response never see the plaintext.
func (s *Server) CreateNotificationChannel(w http.ResponseWriter, r *http.Request) {
	var req createNotificationChannelRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	chType, err := validateNotificationChannel(req.Name, req.Type, req.Events)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Webhook URL is required."))
		return
	}
	if err := validateWebhookURL(req.URL); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	sealed, err := authz.SealSecret(s.cfg.SecretKey, []byte(strings.TrimSpace(req.URL)))
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	ch := &store.NotificationChannel{
		ID:      store.NewUUID(),
		Name:    strings.TrimSpace(req.Name),
		Type:    chType,
		URLEnc:  sealed,
		Events:  req.Events,
		Enabled: req.Enabled == nil || *req.Enabled,
	}
	if err := s.store.CreateNotificationChannel(r.Context(), ch); err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "notification_channel", ch.ID, ch.Name)
	created(w, toNotificationChannelView(ch))
}

// UpdateNotificationChannel updates a channel (perm notifications.manage).
// Omitting "url" (or sending "") keeps the stored, sealed URL.
func (s *Server) UpdateNotificationChannel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateNotificationChannelRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	existing, err := s.store.GetNotificationChannel(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	chType, err := validateNotificationChannel(req.Name, req.Type, req.Events)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "notification_channel", id, existing.Name)
	ch := &store.NotificationChannel{
		ID:      id,
		Name:    strings.TrimSpace(req.Name),
		Type:    chType,
		Events:  req.Events,
		Enabled: req.Enabled == nil || *req.Enabled,
	}
	setURL := strings.TrimSpace(req.URL) != ""
	if setURL {
		if err := validateWebhookURL(req.URL); err != nil {
			authz.WriteError(w, r, err)
			return
		}
		sealed, err := authz.SealSecret(s.cfg.SecretKey, []byte(strings.TrimSpace(req.URL)))
		if err != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		ch.URLEnc = sealed
	}
	if err := s.store.UpdateNotificationChannel(ctx, ch, setURL); err != nil {
		writeMapped(w, r, err)
		return
	}
	fresh, err := s.store.GetNotificationChannel(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, toNotificationChannelView(fresh))
}

// DeleteNotificationChannel removes a channel (perm notifications.manage).
func (s *Server) DeleteNotificationChannel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "notification_channel", id, "")
	if err := s.store.DeleteNotificationChannel(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// TestNotificationChannel sends a test event through the channel and reports
// 200 on delivery or 502 when the endpoint refused/failed. The URL is opened
// just-in-time and never echoed; failures surface only the redacted sender
// error (channel type + transport cause).
func (s *Server) TestNotificationChannel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	ch, err := s.store.GetNotificationChannel(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "notification_channel", id, ch.Name)

	rawURL, err := authz.OpenSecret(s.cfg.SecretKey, ch.URLEnc)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	ev := notify.Event{
		Kind:    "test",
		Title:   "Castor test notification",
		Message: "This is a test notification for channel " + ch.Name + ".",
		HostID:  cache.HostID,
		Target:  ch.Name,
		TS:      time.Now().Unix(),
	}
	tctx, cancel := contextWithTimeout(r, notificationTestTimeout)
	defer cancel()
	if err := notifySender.Send(tctx, ch.Type, string(rawURL), ev); err != nil {
		authz.WriteError(w, r, &authz.APIError{
			Status:  http.StatusBadGateway,
			Code:    "notification_failed",
			Message: err.Error(),
		})
		return
	}
	ok(w, ActionResult{OK: true})
}
