package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/gtek-it/castor/server/internal/store"
)

// TestDeployTemplateRejectsHostMountForNonAdmin proves the host-mount escalation
// guard at the API layer: a non-admin who holds docker.container.create still
// cannot deploy a container with a host bind mount (here the docker socket). The
// denial is 403 and audited, and it short-circuits in buildDeploySpec BEFORE any
// Docker call (so it runs without a live daemon). Admin-bypass for ordinary host
// paths and the hard-reject of always-blocked paths are covered by the docker
// provider's mounts_test.go (ValidateMounts) + the defense-in-depth
// TestContainerCreateAndStartRejectsHostMount.
func TestDeployTemplateRejectsHostMountForNonAdmin(t *testing.T) {
	e := newTestEnv(t)
	// limited user holds docker.container.create (NOT '*').
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.create"})

	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/templates/deploy", map[string]any{
		"image":   "nginx:latest",
		"name":    "escape",
		"volumes": []map[string]any{{"source": "/var/run/docker.sock", "target": "/var/run/docker.sock"}},
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin host bind deploy = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
	if decodeBody(t, rec)["error"].(map[string]any)["code"] != "forbidden" {
		t.Errorf("expected forbidden code, body=%s", rec.Body.String())
	}

	// Exactly one audited denial for docker.container.create.
	entries, _, err := e.st.ListAudit(context.Background(), store.AuditFilter{Action: "docker.container.create"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 audited deploy attempt, got %d", len(entries))
	}
	if entries[0].Result != "denied" || entries[0].HTTPStatus != http.StatusForbidden {
		t.Errorf("audit row result=%q status=%d want denied/403", entries[0].Result, entries[0].HTTPStatus)
	}
}

// TestDeployTemplateNonAdminFlagRejected: a non-admin cannot escalate by setting
// allowHostMounts=true even with no host paths — requesting the admin-only flag
// is itself denied.
func TestDeployTemplateNonAdminFlagRejected(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.create"})

	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/templates/deploy", map[string]any{
		"image":           "nginx:latest",
		"name":            "flagged",
		"allowHostMounts": true,
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin allowHostMounts=true = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
}
