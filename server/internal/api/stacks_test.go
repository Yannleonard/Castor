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
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/store"
)

// TestBuilderGenerateRoundTrips verifies the builder's generated YAML re-parses
// through the compose parser and yields the same services. This protects the
// generate -> validate -> deploy contract end to end.
func TestBuilderGenerateRoundTrips(t *testing.T) {
	req := builderRequest{
		ProjectName: "demo",
		Services: []builderService{
			{
				Name:  "web",
				Image: "nginx:1.27",
				Ports: []builderPort{
					{Host: 8080, Container: 80, Proto: "tcp"},
					{Host: 0, Container: 443, Proto: "tcp"},
					{Host: 5353, Container: 53, Proto: "udp"},
				},
				Env:       []builderEnv{{Key: "FOO", Value: "bar"}},
				Volumes:   []builderVolume{{Source: "data", Target: "/data"}, {Source: "", Target: "/anon"}},
				Restart:   "always",
				DependsOn: []string{"db"},
			},
			{
				Name:  "db",
				Image: "postgres:16",
				Env:   []builderEnv{{Key: "POSTGRES_PASSWORD", Value: "secret"}},
			},
		},
	}

	// Re-build the model exactly as BuilderGenerate does, then marshal.
	model := compose.Model{Services: map[string]compose.Service{}}
	for _, svc := range req.Services {
		model.Services[svc.Name] = compose.Service{
			Image:         svc.Image,
			ContainerName: svc.ContainerName,
			Ports:         builderPortStrings(svc.Ports),
			Environment:   builderEnvStrings(svc.Env),
			Volumes:       builderVolumeStrings(svc.Volumes),
			Networks:      trimAll(svc.Networks),
			Restart:       svc.Restart,
			Command:       svc.Command,
			DependsOn:     trimAll(svc.DependsOn),
		}
	}
	yamlDoc, err := marshalCompose(&model)
	if err != nil {
		t.Fatalf("marshalCompose: %v", err)
	}
	if !strings.Contains(yamlDoc, "services:") {
		t.Fatalf("generated yaml missing services header:\n%s", yamlDoc)
	}

	// Round-trip: parse the generated document back.
	parsed, err := compose.Parse([]byte(yamlDoc))
	if err != nil {
		t.Fatalf("re-parse generated yaml failed: %v\n---\n%s", err, yamlDoc)
	}
	if len(parsed.Services) != 2 {
		t.Fatalf("want 2 services after round-trip, got %d", len(parsed.Services))
	}
	web := parsed.Services["web"]
	if web.Image != "nginx:1.27" {
		t.Errorf("web.Image = %q", web.Image)
	}
	// Build a plan to confirm ports survived the round-trip with correct protos.
	plan, err := compose.BuildPlan("demo", parsed)
	if err != nil {
		t.Fatalf("BuildPlan after round-trip: %v", err)
	}
	var udp, tcp443, tcp8080 bool
	for _, sp := range plan.Specs {
		if sp.Labels[compose.LabelService] != "web" {
			continue
		}
		for _, p := range sp.Ports {
			switch {
			case p.Container == 53 && p.Proto == "udp":
				udp = true
			case p.Container == 443 && p.Host == 0:
				tcp443 = true
			case p.Container == 80 && p.Host == 8080:
				tcp8080 = true
			}
		}
	}
	if !udp || !tcp443 || !tcp8080 {
		t.Errorf("ports did not survive round-trip: udp=%v tcp443=%v tcp8080=%v", udp, tcp443, tcp8080)
	}
}

// mustPlan parses and plans a compose document for the stack network tests.
func mustPlan(t *testing.T, project, yamlDoc string) (*compose.Model, *compose.Plan) {
	t.Helper()
	model, err := compose.Parse([]byte(yamlDoc))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	plan, err := compose.BuildPlan(project, model)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	return model, plan
}

// principalRequest returns a request carrying the principal behind cookies,
// the way the protected routes see it, for tests that call a policy helper
// directly.
func principalRequest(t *testing.T, e *testEnv, cookies []*http.Cookie) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/stacks", nil)
	return r.WithContext(authz.WithUser(r.Context(), sessionUser(t, e, cookies)))
}

