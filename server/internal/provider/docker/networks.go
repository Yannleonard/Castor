package docker

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/docker/docker/api/types/network"

	"github.com/gtek-it/castor/server/internal/provider"
)

// IPAMConfig is one address pool of a network: the subnet in CIDR notation, an
// optional gateway and allocation range inside it, and named auxiliary
// addresses the IPAM driver must leave unallocated.
type IPAMConfig struct {
	Subnet       string            `json:"subnet"`
	Gateway      string            `json:"gateway,omitempty"`
	IPRange      string            `json:"ipRange,omitempty"`
	AuxAddresses map[string]string `json:"auxAddresses,omitempty"`
}

// IPAMSpec is a network's IP address management: the IPAM driver (the daemon
// default when empty) and its address pools.
type IPAMSpec struct {
	Driver string       `json:"driver"`
	Config []IPAMConfig `json:"config"`
}

// NetworkSpec is the create-network request. Name is required; Driver defaults
// to "bridge" when empty. IPAM is optional: without it the daemon picks a free
// subnet from its default address pools.
type NetworkSpec struct {
	Name       string            `json:"name"`
	Driver     string            `json:"driver"`
	Internal   bool              `json:"internal"`
	Attachable bool              `json:"attachable"`
	EnableIPv6 bool              `json:"enableIPv6"`
	Options    map[string]string `json:"options"`
	IPAM       *IPAMSpec         `json:"ipam"`
	Labels     map[string]string `json:"labels"`
}

// NetworkInfo is the normalized network summary the API exposes and the cache
// snapshot carries. Subnets flattens the IPAM pools so the list view can show
// addressing without an inspect round-trip. Options are the driver options
// (never nil): the API's attach policy reads them from the snapshot to tell a
// network bound to a host interface from a plain one.
type NetworkInfo struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Driver     string            `json:"driver"`
	Scope      string            `json:"scope"`
	Internal   bool              `json:"internal"`
	Attachable bool              `json:"attachable"`
	EnableIPv6 bool              `json:"enableIPv6"`
	Created    time.Time         `json:"created"`
	Subnets    []string          `json:"subnets"`
	Options    map[string]string `json:"options"`
	Labels     map[string]string `json:"labels,omitempty"`
}

// NetworkEndpoint is one container attached to a network, with the addresses
// the network allocated to it (plain IPs, without the CIDR suffix the daemon
// reports). Running is true for an endpoint the daemon reports live; the API
// also lists containers configured on the network but stopped, with
// Running=false and State from the last poll. Protected marks Castor's own
// container or one carrying a protected label.
type NetworkEndpoint struct {
	ContainerID string `json:"containerId"`
	Name        string `json:"name"`
	IPv4        string `json:"ipv4,omitempty"`
	IPv6        string `json:"ipv6,omitempty"`
	MAC         string `json:"mac,omitempty"`
	Running     bool   `json:"running"`
	State       string `json:"state"`
	Protected   bool   `json:"protected"`
}

// NetworkDetail is the full inspect view of a network: the summary (with its
// driver options) plus its IPAM configuration and connected containers.
type NetworkDetail struct {
	NetworkInfo
	IPAM       IPAMSpec          `json:"ipam"`
	Containers []NetworkEndpoint `json:"containers"`
}

// NetworkAttachOptions tunes how a container joins a network: optional static
// addresses (user-defined networks with a configured subnet only) and extra
// DNS aliases the other containers on that network can resolve.
type NetworkAttachOptions struct {
	IPv4    string   `json:"ipv4,omitempty"`
	IPv6    string   `json:"ipv6,omitempty"`
	Aliases []string `json:"aliases,omitempty"`
}

// ListNetworks returns normalized network summaries.
func (p *DockerProvider) ListNetworks(ctx context.Context) ([]NetworkInfo, error) {
	nets, err := p.cli.NetworkList(ctx, network.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]NetworkInfo, 0, len(nets))
	for i := range nets {
		out = append(out, mapNetworkInfo(&nets[i]))
	}
	return out, nil
}

