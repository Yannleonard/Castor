package docker

import (
	"testing"

	"github.com/docker/docker/api/types/container"

	"github.com/gtek-it/castor/server/internal/provider"
)

func TestNormalizeState(t *testing.T) {
	cases := map[string]provider.WorkloadState{
		"running":    provider.StateRunning,
		"exited":     provider.StateStopped,
		"dead":       provider.StateStopped,
		"created":    provider.StateStopped,
		"paused":     provider.StatePaused,
		"restarting": provider.StateRestarting,
		"weird":      provider.StateUnknown,
	}
	for in, want := range cases {
		if got := normalizeState(in); got != want {
			t.Errorf("normalizeState(%q) = %q want %q", in, got, want)
		}
	}
}

func TestMapContainer(t *testing.T) {
	p := &DockerProvider{id: ProviderID, daemonHost: "node-1", selfContainerID: "self123456789"}
	s := &container.Summary{
		ID:      "abcdef123456",
		Names:   []string{"/web"},
		Image:   "nginx:latest",
		State:   "running",
		Status:  "Up 3 minutes",
		Created: 1700000000,
		Labels: map[string]string{
			"com.docker.compose.project": "shop",
		},
		Ports: []container.Port{
			{PrivatePort: 80, PublicPort: 8080, Type: "tcp"},
		},
	}
	wl := p.mapContainer(s)
	if wl.ID != "abcdef123456" || wl.Name != "web" {
		t.Errorf("id/name = %q/%q", wl.ID, wl.Name)
	}
	if wl.Kind != provider.KindDocker {
		t.Errorf("kind = %q", wl.Kind)
	}
	if wl.ProviderID != ProviderID {
		t.Errorf("providerId = %q", wl.ProviderID)
	}
	if wl.Node != "node-1" {
		t.Errorf("node = %q", wl.Node)
	}
	if wl.State != provider.StateRunning {
		t.Errorf("state = %q", wl.State)
	}
	if wl.Image != "nginx:latest" {
		t.Errorf("image = %q", wl.Image)
	}
	if wl.Group != "shop" {
		t.Errorf("group = %q want shop", wl.Group)
	}
	if len(wl.Ports) != 1 || wl.Ports[0].Private != 80 || wl.Ports[0].Public != 8080 || wl.Ports[0].Protocol != "tcp" {
		t.Errorf("ports = %+v", wl.Ports)
	}
	if wl.Protected {
		t.Errorf("non-self container should not be protected")
	}
}

func TestMapContainerProtectedSelf(t *testing.T) {
	p := &DockerProvider{id: ProviderID, selfContainerID: "selfcontainerid000000"}
	s := &container.Summary{ID: "selfcontainerid000000", Names: []string{"/castor"}, State: "running"}
	wl := p.mapContainer(s)
	if !wl.Protected {
		t.Errorf("Castor's own container must be Protected")
	}
}

func TestMapContainerProtectedByLabel(t *testing.T) {
	p := &DockerProvider{id: ProviderID}
	s := &container.Summary{
		ID:     "x",
		Names:  []string{"/db"},
		State:  "running",
		Labels: map[string]string{"io.castor.protected": "true"},
	}
	wl := p.mapContainer(s)
	if !wl.Protected {
		t.Errorf("container with io.castor.protected=true must be Protected")
	}
}

func TestValidImageRef(t *testing.T) {
	valid := []string{"nginx", "nginx:latest", "library/nginx:1.25", "ghcr.io/org/app:v1.2.3", "registry.example.com:5000/app@sha256:" + repeat("a", 64)}
	for _, r := range valid {
		if !ValidImageRef(r) {
			t.Errorf("ValidImageRef(%q) = false want true", r)
		}
	}
	invalid := []string{"", "http://evil.com/x", "nginx latest", "nginx;rm -rf", "\"injected\"", "a b"}
	for _, r := range invalid {
		if ValidImageRef(r) {
			t.Errorf("ValidImageRef(%q) = true want false (anti-SSRF)", r)
		}
	}
}

func repeat(s string, n int) string {
	out := make([]byte, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, s[0])
	}
	return string(out)
}
