package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestM365SendUsesMicrosoftGraph(t *testing.T) {
	var tokenRequest, graphRequest bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tenant-id/oauth2/v2.0/token":
			tokenRequest = true
			if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
				t.Errorf("token request = %s %s, content-type %q", r.Method, r.URL.Path, r.Header.Get("Content-Type"))
			}
			body, _ := io.ReadAll(r.Body)
			form, _ := url.ParseQuery(string(body))
			if form.Get("scope") != "https://graph.microsoft.com/.default" {
				t.Errorf("token scope = %q", form.Get("scope"))
			}
			if form.Get("client_secret") != "do-not-log-this" {
				t.Errorf("client secret was not sent to token endpoint")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"access_token":"test-access-token","token_type":"Bearer"}`)
		case "/v1.0/users/castor@example.test/sendMail":
			graphRequest = true
			if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer test-access-token" {
				t.Errorf("Graph request headers/method = %s, %q", r.Method, r.Header.Get("Authorization"))
			}
			var request graphMailRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode Graph payload: %v", err)
			}
			if request.Message.Subject != "Test subject" || request.Message.Body.ContentType != "Text" || request.Message.Body.Content != "Test body" {
				t.Errorf("Graph message = %#v", request.Message)
			}
			if len(request.Message.ToRecipients) != 1 || request.Message.ToRecipients[0].EmailAddress.Address != "recipient@example.test" {
				t.Errorf("Graph recipients = %#v", request.Message.ToRecipients)
			}
			w.WriteHeader(http.StatusAccepted)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	service := newM365Service()
	service.client = server.Client()
	service.tokenEndpoint = server.URL + "/"
	service.graphEndpoint = server.URL + "/v1.0"
	cfg := m365Config{TenantID: "tenant-id", ClientID: "client-id", ClientSecret: "do-not-log-this", Mailbox: "castor@example.test"}
	if err := service.send(t.Context(), cfg, "recipient@example.test", "Test subject", "Test body"); err != nil {
		t.Fatalf("send() error = %v", err)
	}
	if !tokenRequest || !graphRequest {
		t.Fatalf("requests made: token=%t Graph=%t", tokenRequest, graphRequest)
	}
}

func TestGraphSendFailureReasonDoesNotExposeResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			_, _ = io.WriteString(w, `{"access_token":"token","token_type":"Bearer"}`)
			return
		}
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"error":{"code":"ErrorAccessDenied","message":"sensitive diagnostic"}}`)
	}))
	defer server.Close()
	service := newM365Service()
	service.client = server.Client()
	service.tokenEndpoint = server.URL + "/tenant/"
	service.graphEndpoint = server.URL + "/v1.0"
	err := service.send(t.Context(), m365Config{TenantID: "tenant", ClientID: "client", ClientSecret: "secret", Mailbox: "castor@example.test"}, "recipient@example.test", "subject", "body")
	var sendErr *m365SendError
	if !errors.As(err, &sendErr) || sendErr.reason != "graph_permission_rejected" {
		t.Fatalf("send() error = %v, want graph_permission_rejected", err)
	}
	if strings.Contains(err.Error(), "sensitive diagnostic") || strings.Contains(err.Error(), "secret") {
		t.Fatalf("error leaked response details: %v", err)
	}
}

func TestGraphSendFailureReasons(t *testing.T) {
	tests := map[int]string{
		http.StatusUnauthorized:        "graph_authentication_rejected",
		http.StatusForbidden:           "graph_permission_rejected",
		http.StatusNotFound:            "graph_mailbox_not_found",
		http.StatusTooManyRequests:     "graph_throttled",
		http.StatusServiceUnavailable:  "graph_service_unavailable",
		http.StatusInternalServerError: "graph_send_failed",
	}
	for status, want := range tests {
		if got := graphSendFailureReason(status, ""); got != want {
			t.Errorf("graphSendFailureReason(%d) = %q, want %q", status, got, want)
		}
	}
}

func TestM365ConfigPersistsPrivatelyAndKeepsExistingSecret(t *testing.T) {
	service := newM365Service()
	service.path = filepath.Join(t.TempDir(), "m365-smtp.json")
	initial := m365Config{TenantID: "tenant-id", ClientID: "client-id", ClientSecret: "secret-value", Mailbox: "castor@example.test"}
	if err := service.save(initial); err != nil {
		t.Fatal(err)
	}
	updated := m365Config{TenantID: "tenant-id-2", ClientID: "client-id-2", Mailbox: "castor2@example.test"}
	if err := service.updateFromRequest(updated); err != nil {
		t.Fatal(err)
	}
	got, err := service.load()
	if err != nil {
		t.Fatal(err)
	}
	if got.ClientSecret != "secret-value" || got.TenantID != "tenant-id-2" || got.ClientID != "client-id-2" {
		t.Fatalf("config update = %#v", got)
	}
	info, err := os.Stat(service.path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("config file permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestM365ConfigRejectsMissingSecretOnFirstSave(t *testing.T) {
	service := newM365Service()
	service.path = filepath.Join(t.TempDir(), "m365-smtp.json")
	if err := service.updateFromRequest(m365Config{TenantID: "tenant", ClientID: "client", Mailbox: "castor@example.test"}); err == nil {
		t.Fatal("expected missing initial secret to fail")
	}
}

func TestM365ConfigRejectsTenantURLComponents(t *testing.T) {
	for _, tenant := range []string{"../common", "tenant/path", "tenant?x=1", "tenant#fragment"} {
		if err := validateM365Config(m365Config{TenantID: tenant, ClientID: "client", ClientSecret: "secret", Mailbox: "castor@example.test"}, true); err == nil {
			t.Errorf("tenant %q was accepted", tenant)
		}
	}
}
