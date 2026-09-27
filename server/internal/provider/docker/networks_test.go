package docker

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/docker/docker/api/types/network"

	"github.com/gtek-it/castor/server/internal/provider"
)

// TestMapNetworkErr covers the daemon phrasings for network failures: each must
// land on its own actionable sentinel, not-found stays 404, and anything else
// passes through untouched.
func TestMapNetworkErr(t *testing.T) {
	cases := []struct {
		name   string
		in     error
		wantIs error
	}{
		{
			name:   "name taken",
			in:     errors.New("Error response from daemon: network with name front already exists"),
			wantIs: provider.ErrNetworkExists,
		},
		{
			name:   "pool overlaps",
			in:     errors.New("Error response from daemon: Pool overlaps with other one on this address space"),
			wantIs: provider.ErrSubnetOverlap,
		},
		{
			name:   "invalid pool request",
			in:     errors.New("Error response from daemon: invalid pool request: Pool overlaps with other one on this address space"),
			wantIs: provider.ErrSubnetOverlap,
		},
		{
			name:   "cannot create network overlaps",
			in:     errors.New("Error response from daemon: cannot create network 1a2b (br-1a2b): conflicts with network 3c4d (br-3c4d): networks have overlapping IPv4"),
			wantIs: provider.ErrSubnetOverlap,
		},
		{
			name:   "address already in use",
			in:     errors.New("Error response from daemon: Address already in use"),
			wantIs: provider.ErrIPInUse,
		},
		{
			name:   "ip address already in use",
			in:     errors.New("Error response from daemon: IP address 10.10.0.5 is already in use on network front"),
			wantIs: provider.ErrIPInUse,
		},
		{
			name:   "endpoint exists",
			in:     errors.New("Error response from daemon: endpoint with name web already exists in network front"),
			wantIs: provider.ErrAlreadyConnected,
		},
		{
			name:   "not connected to network",
			in:     errors.New("Error response from daemon: container 9f8e7d is not connected to network front"),
			wantIs: provider.ErrNotConnected,
		},
		{
			name:   "not connected to the network",
			in:     errors.New("Error response from daemon: container 9f8e7d is not connected to the network front"),
			wantIs: provider.ErrNotConnected,
		},
		{
			name:   "static ip on default bridge (older daemon)",
			in:     errors.New("Error response from daemon: user specified IP address is supported on user defined networks only"),
			wantIs: provider.ErrStaticIPUnsupported,
		},
		{
			name:   "static ip without user subnet (current daemon)",
			in:     errors.New("Error response from daemon: user specified IP address is supported only when connecting to networks with user configured subnets"),
			wantIs: provider.ErrStaticIPUnsupported,
		},
		{
			name:   "active endpoints on delete",
			in:     errors.New("Error response from daemon: error while removing network: network front id 1a2b has active endpoints"),
			wantIs: provider.ErrNetworkInUse,
		},
		{
			name:   "invalid subnet",
			in:     errors.New("Error response from daemon: invalid network config:\ninvalid subnet 10.0.0.0/33: invalid CIDR block notation"),
			wantIs: provider.ErrInvalidNetworkConfig,
		},
		{
			name:   "invalid gateway",
			in:     errors.New("Error response from daemon: invalid network config:\ninvalid gateway 10.1.0.1: parent subnet 10.0.0.0/24 doesn't contain this address"),
			wantIs: provider.ErrInvalidNetworkConfig,
		},
		{
			name:   "static ip outside subnet",
			in:     errors.New("Error response from daemon: no configured subnet or ip-range contain the IP address 10.9.9.9"),
			wantIs: provider.ErrInvalidNetworkConfig,
		},
		{
			name:   "host/none/container network mode",
			in:     errors.New("Error response from daemon: container sharing network namespace with another container or host cannot join any other network"),
			wantIs: provider.ErrInvalidNetworkConfig,
		},
		{
			name:   "alias on default bridge",
			in:     errors.New("Error response from daemon: network-scoped alias is supported only for containers in user defined networks"),
			wantIs: provider.ErrAliasUnsupported,
		},
		{
			name:   "ipv4 pool exhausted",
			in:     errors.New("Error response from daemon: no available IPv4 addresses on this network's address pools: front (1a2b3c)"),
			wantIs: provider.ErrIPPoolExhausted,
		},
		{
			name:   "ipv6 pool exhausted",
			in:     errors.New("Error response from daemon: no available IPv6 addresses on this network's address pools: front (1a2b3c)"),
			wantIs: provider.ErrIPPoolExhausted,
		},
		{
			name:   "not found via errdefs",
			in:     fmt.Errorf("%w: network front not found", cerrdefs.ErrNotFound),
			wantIs: provider.ErrNotFound,
		},
		{
			name:   "no such network",
			in:     errors.New("Error response from daemon: No such network: front"),
			wantIs: provider.ErrNotFound,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapNetworkErr(tc.in)
			if !errors.Is(got, tc.wantIs) {
				t.Fatalf("mapNetworkErr(%q) = %v; want errors.Is(..., %v)", tc.in, got, tc.wantIs)
			}
		})
	}

	if got := mapNetworkErr(nil); got != nil {
		t.Fatalf("mapNetworkErr(nil) = %v, want nil", got)
	}
	unrelated := errors.New("connection refused")
	if got := mapNetworkErr(unrelated); got != unrelated {
		t.Fatalf("unrelated error must pass through, got %v", got)
	}
}

