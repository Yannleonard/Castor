// Castor by IT Leonard
package compose

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/gtek-it/castor/server/internal/provider/docker"
)

func TestParseMappingAndListForms(t *testing.T) {
	src := `
version: "3.8"
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
      - "443"
    environment:
      FOO: bar
      BAZ: "qux"
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=secret
      - POSTGRES_USER=admin
    volumes:
      - pgdata:/var/lib/postgresql/data
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(m.Services) != 2 {
		t.Fatalf("want 2 services, got %d", len(m.Services))
	}
	web := m.Services["web"]
	if web.Image != "nginx:1.27" {
		t.Errorf("web.Image = %q", web.Image)
	}
	// Mapping env is sorted: BAZ before FOO.
	if !reflect.DeepEqual(web.Environment, []string{"BAZ=qux", "FOO=bar"}) {
		t.Errorf("web.Environment = %#v", web.Environment)
	}
	if !reflect.DeepEqual(web.DependsOn, []string{"db"}) {
		t.Errorf("web.DependsOn = %#v", web.DependsOn)
	}
	db := m.Services["db"]
	if !reflect.DeepEqual(db.Environment, []string{"POSTGRES_PASSWORD=secret", "POSTGRES_USER=admin"}) {
		t.Errorf("db.Environment = %#v", db.Environment)
	}
	if !reflect.DeepEqual(db.Volumes, []string{"pgdata:/var/lib/postgresql/data"}) {
		t.Errorf("db.Volumes = %#v", db.Volumes)
	}
}

func TestParseRejectsMissingImage(t *testing.T) {
	src := `
services:
  web:
    ports: ["80"]
`
	_, err := Parse([]byte(src))
	if err == nil || !IsValidation(err) {
		t.Fatalf("want validation error, got %v", err)
	}
	if !strings.Contains(err.Error(), "image") {
		t.Errorf("error should mention image: %v", err)
	}
}

func TestParseRejectsUnknownServiceKey(t *testing.T) {
	src := `
services:
  web:
    image: nginx
    porst: ["80"]
`
	_, err := Parse([]byte(src))
	if err == nil || !IsValidation(err) {
		t.Fatalf("want validation error for unknown key, got %v", err)
	}
	if !strings.Contains(err.Error(), "porst") {
		t.Errorf("error should name the bad key: %v", err)
	}
}

func TestParseRejectsUnknownDependsOn(t *testing.T) {
	src := `
services:
  web:
    image: nginx
    depends_on: [missing]
`
	_, err := Parse([]byte(src))
	if err == nil || !IsValidation(err) {
		t.Fatalf("want validation error, got %v", err)
	}
}

func TestBuildPlanTopologicalOrder(t *testing.T) {
	src := `
services:
  web:
    image: nginx
    depends_on: [api]
  api:
    image: api:latest
    depends_on: [db, cache]
  db:
    image: postgres
  cache:
    image: redis
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	plan, err := BuildPlan("My Stack", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	if plan.Project != "my-stack" {
		t.Errorf("project = %q, want my-stack", plan.Project)
	}
	// Extract the service order from the specs (via the service label).
	order := make([]string, 0, len(plan.Specs))
	pos := map[string]int{}
	for i, sp := range plan.Specs {
		svc := sp.Labels[LabelService]
		order = append(order, svc)
		pos[svc] = i
	}
	// db and cache must come before api; api before web.
	if pos["db"] >= pos["api"] || pos["cache"] >= pos["api"] || pos["api"] >= pos["web"] {
		t.Fatalf("bad topological order: %v", order)
	}
	// Deterministic tie-break: db before cache (alphabetical) is not guaranteed by
	// dependency, but both precede api; just assert determinism by re-running.
	plan2, _ := BuildPlan("My Stack", m)
	order2 := make([]string, 0, len(plan2.Specs))
	for _, sp := range plan2.Specs {
		order2 = append(order2, sp.Labels[LabelService])
	}
	if !reflect.DeepEqual(order, order2) {
		t.Errorf("order not deterministic: %v vs %v", order, order2)
	}
}

func TestBuildPlanCycleRejected(t *testing.T) {
	// a -> b -> a cycle (constructed directly; Parse validates targets exist).
	m := &Model{Services: map[string]Service{
		"a": {Image: "x", DependsOn: []string{"b"}},
		"b": {Image: "y", DependsOn: []string{"a"}},
	}}
	_, err := BuildPlan("p", m)
	if err == nil || !IsValidation(err) {
		t.Fatalf("want cycle validation error, got %v", err)
	}
	if !strings.Contains(err.Error(), "cycle") {
		t.Errorf("error should mention cycle: %v", err)
	}
}

func TestBuildPlanPortsAndVolumes(t *testing.T) {
	src := `
services:
  app:
    image: app:1
    ports:
      - "8080:80"
      - "9000:9000/udp"
      - "127.0.0.1:5000:5000"
      - "3000"
    volumes:
      - data:/var/data
      - /host/path:/in/container
      - /anon
      - cfg:/etc/app:ro
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	sp := plan.Specs[0]

	// Ports.
	if len(sp.Ports) != 4 {
		t.Fatalf("want 4 ports, got %d: %#v", len(sp.Ports), sp.Ports)
	}
	if sp.Ports[0].Host != 8080 || sp.Ports[0].Container != 80 || sp.Ports[0].Proto != "tcp" {
		t.Errorf("port0 = %#v", sp.Ports[0])
	}
	if sp.Ports[1].Container != 9000 || sp.Ports[1].Proto != "udp" {
		t.Errorf("port1 = %#v", sp.Ports[1])
	}
	if sp.Ports[2].Host != 5000 || sp.Ports[2].Container != 5000 {
		t.Errorf("port2 (ip:host:container) = %#v", sp.Ports[2])
	}
	if sp.Ports[3].Host != 0 || sp.Ports[3].Container != 3000 {
		t.Errorf("port3 (container only) = %#v", sp.Ports[3])
	}

	// Volumes.
	if len(sp.Volumes) != 4 {
		t.Fatalf("want 4 volumes, got %d: %#v", len(sp.Volumes), sp.Volumes)
	}
	if sp.Volumes[0].Source != "data" || sp.Volumes[0].Target != "/var/data" {
		t.Errorf("vol0 = %#v", sp.Volumes[0])
	}
	if sp.Volumes[1].Source != "/host/path" || sp.Volumes[1].Target != "/in/container" {
		t.Errorf("vol1 = %#v", sp.Volumes[1])
	}
	if sp.Volumes[2].Source != "" || sp.Volumes[2].Target != "/anon" {
		t.Errorf("vol2 (anon) = %#v", sp.Volumes[2])
	}
	if sp.Volumes[3].Source != "cfg" || sp.Volumes[3].Target != "/etc/app" {
		t.Errorf("vol3 (mode dropped) = %#v", sp.Volumes[3])
	}
}

func TestBuildPlanLabelsAndNetwork(t *testing.T) {
	src := `
services:
  web:
    image: nginx
`
	m, _ := Parse([]byte(src))
	plan, err := BuildPlan("shop", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	if plan.DefaultNetworkName() != "shop_default" {
		t.Errorf("default network = %q", plan.DefaultNetworkName())
	}
	sp := plan.Specs[0]
	if sp.Labels[LabelProject] != "shop" || sp.Labels[LabelService] != "web" {
		t.Errorf("labels = %#v", sp.Labels)
	}
	if sp.Name != "shop-web" {
		t.Errorf("container name = %q, want shop-web", sp.Name)
	}
	// The service must be reachable by its service-name alias.
	aliases := plan.Aliases["shop-web"]
	found := false
	for _, a := range aliases {
		if a == "web" {
			found = true
		}
	}
	if !found {
		t.Errorf("aliases %#v must include service name 'web'", aliases)
	}
	// Without an explicit list the service joins the project default only, and
	// that membership is the primary the spec is created on.
	if !reflect.DeepEqual(plan.Memberships["shop-web"], []string{"shop_default"}) {
		t.Errorf("Memberships = %#v, want [shop_default]", plan.Memberships["shop-web"])
	}
	if !reflect.DeepEqual(plan.Networks, []string{"shop_default"}) {
		t.Errorf("Networks = %#v, want [shop_default]", plan.Networks)
	}
	if plan.NetworkNames["shop_default"] != "shop_default" {
		t.Errorf("NetworkNames[shop_default] = %q", plan.NetworkNames["shop_default"])
	}
	wantPrimary := []docker.NetworkAttach{{Name: "shop_default", Aliases: []string{"web", "shop-web"}}}
	if !reflect.DeepEqual(sp.Networks, wantPrimary) {
		t.Errorf("spec.Networks = %#v, want %#v", sp.Networks, wantPrimary)
	}
	if len(plan.Warnings) != 0 {
		t.Errorf("Warnings = %v, want none", plan.Warnings)
	}
}

func TestSanitizeProjectName(t *testing.T) {
	cases := map[string]string{
		"My Stack":       "my-stack",
		"  Hello!! ":     "hello",
		"a__b--c":        "a_b-c", // consecutive separators collapse to one
		"UPPER":          "upper",
		"with.dots/and":  "with-dots-and",
		"!!!":            "",
		"--lead-trail--": "lead-trail",
	}
	for in, want := range cases {
		if got := SanitizeProjectName(in); got != want {
			t.Errorf("SanitizeProjectName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseRejectsPortRange(t *testing.T) {
	src := `
services:
  app:
    image: app
    ports: ["8000-8005:8000-8005"]
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	_, perr := BuildPlan("p", m)
	if perr == nil || !IsValidation(perr) {
		t.Fatalf("want validation error for port range, got %v", perr)
	}
}

// A document without a top-level networks section must plan as it did before
// addressing support: same specs, aliases, project-scoped memberships and
// network set, nothing in the declaration maps, and each spec created on the
// first network its service lists (no implicit default when networks are
// listed).
func TestBuildPlanUnchangedWithoutTopLevelNetworks(t *testing.T) {
	src := `
services:
  web:
    image: nginx
    networks: [front, back]
    depends_on: [api]
  api:
    image: api:1
    networks:
      back:
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if m.Networks != nil {
		t.Errorf("Model.Networks = %#v, want nil", m.Networks)
	}
	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}

	names := make([]string, 0, len(plan.Specs))
	for _, sp := range plan.Specs {
		names = append(names, sp.Name)
	}
	if !reflect.DeepEqual(names, []string{"proj-api", "proj-web"}) {
		t.Errorf("spec order = %v", names)
	}
	wantAliases := map[string][]string{
		"proj-api": {"api", "proj-api"},
		"proj-web": {"web", "proj-web"},
	}
	if !reflect.DeepEqual(plan.Aliases, wantAliases) {
		t.Errorf("Aliases = %#v", plan.Aliases)
	}
	wantMembers := map[string][]string{
		"proj-api": {"proj_back"},
		"proj-web": {"proj_front", "proj_back"},
	}
	if !reflect.DeepEqual(plan.Memberships, wantMembers) {
		t.Errorf("Memberships = %#v", plan.Memberships)
	}
	gotNets := append([]string(nil), plan.Networks...)
	sort.Strings(gotNets)
	if !reflect.DeepEqual(gotNets, []string{"proj_back", "proj_front"}) {
		t.Errorf("Networks = %v", plan.Networks)
	}
	if len(plan.NetworkDefs) != 0 {
		t.Errorf("NetworkDefs = %#v, want empty", plan.NetworkDefs)
	}
	if len(plan.StaticIPs) != 0 {
		t.Errorf("StaticIPs = %#v, want empty", plan.StaticIPs)
	}
	// Undeclared networks are created under their key.
	if plan.NetworkNames["proj_back"] != "proj_back" || plan.NetworkNames["proj_front"] != "proj_front" {
		t.Errorf("NetworkNames = %#v", plan.NetworkNames)
	}
	// The primary is the first listed network, with the service aliases.
	if got := plan.Specs[0].Networks; !reflect.DeepEqual(got, []docker.NetworkAttach{{Name: "proj_back", Aliases: []string{"api", "proj-api"}}}) {
		t.Errorf("proj-api primary = %#v", got)
	}
	if got := plan.Specs[1].Networks; !reflect.DeepEqual(got, []docker.NetworkAttach{{Name: "proj_front", Aliases: []string{"web", "proj-web"}}}) {
		t.Errorf("proj-web primary = %#v", got)
	}
	if len(plan.Warnings) != 0 {
		t.Errorf("Warnings = %v, want none", plan.Warnings)
	}
	// The list form yields attachments with only Name set, in declaration order.
	wantAttach := []ServiceNetwork{{Name: "front"}, {Name: "back"}}
	if !reflect.DeepEqual(m.Services["web"].NetworkAttach, wantAttach) {
		t.Errorf("web.NetworkAttach = %#v", m.Services["web"].NetworkAttach)
	}
}

func TestParseTopLevelNetworksIPAM(t *testing.T) {
	src := `
services:
  app:
    image: app
networks:
  backend:
    driver: bridge
    internal: true
    attachable: true
    enable_ipv6: true
    driver_opts:
      com.docker.network.bridge.name: br-back
    ipam:
      driver: default
      config:
        - subnet: 10.20.0.0/24
          gateway: 10.20.0.1
          ip_range: 10.20.0.128/25
          aux_addresses: { router: 10.20.0.2 }
        - subnet: "fd00:20::/64"
  plain:
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(m.Networks) != 2 {
		t.Fatalf("want 2 networks, got %d", len(m.Networks))
	}
	want := NetworkDef{
		Name:       "backend",
		Driver:     "bridge",
		Internal:   true,
		Attachable: true,
		EnableIPv6: true,
		Options:    map[string]string{"com.docker.network.bridge.name": "br-back"},
		IPAM: IPAM{
			Driver: "default",
			Config: []IPAMConfig{
				{
					Subnet:       "10.20.0.0/24",
					Gateway:      "10.20.0.1",
					IPRange:      "10.20.0.128/25",
					AuxAddresses: map[string]string{"router": "10.20.0.2"},
				},
				{Subnet: "fd00:20::/64"},
			},
		},
	}
	if got := m.Networks["backend"]; !reflect.DeepEqual(got, want) {
		t.Errorf("backend =\n%#v\nwant\n%#v", got, want)
	}
	if got := m.Networks["plain"]; !reflect.DeepEqual(got, NetworkDef{Name: "plain"}) {
		t.Errorf("plain (null body) = %#v", got)
	}

	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	// Every declaration is keyed by its project-scoped name.
	if got := plan.NetworkDefs["proj_backend"]; !reflect.DeepEqual(got, want) {
		t.Errorf("NetworkDefs[proj_backend] = %#v", got)
	}
	if _, ok := plan.NetworkDefs["proj_plain"]; !ok {
		t.Errorf("NetworkDefs keys = %v, want proj_plain", sortedKeys(plan.NetworkDefs))
	}
	// A declared-but-unreferenced network is not in the must-exist set; the
	// service lists none, so it joins the project default only.
	if !reflect.DeepEqual(plan.Networks, []string{"proj_default"}) {
		t.Errorf("Networks = %v, want [proj_default] (no service references a declared network)", plan.Networks)
	}
	if plan.NetworkNames["proj_backend"] != "proj_backend" || plan.NetworkNames["proj_plain"] != "proj_plain" {
		t.Errorf("NetworkNames = %#v", plan.NetworkNames)
	}
}

func TestBuildPlanStaticIPs(t *testing.T) {
	src := `
services:
  app:
    image: app
    container_name: my-app
    networks:
      backend:
        ipv4_address: 10.20.0.10
        ipv6_address: "fd00:20::10"
        aliases: [app-a, app-b]
      other:
  db:
    image: postgres
    networks: [backend]
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/24
        - subnet: "fd00:20::/64"
  other:
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	wantAttach := []ServiceNetwork{
		{Name: "backend", IPv4: "10.20.0.10", IPv6: "fd00:20::10", Aliases: []string{"app-a", "app-b"}},
		{Name: "other"},
	}
	if got := m.Services["app"].NetworkAttach; !reflect.DeepEqual(got, wantAttach) {
		t.Errorf("app.NetworkAttach = %#v", got)
	}
	// Names are still exposed the old way for compatibility.
	if got := m.Services["app"].Networks; !reflect.DeepEqual(got, []string{"backend", "other"}) {
		t.Errorf("app.Networks = %#v", got)
	}

	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	if got := plan.Memberships["my-app"]; !reflect.DeepEqual(got, []string{"proj_backend", "proj_other"}) {
		t.Errorf("Memberships[my-app] = %#v", got)
	}
	wantStatic := map[string]map[string]ServiceNetwork{
		"my-app": {"proj_backend": wantAttach[0]},
	}
	if !reflect.DeepEqual(plan.StaticIPs, wantStatic) {
		t.Errorf("StaticIPs = %#v\nwant %#v", plan.StaticIPs, wantStatic)
	}
	if _, ok := plan.StaticIPs["proj-db"]; ok {
		t.Errorf("list-form attachment must not appear in StaticIPs: %#v", plan.StaticIPs["proj-db"])
	}
	if def := plan.NetworkDefs["proj_backend"]; len(def.IPAM.Config) != 2 {
		t.Errorf("NetworkDefs[proj_backend].IPAM = %#v", def.IPAM)
	}
	// The primary carries the ipv4_address and merges the service aliases with
	// the declared ones; the ipv6_address cannot travel at create and is
	// reported.
	var app docker.DeploySpec
	for _, sp := range plan.Specs {
		if sp.Name == "my-app" {
			app = sp
		}
	}
	wantPrimary := []docker.NetworkAttach{{Name: "proj_backend", IPv4: "10.20.0.10", Aliases: []string{"app", "my-app", "app-a", "app-b"}}}
	if !reflect.DeepEqual(app.Networks, wantPrimary) {
		t.Errorf("my-app primary = %#v, want %#v", app.Networks, wantPrimary)
	}
	if len(plan.Warnings) != 1 || !strings.Contains(plan.Warnings[0], `ipv6_address "fd00:20::10" on its primary network "backend"`) {
		t.Errorf("Warnings = %v, want one about the primary ipv6_address", plan.Warnings)
	}
}

func TestParseExternalNetworks(t *testing.T) {
	src := `
services:
  app:
    image: app
    networks:
      shared:
        ipv4_address: 172.30.0.10
      legacy:
networks:
  shared:
    external: true
  legacy:
    external:
      name: real_legacy_net
`
	m, err := Parse([]byte(src))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if got := m.Networks["shared"]; !got.External || got.Name != "shared" {
		t.Errorf("shared = %#v", got)
	}
	if got := m.Networks["legacy"]; !got.External || got.Name != "real_legacy_net" {
		t.Errorf("legacy = %#v", got)
	}

	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	// External declarations are keyed like every other network and flagged;
	// NetworkNames resolves each key to the real network to join.
	if def, ok := plan.NetworkDefs["proj_shared"]; !ok || !def.External {
		t.Errorf("NetworkDefs[proj_shared] = %#v, ok=%v", def, ok)
	}
	if def, ok := plan.NetworkDefs["proj_legacy"]; !ok || !def.External {
		t.Errorf("NetworkDefs[proj_legacy] = %#v, ok=%v", def, ok)
	}
	if plan.NetworkNames["proj_shared"] != "shared" || plan.NetworkNames["proj_legacy"] != "real_legacy_net" {
		t.Errorf("NetworkNames = %#v", plan.NetworkNames)
	}
	// Membership and static-IP keys are project-scoped.
	if got := plan.Memberships["proj-app"]; !reflect.DeepEqual(got, []string{"proj_shared", "proj_legacy"}) {
		t.Errorf("Memberships[proj-app] = %#v", got)
	}
	if !reflect.DeepEqual(plan.Networks, []string{"proj_shared", "proj_legacy"}) {
		t.Errorf("Networks = %#v", plan.Networks)
	}
	// An external network's pools live outside the document: the address is
	// kept (the daemon validates it) and the primary is created by real name.
	if got := plan.StaticIPs["proj-app"]["proj_shared"].IPv4; got != "172.30.0.10" {
		t.Errorf("StaticIPs[proj-app][proj_shared].IPv4 = %q", got)
	}
	if got := plan.Specs[0].Networks; !reflect.DeepEqual(got, []docker.NetworkAttach{{Name: "shared", IPv4: "172.30.0.10", Aliases: []string{"app", "proj-app"}}}) {
		t.Errorf("primary = %#v", got)
	}
	if len(plan.Warnings) != 0 {
		t.Errorf("Warnings = %v, want none", plan.Warnings)
	}
}

func TestParseRejectsBadAddressing(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "ipv4 outside subnet",
			src: `
services:
  app:
    image: app
    networks:
      backend:
        ipv4_address: 10.99.0.10
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/24
`,
			want: `ipv4_address "10.99.0.10" is outside the subnet of network "backend"`,
		},
		{
			name: "invalid ipv4 literal",
			src: `
services:
  app:
    image: app
    networks:
      backend:
        ipv4_address: not-an-ip
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/24
`,
			want: `invalid ipv4_address "not-an-ip"`,
		},
		{
			name: "ipv6 outside subnet",
			src: `
services:
  app:
    image: app
    networks:
      backend:
        ipv6_address: "fd00:99::10"
networks:
  backend:
    ipam:
      config:
        - subnet: "fd00:20::/64"
`,
			want: `ipv6_address "fd00:99::10" is outside the subnet of network "backend"`,
		},
		{
			name: "invalid subnet",
			src: `
services:
  app:
    image: app
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/33
`,
			want: `Network "backend": invalid ipam subnet "10.20.0.0/33"`,
		},
		{
			name: "gateway outside subnet",
			src: `
services:
  app:
    image: app
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/24
          gateway: 10.21.0.1
`,
			want: `ipam gateway "10.21.0.1" is not inside subnet "10.20.0.0/24"`,
		},
		{
			name: "ip_range outside subnet",
			src: `
services:
  app:
    image: app
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/24
          ip_range: 10.20.0.0/23
`,
			want: `ipam ip_range "10.20.0.0/23" is not inside subnet "10.20.0.0/24"`,
		},
		{
			name: "aux address outside subnet",
			src: `
services:
  app:
    image: app
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/24
          aux_addresses: { router: 10.20.1.2 }
`,
			want: `ipam aux_address "10.20.1.2" for "router" is not inside subnet`,
		},
		{
			name: "gateway without subnet",
			src: `
services:
  app:
    image: app
networks:
  backend:
    ipam:
      config:
        - gateway: 10.20.0.1
`,
			want: `ipam config #1 needs a subnet`,
		},
		{
			name: "external must be bool or mapping",
			src: `
services:
  app:
    image: app
networks:
  backend:
    external: [yes]
`,
			want: `external must be a boolean or a mapping`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src))
			if err == nil || !IsValidation(err) {
				t.Fatalf("want validation error, got %v", err)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q should contain %q", err.Error(), tc.want)
			}
		})
	}
}

