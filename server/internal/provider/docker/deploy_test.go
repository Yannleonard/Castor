package docker

import (
	"errors"
	"fmt"
	"testing"

	cerrdefs "github.com/containerd/errdefs"

	"github.com/gtek-it/castor/server/internal/provider"
)

// TestMapDeployCreateErr covers ContainerCreate error translation: the daemon's
// "container name already in use" conflict must become the specific
// ErrNameConflict (a 409 with an actionable message) rather than a generic
// conflict; other errors defer to mapResourceErr.
func TestMapDeployCreateErr(t *testing.T) {
	// Exact daemon phrasing for a taken name.
	nameTaken := errors.New("Error response from daemon: Conflict. The container name \"/web\" is already in use by container \"abc123\". You have to remove (or rename) that container to be able to reuse that name.")

	cases := []struct {
		name    string
		in      error
		wantIs  error
		wantNil bool
	}{
		{name: "nil", in: nil, wantNil: true},
		{name: "name taken (daemon string)", in: nameTaken, wantIs: provider.ErrNameConflict},
		{name: "name taken via errdefs conflict", in: fmt.Errorf("%w: name in use", cerrdefs.ErrConflict), wantIs: provider.ErrNameConflict},
		{name: "not found defers to mapResourceErr", in: fmt.Errorf("no such image: x"), wantIs: provider.ErrNotFound},
		{
			name:   "static ip on a network without user subnet",
			in:     errors.New("Error response from daemon: user specified IP address is supported only when connecting to networks with user configured subnets"),
			wantIs: provider.ErrStaticIPUnsupported,
		},
		{
			name:   "static ip outside the subnet",
			in:     errors.New("Error response from daemon: no configured subnet or ip-range contain the IP address 10.9.9.9"),
			wantIs: provider.ErrInvalidNetworkConfig,
		},
		{
			name:   "unknown network stays not-found",
			in:     fmt.Errorf("%w: network front not found", cerrdefs.ErrNotFound),
			wantIs: provider.ErrNotFound,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := mapDeployCreateErr(c.in)
			if c.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %v", got)
				}
				return
			}
			if !errors.Is(got, c.wantIs) {
				t.Fatalf("want errors.Is(_, %v), got %v", c.wantIs, got)
			}
		})
	}
}

// TestMapDeployStartErr covers ContainerStart error translation: a host-port
// clash must become the specific ErrPortConflict (409) instead of falling
// through to a generic 500; unknown-container stays not-found.
func TestMapDeployStartErr(t *testing.T) {
	// Exact daemon phrasings for a port clash.
	portBind := errors.New("Error response from daemon: driver failed programming external connectivity on endpoint web: Bind for 0.0.0.0:8080 failed: port is already allocated")
	addrInUse := errors.New("Error response from daemon: failed to bind host port for 0.0.0.0:8080: address already in use")

	cases := []struct {
		name    string
		in      error
		wantIs  error
		wantNot error
		wantNil bool
	}{
		{name: "nil", in: nil, wantNil: true},
		{name: "port already allocated", in: portBind, wantIs: provider.ErrPortConflict},
		{name: "address already in use", in: addrInUse, wantIs: provider.ErrPortConflict},
		{name: "unknown container stays not-found", in: errors.New("No such container: abc"), wantIs: provider.ErrNotFound},
		// The bare IPAM refusal (no bind/port context) is a taken static IP on
		// the primary network, not a host-port clash.
		{name: "static ip taken", in: errors.New("Error response from daemon: Address already in use"), wantIs: provider.ErrIPInUse},
		{name: "static ip taken is not a port conflict", in: errors.New("Error response from daemon: Address already in use"), wantNot: provider.ErrPortConflict},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := mapDeployStartErr(c.in)
			if c.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %v", got)
				}
				return
			}
			if c.wantNot != nil {
				if errors.Is(got, c.wantNot) {
					t.Fatalf("must not be errors.Is(_, %v), got %v", c.wantNot, got)
				}
				return
			}
			if !errors.Is(got, c.wantIs) {
				t.Fatalf("want errors.Is(_, %v), got %v", c.wantIs, got)
			}
		})
	}
}

// TestBuildNetworkingConfig covers the DeploySpec.Networks split: the first
// named network becomes the ContainerCreate endpoint (with its static IP and
// aliases), the rest are returned for a post-create connect, unnamed entries
// are dropped, and no networks means no NetworkingConfig at all.
func TestBuildNetworkingConfig(t *testing.T) {
	if cfg, extra := buildNetworkingConfig(nil); cfg != nil || extra != nil {
		t.Fatalf("empty spec: cfg=%+v extra=%+v want nil/nil", cfg, extra)
	}
	if cfg, extra := buildNetworkingConfig([]NetworkAttach{{Name: "  "}}); cfg != nil || extra != nil {
		t.Fatalf("blank names only: cfg=%+v extra=%+v want nil/nil", cfg, extra)
	}

	cfg, extra := buildNetworkingConfig([]NetworkAttach{
		{Name: ""},
		{Name: "front", IPv4: "10.10.0.9", Aliases: []string{"web"}},
		{Name: "back", Aliases: []string{"api"}},
		{Name: "metrics"},
	})
	if cfg == nil || len(cfg.EndpointsConfig) != 1 {
		t.Fatalf("cfg = %+v want exactly one endpoint", cfg)
	}
	ep := cfg.EndpointsConfig["front"]
	if ep == nil {
		t.Fatalf("primary endpoint must be keyed by network name, got %v", cfg.EndpointsConfig)
	}
	if ep.IPAMConfig == nil || ep.IPAMConfig.IPv4Address != "10.10.0.9" {
		t.Errorf("primary IPAMConfig = %+v want IPv4 10.10.0.9", ep.IPAMConfig)
	}
	if len(ep.Aliases) != 1 || ep.Aliases[0] != "web" {
		t.Errorf("primary aliases = %v", ep.Aliases)
	}
	if len(extra) != 2 || extra[0].Name != "back" || extra[1].Name != "metrics" {
		t.Errorf("extra = %+v want [back metrics]", extra)
	}
	if extra[0].Aliases[0] != "api" {
		t.Errorf("extra aliases lost: %+v", extra[0])
	}

	// No static address: the IPAM block must be absent so the daemon does not
	// reject the create on networks without a user subnet.
	cfg, _ = buildNetworkingConfig([]NetworkAttach{{Name: "front"}})
	if cfg.EndpointsConfig["front"].IPAMConfig != nil {
		t.Errorf("IPAMConfig must be nil without a static IP, got %+v", cfg.EndpointsConfig["front"].IPAMConfig)
	}
}

// TestIsImageRefErr covers the bad-reference / auth classification used to turn a
// failed pull into ErrImageNotFound.
func TestIsImageRefErr(t *testing.T) {
	yes := []error{
		errors.New("manifest unknown: manifest tagged by \"9.9\" is not found"),
		errors.New("pull access denied for foo/bar, repository does not exist or may require 'docker login'"),
		errors.New("Error response from daemon: unauthorized: authentication required"),
		fmt.Errorf("%w: nope", cerrdefs.ErrNotFound),
	}
	no := []error{
		nil,
		errors.New("Error response from daemon: i/o timeout"),
		errors.New("connection refused"),
	}
	for _, e := range yes {
		if !isImageRefErr(e) {
			t.Errorf("expected image-ref error for: %v", e)
		}
	}
	for _, e := range no {
		if isImageRefErr(e) {
			t.Errorf("did not expect image-ref error for: %v", e)
		}
	}
}
