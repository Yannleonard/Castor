package docker

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/network"

	"github.com/gtek-it/castor/server/internal/provider"
)

// Labels a stack's networks carry (the compose package stamps the same on the
// stack's containers): the compose project, Castor's own stack marker (both
// set to the project name) and the managed marker.
const (
	labelComposeProject = "com.docker.compose.project"
	labelCastorStack    = "io.castor.stack"
	labelCastorManaged  = "io.castor.managed"
)

// StackContainer is a normalized view of a container belonging to a compose
// stack, enumerated by the compose project label. It carries just what the
// teardown path needs (id + name + service).
type StackContainer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Service string `json:"service"`
	State   string `json:"state"`
}

// NetworkNotOwnedError is returned when a stack network's name is taken by a
// network that does not belong to the stack (neither io.castor.stack nor
// com.docker.compose.project names the project): it is neither adopted nor
// removed. It wraps provider.ErrNetworkExists (HTTP 409).
type NetworkNotOwnedError struct {
	Name    string
	Project string
}

func (e *NetworkNotOwnedError) Error() string {
	return fmt.Sprintf("network name %q is taken by a network not managed by this stack", e.Name)
}

// Unwrap makes errors.Is(err, provider.ErrNetworkExists) true.
func (e *NetworkNotOwnedError) Unwrap() error { return provider.ErrNetworkExists }

// stackNetworkLabels returns the labels stamped on a network created for
// project, the ones EnsureProjectNetworkWithSpec adopts by and
// RemoveProjectNetworks removes by.
func stackNetworkLabels(project string) map[string]string {
	return map[string]string{
		labelComposeProject: project,
		labelCastorStack:    project,
		labelCastorManaged:  "true",
	}
}

// EnsureProjectNetworkWithSpec creates the network name for a compose project
// from its declared settings (driver, internal, IPv6, driver options and IPAM
// pools; a nil spec is a plain bridge) and returns its id. spec.Name is
// ignored in favor of name, the project's labels (stackNetworkLabels) override
// spec.Labels, and the network is always attachable because Castor joins the
// stack's containers to it explicitly. Idempotent for the project's own
// networks: an existing network is adopted when AdoptStackNetwork accepts it,
// and refused otherwise (a foreign network is never adopted, so it is never
// torn down with the stack, and a declared subnet the existing network lacks
// is reported before a static address fails at connect).
func (p *DockerProvider) EnsureProjectNetworkWithSpec(ctx context.Context, project, name string, spec *NetworkSpec) (string, error) {
	if name == "" {
		return "", fmt.Errorf("docker: network name is required")
	}
	if project == "" {
		return "", fmt.Errorf("docker: project name is required")
	}
	// Fast path: already present.
	if existing, err := p.cli.NetworkInspect(ctx, name, network.InspectOptions{}); err == nil {
		return p.adoptNetwork(&existing, project, spec)
	}
	var ns NetworkSpec
	if spec != nil {
		ns = *spec
	}
	ns.Name = name
	ns.Attachable = true
	ns.Labels = mergeLabels(ns.Labels, stackNetworkLabels(project))
	resp, err := p.cli.NetworkCreate(ctx, name, networkCreateOptions(ns))
	if err != nil {
		// Race / pre-existing: fall back to inspect, under the same adoption rule.
		if existing, ierr := p.cli.NetworkInspect(ctx, name, network.InspectOptions{}); ierr == nil {
			return p.adoptNetwork(&existing, project, spec)
		}
		return "", fmt.Errorf("docker: create network %q: %w", name, mapNetworkErr(err))
	}
	return resp.ID, nil
}

// mergeLabels returns base overlaid with over (over wins), or nil when both
// are empty. Neither input is mutated.
func mergeLabels(base, over map[string]string) map[string]string {
	if len(base) == 0 && len(over) == 0 {
		return nil
	}
	out := make(map[string]string, len(base)+len(over))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range over {
		out[k] = v
	}
	return out
}

// adoptNetwork returns the id of an existing network AdoptStackNetwork accepts
// for the project, or its refusal.
func (p *DockerProvider) adoptNetwork(existing *network.Inspect, project string, spec *NetworkSpec) (string, error) {
	info := mapNetworkInfo(existing)
	if err := AdoptStackNetwork(info, project, spec); err != nil {
		return "", err
	}
	return info.ID, nil
}

