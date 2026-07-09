package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gtek-it/castor/server/internal/compose"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/templates"
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

// TestBuildDeploySpecStampsTemplateLabels proves that deploying from a
// marketplace template (built-in or custom) stamps the reserved Castor labels so
// the instance is linkable back to its template. Built-in entries have no DB id,
// so the link key is the SLUG (io.castor.template); io.castor.managed marks it as
// Castor-deployed. A caller-supplied label must never override these reserved
// keys. buildDeploySpec runs without a live Docker daemon (no mounts requested).
func TestBuildDeploySpecStampsTemplateLabels(t *testing.T) {
	e := newTestEnv(t)

	// A built-in slug (taken from the embedded catalog) and a seeded custom slug.
	builtins := templates.BuiltinTemplates()
	if len(builtins) == 0 {
		t.Fatal("built-in catalog is empty; cannot exercise the built-in path")
	}
	builtinSlug := builtins[0].Slug

	const customSlug = "my-custom-app"
	if err := e.st.CreateCustomTemplate(context.Background(), &store.CustomTemplate{
		ID:    store.NewUUID(),
		Name:  "My Custom App",
		Slug:  customSlug,
		Image: "example/app:latest",
	}); err != nil {
		t.Fatalf("CreateCustomTemplate: %v", err)
	}

	cases := []struct {
		name string
		slug string
	}{
		{"builtin", builtinSlug},
		{"custom", customSlug},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// A user label that collides with a reserved key must be overridden.
			req := &deployRequest{
				TemplateSlug: tc.slug,
				Name:         "instance-" + tc.name,
				Labels:       map[string]string{compose.LabelCastorManaged: "false"},
			}
			r := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/templates/deploy", nil)

			spec, err := e.srv.buildDeploySpec(r, req)
			if err != nil {
				t.Fatalf("buildDeploySpec(%s): %v", tc.slug, err)
			}
			if got := spec.Labels[compose.LabelCastorTemplate]; got != tc.slug {
				t.Errorf("%s = %q, want template slug %q", compose.LabelCastorTemplate, got, tc.slug)
			}
			if got := spec.Labels[compose.LabelCastorManaged]; got != "true" {
				t.Errorf("%s = %q, want reserved key force-set to %q", compose.LabelCastorManaged, got, "true")
			}
		})
	}
}
