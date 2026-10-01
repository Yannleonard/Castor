// Castor by IT Leonard
package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/compose"
	"github.com/gtek-it/castor/server/internal/provider/docker"
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

			spec, err := e.srv.buildDeploySpec(r, cache.HostID, req)
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

// deploySnapshot is the host snapshot the deploy-network tests resolve
// against: the default bridge, two plain user networks, a macvlan network and
// a bridge adopting a host interface by name.
func deploySnapshot() cache.Snapshot {
	return cache.Snapshot{
		HostID: cache.HostID,
		Networks: []docker.NetworkInfo{
			{ID: "id-bridge", Name: "bridge", Driver: "bridge"},
			{ID: "id-front", Name: "front", Driver: "bridge"},
			{ID: "id-back", Name: "back", Driver: "bridge"},
			{ID: "id-lan", Name: "lan", Driver: "macvlan", Options: map[string]string{"parent": "eth0"}},
			{ID: "id-br0", Name: "br0", Driver: "bridge", Options: map[string]string{"com.docker.network.bridge.name": "br0"}},
		},
	}
}

// TestBuildDeploySpecNetworks proves the deploy request's network attachments
// reach the spec after validation: names and addresses trimmed, aliases with
// empties dropped, order preserved (the first entry is the primary network),
// each network resolved in the snapshot by name or id. A request without
// networks leaves spec.Networks nil (default bridge) and never touches the
// snapshot.
func TestBuildDeploySpecNetworks(t *testing.T) {
	e := newTestEnv(t)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/templates/deploy", nil)

	spec, err := e.srv.buildDeploySpec(r, cache.HostID, &deployRequest{Image: "nginx:latest", Name: "web"})
	if err != nil {
		t.Fatalf("buildDeploySpec: %v", err)
	}
	if spec.Networks != nil {
		t.Errorf("no networks requested: spec.Networks = %+v want nil", spec.Networks)
	}

	nets, err := e.srv.deployNetworks(r, deploySnapshot(), []docker.NetworkAttach{
		{Name: " front ", IPv4: " 10.10.0.5 ", Aliases: []string{" www ", ""}},
		{Name: "id-back"},
	})
	if err != nil {
		t.Fatalf("deployNetworks: %v", err)
	}
	if len(nets) != 2 {
		t.Fatalf("networks = %+v want 2 entries", nets)
	}
	if nets[0].Name != "front" || nets[0].IPv4 != "10.10.0.5" ||
		len(nets[0].Aliases) != 1 || nets[0].Aliases[0] != "www" {
		t.Errorf("primary attachment = %+v", nets[0])
	}
	if nets[1].Name != "id-back" || nets[1].IPv4 != "" || nets[1].Aliases != nil {
		t.Errorf("secondary attachment = %+v", nets[1])
	}
}