// InspectNetwork returns the full view of one network by id or name.
func (p *DockerProvider) InspectNetwork(ctx context.Context, idOrName string) (*NetworkDetail, error) {
	n, err := p.cli.NetworkInspect(ctx, idOrName, network.InspectOptions{})
	if err != nil {
		return nil, mapNetworkErr(err)
	}
	return mapNetworkDetail(&n), nil
}

// CreateNetwork creates a network from spec and returns the daemon's view of it
// (id, scope, and the subnet it picked when the spec left IPAM empty).
func (p *DockerProvider) CreateNetwork(ctx context.Context, spec NetworkSpec) (*NetworkInfo, error) {
	if spec.Name == "" {
		return nil, fmt.Errorf("%w: network name is required", provider.ErrInvalidNetworkConfig)
	}
	opts := networkCreateOptions(spec)
	resp, err := p.cli.NetworkCreate(ctx, spec.Name, opts)
	if err != nil {
		return nil, mapNetworkErr(err)
	}
	n, err := p.cli.NetworkInspect(ctx, resp.ID, network.InspectOptions{})
	if err != nil {
		// The network exists: report what was requested rather than fail the create.
		info := NetworkInfo{
			ID:         resp.ID,
			Name:       spec.Name,
			Driver:     opts.Driver,
			Scope:      "local",
			Internal:   spec.Internal,
			Attachable: spec.Attachable,
			EnableIPv6: spec.EnableIPv6,
			Subnets:    []string{},
			Options:    nonNilOptions(spec.Options),
			Labels:     spec.Labels,
		}
		if opts.IPAM != nil {
			info.Subnets = ipamSubnets(opts.IPAM.Config)
		}
		return &info, nil
	}
	info := mapNetworkInfo(&n)
	return &info, nil
}

// DeleteNetwork removes a network by id.
func (p *DockerProvider) DeleteNetwork(ctx context.Context, id string) error {
	if err := p.cli.NetworkRemove(ctx, id); err != nil {
		return mapNetworkErr(err)
	}
	return nil
}

// ConnectContainerToNetwork attaches a container to a network (by id or name),
// with an optional static address and DNS aliases. Docker accepts this on a
// created-but-not-started container, which the deploy path relies on.
func (p *DockerProvider) ConnectContainerToNetwork(ctx context.Context, networkID, containerID string, opts NetworkAttachOptions) error {
	if err := p.cli.NetworkConnect(ctx, networkID, containerID, endpointSettings(opts)); err != nil {
		return fmt.Errorf("docker: connect %s to network: %w", shortRef(containerID), mapNetworkErr(err))
	}
	return nil
}

// DisconnectContainerFromNetwork detaches a container from a network. force
// also detaches a container the daemon considers gone (stale endpoint).
func (p *DockerProvider) DisconnectContainerFromNetwork(ctx context.Context, networkID, containerID string, force bool) error {
	if err := p.cli.NetworkDisconnect(ctx, networkID, containerID, force); err != nil {
		return fmt.Errorf("docker: disconnect %s from network: %w", shortRef(containerID), mapNetworkErr(err))
	}
	return nil
}

// endpointSettings builds the daemon endpoint config for one attachment. The
// IPAM block is only sent when a static address was requested: an empty one
// makes the daemon reject the connect on networks without a user subnet.
func endpointSettings(opts NetworkAttachOptions) *network.EndpointSettings {
	cfg := &network.EndpointSettings{Aliases: opts.Aliases}
	if opts.IPv4 != "" || opts.IPv6 != "" {
		cfg.IPAMConfig = &network.EndpointIPAMConfig{IPv4Address: opts.IPv4, IPv6Address: opts.IPv6}
	}
	return cfg
}

