// Package swarm implements a Provider for Docker Swarm, reusing the Docker SDK
// against a manager socket (services / tasks / nodes). Reads cover services,
// tasks and nodes. Service/node lifecycle WRITES (create/scale/update/restart/
// remove, node availability) live in write.go and are exposed via dedicated
// /swarm API endpoints. The generic container-style Provider mutations
// (Start/Stop/Restart/Remove/Exec) stay as ErrUnsupported via the embedded
// ReadOnlyMutations — they operate on containers, not swarm services. See
// ADR-CASTOR-002.
package swarm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/swarm"
	"github.com/docker/docker/client"

	"github.com/gtek-it/castor/server/internal/provider"
)

// ProviderID is the stable id of the local Swarm provider in V1.
const ProviderID = "local-swarm"

// SwarmProvider is a read-only Provider over the Docker Swarm API.
type SwarmProvider struct {
	provider.ReadOnlyMutations
	cli *client.Client
	id  string
}

// Compile-time assertion.
var _ provider.Provider = (*SwarmProvider)(nil)

// New constructs a SwarmProvider sharing the same Docker client (same daemon
// API). The caller passes the docker provider's *client.Client.
func New(cli *client.Client) *SwarmProvider {
	return &SwarmProvider{cli: cli, id: ProviderID}
}

// Kind returns KindSwarm.
func (p *SwarmProvider) Kind() provider.OrchestratorKind { return provider.KindSwarm }

// ID returns the provider id ("local-swarm").
func (p *SwarmProvider) ID() string { return p.id }

// Capabilities returns the Swarm capability set. Swarm is now WRITABLE: service
// and node lifecycle mutations go through dedicated /swarm endpoints (not the
// generic container Provider mutation interface), so CapReadOnly is intentionally
// NOT set — the UI must stop greying out swarm write affordances. The generic
// container-style Start/Stop/Restart/Remove still return ErrUnsupported (they
// operate on containers, not swarm services), which is why CapStart/CapStop/etc.
// remain unset here.
func (p *SwarmProvider) Capabilities() provider.Capability {
	return provider.CapList | provider.CapInspect | provider.CapLogs | provider.CapStats
}

// Ping verifies the daemon is a Swarm manager by reading swarm info.
func (p *SwarmProvider) Ping(ctx context.Context) error {
	info, err := p.cli.Info(ctx)
	if err != nil {
		return err
	}
	if !info.Swarm.ControlAvailable {
		return fmt.Errorf("swarm: daemon is not a swarm manager")
	}
	return nil
}

// Close is a no-op; the shared client is owned by the docker provider.
func (p *SwarmProvider) Close() error { return nil }

