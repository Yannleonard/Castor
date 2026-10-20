package api

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
	buildversion "github.com/gtek-it/castor/server/internal/version"
)

func TestAgentVersionValidationAndUpdateAdvisory(t *testing.T) {
	for _, value := range []string{"", "dev", "v1.4.0", "v1.4.0-rc.1", "1.4.0+build.2"} {
		if !validAgentVersion(value) {
			t.Errorf("validAgentVersion(%q)=false", value)
		}
	}
	for _, value := range []string{strings.Repeat("a", 65), "v1.0.0\n", "v1.0.0/evil"} {
		if validAgentVersion(value) {
			t.Errorf("validAgentVersion(%q)=true", value)
		}
	}

	previous := buildversion.Version
	t.Cleanup(func() { buildversion.Version = previous })
	buildversion.Version = "v1.5.0"
	for _, tc := range []struct {
		reported string
		want     bool
	}{
		{reported: "v1.4.0", want: true},
		{reported: "v1.5.0", want: false},
		{reported: "v1.6.0", want: false},
		{reported: "dev", want: false},
	} {
		if got := agentUpdateAvailable(tc.reported); got != tc.want {
			t.Errorf("agentUpdateAvailable(%q)=%t, want %t", tc.reported, got, tc.want)
		}
	}
}

