// Package docker implements the FULL read+write Provider for a standalone
// Docker engine, talking to the daemon over the mounted unix socket via the
// official github.com/docker/docker/client. See ADR-CASTOR-002.
package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"

	"github.com/gtek-it/castor/server/internal/provider"
)

// ProviderID is the stable id of the local Docker provider in V1.
const ProviderID = "local-docker"

// DockerProvider is the concrete full read+write Provider backed by the Docker
// Engine API.
type DockerProvider struct {
	cli             *client.Client
	id              string
	selfContainerID string
	// daemonHost is the daemon hostname, used as Workload.Node. Resolved lazily.
	daemonHost string
}

// Compile-time assertion that DockerProvider satisfies the Provider interface.
var _ provider.Provider = (*DockerProvider)(nil)

// Config configures the Docker provider.
type Config struct {
	// SelfContainerID is Castor's own container id (for the Protected flag).
	SelfContainerID string
}

// New constructs a DockerProvider. It uses client.FromEnv (honoring DOCKER_HOST,
// default unix:///var/run/docker.sock) with mandatory API-version negotiation.
func New(ctx context.Context, cfg Config) (*DockerProvider, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("docker: new client: %w", err)
	}
	p := &DockerProvider{cli: cli, id: ProviderID, selfContainerID: cfg.SelfContainerID}
	// Resolve daemon hostname for Node; non-fatal on failure.
	if info, err := cli.Info(ctx); err == nil {
		p.daemonHost = info.Name
	}
	return p, nil
}

// Client exposes the underlying Docker client for sibling read packages (images,
// networks, volumes, swarm) that target the same daemon. Not used by handlers.
func (p *DockerProvider) Client() *client.Client { return p.cli }

// EngineInfo is the normalized host/engine capacity + inventory snapshot derived
// from `docker info`. It powers the Hosts overview (CPU/RAM/OS/engine), giving
// the operator the system-level context Portainer-grade tools show.
type EngineInfo struct {
	EngineVersion   string `json:"engineVersion"`
	APIVersion      string `json:"apiVersion"`
	OS              string `json:"os"`        // e.g. "linux"
	OSType          string `json:"osType"`    // operating system string, e.g. "Docker Desktop"
	OSVersion       string `json:"osVersion"` // e.g. "12 (bookworm)"
	KernelVersion   string `json:"kernelVersion"`
	Architecture    string `json:"architecture"` // e.g. "x86_64"
	NCPU            int    `json:"ncpu"`         // logical CPUs
	MemTotalBytes   int64  `json:"memTotalBytes"`
	Containers      int    `json:"containers"`
	ContainersRun   int    `json:"containersRunning"`
	ContainersPause int    `json:"containersPaused"`
	ContainersStop  int    `json:"containersStopped"`
	Images          int    `json:"images"`
	Name            string `json:"name"` // engine hostname
	SwarmActive     bool   `json:"swarmActive"`
}

// Info returns the engine capacity + inventory via the Docker `info` endpoint.
// It is read periodically by the cache poller (never inline by handlers).
func (p *DockerProvider) Info(ctx context.Context) (*EngineInfo, error) {
	info, err := p.cli.Info(ctx)
	if err != nil {
		return nil, fmt.Errorf("docker: info: %w", err)
	}
	ei := &EngineInfo{
		EngineVersion:   info.ServerVersion,
		APIVersion:      p.cli.ClientVersion(),
		OS:              info.OSType,
		OSType:          info.OperatingSystem,
		OSVersion:       info.OSVersion,
		KernelVersion:   info.KernelVersion,
		Architecture:    info.Architecture,
		NCPU:            info.NCPU,
		MemTotalBytes:   info.MemTotal,
		Containers:      info.Containers,
		ContainersRun:   info.ContainersRunning,
		ContainersPause: info.ContainersPaused,
		ContainersStop:  info.ContainersStopped,
		Images:          info.Images,
		Name:            info.Name,
		SwarmActive:     info.Swarm.LocalNodeState == "active",
	}
	return ei, nil
}

// SelfContainerID returns Castor's own container id, if known.
func (p *DockerProvider) SelfContainerID() string { return p.selfContainerID }

// Kind returns KindDocker.
func (p *DockerProvider) Kind() provider.OrchestratorKind { return provider.KindDocker }

// ID returns the provider id ("local-docker").
func (p *DockerProvider) ID() string { return p.id }

// Capabilities returns the full Docker capability set (read + write).
func (p *DockerProvider) Capabilities() provider.Capability {
	return provider.CapList | provider.CapInspect | provider.CapLogs | provider.CapStats |
		provider.CapStart | provider.CapStop | provider.CapRestart | provider.CapRemove |
		provider.CapExec | provider.CapEvents | provider.CapImages | provider.CapNetworks |
		provider.CapVolumes
}

// Ping verifies daemon connectivity.
func (p *DockerProvider) Ping(ctx context.Context) error {
	_, err := p.cli.Ping(ctx)
	return err
}

// Close releases the Docker client.
func (p *DockerProvider) Close() error { return p.cli.Close() }