// apiStatus returns the HTTP status of an *authz.APIError, or 0 for any other
// error (nil included).
func apiStatus(err error) int {
	var ae *authz.APIError
	if errors.As(err, &ae) {
		return ae.Status
	}
	return 0
}

// TestStackNetworksPlainComposeUnchanged is the non-regression check for a
// compose without a networks section: every service joins the project default
// only, that default is the primary each container is created on (with the
// service aliases), nothing is external, and the policy lets any caller
// through, principal or not.
func TestStackNetworksPlainComposeUnchanged(t *testing.T) {
	_, plan := mustPlan(t, "demo", `
services:
  web:
    image: nginx:1.27
  db:
    image: postgres:16
`)
	if len(plan.Networks) != 1 || plan.Networks[0] != "demo_default" {
		t.Fatalf("plan.Networks = %v want [demo_default]", plan.Networks)
	}
	if len(plan.NetworkDefs) != 0 || len(plan.StaticIPs) != 0 || len(plan.Warnings) != 0 {
		t.Fatalf("plain compose produced declarations: %+v / %+v / %v", plan.NetworkDefs, plan.StaticIPs, plan.Warnings)
	}
	for _, sp := range plan.Specs {
		if len(sp.Networks) != 1 || sp.Networks[0].Name != "demo_default" || sp.Networks[0].IPv4 != "" {
			t.Errorf("%s: spec.Networks = %+v want the default network as primary", sp.Name, sp.Networks)
		}
		if secondary := secondaryNetworks(plan, sp.Name); len(secondary) != 0 {
			t.Errorf("%s: secondary networks = %v want none", sp.Name, secondary)
		}
	}

	e := newTestEnv(t)
	nets, err := e.srv.authorizeStackNetworks(nil, cache.Snapshot{}, plan)
	if err != nil {
		t.Fatalf("policy must pass a plain compose even without a principal: %v", err)
	}
	if len(nets) != 1 || nets[0].Key != "demo_default" || nets[0].Name != "demo_default" || nets[0].External {
		t.Fatalf("nets = %+v want one owned demo_default", nets)
	}
	if nets[0].Spec == nil || nets[0].Spec.Name != "demo_default" || nets[0].Spec.Driver != "bridge" || nets[0].Spec.IPAM != nil {
		t.Errorf("default network spec = %+v want a plain bridge", nets[0].Spec)
	}
	// The attach options on the default network carry just the service
	// aliases, as before.
	opts := stackAttachOptions(plan, "demo-web", "demo_default")
	if opts.IPv4 != "" || opts.IPv6 != "" || len(opts.Aliases) != 2 || opts.Aliases[0] != "web" {
		t.Errorf("default attach options = %+v", opts)
	}
}

