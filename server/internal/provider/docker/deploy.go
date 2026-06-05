package docker

import (
	"context"
	"fmt"
	"io"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/go-connections/nat"
)

// PortMap is a single host:container port publication for a DeploySpec.
// Proto is "tcp" or "udp" (defaults to "tcp" when empty). Host==0 lets the
// daemon pick an ephemeral host port.
type PortMap struct {
	Host      int    `json:"host"`
	Container int    `json:"container"`
	Proto     string `json:"proto"`
}

// VolMount is a single volume/bind mount for a DeploySpec. Source is a named
// volume (for a managed volume) or an absolute host path (for a bind); Target
// is the absolute in-container path.
type VolMount struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// DeploySpec is the normalized, SDK-agnostic description of a single container
// to create+start. It is the SHARED input type used by both the one-click
// template deploy (templates.go) and the compose stack deploy: any feature that
// needs to launch a container builds a DeploySpec and calls
// ContainerCreateAndStart. Defined ONCE here.
type DeploySpec struct {
	Image         string            `json:"image"`
	Name          string            `json:"name"`
	Env           map[string]string `json:"env"`
	Ports         []PortMap         `json:"ports"`
	Volumes       []VolMount        `json:"volumes"`
	Labels        map[string]string `json:"labels"`
	RestartPolicy string            `json:"restartPolicy"` // ""|no|always|on-failure|unless-stopped

	// Resource limits/reservations (all optional; <=0 means "unset"). These map
	// to the same knobs as `docker run --cpus/--memory/...`:
	//   CpuLimit               -> HostConfig.NanoCPUs (cores; e.g. 1.5 == 1.5 CPUs)
	//   MemoryLimitBytes       -> HostConfig.Memory (hard limit, bytes)
	//   CpuReservation         -> HostConfig.CPUShares (relative weight; Docker has
	//                             no hard CPU floor — see ContainerCreateAndStart)
	//   MemoryReservationBytes -> HostConfig.MemoryReservation (soft limit, bytes)
	CpuLimit               float64 `json:"cpuLimit"`
	MemoryLimitBytes       int64   `json:"memoryLimitBytes"`
	CpuReservation         float64 `json:"cpuReservation"`
	MemoryReservationBytes int64   `json:"memoryReservationBytes"`

	// AllowHostMounts relaxes the default host-bind-mount rejection (see
	// ValidateMounts / mounts.go). It is an ADMIN-ONLY escape hatch: the API
	// handlers set it true ONLY for a caller holding global superuser, and even
	// then the always-blocked host paths (docker.sock, /, /etc, ...) stay denied.
	// It is intentionally NOT a JSON field — the wire request carries its own
	// admin-gated flag and the handler maps it here, so an untrusted body can
	// never set it directly.
	AllowHostMounts bool `json:"-"`
}

// ContainerCreateAndStart pulls the image if it is absent, creates the
// container from the spec, and starts it. It returns the new container id.
// Mutating call — callers must already have passed RBAC + guard checks.
func (p *DockerProvider) ContainerCreateAndStart(ctx context.Context, spec DeploySpec) (string, error) {
	if spec.Image == "" {
		return "", fmt.Errorf("docker: deploy: image is required")
	}
	// Host-mount escalation guard (defense-in-depth). The API handlers already
	// run this with the actor's privilege, but enforce it here too so NO code
	// path can create a container with a forbidden host bind mount. Returns an
	// error wrapping provider.ErrForbidden (mapped to 403) on violation.
	if err := ValidateMounts(spec.Volumes, spec.AllowHostMounts); err != nil {
		return "", err
	}
	if err := p.ensureImage(ctx, spec.Image); err != nil {
		return "", err
	}

	exposed, bindings, err := buildPortMaps(spec.Ports)
	if err != nil {
		return "", err
	}

	cfg := &container.Config{
		Image:        spec.Image,
		Env:          envSlice(spec.Env),
		ExposedPorts: exposed,
		Labels:       spec.Labels,
	}
	hostCfg := &container.HostConfig{
		PortBindings:  bindings,
		Mounts:        buildMounts(spec.Volumes),
		RestartPolicy: restartPolicy(spec.RestartPolicy),
		Resources:     buildResources(spec),
	}

	created, err := p.cli.ContainerCreate(ctx, cfg, hostCfg, nil, nil, spec.Name)
	if err != nil {
		return "", mapResourceErr(err)
	}
	if err := p.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		// Best-effort cleanup so a failed start does not leak a created container.
		_ = p.cli.ContainerRemove(ctx, created.ID, container.RemoveOptions{Force: true})
		return "", mapNotFound(err)
	}
	return created.ID, nil
}

