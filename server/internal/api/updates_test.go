// Castor by IT Leonard
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
)

// TestListUpdatesEmptyAndUnknownHost proves GET /updates serves the cached
// statuses (empty JSON array before any check, never null) and 404s unknown
// hosts. Requires docker.container.read like the other container reads.
func TestListUpdatesEmptyAndUnknownHost(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodGet, "/api/v1/hosts/local/updates", nil, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("list updates = %d want 200 (%s)", rec.Code, rec.Body.String())
	}
	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body %q is not a JSON array: %v", rec.Body.String(), err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty status list, got %v", got)
	}

	rec = e.do(t, http.MethodGet, "/api/v1/hosts/nope/updates", nil, cookies, csrf)
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown host = %d want 404", rec.Code)
	}

	// Unauthenticated read is rejected by the session chain.
	rec = e.do(t, http.MethodGet, "/api/v1/hosts/local/updates", nil, nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous list = %d want 401", rec.Code)
	}
}

// TestUpdateWorkloadProtectedRefused proves the recreate route runs the same
// destructive-action guard as stop/remove: a protected container is refused
// with 409 protected_resource BEFORE touching any provider.
func TestUpdateWorkloadProtectedRefused(t *testing.T) {
	e := newTestEnv(t)
	e.srv.manager.Store().SeedSnapshotForTest(cache.HostID, provider.Workload{
		ID:         "c1",
		Name:       "castor",
		Kind:       provider.KindDocker,
		ProviderID: "local-docker",
		State:      provider.StateRunning,
		Protected:  true,
	})
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/workloads/c1/update", nil, cookies, csrf)
	if rec.Code != http.StatusConflict {
		t.Fatalf("update protected = %d want 409 (%s)", rec.Code, rec.Body.String())
	}
	if errObj := decodeBody(t, rec)["error"].(map[string]any); errObj["code"] != "protected_resource" {
		t.Errorf("error code = %v want protected_resource", errObj["code"])
	}
}

// TestUpdateWorkloadConfigurableProtectedLabel proves the update path honors
// the CONFIGURABLE security.protected_labels setting (like stop/remove), not
// only the provider-computed Protected flag.
func TestUpdateWorkloadConfigurableProtectedLabel(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()
	if err := e.st.SetSetting(ctx, store.SettingProtectedLabels, `["com.example.lock"]`); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	e.srv.manager.Store().SeedSnapshotForTest(cache.HostID, provider.Workload{
		ID:         "c2",
		Name:       "db",
		Kind:       provider.KindDocker,
		ProviderID: "local-docker",
		State:      provider.StateRunning,
		Labels:     map[string]string{"com.example.lock": "true"},
	})
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/workloads/c2/update", nil, cookies, csrf)
	if rec.Code != http.StatusConflict {
		t.Fatalf("update with configured protected label = %d want 409 (%s)", rec.Code, rec.Body.String())
	}
	if errObj := decodeBody(t, rec)["error"].(map[string]any); errObj["code"] != "protected_resource" {
		t.Errorf("error code = %v want protected_resource", errObj["code"])
	}
}

// TestUpdateWorkloadUnknownAndAnonymous covers the 404 (unknown workload) and
// 401 (no session) paths of the update mutation.
func TestUpdateWorkloadUnknownAndAnonymous(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/workloads/ghost/update", nil, cookies, csrf)
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown workload = %d want 404 (%s)", rec.Code, rec.Body.String())
	}

	rec = e.do(t, http.MethodPost, "/api/v1/hosts/local/workloads/ghost/update", nil, nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous update = %d want 401", rec.Code)
	}
}