// TestStackNetworksDeclaredAndExternal covers the resolution of a compose
// networks section against a host: a declared network maps to a create spec
// with its driver/IPAM (here bound to a host bridge, so superuser-only), an
// external network (with and without a name override) resolves in the
// snapshot to the network to join (its id, never created), an unknown
// external network is a 422 naming it, and a service's static address lands
// on its primary and in the attach options of that network.
func TestStackNetworksDeclaredAndExternal(t *testing.T) {
	_, plan := mustPlan(t, "shop", `
services:
  web:
    image: nginx:1.27
    networks:
      backend:
        ipv4_address: 10.20.0.10
        aliases: [api]
      proxy:
      shared:
networks:
  backend:
    driver: bridge
    internal: true
    enable_ipv6: false
    driver_opts:
      com.docker.network.bridge.name: br-shop
    ipam:
      driver: default
      config:
        - subnet: 10.20.0.0/24
          gateway: 10.20.0.1
          ip_range: 10.20.0.0/25
          aux_addresses:
            router: 10.20.0.2
  proxy:
    external: true
  shared:
    external: true
    name: infra_shared
`)
	if got := plan.Networks; len(got) != 3 || got[0] != "shop_backend" || got[1] != "shop_proxy" || got[2] != "shop_shared" {
		t.Fatalf("plan.Networks = %v", got)
	}
	if plan.NetworkNames["shop_proxy"] != "proxy" || plan.NetworkNames["shop_shared"] != "infra_shared" {
		t.Errorf("NetworkNames = %v", plan.NetworkNames)
	}

	def, ok := plan.NetworkDefs["shop_backend"]
	if !ok {
		t.Fatalf("plan.NetworkDefs lacks shop_backend: %v", plan.NetworkDefs)
	}
	spec := networkSpecFromDef(def)
	if spec.Driver != "bridge" || !spec.Internal || spec.EnableIPv6 || spec.Options["com.docker.network.bridge.name"] != "br-shop" {
		t.Errorf("spec = %+v", spec)
	}
	if spec.IPAM == nil || spec.IPAM.Driver != "default" || len(spec.IPAM.Config) != 1 {
		t.Fatalf("spec.IPAM = %+v", spec.IPAM)
	}
	pool := spec.IPAM.Config[0]
	if pool.Subnet != "10.20.0.0/24" || pool.Gateway != "10.20.0.1" || pool.IPRange != "10.20.0.0/25" || pool.AuxAddresses["router"] != "10.20.0.2" {
		t.Errorf("pool = %+v", pool)
	}
	if plain := networkSpecFromDef(compose.NetworkDef{Name: "x"}); plain.IPAM != nil || plain.Driver != "" {
		t.Errorf("bare declaration must map to a plain spec, got %+v", plain)
	}

	// The primary carries the static address and merges the aliases; the two
	// external networks are connected after create.
	web := plan.Specs[0]
	if len(web.Networks) != 1 || web.Networks[0].Name != "shop_backend" || web.Networks[0].IPv4 != "10.20.0.10" ||
		!contains(web.Networks[0].Aliases, "web") || !contains(web.Networks[0].Aliases, "api") {
		t.Errorf("primary = %+v", web.Networks)
	}
	if got := secondaryNetworks(plan, "shop-web"); len(got) != 2 || got[0] != "shop_proxy" || got[1] != "shop_shared" {
		t.Errorf("secondary networks = %v", got)
	}
	opts := stackAttachOptions(plan, "shop-web", "shop_backend")
	if opts.IPv4 != "10.20.0.10" || opts.IPv6 != "" {
		t.Errorf("static address not applied: %+v", opts)
	}
	if !contains(opts.Aliases, "web") || !contains(opts.Aliases, "api") {
		t.Errorf("aliases must merge service name + compose aliases: %v", opts.Aliases)
	}
	if plainOpts := stackAttachOptions(plan, "shop-web", "shop_proxy"); plainOpts.IPv4 != "" || len(plainOpts.Aliases) != 2 {
		t.Errorf("attachment without options = %+v", plainOpts)
	}

	e := newTestEnv(t)
	adminCookies, _ := adminSession(t, e)
	admin := principalRequest(t, e, adminCookies)
	snap := cache.Snapshot{HostID: cache.HostID, Networks: []docker.NetworkInfo{
		{ID: "id-proxy", Name: "proxy", Driver: "bridge"},
		{ID: "id-shared", Name: "infra_shared", Driver: "bridge"},
	}}
	nets, err := e.srv.authorizeStackNetworks(admin, snap, plan)
	if err != nil {
		t.Fatalf("superuser: %v", err)
	}
	if len(nets) != 3 {
		t.Fatalf("nets = %+v want 3", nets)
	}
	if nets[0].External || nets[0].Name != "shop_backend" || nets[0].Spec == nil || nets[0].Spec.Name != "shop_backend" || !nets[0].Spec.Internal {
		t.Errorf("backend = %+v", nets[0])
	}
	if !nets[1].External || nets[1].Name != "proxy" || nets[1].Info == nil || nets[1].Info.ID != "id-proxy" || nets[1].Spec != nil {
		t.Errorf("proxy = %+v", nets[1])
	}
	if !nets[2].External || nets[2].Name != "infra_shared" || nets[2].Info == nil || nets[2].Info.ID != "id-shared" {
		t.Errorf("shared = %+v", nets[2])
	}

	// com.docker.network.bridge.name adopts a host bridge: no principal, 403.
	if _, err := e.srv.authorizeStackNetworks(nil, snap, plan); apiStatus(err) != http.StatusForbidden {
		t.Errorf("host-interface option without superuser: got %v want 403", err)
	}
	// An external network absent from the host is a 422 naming it, before any
	// daemon call.
	_, err = e.srv.authorizeStackNetworks(admin, cache.Snapshot{Networks: snap.Networks[:1]}, plan)
	if apiStatus(err) != http.StatusUnprocessableEntity || !strings.Contains(err.Error(), "Unknown network infra_shared") {
		t.Errorf("missing external network: got %v want 422 naming infra_shared", err)
	}
}

