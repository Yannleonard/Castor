package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
)

// testEnv wires a Server with a real (temp) store and an empty provider
// registry. The cache Manager is created but never Start()ed, so no Docker
// daemon is required for auth/RBAC/contract tests.
type testEnv struct {
	srv *Server
	mux http.Handler
	st  *store.Store
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	cfg := &config.Config{
		DBPath:             filepath.Join(t.TempDir(), "api.db"),
		SecretKey:          make([]byte, 32),
		SessionTTL:         12 * 3600 * 1e9, // 12h in ns
		SessionAbsoluteTTL: 24 * 3600 * 1e9,
	}
	st, err := store.Connect(cfg)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if err := st.Seed(ctx); err != nil {
		t.Fatalf("Seed: %v", err)
	}

	reg := provider.NewRegistry()
	az := &authz.Deps{Store: st, AdminRoleID: store.RoleIDAdmin}
	guard := authz.NewGuard(st, "self", true)
	// Manager with nil providers; we never Start() it nor hit Docker in these tests.
	mgr := cache.NewManager(cfg, nil, nil, nil)
	// Register the local host snapshot so {hostID}-scoped routes resolve without a
	// live poller (Docker is still never touched in these tests).
	mgr.Store().SeedSnapshotForTest(cache.HostID)

	srv := NewServer(cfg, st, az, guard, mgr, reg)
	return &testEnv{srv: srv, mux: srv.Router(), st: st}
}

func (e *testEnv) do(t *testing.T, method, path string, body any, cookies []*http.Cookie, csrf string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	// Same-origin so the CSRF Origin check passes for mutations.
	req.Header.Set("Origin", "http://example.test")
	req.Host = "example.test"
	for _, c := range cookies {
		req.AddCookie(c)
	}
	if csrf != "" {
		req.Header.Set(authz.CSRFHeaderName, csrf)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	return rec
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return m
}

func TestHealthzAndBootstrapStatus(t *testing.T) {
	e := newTestEnv(t)
	rec := e.do(t, http.MethodGet, "/api/v1/healthz", nil, nil, "")
	if rec.Code != 200 {
		t.Fatalf("healthz code = %d", rec.Code)
	}
	body := decodeBody(t, rec)
	if body["bootstrap"] != true {
		t.Errorf("expected bootstrap=true before init, got %v", body["bootstrap"])
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("expected Cache-Control: no-store on /api response")
	}
}

func TestBootstrapModeBlocksProtectedRoutes(t *testing.T) {
	e := newTestEnv(t)
	// /auth/me is protected and bootstrap-gated -> 409 bootstrap_required.
	rec := e.do(t, http.MethodGet, "/api/v1/auth/me", nil, nil, "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 in bootstrap mode, got %d (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	errObj := body["error"].(map[string]any)
	if errObj["code"] != "bootstrap_required" {
		t.Errorf("error code = %v want bootstrap_required", errObj["code"])
	}
	if _, ok := errObj["requestId"]; !ok {
		t.Errorf("error envelope missing requestId")
	}
}

func TestBootstrapThenLoginFlow(t *testing.T) {
	e := newTestEnv(t)

	// 1. Bootstrap the first admin.
	rec := e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin",
		"password": "supersecretpw1",
		"email":    "admin@example.test",
	}, nil, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("bootstrap code = %d (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["totpEnrollOffered"] != true {
		t.Errorf("expected totpEnrollOffered=true")
	}

	// 2. Second bootstrap must now be rejected.
	rec = e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin2", "password": "supersecretpw1",
	}, nil, "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("second bootstrap code = %d want 409", rec.Code)
	}

	// 3. Login.
	rec = e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")
	if rec.Code != 200 {
		t.Fatalf("login code = %d (%s)", rec.Code, rec.Body.String())
	}
	body = decodeBody(t, rec)
	if body["requiresTotp"] != false {
		t.Errorf("requiresTotp = %v want false", body["requiresTotp"])
	}
	csrf, _ := body["csrfToken"].(string)
	if csrf == "" {
		t.Fatalf("login did not return csrfToken")
	}
	perms, _ := body["permissions"].([]any)
	if len(perms) == 0 {
		t.Errorf("admin login should return permissions")
	}
	cookies := rec.Result().Cookies()
	if !hasCookie(cookies, authz.SessionCookieName) {
		t.Fatalf("login did not set %s cookie", authz.SessionCookieName)
	}

	// 4. /auth/me with the session cookie.
	rec = e.do(t, http.MethodGet, "/api/v1/auth/me", nil, cookies, "")
	if rec.Code != 200 {
		t.Fatalf("me code = %d (%s)", rec.Code, rec.Body.String())
	}
	body = decodeBody(t, rec)
	user := body["user"].(map[string]any)
	if user["username"] != "admin" {
		t.Errorf("me username = %v", user["username"])
	}

	// 5. A mutating call WITHOUT the CSRF header must be rejected.
	rec = e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "x", "permissions": []string{"audit.read"},
	}, cookies, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF should be 403, got %d", rec.Code)
	}
	if decodeBody(t, rec)["error"].(map[string]any)["code"] != "csrf_failed" {
		t.Errorf("expected csrf_failed code")
	}

	// 6. With the CSRF header it succeeds (admin has '*').
	rec = e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "auditors", "description": "", "permissions": []string{"audit.read"},
	}, cookies, csrf)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create role code = %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestLoginBadCredentialsUniform(t *testing.T) {
	e := newTestEnv(t)
	// Bootstrap so we're out of bootstrap mode.
	e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")

	// Unknown user and wrong password must both be 401 unauthenticated.
	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "ghost", "password": "whatever12345",
	}, nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("unknown user login = %d want 401", rec.Code)
	}
	rec = e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "admin", "password": "wrongpassword12",
	}, nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong password login = %d want 401", rec.Code)
	}
}

