package docker

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"

	"github.com/gtek-it/castor/server/internal/provider"
)

// recreateStopSecs is the graceful stop window (seconds) before a recreate.
const recreateStopSecs = 10

// rollbackTimeout bounds the best-effort rollback independently of the
// recreate budget: by the time a rollback runs, the caller's deadline may
// already be spent (a slow pull can eat all of it).
const rollbackTimeout = 2 * time.Minute

// ContainerImageIdentity returns a container's configured image reference and
// the RepoDigests of the image it currently runs. Input for the update checker.
func (p *DockerProvider) ContainerImageIdentity(ctx context.Context, id string) (string, []string, error) {
	cj, err := p.cli.ContainerInspect(ctx, id)
	if err != nil {
		return "", nil, mapNotFound(err)
	}
	if cj.Config == nil || cj.Config.Image == "" {
		return "", nil, fmt.Errorf("docker: container %s has no image reference", shortRef(id))
	}
	img, err := p.cli.ImageInspect(ctx, cj.Image)
	if err != nil {
		return "", nil, mapNotFound(err)
	}
	return cj.Config.Image, img.RepoDigests, nil
}

// RecreateWithImage re-creates a container on the newest image for its
// original reference: pull (re-resolves the tag) -> stop (10s grace) -> rename
// the old container aside -> create a new one with the SAME Config/HostConfig/
// NetworkingConfig and the original name -> start -> remove the old one. Every
// volume attached to the old container — anonymous ones included — is
// re-attached to the new one (see preserveAnonymousVolumes). If the new
// container fails to create or start, the old one is renamed back and
// restarted when it was running (rollback), and the error is returned.
// Protected containers (io.castor.protected=true label or Castor itself) are
// refused with an error wrapping provider.ErrForbidden. Returns the new id.
func (p *DockerProvider) RecreateWithImage(ctx context.Context, id string) (string, error) {
	cj, err := p.cli.ContainerInspect(ctx, id)
	if err != nil {
		return "", mapNotFound(err)
	}
	var labels map[string]string
	if cj.Config != nil {
		labels = cj.Config.Labels
	}
	if p.isProtected(cj.ID, labels) {
		return "", fmt.Errorf("%w: container is protected and cannot be recreated", provider.ErrForbidden)
	}
	if cj.Config == nil || cj.Config.Image == "" {
		return "", fmt.Errorf("docker: recreate %s: container has no image reference", shortRef(id))
	}
	ref := cj.Config.Image

	// Pull the ORIGINAL reference so the tag re-resolves to the newest digest.
	// Drain to EOF: the image must be on disk before the old container stops.
	rc, err := p.cli.ImagePull(ctx, ref, image.PullOptions{})
	if err != nil {
		return "", fmt.Errorf("docker: recreate: pull %q: %w", ref, err)
	}
	_, cpErr := io.Copy(io.Discard, rc)
	_ = rc.Close()
	if cpErr != nil {
		return "", fmt.Errorf("docker: recreate: pull %q: %w", ref, cpErr)
	}

	wasRunning := cj.State != nil && cj.State.Running
	stopSecs := recreateStopSecs
	if err := p.cli.ContainerStop(ctx, cj.ID, container.StopOptions{Timeout: &stopSecs}); err != nil {
		return "", mapNotFound(err)
	}

	name := strings.TrimPrefix(cj.Name, "/")
	oldName := fmt.Sprintf("%s-old-%d", name, time.Now().Unix())
	if err := p.cli.ContainerRename(ctx, cj.ID, oldName); err != nil {
		// Nothing replaced yet: restore the previous run state and bail.
		if wasRunning {
			_ = p.cli.ContainerStart(ctx, cj.ID, container.StartOptions{})
		}
		return "", fmt.Errorf("docker: recreate: rename: %w", err)
	}

	var netCfg *network.NetworkingConfig
	if cj.NetworkSettings != nil && len(cj.NetworkSettings.Networks) > 0 {
		netCfg = &network.NetworkingConfig{EndpointsConfig: cj.NetworkSettings.Networks}
	}
	hostCfg := cj.HostConfig
	if extra := preserveAnonymousVolumes(hostCfg, cj.Mounts); len(extra) > 0 {
		// Work on a copy: the inspect response must stay pristine for rollback.
		var hc container.HostConfig
		if hostCfg != nil {
			hc = *hostCfg
		}
		hc.Mounts = append(append([]mount.Mount(nil), hc.Mounts...), extra...)
		hostCfg = &hc
	}
	created, err := p.cli.ContainerCreate(ctx, cj.Config, hostCfg, netCfg, nil, name)
	if err != nil {
		p.rollbackRecreate(ctx, cj.ID, name, wasRunning)
		return "", fmt.Errorf("docker: recreate: create: %w", err)
	}
	if err := p.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		_ = p.cli.ContainerRemove(ctx, created.ID, container.RemoveOptions{Force: true})
		p.rollbackRecreate(ctx, cj.ID, name, wasRunning)
		return "", fmt.Errorf("docker: recreate: start: %w", err)
	}
	// RemoveVolumes must stay false: the new container references the old
	// one's anonymous volumes by name.
	_ = p.cli.ContainerRemove(ctx, cj.ID, container.RemoveOptions{Force: true})
	return created.ID, nil
}