// networkCreateOptions maps a NetworkSpec onto the daemon create request.
// EnableIPv6 is left unset (daemon default) unless requested, and an IPAM block
// is only sent when the spec carries one, so the daemon keeps picking subnets
// from its default pools otherwise.
func networkCreateOptions(spec NetworkSpec) network.CreateOptions {
	driver := spec.Driver
	if driver == "" {
		driver = "bridge"
	}
	opts := network.CreateOptions{
		Driver:     driver,
		Internal:   spec.Internal,
		Attachable: spec.Attachable,
		Options:    spec.Options,
		Labels:     spec.Labels,
	}
	if spec.EnableIPv6 {
		enabled := true
		opts.EnableIPv6 = &enabled
	}
	if spec.IPAM != nil && (spec.IPAM.Driver != "" || len(spec.IPAM.Config) > 0) {
		ipam := &network.IPAM{Driver: spec.IPAM.Driver}
		if ipam.Driver == "" {
			ipam.Driver = "default"
		}
		for _, c := range spec.IPAM.Config {
			if c.Subnet == "" && c.Gateway == "" && c.IPRange == "" && len(c.AuxAddresses) == 0 {
				continue
			}
			ipam.Config = append(ipam.Config, network.IPAMConfig{
				Subnet:     c.Subnet,
				IPRange:    c.IPRange,
				Gateway:    c.Gateway,
				AuxAddress: c.AuxAddresses,
			})
		}
		opts.IPAM = ipam
	}
	return opts
}

// mapNetworkInfo converts a daemon network summary/inspect into NetworkInfo.
func mapNetworkInfo(n *network.Inspect) NetworkInfo {
	return NetworkInfo{
		ID:         n.ID,
		Name:       n.Name,
		Driver:     n.Driver,
		Scope:      n.Scope,
		Internal:   n.Internal,
		Attachable: n.Attachable,
		EnableIPv6: n.EnableIPv6,
		Created:    n.Created.UTC(),
		Subnets:    ipamSubnets(n.IPAM.Config),
		Options:    nonNilOptions(n.Options),
		Labels:     n.Labels,
	}
}

// nonNilOptions returns opts, or an empty map when nil, so the JSON is always
// an object.
func nonNilOptions(opts map[string]string) map[string]string {
	if opts == nil {
		return map[string]string{}
	}
	return opts
}

// mapNetworkDetail converts a daemon network inspect into NetworkDetail. The
// daemon only lists live endpoints, so each comes with Running=true; they are
// sorted by container name so the view is stable across polls.
func mapNetworkDetail(n *network.Inspect) *NetworkDetail {
	d := &NetworkDetail{
		NetworkInfo: mapNetworkInfo(n),
		IPAM:        IPAMSpec{Driver: n.IPAM.Driver, Config: make([]IPAMConfig, 0, len(n.IPAM.Config))},
		Containers:  make([]NetworkEndpoint, 0, len(n.Containers)),
	}
	for _, c := range n.IPAM.Config {
		d.IPAM.Config = append(d.IPAM.Config, IPAMConfig{
			Subnet:       c.Subnet,
			Gateway:      c.Gateway,
			IPRange:      c.IPRange,
			AuxAddresses: c.AuxAddress,
		})
	}
	for id, ep := range n.Containers {
		d.Containers = append(d.Containers, NetworkEndpoint{
			ContainerID: id,
			Name:        ep.Name,
			IPv4:        stripCIDR(ep.IPv4Address),
			IPv6:        stripCIDR(ep.IPv6Address),
			MAC:         ep.MacAddress,
			Running:     true,
			State:       string(provider.StateRunning),
		})
	}
	sort.Slice(d.Containers, func(i, j int) bool {
		if d.Containers[i].Name != d.Containers[j].Name {
			return d.Containers[i].Name < d.Containers[j].Name
		}
		return d.Containers[i].ContainerID < d.Containers[j].ContainerID
	})
	return d
}