// TestBuildDeploySpecNetworksRejectsInvalid: an unnamed attachment or a
// malformed IPv4 is a 422 naming the offending entry, before any daemon call.
func TestBuildDeploySpecNetworksRejectsInvalid(t *testing.T) {
	e := newTestEnv(t)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/templates/deploy", nil)

	cases := []struct {
		name string
		nets []docker.NetworkAttach
		want string
	}{
		{"empty name", []docker.NetworkAttach{{Name: "front"}, {Name: "  "}}, "Network #2 needs a name."},
		{"bad ipv4", []docker.NetworkAttach{{Name: "front", IPv4: "10.10.0"}}, `Invalid IPv4 address "10.10.0" for network "front".`},
		{"v6 as ipv4", []docker.NetworkAttach{{Name: "front", IPv4: "fd00::5"}}, `Invalid IPv4 address "fd00::5"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := e.srv.deployNetworks(r, deploySnapshot(), tc.nets)
			var ae *authz.APIError
			if !errors.As(err, &ae) || ae.Status != http.StatusUnprocessableEntity {
				t.Fatalf("want 422 APIError, got %v", err)
			}
			if !strings.Contains(ae.Message, tc.want) {
				t.Errorf("message = %q want it to contain %q", ae.Message, tc.want)
			}
		})
	}
}

// TestDeployNetworksPolicy covers the snapshot-side rules of deployNetworks:
// an unknown network is a 422 (not a 404 after the pull), the same network
// listed twice (by name and by id) is a 422, aliases on the default bridge
// are a 422 and a static address on it a 409, and a network bound to a host
// interface (macvlan driver, or a bridge adopting a host bridge by name) is a
// 403 for anyone but a superuser.
func TestDeployNetworksPolicy(t *testing.T) {
	e := newTestEnv(t)
	anon := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/templates/deploy", nil)
	snap := deploySnapshot()

	cases := []struct {
		name   string
		nets   []docker.NetworkAttach
		status int
		code   string
		want   string
	}{
		{"unknown", []docker.NetworkAttach{{Name: "front"}, {Name: "ghost"}}, 422, "validation_failed", "Unknown network ghost on this host."},
		{"duplicate by name", []docker.NetworkAttach{{Name: "front"}, {Name: "back"}, {Name: "front", IPv4: "10.10.0.9"}}, 422, "validation_failed", "Network front is listed twice (#1 and #3)"},
		{"duplicate by id", []docker.NetworkAttach{{Name: "front"}, {Name: "id-front"}}, 422, "validation_failed", "Network front is listed twice (#1 and #2)"},
		{"alias on default bridge", []docker.NetworkAttach{{Name: "bridge", Aliases: []string{"www"}}}, 422, "validation_failed", "default bridge"},
		{"static ip on default bridge", []docker.NetworkAttach{{Name: "id-bridge", IPv4: "172.17.0.9"}}, 409, "static_ip_unsupported", ""},
		{"macvlan without principal", []docker.NetworkAttach{{Name: "lan"}}, 403, "forbidden", "administrator"},
		{"host bridge without principal", []docker.NetworkAttach{{Name: "br0"}}, 403, "forbidden", "com.docker.network.bridge.name"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := e.srv.deployNetworks(anon, snap, tc.nets)
			var ae *authz.APIError
			if !errors.As(err, &ae) {
				t.Fatalf("want APIError, got %v", err)
			}
			if ae.Status != tc.status || ae.Code != tc.code {
				t.Errorf("status/code = %d/%s want %d/%s (%s)", ae.Status, ae.Code, tc.status, tc.code, ae.Message)
			}
			if tc.want != "" && !strings.Contains(ae.Message, tc.want) {
				t.Errorf("message = %q want it to contain %q", ae.Message, tc.want)
			}
		})
	}

	// A non-admin holding docker.container.create is refused the same way; a
	// superuser is allowed both host-interface networks.
	opCookies, _, _ := loginLimited(t, e, []string{"docker.container.create"})
	op := anon.WithContext(authz.WithUser(anon.Context(), sessionUser(t, e, opCookies)))
	if _, err := e.srv.deployNetworks(op, snap, []docker.NetworkAttach{{Name: "lan"}}); err == nil {
		t.Error("operator must be refused a macvlan network")
	}
	adminCookies, _ := adminSession(t, e)
	admin := anon.WithContext(authz.WithUser(anon.Context(), sessionUser(t, e, adminCookies)))
	nets, err := e.srv.deployNetworks(admin, snap, []docker.NetworkAttach{{Name: "lan", IPv4: "192.168.1.50"}, {Name: "br0"}})
	if err != nil {
		t.Fatalf("superuser must be allowed host-interface networks: %v", err)
	}
	if len(nets) != 2 || nets[0].Name != "lan" || nets[0].IPv4 != "192.168.1.50" || nets[1].Name != "br0" {
		t.Errorf("superuser attachments = %+v", nets)
	}
}

// TestDeployTemplateUnknownNetworkRejectedBeforePull: through the real route,
// a deploy naming a network the host does not have is a 422 naming it. The
// test env has no daemon, so reaching the pull would not produce a 422.
func TestDeployTemplateUnknownNetworkRejectedBeforePull(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/templates/deploy", map[string]any{
		"image":    "nginx:latest",
		"name":     "web",
		"networks": []map[string]any{{"name": "ghost"}},
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("deploy on unknown network = %d want 422 (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if errCode(t, body) != "validation_failed" || !strings.Contains(errMessage(t, body), "Unknown network ghost on this host") {
		t.Errorf("envelope = %v", body["error"])
	}
}