// ListWorkloads returns one Workload per Swarm task, enriched with service name
// (Group) and resolved node hostname (Node).
func (p *SwarmProvider) ListWorkloads(ctx context.Context, opts provider.ListOptions) ([]provider.Workload, error) {
	services, err := p.cli.ServiceList(ctx, swarmServiceListOptions())
	if err != nil {
		return nil, fmt.Errorf("swarm: service list: %w", err)
	}
	svcName := make(map[string]string, len(services))
	svcImage := make(map[string]string, len(services))
	for _, s := range services {
		svcName[s.ID] = s.Spec.Name
		svcImage[s.ID] = s.Spec.TaskTemplate.ContainerSpec.Image
	}

	nodes, err := p.cli.NodeList(ctx, swarmNodeListOptions())
	if err != nil {
		return nil, fmt.Errorf("swarm: node list: %w", err)
	}
	nodeName := make(map[string]string, len(nodes))
	for _, n := range nodes {
		nodeName[n.ID] = n.Description.Hostname
	}

	f := filters.NewArgs()
	for k, v := range opts.LabelSelector {
		if v == "" {
			f.Add("label", k)
		} else {
			f.Add("label", k+"="+v)
		}
	}
	tasks, err := p.cli.TaskList(ctx, swarmTaskListOptions(f))
	if err != nil {
		return nil, fmt.Errorf("swarm: task list: %w", err)
	}

	out := make([]provider.Workload, 0, len(tasks))
	for i := range tasks {
		t := &tasks[i]
		if !opts.All && isTerminalTask(t.Status.State) {
			continue
		}
		out = append(out, p.mapTask(t, svcName, svcImage, nodeName))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// mapTask converts a swarm.Task into a normalized Workload.
func (p *SwarmProvider) mapTask(t *swarm.Task, svcName, svcImage, nodeName map[string]string) provider.Workload {
	service := svcName[t.ServiceID]
	name := service
	if t.Slot > 0 {
		name = fmt.Sprintf("%s.%d", service, t.Slot)
	} else if t.NodeID != "" {
		name = fmt.Sprintf("%s.%s", service, shortID(t.NodeID))
	}
	image := t.Spec.ContainerSpec.Image
	if image == "" {
		image = svcImage[t.ServiceID]
	}
	stateRaw := string(t.Status.State)
	if t.Status.Message != "" {
		stateRaw = string(t.Status.State) + ": " + t.Status.Message
	}
	return provider.Workload{
		ID:         t.ID,
		Name:       name,
		Kind:       provider.KindSwarm,
		ProviderID: p.id,
		Node:       nodeName[t.NodeID],
		State:      normalizeTaskState(t.Status.State),
		StateRaw:   stateRaw,
		Image:      image,
		Labels:     t.Labels,
		CreatedAt:  t.CreatedAt.UTC(),
		Group:      service,
		Protected:  false,
	}
}

// InspectWorkload returns the task header plus its raw JSON.
func (p *SwarmProvider) InspectWorkload(ctx context.Context, id string) (*provider.WorkloadDetail, error) {
	task, _, err := p.cli.TaskInspectWithRaw(ctx, id)
	if err != nil {
		return nil, mapSwarmNotFound(err)
	}
	raw, err := json.Marshal(task)
	if err != nil {
		return nil, err
	}
	// Enrich names/node for the header.
	svcName := map[string]string{}
	if svc, _, serr := p.cli.ServiceInspectWithRaw(ctx, task.ServiceID, swarmServiceInspectOptions()); serr == nil {
		svcName[task.ServiceID] = svc.Spec.Name
	}
	nodeName := map[string]string{}
	if task.NodeID != "" {
		if node, _, nerr := p.cli.NodeInspectWithRaw(ctx, task.NodeID); nerr == nil {
			nodeName[task.NodeID] = node.Description.Hostname
		}
	}
	wl := p.mapTask(&task, svcName, map[string]string{}, nodeName)
	return &provider.WorkloadDetail{Workload: wl, Raw: raw}, nil
}

// Logs streams logs for the service backing a task (read-only).
func (p *SwarmProvider) Logs(ctx context.Context, id string, opts provider.LogOptions) (io.ReadCloser, error) {
	task, _, err := p.cli.TaskInspectWithRaw(ctx, id)
	if err != nil {
		return nil, mapSwarmNotFound(err)
	}
	logOpts := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     opts.Follow,
		Timestamps: opts.Timestamps,
	}
	if opts.Tail > 0 {
		logOpts.Tail = strconv.Itoa(opts.Tail)
	}
	rc, err := p.cli.TaskLogs(ctx, task.ID, logOpts)
	if err != nil {
		return nil, mapSwarmNotFound(err)
	}
	return rc, nil
}

// Stats streams stats for the container backing a task (real implementation).
// It resolves the task's backing container id and proxies ContainerStats.
func (p *SwarmProvider) Stats(ctx context.Context, id string) (<-chan provider.StatSample, error) {
	task, _, err := p.cli.TaskInspectWithRaw(ctx, id)
	if err != nil {
		return nil, mapSwarmNotFound(err)
	}
	containerID := task.Status.ContainerStatus.ContainerID
	if containerID == "" {
		return nil, provider.ErrNotFound
	}
	resp, err := p.cli.ContainerStats(ctx, containerID, true)
	if err != nil {
		return nil, mapSwarmNotFound(err)
	}
	out := make(chan provider.StatSample, 1)
	go func() {
		defer close(out)
		defer func() { _ = resp.Body.Close() }()
		dec := json.NewDecoder(resp.Body)
		for {
			if ctx.Err() != nil {
				return
			}
			var raw container.StatsResponse
			if derr := dec.Decode(&raw); derr != nil {
				return
			}
			select {
			case out <- toStatSample(&raw):
			case <-ctx.Done():
				return
			}
		}
	}()
	return out, nil
}

func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func mapSwarmNotFound(err error) error {
	if err == nil {
		return nil
	}
	if cerrdefs.IsNotFound(err) {
		return provider.ErrNotFound
	}
	if strings.Contains(strings.ToLower(err.Error()), "no such") {
		return provider.ErrNotFound
	}
	return err
}

func isTerminalTask(s swarm.TaskState) bool {
	switch s {
	case swarm.TaskStateComplete, swarm.TaskStateFailed, swarm.TaskStateRejected,
		swarm.TaskStateShutdown, swarm.TaskStateOrphaned, swarm.TaskStateRemove:
		return true
	default:
		return false
	}
}

func normalizeTaskState(s swarm.TaskState) provider.WorkloadState {
	switch s {
	case swarm.TaskStateRunning:
		return provider.StateRunning
	case swarm.TaskStateComplete, swarm.TaskStateShutdown:
		return provider.StateStopped
	case swarm.TaskStateFailed, swarm.TaskStateRejected, swarm.TaskStateOrphaned:
		return provider.StateStopped
	case swarm.TaskStateNew, swarm.TaskStatePending, swarm.TaskStateAssigned,
		swarm.TaskStateAccepted, swarm.TaskStatePreparing, swarm.TaskStateStarting,
		swarm.TaskStateReady:
		return provider.StatePending
	default:
		return provider.StateUnknown
	}
}

// toStatSample mirrors the docker package's CPU/mem/net/blk computation. Kept
// local to avoid importing the docker package (which would couple the two).
func toStatSample(s *container.StatsResponse) provider.StatSample {
	ts := s.Read
	if ts.IsZero() {
		ts = time.Now()
	}
	sample := provider.StatSample{
		Timestamp:     ts.UTC(),
		MemUsageBytes: s.MemoryStats.Usage,
		MemLimitBytes: s.MemoryStats.Limit,
	}
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) - float64(s.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(s.CPUStats.SystemUsage) - float64(s.PreCPUStats.SystemUsage)
	if sysDelta > 0 && cpuDelta >= 0 {
		cpus := float64(s.CPUStats.OnlineCPUs)
		if cpus == 0 {
			cpus = float64(len(s.CPUStats.CPUUsage.PercpuUsage))
		}
		if cpus == 0 {
			cpus = 1
		}
		sample.CPUPercent = (cpuDelta / sysDelta) * cpus * 100.0
	}
	for _, nw := range s.Networks {
		sample.NetRxBytes += nw.RxBytes
		sample.NetTxBytes += nw.TxBytes
	}
	for _, e := range s.BlkioStats.IoServiceBytesRecursive {
		switch e.Op {
		case "Read", "read":
			sample.BlkReadBytes += e.Value
		case "Write", "write":
			sample.BlkWriteBytes += e.Value
		}
	}
	return sample
}