// TestMapNetworkErrInvalidConfigMessage locks the 422 payload: the daemon's
// explanation survives on one line, without the daemon prefix.
func TestMapNetworkErrInvalidConfigMessage(t *testing.T) {
	in := errors.New("Error response from daemon: invalid network config:\ninvalid subnet 10.0.0.0/33: invalid CIDR block notation")
	got := mapNetworkErr(in)
	if !errors.Is(got, provider.ErrInvalidNetworkConfig) {
		t.Fatalf("want ErrInvalidNetworkConfig, got %v", got)
	}
	msg := got.Error()
	if strings.Contains(msg, "Error response from daemon") {
		t.Errorf("daemon prefix leaked: %q", msg)
	}
	if strings.Contains(msg, "\n") {
		t.Errorf("message must be single-line: %q", msg)
	}
	if !strings.Contains(msg, "invalid subnet 10.0.0.0/33") {
		t.Errorf("daemon explanation lost: %q", msg)
	}

	// The network-mode refusal replaces the daemon's phrasing with the
	// user-facing explanation.
	mode := mapNetworkErr(errors.New("Error response from daemon: container sharing network namespace with another container or host cannot join any other network"))
	if !errors.Is(mode, provider.ErrInvalidNetworkConfig) || !strings.Contains(mode.Error(), provider.MsgNetworkModeUnjoinable) {
		t.Errorf("network-mode refusal = %v want ErrInvalidNetworkConfig with %q", mode, provider.MsgNetworkModeUnjoinable)
	}
}

// TestNetworkSentinelsWrap locks the invariants the API mapping relies on: the
// 409 sentinels satisfy errors.Is(_, ErrConflict), ErrNotConnected satisfies
// errors.Is(_, ErrNotFound), and none of them is mistaken for its parent.
func TestNetworkSentinelsWrap(t *testing.T) {
	conflicts := []error{
		provider.ErrNetworkExists,
		provider.ErrSubnetOverlap,
		provider.ErrIPInUse,
		provider.ErrAlreadyConnected,
		provider.ErrStaticIPUnsupported,
		provider.ErrNetworkInUse,
		provider.ErrAliasUnsupported,
		provider.ErrIPPoolExhausted,
	}
	for _, e := range conflicts {
		if !errors.Is(e, provider.ErrConflict) {
			t.Errorf("%v must wrap ErrConflict", e)
		}
		if e == provider.ErrConflict {
			t.Errorf("specific sentinel %v must not be the bare ErrConflict", e)
		}
	}
	if !errors.Is(provider.ErrNotConnected, provider.ErrNotFound) {
		t.Error("ErrNotConnected must wrap ErrNotFound")
	}
	if errors.Is(provider.ErrInvalidNetworkConfig, provider.ErrConflict) ||
		errors.Is(provider.ErrInvalidNetworkConfig, provider.ErrNotFound) {
		t.Error("ErrInvalidNetworkConfig must be its own sentinel (422), not a conflict or not-found")
	}
}

