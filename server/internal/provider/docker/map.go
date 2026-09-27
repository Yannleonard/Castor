package docker

import (
	"sort"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"

	"github.com/gtek-it/castor/server/internal/provider"
)

// composeProjectLabel is the label compose stamps for stack grouping.
const composeProjectLabel = "com.docker.compose.project"

// castorProtectedLabel marks a container as protected from destructive actions.
const castorProtectedLabel = "io.castor.protected"

// mapContainer converts a container.Summary (from ContainerList) into a Workload.
func (p *DockerProvider) mapContainer(s *container.Summary) provider.Workload {
	name := ""
	if len(s.Names) > 0 {
		name = strings.TrimPrefix(s.Names[0], "/")
	}
	wl := provider.Workload{
		ID:         s.ID,
		Name:       name,
		Kind:       provider.KindDocker,
		ProviderID: p.id,
		Node:       p.daemonHost,
		State:      normalizeState(s.State),
		StateRaw:   s.Status,
		Image:      s.Image,
		Ports:      mapSummaryPorts(s.Ports),
		Labels:     s.Labels,
		CreatedAt:  time.Unix(s.Created, 0).UTC(),
		Group:      s.Labels[composeProjectLabel],
		Protected:  p.isProtected(s.ID, s.Labels),
	}
	if s.NetworkSettings != nil {
		wl.NetworkNames, wl.IPAddress = summarizeNetworks(s.NetworkSettings.Networks)
	}
	return wl
}

// mapInspect converts a full InspectResponse (from ContainerInspect) into a Workload.
func (p *DockerProvider) mapInspect(cj *container.InspectResponse) provider.Workload {
	var labels map[string]string
	var image string
	if cj.Config != nil {
		labels = cj.Config.Labels
		image = cj.Config.Image
	}
	name := strings.TrimPrefix(cj.Name, "/")
	created := time.Time{}
	if t, err := time.Parse(time.RFC3339Nano, cj.Created); err == nil {
		created = t.UTC()
	}
	state := provider.StateUnknown
	stateRaw := ""
	if cj.State != nil {
		state = normalizeState(cj.State.Status)
		stateRaw = cj.State.Status
		if cj.State.Health != nil && cj.State.Health.Status != "" {
			stateRaw = cj.State.Status + " (" + cj.State.Health.Status + ")"
		}
	}
	wl := provider.Workload{
		ID:         cj.ID,
		Name:       name,
		Kind:       provider.KindDocker,
		ProviderID: p.id,
		Node:       p.daemonHost,
		State:      state,
		StateRaw:   stateRaw,
		Image:      image,
		Ports:      mapInspectPorts(cj),
		Labels:     labels,
		CreatedAt:  created,
		Group:      labels[composeProjectLabel],
		Protected:  p.isProtected(cj.ID, labels),
	}
	if cj.NetworkSettings != nil {
		wl.NetworkNames, wl.IPAddress = summarizeNetworks(cj.NetworkSettings.Networks)
		wl.Networks = mapInspectNetworks(cj.NetworkSettings.Networks)
	}
	return wl
}

// summarizeNetworks returns the sorted names of the networks a container is on
// and the first IPv4 it holds in that order (empty when it has none).
func summarizeNetworks(nets map[string]*network.EndpointSettings) ([]string, string) {
	if len(nets) == 0 {
		return nil, ""
	}
	names := sortedNetworkNames(nets)
	for _, name := range names {
		if ip := endpointIPv4(nets[name]); ip != "" {
			return names, ip
		}
	}
	return names, ""
}

// mapInspectNetworks converts a container's per-network endpoint settings into
// the normalized attachment list, sorted by network name.
func mapInspectNetworks(nets map[string]*network.EndpointSettings) []provider.WorkloadNetwork {
	if len(nets) == 0 {
		return nil
	}
	names := sortedNetworkNames(nets)
	out := make([]provider.WorkloadNetwork, 0, len(names))
	for _, name := range names {
		ep := nets[name]
		wn := provider.WorkloadNetwork{Name: name, IPv4: endpointIPv4(ep)}
		if ep != nil {
			wn.NetworkID = ep.NetworkID
			wn.IPv6 = ep.GlobalIPv6Address
			wn.Gateway = ep.Gateway
			wn.MAC = ep.MacAddress
			wn.Aliases = ep.Aliases
			if wn.IPv6 == "" && ep.IPAMConfig != nil {
				wn.IPv6 = ep.IPAMConfig.IPv6Address
			}
		}
		out = append(out, wn)
	}
	return out
}

// sortedNetworkNames returns the map's keys in sorted order.
func sortedNetworkNames(nets map[string]*network.EndpointSettings) []string {
	names := make([]string, 0, len(nets))
	for name := range nets {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// endpointIPv4 returns the address an endpoint currently holds, falling back to
// the static address it was configured with (a stopped container has no live
// address but still shows what it will get on start).
func endpointIPv4(ep *network.EndpointSettings) string {
	if ep == nil {
		return ""
	}
	if ep.IPAddress != "" {
		return ep.IPAddress
	}
	if ep.IPAMConfig != nil {
		return ep.IPAMConfig.IPv4Address
	}
	return ""
}

// isProtected reports whether a container is Castor's own or carries the
// protected label.
func (p *DockerProvider) isProtected(id string, labels map[string]string) bool {
	if p.selfContainerID != "" {
		if id == p.selfContainerID ||
			(len(id) >= 12 && len(p.selfContainerID) >= 12 &&
				(strings.HasPrefix(id, p.selfContainerID) || strings.HasPrefix(p.selfContainerID, id))) {
			return true
		}
	}
	if labels != nil {
		if v, ok := labels[castorProtectedLabel]; ok && strings.EqualFold(strings.TrimSpace(v), "true") {
			return true
		}
	}
	return false
}

// normalizeState maps a Docker container state string to a WorkloadState.
func normalizeState(s string) provider.WorkloadState {
	switch strings.ToLower(s) {
	case "running":
		return provider.StateRunning
	case "exited", "dead", "created":
		return provider.StateStopped
	case "paused":
		return provider.StatePaused
	case "restarting":
		return provider.StateRestarting
	case "removing":
		return provider.StatePending
	default:
		return provider.StateUnknown
	}
}

// mapSummaryPorts converts ContainerList ports to normalized Ports.
func mapSummaryPorts(ports []container.Port) []provider.Port {
	if len(ports) == 0 {
		return nil
	}
	out := make([]provider.Port, 0, len(ports))
	for _, pt := range ports {
		out = append(out, provider.Port{
			Private:  pt.PrivatePort,
			Public:   pt.PublicPort,
			Protocol: pt.Type,
		})
	}
	return out
}

// mapInspectPorts derives normalized ports from an InspectResponse's NetworkSettings.
func mapInspectPorts(cj *container.InspectResponse) []provider.Port {
	if cj.NetworkSettings == nil || len(cj.NetworkSettings.Ports) == 0 {
		return nil
	}
	var out []provider.Port
	for portProto, bindings := range cj.NetworkSettings.Ports {
		priv := uint16(portProto.Int())
		proto := portProto.Proto()
		if len(bindings) == 0 {
			out = append(out, provider.Port{Private: priv, Protocol: proto})
			continue
		}
		for _, b := range bindings {
			out = append(out, provider.Port{
				Private:  priv,
				Public:   parsePort(b.HostPort),
				Protocol: proto,
			})
		}
	}
	return out
}

func parsePort(s string) uint16 {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
		if n > 65535 {
			return 0
		}
	}
	return uint16(n)
}
