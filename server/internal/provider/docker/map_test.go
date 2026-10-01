// Castor by IT Leonard
package docker

import (
	"testing"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"

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

// TestMapContainerNetworks covers the list-row network summary: names sorted,
// IPAddress = first IPv4 in that order (skipping networks without one), and a
// container with no network settings (or none attached) carries neither.
func TestMapContainerNetworks(t *testing.T) {
	p := &DockerProvider{id: ProviderID}
	s := &container.Summary{
		ID:    "abc",
		Names: []string{"/web"},
		State: "running",
		NetworkSettings: &container.NetworkSettingsSummary{
			Networks: map[string]*network.EndpointSettings{
				"shop_default": {IPAddress: "172.20.0.5", NetworkID: "n1"},
				"back":         {IPAddress: ""},
				"front":        {IPAddress: "10.10.0.5", NetworkID: "n2"},
			},
		},
	}
	wl := p.mapContainer(s)
	if len(wl.NetworkNames) != 3 || wl.NetworkNames[0] != "back" || wl.NetworkNames[1] != "front" || wl.NetworkNames[2] != "shop_default" {
		t.Errorf("networkNames = %v want sorted [back front shop_default]", wl.NetworkNames)
	}
	if wl.IPAddress != "10.10.0.5" {
		t.Errorf("ipAddress = %q want first non-empty IPv4 in name order (front)", wl.IPAddress)
	}
	if wl.Networks != nil {
		t.Errorf("list rows must not carry the per-network detail, got %+v", wl.Networks)
	}

	bare := p.mapContainer(&container.Summary{ID: "x", Names: []string{"/none"}, State: "exited"})
	if bare.NetworkNames != nil || bare.IPAddress != "" {
		t.Errorf("no network settings: names=%v ip=%q want none", bare.NetworkNames, bare.IPAddress)
	}
}

// TestMapInspectNetworks covers the inspect mapping of a container's endpoint
// settings into WorkloadNetwork entries, sorted by name, with the configured
// static address used when the live one is absent (stopped container).
func TestMapInspectNetworks(t *testing.T) {
	p := &DockerProvider{id: ProviderID, daemonHost: "node-1"}
	cj := &container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			ID:      "abcdef123456",
			Name:    "/web",
			Created: "2026-09-25T10:00:00.000000000Z",
			State:   &container.State{Status: "running", Running: true},
		},
		Config: &container.Config{Image: "nginx:latest"},
		NetworkSettings: &container.NetworkSettings{
			Networks: map[string]*network.EndpointSettings{
				"front": {
					NetworkID:         "n-front",
					IPAddress:         "10.10.0.5",
					Gateway:           "10.10.0.1",
					GlobalIPv6Address: "fd00:10::5",
					MacAddress:        "02:42:0a:0a:00:05",
					Aliases:           []string{"web", "www"},
				},
				"back": {
					NetworkID:  "n-back",
					IPAMConfig: &network.EndpointIPAMConfig{IPv4Address: "10.20.0.9"},
				},
			},
		},
	}
	wl := p.mapInspect(cj)

	if len(wl.Networks) != 2 {
		t.Fatalf("networks = %+v want 2", wl.Networks)
	}
	back, front := wl.Networks[0], wl.Networks[1]
	if back.Name != "back" || back.NetworkID != "n-back" || back.IPv4 != "10.20.0.9" || back.Gateway != "" {
		t.Errorf("back = %+v (static IPv4 must be used when no live address)", back)
	}
	if front.Name != "front" || front.NetworkID != "n-front" || front.IPv4 != "10.10.0.5" || front.IPv6 != "fd00:10::5" ||
		front.Gateway != "10.10.0.1" || front.MAC != "02:42:0a:0a:00:05" || len(front.Aliases) != 2 || front.Aliases[1] != "www" {
		t.Errorf("front = %+v", front)
	}
	if len(wl.NetworkNames) != 2 || wl.NetworkNames[0] != "back" || wl.NetworkNames[1] != "front" {
		t.Errorf("networkNames = %v", wl.NetworkNames)
	}
	if wl.IPAddress != "10.20.0.9" {
		t.Errorf("ipAddress = %q want first IPv4 in name order", wl.IPAddress)
	}

	none := p.mapInspect(&container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{ID: "x", Name: "/lonely", State: &container.State{Status: "exited"}},
	})
	if none.Networks != nil || none.NetworkNames != nil || none.IPAddress != "" {
		t.Errorf("no network settings must yield no network fields: %+v", none)
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