// TestNetworkCreateOptions covers the spec -> daemon request mapping: bridge by
// default, IPv6 only sent when requested, and the IPAM pools with the default
// IPAM driver when the spec names none.
func TestNetworkCreateOptions(t *testing.T) {
	plain := networkCreateOptions(NetworkSpec{Name: "front"})
	if plain.Driver != "bridge" {
		t.Errorf("driver = %q want bridge", plain.Driver)
	}
	if plain.EnableIPv6 != nil {
		t.Errorf("EnableIPv6 must stay unset (daemon default), got %v", *plain.EnableIPv6)
	}
	if plain.IPAM != nil {
		t.Errorf("IPAM must stay unset without pools, got %+v", plain.IPAM)
	}

	full := networkCreateOptions(NetworkSpec{
		Name:       "back",
		Driver:     "macvlan",
		Internal:   true,
		Attachable: true,
		EnableIPv6: true,
		Options:    map[string]string{"parent": "eth0"},
		Labels:     map[string]string{"io.castor.managed": "true"},
		IPAM: &IPAMSpec{Config: []IPAMConfig{
			{Subnet: "10.10.0.0/24", Gateway: "10.10.0.1", IPRange: "10.10.0.128/25", AuxAddresses: map[string]string{"router": "10.10.0.2"}},
			{}, // empty pool is dropped
		}},
	})
	if full.Driver != "macvlan" || !full.Internal || !full.Attachable {
		t.Errorf("driver/internal/attachable = %q/%v/%v", full.Driver, full.Internal, full.Attachable)
	}
	if full.EnableIPv6 == nil || !*full.EnableIPv6 {
		t.Errorf("EnableIPv6 must be sent as true")
	}
	if full.Options["parent"] != "eth0" || full.Labels["io.castor.managed"] != "true" {
		t.Errorf("options/labels not passed through: %+v / %+v", full.Options, full.Labels)
	}
	if full.IPAM == nil {
		t.Fatal("IPAM must be set")
	}
	if full.IPAM.Driver != "default" {
		t.Errorf("IPAM driver = %q want default", full.IPAM.Driver)
	}
	if len(full.IPAM.Config) != 1 {
		t.Fatalf("IPAM config = %+v want 1 pool", full.IPAM.Config)
	}
	pool := full.IPAM.Config[0]
	if pool.Subnet != "10.10.0.0/24" || pool.Gateway != "10.10.0.1" || pool.IPRange != "10.10.0.128/25" || pool.AuxAddress["router"] != "10.10.0.2" {
		t.Errorf("pool = %+v", pool)
	}
}

// TestMapNetworkDetail covers the inspect mapping: subnets flattened onto the
// summary, IPAM pools echoed back, endpoints sorted by container name with the
// CIDR suffix stripped from their addresses.
func TestMapNetworkDetail(t *testing.T) {
	created := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	in := &network.Inspect{
		Name:       "front",
		ID:         "net1",
		Created:    created,
		Scope:      "local",
		Driver:     "bridge",
		EnableIPv6: true,
		Internal:   false,
		Attachable: true,
		IPAM: network.IPAM{
			Driver: "default",
			Config: []network.IPAMConfig{
				{Subnet: "10.10.0.0/24", Gateway: "10.10.0.1"},
				{Subnet: "fd00:10::/64"},
			},
		},
		Containers: map[string]network.EndpointResource{
			"c-web": {Name: "web", IPv4Address: "10.10.0.5/24", IPv6Address: "fd00:10::5/64", MacAddress: "02:42:0a:0a:00:05"},
			"c-db":  {Name: "db", IPv4Address: "10.10.0.3/24"},
		},
		Options: map[string]string{"com.docker.network.bridge.name": "br-front"},
		Labels:  map[string]string{"com.docker.compose.project": "shop"},
	}
	d := mapNetworkDetail(in)

	if d.ID != "net1" || d.Name != "front" || d.Driver != "bridge" || d.Scope != "local" {
		t.Errorf("summary = %+v", d.NetworkInfo)
	}
	if !d.Attachable || !d.EnableIPv6 || d.Internal {
		t.Errorf("flags = attachable %v ipv6 %v internal %v", d.Attachable, d.EnableIPv6, d.Internal)
	}
	if !d.Created.Equal(created) {
		t.Errorf("created = %v want %v", d.Created, created)
	}
	if len(d.Subnets) != 2 || d.Subnets[0] != "10.10.0.0/24" || d.Subnets[1] != "fd00:10::/64" {
		t.Errorf("subnets = %v", d.Subnets)
	}
	if d.Labels["com.docker.compose.project"] != "shop" {
		t.Errorf("labels = %v", d.Labels)
	}
	if d.IPAM.Driver != "default" || len(d.IPAM.Config) != 2 || d.IPAM.Config[0].Gateway != "10.10.0.1" {
		t.Errorf("ipam = %+v", d.IPAM)
	}
	if d.Options["com.docker.network.bridge.name"] != "br-front" {
		t.Errorf("options = %v", d.Options)
	}
	if len(d.Containers) != 2 {
		t.Fatalf("containers = %+v want 2", d.Containers)
	}
	db, web := d.Containers[0], d.Containers[1]
	if db.Name != "db" || db.ContainerID != "c-db" || db.IPv4 != "10.10.0.3" || db.IPv6 != "" {
		t.Errorf("db endpoint = %+v", db)
	}
	if web.Name != "web" || web.ContainerID != "c-web" || web.IPv4 != "10.10.0.5" || web.IPv6 != "fd00:10::5" || web.MAC != "02:42:0a:0a:00:05" {
		t.Errorf("web endpoint = %+v", web)
	}
	// The daemon only lists live endpoints: each is running, none protected
	// until the API overlays the snapshot.
	for _, ep := range d.Containers {
		if !ep.Running || ep.State != string(provider.StateRunning) || ep.Protected {
			t.Errorf("endpoint flags = %+v want running/unprotected", ep)
		}
	}
}

