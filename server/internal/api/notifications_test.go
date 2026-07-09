package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gtek-it/castor/server/internal/notify"
)

// TestNotificationChannelCreateListNeverLeaksURL proves the core secrecy
// contract: the webhook URL (which embeds a secret token) is accepted on
// create but NEVER appears in any response body — only urlSet:true.
func TestNotificationChannelCreateListNeverLeaksURL(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	const secretURL = "https://hooks.example.test/T000/B000/supersecrettoken"
	rec := e.do(t, http.MethodPost, "/api/v1/notifications/channels", map[string]any{
		"name":   "ops",
		"type":   "discord",
		"url":    secretURL,
		"events": []string{"container.down", "update.available"},
	}, cookies, csrf)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create code = %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "supersecrettoken") {
		t.Fatalf("create response leaks the webhook URL: %s", rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["urlSet"] != true {
		t.Errorf("urlSet = %v want true", body["urlSet"])
	}
	if body["type"] != "discord" || body["enabled"] != true {
		t.Errorf("view = %v", body)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("create did not return an id")
	}

	rec = e.do(t, http.MethodGet, "/api/v1/notifications/channels", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list code = %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "supersecrettoken") {
		t.Fatalf("list response leaks the webhook URL: %s", rec.Body.String())
	}
	var views []notificationChannelView
	if err := json.Unmarshal(rec.Body.Bytes(), &views); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(views) != 1 || !views[0].URLSet || views[0].Name != "ops" {
		t.Fatalf("list = %+v", views)
	}

	// Update without a url keeps the stored one; the response still never leaks.
	rec = e.do(t, http.MethodPut, "/api/v1/notifications/channels/"+id, map[string]any{
		"name":   "ops-renamed",
		"type":   "discord",
		"events": []string{"container.down"},
	}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("update code = %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "supersecrettoken") {
		t.Fatalf("update response leaks the webhook URL")
	}
	if decodeBody(t, rec)["urlSet"] != true {
		t.Errorf("urlSet must stay true when url omitted on update")
	}
}

func TestNotificationChannelValidation(t *testing.T) {
	t.Setenv("CASTOR_NOTIFY_ALLOW_LOOPBACK", "") // exercise the default policy
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	// Unknown type.
	rec := e.do(t, http.MethodPost, "/api/v1/notifications/channels", map[string]any{
		"name": "x", "type": "sms", "url": "https://example.test/h", "events": []string{},
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("unknown type code = %d want 422", rec.Code)
	}

	// Unknown event kind.
	rec = e.do(t, http.MethodPost, "/api/v1/notifications/channels", map[string]any{
		"name": "x", "type": "slack", "url": "https://example.test/h", "events": []string{"bogus.kind"},
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("unknown event code = %d want 422", rec.Code)
	}

	// Non-http(s) URL.
	rec = e.do(t, http.MethodPost, "/api/v1/notifications/channels", map[string]any{
		"name": "x", "type": "webhook", "url": "file:///etc/passwd", "events": []string{},
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("bad scheme code = %d want 422", rec.Code)
	}

	// Literal loopback host (denied by default; SSRF surface).
	rec = e.do(t, http.MethodPost, "/api/v1/notifications/channels", map[string]any{
		"name": "x", "type": "webhook", "url": "http://127.0.0.1:5000/api", "events": []string{},
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("loopback url code = %d want 422", rec.Code)
	}

	// Literal link-local host (cloud metadata range, always denied).
	rec = e.do(t, http.MethodPost, "/api/v1/notifications/channels", map[string]any{
		"name": "x", "type": "webhook", "url": "http://169.254.169.254/latest/meta-data/", "events": []string{},
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("link-local url code = %d want 422", rec.Code)
	}
}

// TestNotificationChannelTestEndpoint drives POST .../test against a live
// httptest endpoint: 200 when the webhook accepts, 502 when it fails.
func TestNotificationChannelTestEndpoint(t *testing.T) {
	// httptest endpoints bind to 127.0.0.1, which URL validation and the dial
	// guard refuse by default.
	t.Setenv("CASTOR_NOTIFY_ALLOW_LOOPBACK", "true")
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	var received notify.Event
	okSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer okSrv.Close()
	badSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer badSrv.Close()

	createChannel := func(name, url string) string {
		rec := e.do(t, http.MethodPost, "/api/v1/notifications/channels", map[string]any{
			"name": name, "type": "webhook", "url": url, "events": []string{"container.down"},
		}, cookies, csrf)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create %s code = %d (%s)", name, rec.Code, rec.Body.String())
		}
		return decodeBody(t, rec)["id"].(string)
	}

	goodID := createChannel("good", okSrv.URL)
	badID := createChannel("bad", badSrv.URL)

	rec := e.do(t, http.MethodPost, "/api/v1/notifications/channels/"+goodID+"/test", nil, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("test(good) code = %d (%s)", rec.Code, rec.Body.String())
	}
	if received.Kind != "test" || received.Target != "good" {
		t.Errorf("delivered test event = %+v", received)
	}

	rec = e.do(t, http.MethodPost, "/api/v1/notifications/channels/"+badID+"/test", nil, cookies, csrf)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("test(bad) code = %d want 502 (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), badSrv.URL) {
		t.Errorf("502 body leaks the webhook URL: %s", rec.Body.String())
	}

	// Delete then test -> 404.
	rec = e.do(t, http.MethodDelete, "/api/v1/notifications/channels/"+goodID, nil, cookies, csrf)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete code = %d", rec.Code)
	}
	rec = e.do(t, http.MethodPost, "/api/v1/notifications/channels/"+goodID+"/test", nil, cookies, csrf)
	if rec.Code != http.StatusNotFound {
		t.Errorf("test(deleted) code = %d want 404", rec.Code)
	}
}
