package docker

import (
	"testing"

	"github.com/gtek-it/castor/server/internal/provider"
)

func TestDockerPortConfigKeepsUnpublishedPortsInternal(t *testing.T) {
	set, bindings, err := dockerPortConfig([]provider.Port{
		{Private: 8080, Protocol: "tcp"},
		{Private: 5353, Public: 5353, Protocol: "udp", HostIP: "127.0.0.1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(set) != 2 {
		t.Fatalf("exposed ports = %d, want 2", len(set))
	}
	if len(bindings) != 1 {
		t.Fatalf("published bindings = %d, want 1", len(bindings))
	}
	binding := bindings["5353/udp"]
	if len(binding) != 1 || binding[0].HostIP != "127.0.0.1" || binding[0].HostPort != "5353" {
		t.Fatalf("published binding = %#v", binding)
	}
}

func TestDockerPortConfigRejectsInvalidMapping(t *testing.T) {
	for _, ports := range [][]provider.Port{
		{{Protocol: "tcp"}},
		{{Private: 80, Protocol: "icmp"}},
		{{Private: 80, Public: 8080, Protocol: "tcp", HostIP: "example.com"}},
		{{Private: 80, Protocol: "tcp"}, {Private: 80, Protocol: "tcp"}},
	} {
		if _, _, err := dockerPortConfig(ports); err == nil {
			t.Errorf("dockerPortConfig(%#v) expected error", ports)
		}
	}
}