// preserveAnonymousVolumes returns the volume mounts to add to the new
// container's HostConfig so every volume of the old container stays attached
// across a recreate. Anonymous volumes are the constraint: they exist ONLY in
// the inspect's Mounts list — Config.Volumes merely declares a destination,
// and creating from it makes the daemon provision a fresh empty volume under
// a new random name, silently orphaning the data (fatal for databases).
func preserveAnonymousVolumes(hc *container.HostConfig, mountPoints []container.MountPoint) []mount.Mount {
	covered := make(map[string]bool)
	if hc != nil {
		for _, b := range hc.Binds {
			if dst := bindDestination(b); dst != "" {
				covered[dst] = true
			}
		}
		for _, m := range hc.Mounts {
			covered[m.Target] = true
		}
	}
	var out []mount.Mount
	for _, mp := range mountPoints {
		if mp.Type != mount.TypeVolume || mp.Name == "" || covered[mp.Destination] {
			continue
		}
		out = append(out, mount.Mount{
			Type:     mount.TypeVolume,
			Source:   mp.Name,
			Target:   mp.Destination,
			ReadOnly: !mp.RW,
		})
	}
	return out
}

// bindDestination extracts the container-side path from a HostConfig.Binds
// entry ("src:dst[:opts]"). The separator is also the Windows drive-letter
// colon ("C:\src:C:\dst:ro"), so drive segments are re-joined before picking
// the second field.
func bindDestination(spec string) string {
	parts := strings.Split(spec, ":")
	fields := make([]string, 0, len(parts))
	for i := 0; i < len(parts); i++ {
		f := parts[i]
		if len(f) == 1 && isDriveLetter(f[0]) && i+1 < len(parts) && parts[i+1] != "" &&
			(parts[i+1][0] == '\\' || parts[i+1][0] == '/') {
			f = f + ":" + parts[i+1]
			i++
		}
		fields = append(fields, f)
	}
	if len(fields) >= 2 {
		return fields[1]
	}
	return ""
}

// rollbackRecreate renames the old container back to its original name and
// restarts it when it was running before the attempt. Best-effort by design:
// the primary error is the one reported to the caller. The caller's context is
// frequently already expired or canceled by the time a rollback is needed, so
// the rollback detaches from its deadline and runs on its own clock.
func (p *DockerProvider) rollbackRecreate(ctx context.Context, oldID, name string, wasRunning bool) {
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), rollbackTimeout)
	defer cancel()
	_ = p.cli.ContainerRename(rctx, oldID, name)
	if wasRunning {
		_ = p.cli.ContainerStart(rctx, oldID, container.StartOptions{})
	}
}

// shortRef truncates an id for error messages.
func shortRef(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