// A Model assembled by hand skips Parse, so BuildPlan must re-run the
// addressing checks itself.
func TestBuildPlanValidatesHandBuiltAddressing(t *testing.T) {
	m := &Model{
		Services: map[string]Service{
			"app": {
				Image:         "app",
				Networks:      []string{"backend"},
				NetworkAttach: []ServiceNetwork{{Name: "backend", IPv4: "10.99.0.10"}},
			},
		},
		Networks: map[string]NetworkDef{
			"backend": {Name: "backend", IPAM: IPAM{Config: []IPAMConfig{{Subnet: "10.20.0.0/24"}}}},
		},
	}
	_, err := BuildPlan("p", m)
	if err == nil || !IsValidation(err) {
		t.Fatalf("want validation error, got %v", err)
	}
	if !strings.Contains(err.Error(), "outside the subnet") {
		t.Errorf("error should mention the subnet: %v", err)
	}
}

// specByName returns the plan spec created for containerName.
func specByName(t *testing.T, plan *Plan, containerName string) docker.DeploySpec {
	t.Helper()
	for _, sp := range plan.Specs {
		if sp.Name == containerName {
			return sp
		}
	}
	t.Fatalf("no spec named %q in %v", containerName, plan.Specs)
	return docker.DeploySpec{}
}