func TestAgentHostEnrollmentIssuesDigestBackedSingleUseCredential(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)
	withTLSManager(t, e)

	// An authenticated administrator over plain HTTP must not mint a bearer token.
	plain := e.do(t, http.MethodPost, "/api/v1/hosts/agent", map[string]any{"name": "edge"}, cookies, csrf)
	if plain.Code != http.StatusForbidden {
		t.Fatalf("plain HTTP enrollment status=%d body=%s", plain.Code, plain.Body.String())
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/agent", strings.NewReader(`{"name":"  edge-linux  "}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://example.test")
	req.Host = "example.test"
	req.TLS = &tls.ConnectionState{Version: tls.VersionTLS12}
	req.Header.Set(authz.CSRFHeaderName, csrf)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("secure enrollment status=%d body=%s, want created", rec.Code, rec.Body.String())
	}
	var got struct {
		HostID string `json:"hostId"`
		Token  string `json:"enrollmentToken"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.HostID == "" || got.Token == "" {
		t.Fatalf("enrollment response=%s err=%v", rec.Body.String(), err)
	}
	digest := sha256.Sum256([]byte(got.Token))
	var stored []byte
	if err := e.st.DB().QueryRow(`SELECT token_hash FROM agent_enrollments WHERE host_id = ?`, got.HostID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if string(stored) != string(digest[:]) {
		t.Fatal("stored enrollment digest does not match returned bearer")
	}
	if string(stored) == got.Token {
		t.Fatal("raw enrollment token was stored")
	}
}

func TestAgentHostRevocationIsAdminGatedAndAudited(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)
	withTLSManager(t, e)
	hostID := "remote-test"
	digest := sha256.Sum256([]byte("test token"))
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "edge", digest[:], 9999999999, ""); err != nil {
		t.Fatal(err)
	}
	plain := e.do(t, http.MethodDelete, "/api/v1/hosts/"+hostID+"/agent", nil, cookies, csrf)
	if plain.Code != http.StatusNoContent {
		t.Fatalf("emergency revocation over authenticated HTTP status=%d body=%s", plain.Code, plain.Body.String())
	}
	entries, _, err := e.st.ListAudit(t.Context(), store.AuditFilter{Action: "agent.host.revoke"})
	if err != nil || len(entries) != 1 || entries[0].Result != "success" {
		t.Fatalf("revocation audit entries=%#v err=%v", entries, err)
	}
	if _, err := e.st.ConsumeAgentEnrollment(t.Context(), digest[:]); err != store.ErrNotFound {
		t.Fatalf("revoked credential redemption error=%v, want ErrNotFound", err)
	}
	list := e.do(t, http.MethodGet, "/api/v1/hosts", nil, cookies, "")
	var visible []hostView
	if list.Code != http.StatusOK || json.Unmarshal(list.Body.Bytes(), &visible) != nil {
		t.Fatalf("hosts list after revoke status=%d body=%s", list.Code, list.Body.String())
	}
	for _, host := range visible {
		if host.ID == hostID {
			t.Fatal("revoked host remains visible in Hosts list")
		}
	}
	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/hosts/" + hostID},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/workloads"},
	} {
		got := e.do(t, tc.method, tc.path, nil, cookies, "")
		if got.Code != http.StatusNotFound {
			t.Errorf("after revoke %s %s status=%d body=%s, want 404", tc.method, tc.path, got.Code, got.Body.String())
		}
	}
}

func TestActiveDockerProviderGuardRejectsEmptyHostID(t *testing.T) {
	e := newTestEnv(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	routeCtx := chi.NewRouteContext()
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	e.srv.requireActiveHostDockerProvider(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("handler ran without hostID")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing hostID status=%d body=%s, want 404", rec.Code, rec.Body.String())
	}
}

func TestAgentHostRevocationWorksWhenServerTLSModeIsOff(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)
	digest := sha256.Sum256([]byte("revoke-http-test"))
	const hostID = "revoke-http-test"
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "edge", digest[:], 9999999999, ""); err != nil {
		t.Fatal(err)
	}
	rec := e.do(t, http.MethodDelete, "/api/v1/hosts/"+hostID+"/agent", nil, cookies, csrf)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("revocation over authenticated HTTP status=%d body=%s", rec.Code, rec.Body.String())
	}
	if _, err := e.st.AgentPublicKey(t.Context(), hostID); err != store.ErrNotFound {
		t.Fatalf("revoked host key lookup error=%v, want not found", err)
	}
}

func TestAgentEnrollmentHTTPSBehindExplicitTrustedProxy(t *testing.T) {
	e := newTestEnv(t)
	e.srv.cfg.TrustProxy = true
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	if !e.srv.agentEnrollmentHTTPS(req) {
		t.Fatal("trusted HTTPS proxy should authorize the encrypted external request")
	}
	e.srv.cfg.TrustProxy = false
	if e.srv.agentEnrollmentHTTPS(req) {
		t.Fatal("untrusted forwarded proto must not authorize enrollment")
	}
}

func TestPendingAgentHostDoesNotInheritLocalProvider(t *testing.T) {
	e := newTestEnv(t)
	adminCookies, _ := adminSession(t, e)
	digest := sha256.Sum256([]byte("token"))
	if err := e.st.CreateAgentHostEnrollment(t.Context(), "remote-list-test", "edge", digest[:], 9999999999, ""); err != nil {
		t.Fatal(err)
	}
	rec := e.do(t, http.MethodGet, "/api/v1/hosts", nil, adminCookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("hosts status=%d body=%s", rec.Code, rec.Body.String())
	}
	var hosts []hostView
	if err := json.Unmarshal(rec.Body.Bytes(), &hosts); err != nil {
		t.Fatal(err)
	}
	for _, h := range hosts {
		if h.ID == "remote-list-test" && len(h.ProviderIDs) != 0 {
			t.Fatalf("pending remote host inherited providers: %v", h.ProviderIDs)
		}
	}
}

func TestRemoteHostsCannotFallThroughToLocalDockerHandlers(t *testing.T) {
	e := newTestEnv(t)
	adminCookies, csrf := adminSession(t, e)
	digest := sha256.Sum256([]byte("remote-guard-test"))
	const hostID = "remote-guard-test"
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "edge", digest[:], 9999999999, ""); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/workloads", nil},
		{http.MethodPost, "/api/v1/hosts/" + hostID + "/workloads/container-id/start", nil},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/images", nil},
		{http.MethodPost, "/api/v1/hosts/" + hostID + "/templates/deploy", map[string]any{"templateId": "test"}},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/networks", nil},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/networks/network-id", nil},
		{http.MethodPost, "/api/v1/hosts/" + hostID + "/networks/network-id/connect", map[string]any{"containerId": "container-id"}},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/volumes", nil},
		{http.MethodPost, "/api/v1/hosts/" + hostID + "/images/pull", map[string]any{"ref": "alpine:latest"}},
		{http.MethodPost, "/api/v1/hosts/" + hostID + "/prune", map[string]any{"kind": "images"}},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/swarm/services", nil},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/k8s/pods", nil},
		{http.MethodGet, "/api/v1/hosts/" + hostID + "/helm/releases", nil},
		{http.MethodPost, "/api/v1/hosts/" + hostID + "/stacks/validate", map[string]any{"yaml": "services: {}"}},
	} {
		rec := e.do(t, tc.method, tc.path, tc.body, adminCookies, csrf)
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s status=%d body=%s, want 503", tc.method, tc.path, rec.Code, rec.Body.String())
			continue
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Errorf("%s %s response is not JSON: %v", tc.method, tc.path, err)
			continue
		}
		got := body["error"].(map[string]any)["code"]
		if got != "host_unavailable" {
			t.Errorf("%s %s error code=%v, want host_unavailable", tc.method, tc.path, got)
		}
	}

}

func TestRemoteAgentHostStatusRequiresLiveAuthenticatedConnection(t *testing.T) {
	e := newTestEnv(t)
	cookies, _ := adminSession(t, e)
	digest := sha256.Sum256([]byte("status-test"))
	const hostID = "remote-stale-status"
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "edge", digest[:], 9999999999, ""); err != nil {
		t.Fatal(err)
	}
	pub := make([]byte, 32)
	if _, err := e.st.RedeemAgentEnrollment(t.Context(), digest[:], pub); err != nil {
		t.Fatal(err)
	}
	if err := e.st.SetAgentConnectionState(t.Context(), hostID, "connected"); err != nil {
		t.Fatal(err)
	}

	list := e.do(t, http.MethodGet, "/api/v1/hosts", nil, cookies, "")
	var hosts []hostView
	if list.Code != http.StatusOK || json.Unmarshal(list.Body.Bytes(), &hosts) != nil {
		t.Fatalf("hosts status=%d body=%s", list.Code, list.Body.String())
	}
	for _, host := range hosts {
		if host.ID == hostID && host.Status != "down" {
			t.Fatalf("stale remote status presented as %q, want down", host.Status)
		}
	}
	detail := e.do(t, http.MethodGet, "/api/v1/hosts/"+hostID, nil, cookies, "")
	var got map[string]any
	if detail.Code != http.StatusOK || json.Unmarshal(detail.Body.Bytes(), &got) != nil {
		t.Fatalf("host detail status=%d body=%s", detail.Code, detail.Body.String())
	}
	if got["status"] != "down" {
		t.Fatalf("stale remote detail status=%v, want down", got["status"])
	}
}

func TestLocalHostOnlyGuardDoesNotRevealUnknownHost(t *testing.T) {
	e := newTestEnv(t)
	cookies, _ := adminSession(t, e)
	rec := e.do(t, http.MethodGet, "/api/v1/hosts/unknown-host/images", nil, cookies, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown host images status=%d body=%s, want 404", rec.Code, rec.Body.String())
	}
}

func TestAgentWebSocketRequiresActualTLS(t *testing.T) {
	e := newTestEnv(t)
	e.srv.cfg.TrustProxy = true
	req := httptest.NewRequest(http.MethodGet, "/api/v1/agent/ws", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUpgradeRequired {
		t.Fatalf("plain HTTP with forwarded proto status=%d, want TLS-required", rec.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/agent/ws", nil)
	req.TLS = &tls.ConnectionState{Version: tls.VersionTLS12}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	req.Header.Set("Origin", "https://example.test")
	rec = httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("browser Origin status=%d, want forbidden", rec.Code)
	}
}

func TestAgentWebSocketRejectsQueryAndNonGetRequests(t *testing.T) {
	e := newTestEnv(t)
	for _, tc := range []struct {
		method string
		target string
		want   int
	}{
		{http.MethodPost, "/api/v1/agent/ws", http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/v1/agent/ws?token=secret", http.StatusBadRequest},
	} {
		req := httptest.NewRequest(tc.method, tc.target, nil)
		req.TLS = &tls.ConnectionState{Version: tls.VersionTLS12}
		rec := httptest.NewRecorder()
		e.mux.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s %s status=%d body=%s, want %d", tc.method, tc.target, rec.Code, rec.Body.String(), tc.want)
		}
	}
}