// AdoptStackNetwork decides whether an existing network may stand in for the
// network spec declares for a compose project. It must belong to the project,
// that is carry io.castor.stack or com.docker.compose.project set to it,
// otherwise a *NetworkNotOwnedError (409) is returned; and every subnet the
// spec declares must be one of its pools, otherwise ErrInvalidNetworkConfig
// (422) names both sides. Other settings (driver, internal, options) are not
// reconciled. A nil spec, or one without subnets, only needs the label.
func AdoptStackNetwork(existing NetworkInfo, project string, spec *NetworkSpec) error {
	if existing.Labels[labelCastorStack] != project && existing.Labels[labelComposeProject] != project {
		return &NetworkNotOwnedError{Name: existing.Name, Project: project}
	}
	if spec == nil || spec.IPAM == nil {
		return nil
	}
	have := make(map[string]struct{}, len(existing.Subnets))
	for _, s := range existing.Subnets {
		have[canonicalCIDR(s)] = struct{}{}
	}
	for _, c := range spec.IPAM.Config {
		if c.Subnet == "" {
			continue
		}
		if _, ok := have[canonicalCIDR(c.Subnet)]; ok {
			continue
		}
		existingSubnets := "no subnet"
		if len(existing.Subnets) > 0 {
			sorted := append([]string(nil), existing.Subnets...)
			sort.Strings(sorted)
			existingSubnets = "subnet " + strings.Join(sorted, ", ")
		}
		return fmt.Errorf("%w: network %q already exists with %s, but the compose file declares subnet %s; remove the network or align the declaration",
			provider.ErrInvalidNetworkConfig, existing.Name, existingSubnets, c.Subnet)
	}
	return nil
}

// canonicalCIDR normalizes a CIDR to its network form ("10.0.0.5/24" ->
// "10.0.0.0/24") so two spellings of one pool compare equal; an unparsable
// value is returned trimmed.
func canonicalCIDR(s string) string {
	s = strings.TrimSpace(s)
	if _, ipnet, err := net.ParseCIDR(s); err == nil {
		return ipnet.String()
	}
	return s
}

// ListProjectContainers lists all containers (running or stopped) labelled with
// the given compose project, newest-first as the daemon returns them.
func (p *DockerProvider) ListProjectContainers(ctx context.Context, project string) ([]StackContainer, error) {
	f := filters.NewArgs()
	f.Add("label", labelComposeProject+"="+project)
	summaries, err := p.cli.ContainerList(ctx, container.ListOptions{All: true, Filters: f})
	if err != nil {
		return nil, fmt.Errorf("docker: list project containers: %w", err)
	}
	out := make([]StackContainer, 0, len(summaries))
	for i := range summaries {
		s := &summaries[i]
		name := ""
		if len(s.Names) > 0 {
			name = s.Names[0]
			if len(name) > 0 && name[0] == '/' {
				name = name[1:]
			}
		}
		out = append(out, StackContainer{
			ID:      s.ID,
			Name:    name,
			Service: s.Labels["com.docker.compose.service"],
			State:   s.State,
		})
	}
	return out, nil
}

// ListProjectNetworks lists the networks Castor created for a compose
// project, by the io.castor.stack label, whatever their names. An external
// network the stack only joins never carries it, nor does a foreign network
// EnsureProjectNetworkWithSpec refused to adopt.
func (p *DockerProvider) ListProjectNetworks(ctx context.Context, project string) ([]NetworkInfo, error) {
	f := filters.NewArgs()
	f.Add("label", labelCastorStack+"="+project)
	nets, err := p.cli.NetworkList(ctx, network.ListOptions{Filters: f})
	if err != nil {
		return nil, fmt.Errorf("docker: list project networks: %w", err)
	}
	out := make([]NetworkInfo, 0, len(nets))
	for i := range nets {
		out = append(out, mapNetworkInfo(&nets[i]))
	}
	return out, nil
}

// RemoveProjectNetworks removes every network ListProjectNetworks returns for
// the project. Each removal is attempted; a network that cannot be removed
// (still in use by a container outside the stack) is reported in the joined
// error while the others are still removed. A not-found network is treated as
// already gone.
func (p *DockerProvider) RemoveProjectNetworks(ctx context.Context, project string) error {
	nets, err := p.ListProjectNetworks(ctx, project)
	if err != nil {
		return err
	}
	var errs []error
	for _, n := range nets {
		if rerr := p.cli.NetworkRemove(ctx, n.ID); rerr != nil && mapNotFound(rerr) != nil {
			errs = append(errs, fmt.Errorf("docker: remove network %q: %w", n.Name, mapNetworkErr(rerr)))
		}
	}
	return errors.Join(errs...)
}

// StopAndRemoveContainer stops (if running) and force-removes a container by id,
// also removing its anonymous volumes. Used by the stack teardown path. A
// not-found container is treated as already gone (nil error).
func (p *DockerProvider) StopAndRemoveContainer(ctx context.Context, id string) error {
	// Best-effort stop; ignore "not running" / "not found".
	_ = p.cli.ContainerStop(ctx, id, container.StopOptions{})
	if err := p.cli.ContainerRemove(ctx, id, container.RemoveOptions{Force: true, RemoveVolumes: true}); err != nil {
		if mapNotFound(err) == nil {
			return nil
		}
		return mapResourceErr(err)
	}
	return nil
}