// TestMapNetworkInfoEmpty locks the JSON-friendly shape of a bare network: no
// pools yields an empty (not nil) subnet list, and nil options become an empty
// map on the summary and the detail alike.
func TestMapNetworkInfoEmpty(t *testing.T) {
	in := &network.Inspect{Name: "none", ID: "n0", Driver: "null", Scope: "local"}
	info := mapNetworkInfo(in)
	if info.Subnets == nil || len(info.Subnets) != 0 {
		t.Errorf("subnets = %#v want empty slice", info.Subnets)
	}
	if info.Options == nil {
		t.Errorf("summary options must be non-nil: %+v", info)
	}
	d := mapNetworkDetail(in)
	if d.Options == nil || d.Containers == nil || d.IPAM.Config == nil {
		t.Errorf("detail collections must be non-nil: %+v", d)
	}
}

func TestStripCIDR(t *testing.T) {
	cases := map[string]string{
		"10.0.0.5/24":  "10.0.0.5",
		"fd00::5/64":   "fd00::5",
		"10.0.0.5":     "10.0.0.5",
		"":             "",
		"192.168.1.1/": "192.168.1.1",
	}
	for in, want := range cases {
		if got := stripCIDR(in); got != want {
			t.Errorf("stripCIDR(%q) = %q want %q", in, got, want)
		}
	}
}

// TestEndpointSettings locks the connect payload: aliases always, the IPAM
// block only when a static address is requested.
func TestEndpointSettings(t *testing.T) {
	plain := endpointSettings(NetworkAttachOptions{Aliases: []string{"web", "www"}})
	if plain.IPAMConfig != nil {
		t.Errorf("IPAMConfig must be nil without a static address, got %+v", plain.IPAMConfig)
	}
	if len(plain.Aliases) != 2 || plain.Aliases[0] != "web" {
		t.Errorf("aliases = %v", plain.Aliases)
	}
	static := endpointSettings(NetworkAttachOptions{IPv4: "10.10.0.9", IPv6: "fd00:10::9"})
	if static.IPAMConfig == nil || static.IPAMConfig.IPv4Address != "10.10.0.9" || static.IPAMConfig.IPv6Address != "fd00:10::9" {
		t.Errorf("IPAMConfig = %+v", static.IPAMConfig)
	}
}

// TestMergeLabels covers the project-network label overlay: stack labels win
// over compose-declared ones, inputs stay untouched, and empty yields nil.
func TestMergeLabels(t *testing.T) {
	if got := mergeLabels(nil, nil); got != nil {
		t.Errorf("mergeLabels(nil, nil) = %v want nil", got)
	}
	base := map[string]string{"a": "1", "b": "base"}
	over := map[string]string{"b": "over", "c": "3"}
	got := mergeLabels(base, over)
	if got["a"] != "1" || got["b"] != "over" || got["c"] != "3" {
		t.Errorf("merged = %v", got)
	}
	if base["b"] != "base" || len(base) != 2 {
		t.Errorf("base mutated: %v", base)
	}
}
