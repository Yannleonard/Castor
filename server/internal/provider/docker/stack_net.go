package docker

import (
	"context"
	"fmt"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/network"
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

// EnsureProjectNetwork creates a user-defined bridge network with the given name
// if it does not already exist, returning its id. The labels are stamped on the
// network so it is recognizable/teardownable as part of the stack. Idempotent:
// an "already exists" condition resolves to the existing network's id.
func (p *DockerProvider) EnsureProjectNetwork(ctx context.Context, name string, labels map[string]string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("docker: network name is required")
	}
	// Fast path: already present.
	if existing, err := p.cli.NetworkInspect(ctx, name, network.InspectOptions{}); err == nil {
		return existing.ID, nil
	}
	resp, err := p.cli.NetworkCreate(ctx, name, network.CreateOptions{
		Driver:     "bridge",
		Attachable: true,
		Labels:     labels,
	})
	if err != nil {
		// Race / pre-existing: fall back to inspect.
		if existing, ierr := p.cli.NetworkInspect(ctx, name, network.InspectOptions{}); ierr == nil {
			return existing.ID, nil
		}
		return "", fmt.Errorf("docker: create network %q: %w", name, err)
	}
	return resp.ID, nil
}

// ConnectToNetwork attaches a container to a network, registering the given DNS
// aliases so other containers on the network can resolve it by service name.
// A nil/empty alias list still connects (no extra aliases).
func (p *DockerProvider) ConnectToNetwork(ctx context.Context, networkID, containerID string, aliases []string) error {
	cfg := &network.EndpointSettings{Aliases: aliases}
	if err := p.cli.NetworkConnect(ctx, networkID, containerID, cfg); err != nil {
		return fmt.Errorf("docker: connect %s to network: %w", containerID, err)
	}
	return nil
}

// ListProjectContainers lists all containers (running or stopped) labelled with
// the given compose project, newest-first as the daemon returns them.
func (p *DockerProvider) ListProjectContainers(ctx context.Context, project string) ([]StackContainer, error) {
	f := filters.NewArgs()
	f.Add("label", "com.docker.compose.project="+project)
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

// RemoveNetworkByName removes a network by name. A not-found network is treated
// as already gone (nil error); an in-use network surfaces as ErrConflict via
// mapResourceErr.
func (p *DockerProvider) RemoveNetworkByName(ctx context.Context, name string) error {
	n, err := p.cli.NetworkInspect(ctx, name, network.InspectOptions{})
	if err != nil {
		// Not found -> nothing to remove.
		return nil
	}
	if err := p.cli.NetworkRemove(ctx, n.ID); err != nil {
		return mapResourceErr(err)
	}
	return nil
}