// ListWorkloads lists containers (optionally including stopped) and maps them to
// the normalized Workload shape.
func (p *DockerProvider) ListWorkloads(ctx context.Context, opts provider.ListOptions) ([]provider.Workload, error) {
	f := filters.NewArgs()
	for k, v := range opts.LabelSelector {
		if v == "" {
			f.Add("label", k)
		} else {
			f.Add("label", k+"="+v)
		}
	}
	summaries, err := p.cli.ContainerList(ctx, container.ListOptions{All: opts.All, Filters: f})
	if err != nil {
		return nil, fmt.Errorf("docker: container list: %w", err)
	}
	out := make([]provider.Workload, 0, len(summaries))
	for i := range summaries {
		out = append(out, p.mapContainer(&summaries[i]))
	}
	return out, nil
}

// InspectWorkload returns the normalized header plus the raw ContainerJSON.
func (p *DockerProvider) InspectWorkload(ctx context.Context, id string) (*provider.WorkloadDetail, error) {
	cj, err := p.cli.ContainerInspect(ctx, id)
	if err != nil {
		return nil, mapNotFound(err)
	}
	raw, err := json.Marshal(cj)
	if err != nil {
		return nil, err
	}
	wl := p.mapInspect(&cj)
	return &provider.WorkloadDetail{Workload: wl, Raw: raw}, nil
}

// Start starts a stopped container.
func (p *DockerProvider) Start(ctx context.Context, id string) error {
	if err := p.cli.ContainerStart(ctx, id, container.StartOptions{}); err != nil {
		return mapNotFound(err)
	}
	return nil
}

// Stop stops a running container with an optional graceful timeout (seconds).
func (p *DockerProvider) Stop(ctx context.Context, id string, timeout *time.Duration) error {
	opts := container.StopOptions{}
	if timeout != nil {
		secs := int(timeout.Seconds())
		opts.Timeout = &secs
	}
	if err := p.cli.ContainerStop(ctx, id, opts); err != nil {
		return mapNotFound(err)
	}
	return nil
}

// Restart restarts a container with an optional graceful timeout (seconds).
func (p *DockerProvider) Restart(ctx context.Context, id string, timeout *time.Duration) error {
	opts := container.StopOptions{}
	if timeout != nil {
		secs := int(timeout.Seconds())
		opts.Timeout = &secs
	}
	if err := p.cli.ContainerRestart(ctx, id, opts); err != nil {
		return mapNotFound(err)
	}
	return nil
}

// Remove deletes a container, optionally forcing and removing anonymous volumes.
func (p *DockerProvider) Remove(ctx context.Context, id string, opts provider.RemoveOptions) error {
	if err := p.cli.ContainerRemove(ctx, id, container.RemoveOptions{
		Force:         opts.Force,
		RemoveVolumes: opts.RemoveVolumes,
	}); err != nil {
		return mapRemoveErr(err)
	}
	return nil
}

// mapRemoveErr translates a ContainerRemove failure into the right provider
// sentinel: ErrNotFound for an unknown id, and — when the daemon refuses with an
// HTTP 409 conflict because the container is still running and Force was not set —
// ErrContainerRunning (a specific ErrConflict carrying an actionable message).
// Any other 409 conflict falls back to the generic ErrConflict. This keeps the API
// from surfacing a generic 500 for the ordinary "you cannot remove a running
// container" refusal. Other errors pass through unchanged (mapped to 500 upstream).
func mapRemoveErr(err error) error {
	if err == nil {
		return nil
	}
	if cerrdefs.IsNotFound(err) || strings.Contains(strings.ToLower(err.Error()), "no such container") {
		return provider.ErrNotFound
	}
	// The daemon returns HTTP 409 (-> cerrdefs.IsConflict) for "You cannot remove a
	// running container ... Stop the container before attempting removal or force
	// remove". Match the running phrasing to give the precise message; any other
	// 409 still maps to a clear conflict rather than a 500.
	msg := strings.ToLower(err.Error())
	running := strings.Contains(msg, "running container") ||
		(strings.Contains(msg, "force") && strings.Contains(msg, "remov"))
	if cerrdefs.IsConflict(err) || running {
		if running {
			return provider.ErrContainerRunning
		}
		return provider.ErrConflict
	}
	return err
}

// mapNotFound translates a Docker "not found" error into provider.ErrNotFound.
func mapNotFound(err error) error {
	if err == nil {
		return nil
	}
	if cerrdefs.IsNotFound(err) {
		return provider.ErrNotFound
	}
	// Fallback string check for older/edge cases.
	if strings.Contains(strings.ToLower(err.Error()), "no such container") {
		return provider.ErrNotFound
	}
	return err
}

// mapResourceErr translates a Docker error from an image/network/volume delete
// into the right provider sentinel: ErrNotFound for unknown ids, ErrConflict
// when the daemon refuses because the resource is still in use (HTTP 409 — image
// referenced by a container, network with active endpoints, volume in use). It
// keeps the API from surfacing a generic 500 for an ordinary "in use" refusal.
func mapResourceErr(err error) error {
	if err == nil {
		return nil
	}
	if cerrdefs.IsNotFound(err) {
		return provider.ErrNotFound
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "no such") {
		return provider.ErrNotFound
	}
	// Daemon 409 conflict phrasings across image/network/volume removals.
	if strings.Contains(msg, "conflict") ||
		strings.Contains(msg, "in use") ||
		strings.Contains(msg, "being used") ||
		strings.Contains(msg, "active endpoints") ||
		strings.Contains(msg, "dependent child") ||
		strings.Contains(msg, "must be forced") {
		return provider.ErrConflict
	}
	return err
}