// ipamSubnets flattens the IPAM pools to their subnets (never nil, so the JSON
// is an array).
func ipamSubnets(cfg []network.IPAMConfig) []string {
	out := make([]string, 0, len(cfg))
	for _, c := range cfg {
		if c.Subnet != "" {
			out = append(out, c.Subnet)
		}
	}
	return out
}

// stripCIDR drops the prefix length from an address the daemon reports in CIDR
// form ("10.0.0.5/24" -> "10.0.0.5").
func stripCIDR(addr string) string {
	if i := strings.IndexByte(addr, '/'); i >= 0 {
		return addr[:i]
	}
	return addr
}

// mapNetworkErr translates a daemon error from a network create/inspect/remove
// or connect/disconnect into the matching provider sentinel, so the API answers
// with a precise 404/409/422 instead of a generic 500. Phrasings the daemon
// uses for network failures are matched first; anything else goes through
// mapResourceErr (not-found / in-use / passthrough).
func mapNetworkErr(err error) error {
	if err == nil {
		return nil
	}
	if mapped := matchNetworkErr(err); mapped != nil {
		return mapped
	}
	return mapResourceErr(err)
}

// matchNetworkErr returns the sentinel for a daemon network phrasing, or nil
// when err is not a recognized network failure. Shared by the network and the
// deploy error mappers.
func matchNetworkErr(err error) error {
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "network with name") && strings.Contains(msg, "already exists"):
		return provider.ErrNetworkExists
	case strings.Contains(msg, "endpoint with name") && strings.Contains(msg, "already exists"):
		return provider.ErrAlreadyConnected
	case strings.Contains(msg, "is not connected to network") ||
		strings.Contains(msg, "is not connected to the network"):
		return provider.ErrNotConnected
	case strings.Contains(msg, "network-scoped alias is supported only"):
		return provider.ErrAliasUnsupported
	case strings.Contains(msg, "user specified ip address is supported") ||
		strings.Contains(msg, "only on user defined"):
		return provider.ErrStaticIPUnsupported
	case strings.Contains(msg, "no available ipv4 address") ||
		strings.Contains(msg, "no available ipv6 address"):
		return provider.ErrIPPoolExhausted
	case strings.Contains(msg, "cannot join any other network"):
		// "container sharing network namespace with another container or host
		// cannot join any other network": host/none/container network mode.
		return fmt.Errorf("%w: %s", provider.ErrInvalidNetworkConfig, provider.MsgNetworkModeUnjoinable)
	case strings.Contains(msg, "pool overlaps") ||
		strings.Contains(msg, "invalid pool request") ||
		(strings.Contains(msg, "network") && strings.Contains(msg, "overlap")):
		return provider.ErrSubnetOverlap
	case strings.Contains(msg, "address already in use") ||
		(strings.Contains(msg, "ip address") && strings.Contains(msg, "already in use")):
		return provider.ErrIPInUse
	case strings.Contains(msg, "has active endpoints"):
		return provider.ErrNetworkInUse
	case strings.Contains(msg, "invalid subnet") ||
		strings.Contains(msg, "invalid cidr") ||
		strings.Contains(msg, "invalid gateway") ||
		strings.Contains(msg, "invalid ip-range") ||
		strings.Contains(msg, "invalid auxiliary address") ||
		strings.Contains(msg, "invalid network config") ||
		strings.Contains(msg, "invalid ipv4 address") ||
		strings.Contains(msg, "invalid ipv6 address") ||
		strings.Contains(msg, "no configured subnet or ip-range contain"):
		return fmt.Errorf("%w: %s", provider.ErrInvalidNetworkConfig, cleanDaemonMsg(err.Error()))
	}
	return nil
}

// cleanDaemonMsg strips the "Error response from daemon: " prefix and folds
// the multi-line validation output onto one line for a user-facing message.
func cleanDaemonMsg(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "Error response from daemon: ")
	return strings.Join(strings.Fields(s), " ")
}
