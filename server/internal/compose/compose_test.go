package compose

import (
	"reflect"
	"strings"
	"testing"
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
