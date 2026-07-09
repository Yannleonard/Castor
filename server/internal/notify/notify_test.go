package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// capture records one request received by the fake webhook endpoint.
type capture struct {
	body        string
	contentType string
	title       string
	tags        string
	method      string
}

func newCaptureServer(t *testing.T, status int) (*httptest.Server, *capture) {
	t.Helper()
	// httptest binds to 127.0.0.1, which the dial guard refuses by default.
	t.Setenv("CASTOR_NOTIFY_ALLOW_LOOPBACK", "true")
	c := &capture{}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		c.body = string(b)
		c.contentType = r.Header.Get("Content-Type")
		c.title = r.Header.Get("Title")
		c.tags = r.Header.Get("Tags")
		c.method = r.Method
		w.WriteHeader(status)
	}))
	t.Cleanup(ts.Close)
	return ts, c
}

func testEvent() Event {
	return Event{
		Kind:    "container.down",
		Title:   "Container down",
		Message: "Container \"web\" on host local exited unexpectedly.",
		HostID:  "local",
		Target:  "web",
		TS:      1751000000,
	}
}

func TestSendDiscord(t *testing.T) {
	ts, c := newCaptureServer(t, http.StatusNoContent)
	if err := NewSender().Send(context.Background(), "discord", ts.URL, testEvent()); err != nil {
		t.Fatalf("Send(discord): %v", err)
	}
	if c.method != http.MethodPost {
		t.Errorf("method = %s", c.method)
	}
	if !strings.Contains(c.contentType, "application/json") {
		t.Errorf("content-type = %q", c.contentType)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(c.body), &payload); err != nil {
		t.Fatalf("decode body %q: %v", c.body, err)
	}
	want := "**Container down**\nContainer \"web\" on host local exited unexpectedly."
	if payload["content"] != want {
		t.Errorf("content = %q want %q", payload["content"], want)
	}
}

func TestSendSlack(t *testing.T) {
	ts, c := newCaptureServer(t, http.StatusOK)
	if err := NewSender().Send(context.Background(), "slack", ts.URL, testEvent()); err != nil {
		t.Fatalf("Send(slack): %v", err)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(c.body), &payload); err != nil {
		t.Fatalf("decode body %q: %v", c.body, err)
	}
	if !strings.HasPrefix(payload["text"], "*Container down*\n") {
		t.Errorf("text = %q", payload["text"])
	}
}

func TestSendNtfy(t *testing.T) {
	ts, c := newCaptureServer(t, http.StatusOK)
	ev := testEvent()
	if err := NewSender().Send(context.Background(), "ntfy", ts.URL, ev); err != nil {
		t.Fatalf("Send(ntfy): %v", err)
	}
	if c.body != ev.Message {
		t.Errorf("body = %q want raw message", c.body)
	}
	if c.title != ev.Title {
		t.Errorf("Title header = %q want %q", c.title, ev.Title)
	}
	if c.tags != "warning" {
		t.Errorf("Tags = %q want warning for container.down", c.tags)
	}

	ev.Kind = "update.available"
	if err := NewSender().Send(context.Background(), "ntfy", ts.URL, ev); err != nil {
		t.Fatalf("Send(ntfy update): %v", err)
	}
	if c.tags != "package" {
		t.Errorf("Tags = %q want package for update.available", c.tags)
	}
}

func TestSendWebhookFullEvent(t *testing.T) {
	ts, c := newCaptureServer(t, http.StatusOK)
	ev := testEvent()
	if err := NewSender().Send(context.Background(), "webhook", ts.URL, ev); err != nil {
		t.Fatalf("Send(webhook): %v", err)
	}
	var got Event
	if err := json.Unmarshal([]byte(c.body), &got); err != nil {
		t.Fatalf("decode body %q: %v", c.body, err)
	}
	if got != ev {
		t.Errorf("event round-trip = %+v want %+v", got, ev)
	}
}

func TestSendNon2xxIsError(t *testing.T) {
	ts, _ := newCaptureServer(t, http.StatusInternalServerError)
	err := NewSender().Send(context.Background(), "discord", ts.URL, testEvent())
	if err == nil {
		t.Fatalf("non-2xx must be an error")
	}
	if strings.Contains(err.Error(), ts.URL) {
		t.Errorf("error %q must not contain the webhook URL", err.Error())
	}
}