// TestStackNetworksL2Guard proves a compose declaring a macvlan/ipvlan network
// or a "parent" driver option is admin-only: denied 403 for the public
// webhook (no principal) and for a non-admin holding docker.container.create
// (audited on the create route), allowed for a global superuser. Joining an
// existing L2 network declared external is gated the same way.
func TestStackNetworksL2Guard(t *testing.T) {
	e := newTestEnv(t)
	const l2Compose = `
services:
  web:
    image: nginx:1.27
    networks: [lan]
networks:
  lan:
    driver: macvlan
    driver_opts:
      parent: eth0
`
	_, plan := mustPlan(t, "edge", l2Compose)

	// Public webhook: no principal, always denied.
	if _, err := e.srv.authorizeStackNetworks(nil, cache.Snapshot{}, plan); apiStatus(err) != http.StatusForbidden {
		t.Fatalf("public webhook must be denied an L2 network, got %v", err)
	}

	// Non-admin deployer through the real route: 403, audited as denied, and no
	// stack row is persisted (the policy runs before the insert).
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.create"})
	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/stacks", map[string]any{
		"name": "edge", "composeYaml": l2Compose,
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin L2 stack = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeBody(t, rec)["error"].(map[string]any)["code"]; code != "forbidden" {
		t.Errorf("code = %v want forbidden", code)
	}
	entries, _, err := e.st.ListAudit(context.Background(), store.AuditFilter{Action: "docker.container.create"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != 1 || entries[0].Result != "denied" {
		t.Errorf("expected one audited denial, got %+v", entries)
	}
	if _, gerr := e.st.GetStackByProject(context.Background(), "edge"); gerr == nil {
		t.Error("a denied stack must not be persisted")
	}

	// Superuser: allowed (checked on the policy directly with the real session
	// principal; the deploy itself needs a daemon).
	adminCookies, _ := adminSession(t, e)
	admin := principalRequest(t, e, adminCookies)
	nets, err := e.srv.authorizeStackNetworks(admin, cache.Snapshot{}, plan)
	if err != nil {
		t.Errorf("superuser must be allowed an L2 network: %v", err)
	}
	if len(nets) != 1 || nets[0].Spec == nil || nets[0].Spec.Driver != "macvlan" || nets[0].Spec.Options["parent"] != "eth0" {
		t.Errorf("nets = %+v want the macvlan spec", nets)
	}

	// An existing macvlan network joined as external: the attach policy applies
	// (superuser only), resolved to the snapshot network's id.
	_, extPlan := mustPlan(t, "edge", `
services:
  web:
    image: nginx:1.27
    networks: [lan]
networks:
  lan:
    external: true
`)
	snap := cache.Snapshot{HostID: cache.HostID, Networks: []docker.NetworkInfo{
		{ID: "id-lan", Name: "lan", Driver: "macvlan", Options: map[string]string{"parent": "eth0"}},
	}}
	if _, err := e.srv.authorizeStackNetworks(nil, snap, extPlan); apiStatus(err) != http.StatusForbidden {
		t.Errorf("joining an external L2 network without superuser: got %v want 403", err)
	}
	nets, err = e.srv.authorizeStackNetworks(admin, snap, extPlan)
	if err != nil || len(nets) != 1 || !nets[0].External || nets[0].Info == nil || nets[0].Info.ID != "id-lan" {
		t.Errorf("superuser joining an external L2 network: nets=%+v err=%v", nets, err)
	}
}

// TestStackNetworksPolicy422 covers the up-front validation of the network
// declarations: a mistyped driver, an option outside the allowlist and an
// external network that resolves to the daemon's default bridge are each a
// 422 with a message naming the problem, before any daemon call and (on the
// create route) before any stack row is persisted.
func TestStackNetworksPolicy422(t *testing.T) {
	e := newTestEnv(t)
	const badDriver = `
services:
  web:
    image: nginx:1.27
    networks: [lan]
networks:
  lan:
    driver: brdige
`
	_, plan := mustPlan(t, "typo", badDriver)
	_, err := e.srv.authorizeStackNetworks(nil, cache.Snapshot{}, plan)
	if apiStatus(err) != http.StatusUnprocessableEntity || !strings.Contains(err.Error(), `Unsupported network driver "brdige"`) {
		t.Errorf("bad driver: got %v want 422 naming it", err)
	}

	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.create"})
	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/stacks", map[string]any{
		"name": "typo", "composeYaml": badDriver,
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad driver through the route = %d want 422 (%s)", rec.Code, rec.Body.String())
	}
	if body := decodeBody(t, rec); errCode(t, body) != "validation_error" && !strings.Contains(errMessage(t, body), "brdige") {
		t.Errorf("envelope = %v", body["error"])
	}
	if _, gerr := e.st.GetStackByProject(context.Background(), "typo"); gerr == nil {
		t.Error("a refused stack must not be persisted")
	}

	_, plan = mustPlan(t, "opts", `
services:
  web:
    image: nginx:1.27
    networks: [front]
networks:
  front:
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"
      foo: bar
`)
	_, err = e.srv.authorizeStackNetworks(nil, cache.Snapshot{}, plan)
	if apiStatus(err) != http.StatusUnprocessableEntity || !strings.Contains(err.Error(), `Unsupported network option "foo"`) {
		t.Errorf("unknown option: got %v want 422 naming it", err)
	}

	_, plan = mustPlan(t, "br", `
services:
  web:
    image: nginx:1.27
networks:
  default:
    external: true
    name: bridge
`)
	snap := cache.Snapshot{Networks: []docker.NetworkInfo{{ID: "id-bridge", Name: "bridge", Driver: "bridge"}}}
	_, err = e.srv.authorizeStackNetworks(nil, snap, plan)
	if apiStatus(err) != http.StatusUnprocessableEntity || !strings.Contains(err.Error(), "default bridge") {
		t.Errorf("default bridge as external: got %v want 422", err)
	}
}

// TestAdoptStackNetwork locks the adoption rule an existing network must pass
// to stand in for a stack's: it belongs to the project by label (io.castor.stack
// or com.docker.compose.project), else a 409 saying the name is taken by a
// network the stack does not manage; and it holds every subnet the compose
// declares, else a 422 naming both sides.
func TestAdoptStackNetwork(t *testing.T) {
	owned := docker.NetworkInfo{ID: "n1", Name: "proj_back", Driver: "bridge",
		Labels:  map[string]string{compose.LabelCastorStack: "proj", compose.LabelCastorManaged: "true"},
		Subnets: []string{"10.20.0.0/24", "fd00:20::/64"}}
	if err := docker.AdoptStackNetwork(owned, "proj", nil); err != nil {
		t.Errorf("owned network, plain spec: %v", err)
	}
	byCompose := owned
	byCompose.Labels = map[string]string{compose.LabelProject: "proj"}
	if err := docker.AdoptStackNetwork(byCompose, "proj", &docker.NetworkSpec{Driver: "bridge"}); err != nil {
		t.Errorf("network created by the compose CLI for the project: %v", err)
	}

	// Foreign: no label at all, or another project's.
	for _, labels := range []map[string]string{nil, {compose.LabelCastorStack: "other", compose.LabelProject: "other"}} {
		foreign := owned
		foreign.Labels = labels
		err := docker.AdoptStackNetwork(foreign, "proj", nil)
		var notOwned *docker.NetworkNotOwnedError
		if !errors.As(err, &notOwned) || notOwned.Name != "proj_back" || notOwned.Project != "proj" {
			t.Fatalf("labels %v: got %v want *NetworkNotOwnedError", labels, err)
		}
		if !errors.Is(err, provider.ErrNetworkExists) || !strings.Contains(err.Error(), "not managed by this stack") {
			t.Errorf("labels %v: err = %v want ErrNetworkExists with the taken-name message", labels, err)
		}
		mapped := mapStackNetworkErr(err)
		var ae *authz.APIError
		if !errors.As(mapped, &ae) || ae.Status != http.StatusConflict || ae.Code != authz.ErrNetworkExists.Code ||
			!strings.Contains(ae.Message, `"proj_back"`) || !strings.Contains(ae.Message, "not managed by this stack") {
			t.Errorf("mapped = %v want 409 network_exists naming the network", mapped)
		}
	}

	// Declared subnets must be pools of the existing network (spelling aside).
	match := &docker.NetworkSpec{IPAM: &docker.IPAMSpec{Config: []docker.IPAMConfig{{Subnet: "10.20.0.5/24"}, {Subnet: "fd00:20::/64"}}}}
	if err := docker.AdoptStackNetwork(owned, "proj", match); err != nil {
		t.Errorf("matching subnets: %v", err)
	}
	noSubnet := &docker.NetworkSpec{IPAM: &docker.IPAMSpec{Driver: "default"}}
	if err := docker.AdoptStackNetwork(owned, "proj", noSubnet); err != nil {
		t.Errorf("ipam without subnet: %v", err)
	}
	mismatch := &docker.NetworkSpec{IPAM: &docker.IPAMSpec{Config: []docker.IPAMConfig{{Subnet: "10.30.0.0/24"}}}}
	err := docker.AdoptStackNetwork(owned, "proj", mismatch)
	if !errors.Is(err, provider.ErrInvalidNetworkConfig) {
		t.Fatalf("subnet mismatch: got %v want ErrInvalidNetworkConfig", err)
	}
	var ae *authz.APIError
	if mapped := mapStackNetworkErr(err); !errors.As(mapped, &ae) || ae.Status != http.StatusUnprocessableEntity ||
		!strings.Contains(ae.Message, "10.30.0.0/24") || !strings.Contains(ae.Message, "10.20.0.0/24") {
		t.Errorf("mapped = %v want 422 naming both subnets", mapped)
	}
	// A network without any pool cannot serve a declared subnet either.
	bare := owned
	bare.Subnets = nil
	if err := docker.AdoptStackNetwork(bare, "proj", mismatch); !errors.Is(err, provider.ErrInvalidNetworkConfig) || !strings.Contains(err.Error(), "no subnet") {
		t.Errorf("no pool: got %v", err)
	}
}

// TestValidateStackReportsWarnings checks the validate route surfaces what the
// plan left out: an ipv4_address on a network without a declared subnet used
// to be ignored silently and now comes back as a warning, the document still
// being valid. A plain document reports an empty array, never null.
func TestValidateStackReportsWarnings(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.create"})
	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/stacks/validate", map[string]any{
		"composeYaml": `
services:
  app:
    image: app
    networks:
      backend:
        ipv4_address: 10.20.0.10
networks:
  backend:
    driver: bridge
`,
	}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("validate = %d want 200 (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	warnings, _ := body["warnings"].([]any)
	if len(warnings) != 1 || !strings.Contains(warnings[0].(string), `ipv4_address "10.20.0.10" ignored`) {
		t.Errorf("warnings = %v", body["warnings"])
	}
	if body["valid"] != true {
		t.Errorf("valid = %v", body["valid"])
	}

	rec = e.do(t, http.MethodPost, "/api/v1/hosts/local/stacks/validate", map[string]any{
		"composeYaml": "services:\n  app:\n    image: app\n",
	}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("validate plain = %d (%s)", rec.Code, rec.Body.String())
	}
	if w, ok := decodeBody(t, rec)["warnings"].([]any); !ok || len(w) != 0 {
		t.Errorf("plain document warnings = %v want []", decodeBody(t, rec)["warnings"])
	}
}

// sessionUser resolves the principal behind a session cookie exactly as the
// protected routes do (through SessionAuth), for tests that call a guard
// directly with a real *authz.User.
func sessionUser(t *testing.T, e *testEnv, cookies []*http.Cookie) *authz.User {
	t.Helper()
	var seen *authz.User
	h := e.srv.authz.SessionAuth(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = authz.UserFrom(r)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	h.ServeHTTP(httptest.NewRecorder(), req)
	if seen == nil {
		t.Fatal("SessionAuth did not resolve a user from the session cookie")
	}
	return seen
}

// TestBuilderPortStrings checks the host:container[/proto] rendering rules.
func TestBuilderPortStrings(t *testing.T) {
	got := builderPortStrings([]builderPort{
		{Host: 8080, Container: 80, Proto: "tcp"},
		{Host: 0, Container: 9000, Proto: "udp"},
		{Host: 0, Container: 443, Proto: ""},
		{Host: 0, Container: 0, Proto: "tcp"}, // dropped (no container port)
	})
	want := []string{"8080:80", "9000/udp", "443"}
	if len(got) != len(want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("port[%d] = %q want %q", i, got[i], want[i])
		}
	}
}
