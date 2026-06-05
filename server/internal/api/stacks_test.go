package api

import (
	"strings"
	"testing"

	"github.com/gtek-it/castor/server/internal/compose"
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