func TestProvidersEndpointShape(t *testing.T) {
	e := newTestEnv(t)
	// Register a fake read-only provider to exercise capability serialization.
	e.srv.reg.Register(&roProvider{})

	e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")
	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")
	cookies := rec.Result().Cookies()

	rec = e.do(t, http.MethodGet, "/api/v1/providers", nil, cookies, "")
	if rec.Code != 200 {
		t.Fatalf("providers code = %d (%s)", rec.Code, rec.Body.String())
	}
	var provs []providerView
	if err := json.Unmarshal(rec.Body.Bytes(), &provs); err != nil {
		t.Fatalf("decode providers: %v", err)
	}
	if len(provs) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(provs))
	}
	if provs[0].Kind != "swarm" {
		t.Errorf("kind = %q", provs[0].Kind)
	}
	if !contains(provs[0].Capabilities, "readonly") {
		t.Errorf("read-only provider must advertise 'readonly' capability: %v", provs[0].Capabilities)
	}
}

// TestDeniedMutationIsAudited proves the contract from the security runbook
// ("Denials return 403 and are audited"): an RBAC-denied mutation must still
// write exactly one append-only audit row with result="denied". This guards the
// middleware ordering — AuditWrap must wrap RequirePermission so the audit
// record exists (and is persisted) even when the gate short-circuits with 403.
func TestDeniedMutationIsAudited(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()

	// Out of bootstrap mode.
	e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")

	// A viewer holds only *.read perms — NOT rbac.role.create.
	hash, err := authz.HashPassword("viewerpassword1")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	uid := store.NewUUID()
	if err := e.st.CreateUser(ctx, &store.User{ID: uid, Username: "viewer", PasswordHash: hash, IsActive: true}); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := e.st.CreateBinding(ctx, &store.Binding{
		ID: store.NewUUID(), UserID: uid, RoleID: store.RoleIDViewer, ScopeType: "global",
	}); err != nil {
		t.Fatalf("CreateBinding: %v", err)
	}

	// Login as the viewer to obtain a real session + CSRF token.
	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "viewer", "password": "viewerpassword1",
	}, nil, "")
	if rec.Code != 200 {
		t.Fatalf("viewer login code = %d (%s)", rec.Code, rec.Body.String())
	}
	csrf, _ := decodeBody(t, rec)["csrfToken"].(string)
	cookies := rec.Result().Cookies()

	// Attempt a mutation the viewer lacks permission for.
	rec = e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "nope", "permissions": []string{"audit.read"},
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer create role = %d want 403 (%s)", rec.Code, rec.Body.String())
	}

	// The denial MUST have produced exactly one audit row.
	entries, _, err := e.st.ListAudit(ctx, store.AuditFilter{Action: "rbac.role.create"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected exactly 1 audited denial for rbac.role.create, got %d", len(entries))
	}
	got := entries[0]
	if got.Result != "denied" {
		t.Errorf("audit result = %q want denied", got.Result)
	}
	if got.HTTPStatus != http.StatusForbidden {
		t.Errorf("audit httpStatus = %d want 403", got.HTTPStatus)
	}
	if got.ActorName != "viewer" {
		t.Errorf("audit actorName = %q want viewer", got.ActorName)
	}
	if got.ActorID != uid {
		t.Errorf("audit actorId = %q want %q", got.ActorID, uid)
	}
}

func hasCookie(cs []*http.Cookie, name string) bool {
	for _, c := range cs {
		if c.Name == name && c.Value != "" {
			return true
		}
	}
	return false
}

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}

// roProvider is a read-only provider double for the providers-endpoint test.
type roProvider struct{ provider.ReadOnlyMutations }

var _ provider.Provider = roProvider{}

func (roProvider) Kind() provider.OrchestratorKind { return provider.KindSwarm }
func (roProvider) ID() string                      { return "local-swarm" }
func (roProvider) Capabilities() provider.Capability {
	return provider.CapList | provider.CapInspect | provider.CapLogs | provider.CapStats | provider.CapReadOnly
}
func (roProvider) Ping(context.Context) error { return nil }
func (roProvider) Close() error               { return nil }
func (roProvider) ListWorkloads(context.Context, provider.ListOptions) ([]provider.Workload, error) {
	return nil, nil
}
func (roProvider) InspectWorkload(context.Context, string) (*provider.WorkloadDetail, error) {
	return nil, provider.ErrNotFound
}
func (roProvider) Logs(context.Context, string, provider.LogOptions) (io.ReadCloser, error) {
	return nil, provider.ErrUnsupported
}
func (roProvider) Stats(context.Context, string) (<-chan provider.StatSample, error) {
	return nil, provider.ErrUnsupported
}
