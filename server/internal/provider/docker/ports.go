package docker

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/go-connections/nat"

	"github.com/gtek-it/castor/server/internal/provider"
)

// RecreateWithPorts updates exposed and published port bindings. Docker does not
// support changing port bindings on an existing container, so this preserves its
// configuration and volumes while replacing the container. The returned ID is
// different from id.
func (p *DockerProvider) RecreateWithPorts(ctx context.Context, id string, ports []provider.Port) (string, error) {
	cj, err := p.cli.ContainerInspect(ctx, id)
	if err != nil {
		return "", mapNotFound(err)
	}
	if cj.Config == nil || cj.HostConfig == nil {
		return "", fmt.Errorf("docker: container %s has incomplete configuration", shortRef(id))
	}
	if p.isProtected(cj.ID, cj.Config.Labels) {
		return "", fmt.Errorf("%w: container is protected and cannot be recreated", provider.ErrForbidden)
	}
	if strings.EqualFold(cj.HostConfig.NetworkMode.NetworkName(), "host") && len(ports) > 0 {
		return "", fmt.Errorf("docker: published ports cannot be configured with host networking")
	}
	portSet, bindings, err := dockerPortConfig(ports)
	if err != nil {
		return "", err
	}

	cfg := *cj.Config
	cfg.ExposedPorts = portSet
	hostCfgCopy := *cj.HostConfig
	hostCfgCopy.PortBindings = bindings

	wasRunning := cj.State != nil && cj.State.Running
	wasPaused := cj.State != nil && cj.State.Paused
	if wasRunning || wasPaused {
		stopSecs := recreateStopSecs
		if err := p.cli.ContainerStop(ctx, cj.ID, container.StopOptions{Timeout: &stopSecs}); err != nil {
			return "", mapNotFound(err)
		}
	}

	name := strings.TrimPrefix(cj.Name, "/")
	oldName := fmt.Sprintf("%s-old-%d", name, time.Now().UnixNano())
	if err := p.cli.ContainerRename(ctx, cj.ID, oldName); err != nil {
		if wasRunning || wasPaused {
			_ = p.cli.ContainerStart(ctx, cj.ID, container.StartOptions{})
			if wasPaused {
				_ = p.cli.ContainerPause(ctx, cj.ID)
			}
		}
		return "", fmt.Errorf("docker: port update: rename: %w", err)
	}

	var netCfg *network.NetworkingConfig
	if cj.NetworkSettings != nil && len(cj.NetworkSettings.Networks) > 0 {
		netCfg = &network.NetworkingConfig{EndpointsConfig: cj.NetworkSettings.Networks}
	}
	if extra := preserveAnonymousVolumes(&hostCfgCopy, cj.Mounts); len(extra) > 0 {
		hostCfgCopy.Mounts = append(append([]mount.Mount(nil), hostCfgCopy.Mounts...), extra...)
	}
	created, err := p.cli.ContainerCreate(ctx, &cfg, &hostCfgCopy, netCfg, nil, name)
	if err != nil {
		p.rollbackRecreate(ctx, cj.ID, name, wasRunning || wasPaused)
		if wasPaused {
			_ = p.cli.ContainerPause(context.WithoutCancel(ctx), cj.ID)
		}
		return "", fmt.Errorf("docker: port update: create: %w", mapDeployCreateErr(err))
	}
	if wasRunning || wasPaused {
		if err := p.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
			_ = p.cli.ContainerRemove(context.WithoutCancel(ctx), created.ID, container.RemoveOptions{Force: true})
			p.rollbackRecreate(ctx, cj.ID, name, wasRunning || wasPaused)
			if wasPaused {
				_ = p.cli.ContainerPause(context.WithoutCancel(ctx), cj.ID)
			}
			return "", fmt.Errorf("docker: port update: start: %w", mapDeployStartErr(err))
		}
		if wasPaused {
			if err := p.cli.ContainerPause(ctx, created.ID); err != nil {
				_ = p.cli.ContainerRemove(context.WithoutCancel(ctx), created.ID, container.RemoveOptions{Force: true})
				p.rollbackRecreate(ctx, cj.ID, name, true)
				_ = p.cli.ContainerPause(context.WithoutCancel(ctx), cj.ID)
				return "", fmt.Errorf("docker: port update: restore paused state: %w", err)
			}
		}
	}
	// Keep volumes: anonymous volumes are explicitly reattached to the new
	// container and named/bind mounts are part of the preserved HostConfig.
	_ = p.cli.ContainerRemove(context.WithoutCancel(ctx), cj.ID, container.RemoveOptions{Force: true})
	return created.ID, nil
}

func dockerPortConfig(ports []provider.Port) (nat.PortSet, nat.PortMap, error) {
	set := make(nat.PortSet, len(ports))
	bindings := make(nat.PortMap, len(ports))
	seen := make(map[string]struct{}, len(ports))
	for _, port := range ports {
		proto := strings.ToLower(strings.TrimSpace(port.Protocol))
		if port.Private == 0 || (proto != "tcp" && proto != "udp" && proto != "sctp") {
			return nil, nil, fmt.Errorf("docker: invalid port mapping")
		}
		hostIP := strings.TrimSpace(port.HostIP)
		if hostIP != "" && net.ParseIP(hostIP) == nil {
			return nil, nil, fmt.Errorf("docker: host binding address must be an IP address")
		}
		key := fmt.Sprintf("%d/%s", port.Private, proto)
		if port.Public > 0 {
			key += fmt.Sprintf("@%s:%d", hostIP, port.Public)
		}
		if _, exists := seen[key]; exists {
			return nil, nil, fmt.Errorf("docker: duplicate port mapping")
		}
		seen[key] = struct{}{}
		dockerPort := nat.Port(fmt.Sprintf("%d/%s", port.Private, proto))
		set[dockerPort] = struct{}{}
		if port.Public > 0 {
			bindings[dockerPort] = append(bindings[dockerPort], nat.PortBinding{HostIP: hostIP, HostPort: fmt.Sprint(port.Public)})
		}
	}
	return set, bindings, nil
}
