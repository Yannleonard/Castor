package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCurrentAnnouncementProxiesActiveFeed(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/announcements/current" { t.Errorf("upstream path = %q", r.URL.Path) }
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"release-1","kind":"update","title":"Castor 2","message":"Now available","link":"https://example.com/releases"}`))
	}))
	defer upstream.Close()
	w := httptest.NewRecorder()
	proxyCurrentAnnouncement(w, httptest.NewRequest(http.MethodGet, "/api/v1/announcements/current", nil), upstream.URL)
	if w.Code != http.StatusOK { t.Fatalf("status = %d, body=%s", w.Code, w.Body.String()) }
	var got announcementResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil { t.Fatal(err) }
	if got.ID != "release-1" || got.Kind != "update" { t.Fatalf("announcement = %#v", got) }
}

func TestCurrentAnnouncementNoActiveMessageReturnsNoContent(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	w := httptest.NewRecorder()
	proxyCurrentAnnouncement(w, httptest.NewRequest(http.MethodGet, "/api/v1/announcements/current", nil), upstream.URL)
	if w.Code != http.StatusNoContent { t.Fatalf("status = %d, want 204", w.Code) }
}

func TestCurrentAnnouncementRejectsInvalidUpstreamPayload(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":"x","kind":"info","title":"bad","message":"x","link":"javascript:alert(1)"}`))
	}))
	defer upstream.Close()
	w := httptest.NewRecorder()
	proxyCurrentAnnouncement(w, httptest.NewRequest(http.MethodGet, "/", nil), upstream.URL)
	if w.Code != http.StatusBadGateway { t.Fatalf("status = %d, want 502", w.Code) }
}

func TestCurrentAnnouncementBoundsUpstreamResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(strings.Repeat("x", announcementResponseLimit+10))) }))
	defer upstream.Close()
	w := httptest.NewRecorder()
	proxyCurrentAnnouncement(w, httptest.NewRequest(http.MethodGet, "/", nil), upstream.URL)
	if w.Code != http.StatusBadGateway { t.Fatalf("status = %d, want 502", w.Code) }
}