// ensureImage pulls ref when it is not already present locally. A successful
// local lookup short-circuits the (slow) pull. The pull stream is fully drained
// so the image is on disk before ContainerCreate runs. Existence is checked via
// ImageList with a reference filter (version-stable; mirrors resources.go).
func (p *DockerProvider) ensureImage(ctx context.Context, ref string) error {
	f := filters.NewArgs()
	f.Add("reference", ref)
	if imgs, err := p.cli.ImageList(ctx, image.ListOptions{Filters: f}); err == nil && len(imgs) > 0 {
		return nil
	}
	rc, err := p.cli.ImagePull(ctx, ref, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("docker: pull %q: %w", ref, err)
	}
	defer func() { _ = rc.Close() }()
	// Draining to EOF blocks until the pull completes (or errors mid-stream).
	if _, err := io.Copy(io.Discard, rc); err != nil {
		return fmt.Errorf("docker: pull %q: %w", ref, err)
	}
	return nil
}

// envSlice converts an env map into the "KEY=VALUE" slice the Docker API wants.
func envSlice(env map[string]string) []string {
	if len(env) == 0 {
		return nil
	}
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}

// buildPortMaps turns the spec's PortMaps into the daemon's ExposedPorts set and
// PortBindings map. A zero Host port publishes to an ephemeral host port.
func buildPortMaps(ports []PortMap) (nat.PortSet, nat.PortMap, error) {
	if len(ports) == 0 {
		return nil, nil, nil
	}
	exposed := nat.PortSet{}
	bindings := nat.PortMap{}
	for _, pm := range ports {
		if pm.Container <= 0 {
			continue
		}
		proto := pm.Proto
		if proto == "" {
			proto = "tcp"
		}
		port, err := nat.NewPort(proto, fmt.Sprintf("%d", pm.Container))
		if err != nil {
			return nil, nil, fmt.Errorf("docker: invalid port %d/%s: %w", pm.Container, proto, err)
		}
		exposed[port] = struct{}{}
		hostPort := ""
		if pm.Host > 0 {
			hostPort = fmt.Sprintf("%d", pm.Host)
		}
		bindings[port] = append(bindings[port], nat.PortBinding{HostIP: "", HostPort: hostPort})
	}
	return exposed, bindings, nil
}

// buildMounts converts VolMounts into Docker mount specs. A Source that looks
// like a host path (see isHostPath) is a bind mount; otherwise it is a named
// volume (created on demand by the daemon). Callers MUST have already passed the
// volumes through ValidateMounts (mounts.go) — ContainerCreateAndStart does this
// before reaching here — so any bind that survives to this point is an allowed
// admin host mount.
func buildMounts(vols []VolMount) []mount.Mount {
	if len(vols) == 0 {
		return nil
	}
	out := make([]mount.Mount, 0, len(vols))
	for _, v := range vols {
		if v.Target == "" {
			continue
		}
		m := mount.Mount{Target: v.Target, Source: v.Source}
		if isHostPath(v.Source) {
			m.Type = mount.TypeBind
		} else {
			m.Type = mount.TypeVolume
		}
		out = append(out, m)
	}
	return out
}

// buildResources maps the spec's CPU/memory limits and reservations onto the
// daemon's container.Resources. Only fields with a positive value are set, so an
// all-zero spec produces an empty (no-limit) Resources struct.
//
//   - CpuLimit (cores) -> NanoCPUs = cores * 1e9 (matches `docker run --cpus`).
//   - MemoryLimitBytes -> Memory (hard limit, `--memory`).
//   - MemoryReservationBytes -> MemoryReservation (soft limit, `--memory-reservation`).
//   - CpuReservation: Docker has no hard CPU reservation field; we approximate a
//     relative weight via CPUShares = reservation * 1024 (1 core ~= the default
//     1024 shares). This influences scheduling under contention only — it is NOT
//     a guaranteed floor.
func buildResources(spec DeploySpec) container.Resources {
	var res container.Resources
	if spec.CpuLimit > 0 {
		res.NanoCPUs = int64(spec.CpuLimit * 1e9)
	}
	if spec.MemoryLimitBytes > 0 {
		res.Memory = spec.MemoryLimitBytes
	}
	if spec.MemoryReservationBytes > 0 {
		res.MemoryReservation = spec.MemoryReservationBytes
	}
	if spec.CpuReservation > 0 {
		res.CPUShares = int64(spec.CpuReservation * 1024)
	}
	return res
}

// restartPolicy maps a spec restart-policy string to the daemon enum, defaulting
// to "no" (Disabled) for empty/unknown values.
func restartPolicy(name string) container.RestartPolicy {
	switch container.RestartPolicyMode(name) {
	case container.RestartPolicyAlways,
		container.RestartPolicyOnFailure,
		container.RestartPolicyUnlessStopped:
		return container.RestartPolicy{Name: container.RestartPolicyMode(name)}
	default:
		return container.RestartPolicy{Name: container.RestartPolicyDisabled}
	}
}