func TestSendErrorNeverContainsURL(t *testing.T) {
	// A closed server: the transport error must be redacted of the URL.
	ts, _ := newCaptureServer(t, http.StatusOK)
	deadURL := ts.URL + "/hooks/supersecrettoken"
	ts.Close()
	err := NewSender().Send(context.Background(), "slack", deadURL, testEvent())
	if err == nil {
		t.Fatalf("expected transport error")
	}
	if strings.Contains(err.Error(), "supersecrettoken") {
		t.Errorf("error %q leaks the webhook URL path", err.Error())
	}
}

func TestSendUnknownTypeIsError(t *testing.T) {
	if err := NewSender().Send(context.Background(), "sms", "http://127.0.0.1:1", testEvent()); err == nil {
		t.Fatalf("unknown channel type must be an error")
	}
}

func TestSendRefusesLoopbackByDefault(t *testing.T) {
	t.Setenv("CASTOR_NOTIFY_ALLOW_LOOPBACK", "")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("guarded sender must not reach a loopback endpoint")
	}))
	defer ts.Close()
	err := NewSender().Send(context.Background(), "webhook", ts.URL, testEvent())
	if err == nil {
		t.Fatalf("loopback delivery must fail by default")
	}
	if !strings.Contains(err.Error(), "loopback") {
		t.Errorf("error = %q, want loopback denial", err.Error())
	}
}

func TestSendRefusesLinkLocalAlways(t *testing.T) {
	// Even with the loopback opt-in, link-local (metadata range) stays denied.
	t.Setenv("CASTOR_NOTIFY_ALLOW_LOOPBACK", "true")
	err := NewSender().Send(context.Background(), "webhook", "http://169.254.169.254/latest/meta-data/", testEvent())
	if err == nil {
		t.Fatalf("link-local delivery must always fail")
	}
	if !strings.Contains(err.Error(), "link-local") {
		t.Errorf("error = %q, want link-local denial", err.Error())
	}
}

func TestSendDenyPrivateEnv(t *testing.T) {
	t.Setenv("CASTOR_NOTIFY_DENY_PRIVATE", "true")
	err := NewSender().Send(context.Background(), "webhook", "http://10.255.255.1/hook", testEvent())
	if err == nil {
		t.Fatalf("private delivery must fail with CASTOR_NOTIFY_DENY_PRIVATE=true")
	}
	if !strings.Contains(err.Error(), "private") {
		t.Errorf("error = %q, want private-range denial", err.Error())
	}
}

func TestSendRedirectLimit(t *testing.T) {
	var hops atomic.Int32
	var ts *httptest.Server
	ts = newRedirectServer(t, func(w http.ResponseWriter, r *http.Request) {
		hops.Add(1)
		http.Redirect(w, r, ts.URL+"/again", http.StatusFound)
	})
	err := NewSender().Send(context.Background(), "webhook", ts.URL, testEvent())
	if err == nil {
		t.Fatalf("unbounded redirect chain must fail")
	}
	if n := hops.Load(); n > maxRedirects+1 {
		t.Errorf("followed %d hops, want at most %d", n, maxRedirects+1)
	}
	if strings.Contains(err.Error(), ts.URL) {
		t.Errorf("error %q must not contain the webhook URL", err.Error())
	}
}

func TestSendRedirectCannotEscapeDialGuard(t *testing.T) {
	// A redirect hop dials through the same guarded transport: an allowed
	// endpoint must not be able to bounce the request into a denied range.
	ts := newRedirectServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	})
	err := NewSender().Send(context.Background(), "webhook", ts.URL, testEvent())
	if err == nil {
		t.Fatalf("redirect to link-local must fail")
	}
	if !strings.Contains(err.Error(), "link-local") {
		t.Errorf("error = %q, want link-local denial on the redirect hop", err.Error())
	}
}

// newRedirectServer starts a loopback-allowed endpoint with a custom handler.
func newRedirectServer(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	t.Setenv("CASTOR_NOTIFY_ALLOW_LOOPBACK", "true")
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	return ts
}