// An ipv4_address (or ipv6_address) on a network that declares no subnet of
// its family used to be ignored by the parser, so a stored document that
// deployed before must still plan: the address is dropped with a warning, the
// membership is kept, and nothing lands in StaticIPs or on the primary.
func TestBuildPlanWarnsStaticIPWithoutSubnet(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "ipv4 on network without subnet",
			src: `
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
			want: `Service "app": ipv4_address "10.20.0.10" ignored: network "backend" declares no ipam subnet`,
		},
		{
			name: "ipv4 on undeclared network",
			src: `
services:
  app:
    image: app
    networks:
      backend:
        ipv4_address: 10.20.0.10
`,
			want: `Service "app": ipv4_address "10.20.0.10" ignored: network "backend" declares no ipam subnet`,
		},
		{
			name: "ipv6 on ipv4-only network",
			src: `
services:
  app:
    image: app
    networks:
      backend:
        ipv6_address: "fd00::10"
networks:
  backend:
    ipam:
      config:
        - subnet: 10.20.0.0/24
`,
			want: `Service "app": ipv6_address "fd00::10" ignored: network "backend" declares no IPv6 ipam subnet`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m, err := Parse([]byte(tc.src))
			if err != nil {
				t.Fatalf("Parse: %v", err)
			}
			plan, err := BuildPlan("proj", m)
			if err != nil {
				t.Fatalf("BuildPlan: %v", err)
			}
			if len(plan.Warnings) != 1 || !strings.Contains(plan.Warnings[0], tc.want) {
				t.Errorf("Warnings = %v, want one containing %q", plan.Warnings, tc.want)
			}
			if len(plan.StaticIPs) != 0 {
				t.Errorf("StaticIPs = %#v, want empty (address dropped)", plan.StaticIPs)
			}
			if got := plan.Memberships["proj-app"]; !reflect.DeepEqual(got, []string{"proj_backend"}) {
				t.Errorf("Memberships = %#v", got)
			}
			if got := plan.Specs[0].Networks; !reflect.DeepEqual(got, []docker.NetworkAttach{{Name: "proj_backend", Aliases: []string{"app", "proj-app"}}}) {
				t.Errorf("primary = %#v", got)
			}
		})
	}
}

// A service on an internal network is created on it and on nothing else: the
// spec's primary is the internal network and the project default is neither
// joined nor part of the network set.
func TestBuildPlanInternalNetworkIsPrimary(t *testing.T) {
	m, err := Parse([]byte(`
services:
  db:
    image: postgres
    networks: [isolated]
networks:
  isolated:
    internal: true
`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	sp := plan.Specs[0]
	if len(sp.Networks) != 1 || sp.Networks[0].Name != "proj_isolated" {
		t.Fatalf("spec.Networks = %#v, want the internal network as primary", sp.Networks)
	}
	if !reflect.DeepEqual(plan.Memberships["proj-db"], []string{"proj_isolated"}) {
		t.Errorf("Memberships = %#v, want [proj_isolated] (no default)", plan.Memberships["proj-db"])
	}
	if !reflect.DeepEqual(plan.Networks, []string{"proj_isolated"}) {
		t.Errorf("Networks = %#v, want [proj_isolated]", plan.Networks)
	}
	if def := plan.NetworkDefs["proj_isolated"]; !def.Internal {
		t.Errorf("NetworkDefs[proj_isolated] = %#v, want Internal", def)
	}
}

// A top-level default declaration customizes the project network (ipam,
// name, external), and a service listing "default" next to other networks
// joins it once.
func TestBuildPlanDeclaredDefaultNetwork(t *testing.T) {
	m, err := Parse([]byte(`
services:
  web:
    image: nginx
    networks:
      default:
        ipv4_address: 10.30.0.10
      front:
  worker:
    image: worker
  db:
    image: postgres
    networks: [default, default]
networks:
  default:
    ipam:
      config:
        - subnet: 10.30.0.0/24
  front:
`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	def, ok := plan.NetworkDefs["proj_default"]
	if !ok || len(def.IPAM.Config) != 1 || def.IPAM.Config[0].Subnet != "10.30.0.0/24" {
		t.Errorf("NetworkDefs[proj_default] = %#v, ok=%v", def, ok)
	}
	if plan.NetworkNames["proj_default"] != "proj_default" {
		t.Errorf("NetworkNames[proj_default] = %q", plan.NetworkNames["proj_default"])
	}
	wantMembers := map[string][]string{
		"proj-web":    {"proj_default", "proj_front"},
		"proj-worker": {"proj_default"},
		"proj-db":     {"proj_default"},
	}
	if !reflect.DeepEqual(plan.Memberships, wantMembers) {
		t.Errorf("Memberships = %#v\nwant %#v", plan.Memberships, wantMembers)
	}
	gotNets := append([]string(nil), plan.Networks...)
	sort.Strings(gotNets)
	if !reflect.DeepEqual(gotNets, []string{"proj_default", "proj_front"}) {
		t.Errorf("Networks = %#v", plan.Networks)
	}
	web := specByName(t, plan, "proj-web")
	if !reflect.DeepEqual(web.Networks, []docker.NetworkAttach{{Name: "proj_default", IPv4: "10.30.0.10", Aliases: []string{"web", "proj-web"}}}) {
		t.Errorf("web primary = %#v", web.Networks)
	}
	if got := plan.StaticIPs["proj-web"]["proj_default"].IPv4; got != "10.30.0.10" {
		t.Errorf("StaticIPs[proj-web][proj_default] = %q", got)
	}
	if len(plan.Warnings) != 0 {
		t.Errorf("Warnings = %v, want none", plan.Warnings)
	}

	// The default declared external: joined by its real name, not created.
	m, err = Parse([]byte(`
services:
  web:
    image: nginx
networks:
  default:
    external: true
    name: shared_infra
`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	plan, err = BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	if !plan.NetworkDefs["proj_default"].External || plan.NetworkNames["proj_default"] != "shared_infra" {
		t.Errorf("external default: defs=%#v names=%#v", plan.NetworkDefs, plan.NetworkNames)
	}
	if got := plan.Specs[0].Networks[0].Name; got != "shared_infra" {
		t.Errorf("primary = %q, want shared_infra", got)
	}
}

// name: on a non-external network is the exact daemon name to create; the key
// services use stays project-scoped.
func TestBuildPlanExplicitNetworkName(t *testing.T) {
	m, err := Parse([]byte(`
services:
  app:
    image: app
    networks: [backend, cache]
networks:
  backend:
    name: company-backbone
  cache:
    name: cache
`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if def := m.Networks["backend"]; !def.ExplicitName || def.Name != "company-backbone" {
		t.Errorf("backend = %#v", def)
	}
	if def := m.Networks["cache"]; !def.ExplicitName || def.Name != "cache" {
		t.Errorf("cache (name equal to the key) = %#v", def)
	}
	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	if plan.NetworkNames["proj_backend"] != "company-backbone" || plan.NetworkNames["proj_cache"] != "cache" {
		t.Errorf("NetworkNames = %#v", plan.NetworkNames)
	}
	if !reflect.DeepEqual(plan.Memberships["proj-app"], []string{"proj_backend", "proj_cache"}) {
		t.Errorf("Memberships = %#v", plan.Memberships["proj-app"])
	}
	if def, ok := plan.NetworkDefs["proj_backend"]; !ok || def.External {
		t.Errorf("NetworkDefs[proj_backend] = %#v, ok=%v (not external)", def, ok)
	}
	if got := plan.Specs[0].Networks[0].Name; got != "company-backbone" {
		t.Errorf("primary = %q, want company-backbone", got)
	}
}

// Two declarations that would share one network are rejected: keys colliding
// after sanitization, or daemon names colliding through name:/external.
func TestBuildPlanNetworkCollisions(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "keys collide after sanitization",
			src: `
services:
  app:
    image: app
networks:
  Front:
  front:
`,
			want: `both map to "proj_front"`,
		},
		{
			name: "daemon names collide",
			src: `
services:
  app:
    image: app
networks:
  a:
    name: shared
  b:
    external: true
    name: shared
`,
			want: `both resolve to the network name "shared"`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m, err := Parse([]byte(tc.src))
			if err != nil {
				t.Fatalf("Parse: %v", err)
			}
			_, err = BuildPlan("proj", m)
			if err == nil || !IsValidation(err) {
				t.Fatalf("want validation error, got %v", err)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q should contain %q", err.Error(), tc.want)
			}
		})
	}
}

// A Model built by hand (the compose builder) carries Networks without
// NetworkAttach: memberships follow Networks, and a service without any joins
// the project default.
func TestBuildPlanHandBuiltNetworks(t *testing.T) {
	m := &Model{Services: map[string]Service{
		"web": {Image: "nginx", Networks: []string{"front", "back"}},
		"db":  {Image: "postgres"},
	}}
	plan, err := BuildPlan("proj", m)
	if err != nil {
		t.Fatalf("BuildPlan: %v", err)
	}
	wantMembers := map[string][]string{
		"proj-web": {"proj_front", "proj_back"},
		"proj-db":  {"proj_default"},
	}
	if !reflect.DeepEqual(plan.Memberships, wantMembers) {
		t.Errorf("Memberships = %#v", plan.Memberships)
	}
	if got := specByName(t, plan, "proj-web").Networks[0].Name; got != "proj_front" {
		t.Errorf("web primary = %q", got)
	}
	if got := specByName(t, plan, "proj-db").Networks[0].Name; got != "proj_default" {
		t.Errorf("db primary = %q", got)
	}
}
