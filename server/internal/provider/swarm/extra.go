package swarm

import (
	"context"
	"fmt"
	"time"

	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/swarm"
)

// Option-construction helpers isolate the SDK option structs so the SDK version
// can move without touching the mapping logic. In Docker SDK v28 the swarm
// option structs live in api/types/swarm (not api/types).

func swarmServiceListOptions() swarm.ServiceListOptions { return swarm.ServiceListOptions{} }
func swarmNodeListOptions() swarm.NodeListOptions       { return swarm.NodeListOptions{} }
func swarmTaskListOptions(f filters.Args) swarm.TaskListOptions {
	return swarm.TaskListOptions{Filters: f}
}
func swarmServiceInspectOptions() swarm.ServiceInspectOptions {
	return swarm.ServiceInspectOptions{}
}

// ServiceResources are the configured per-task CPU/memory limits and
// reservations read back from TaskTemplate.Resources. CPU values are cores
// (NanoCPUs/1e9); memory values are bytes. A zero value means "not set".
type ServiceResources struct {
	CpuLimit               float64 `json:"cpuLimit"`
	MemoryLimitBytes       int64   `json:"memoryLimitBytes"`
	CpuReservation         float64 `json:"cpuReservation"`
	MemoryReservationBytes int64   `json:"memoryReservationBytes"`
}

// ServiceInfo is the normalized Swarm service summary the API exposes.
type ServiceInfo struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Mode      string           `json:"mode"`     // "replicated" | "global"
	Replicas  string           `json:"replicas"` // "running/desired" for replicated; "" for global
	Image     string           `json:"image"`
	CreatedAt time.Time        `json:"createdAt"`
	Resources ServiceResources `json:"resources"`
}

// ListServices returns normalized service summaries with running/desired counts.
func (p *SwarmProvider) ListServices(ctx context.Context) ([]ServiceInfo, error) {
	services, err := p.cli.ServiceList(ctx, swarmServiceListOptions())
	if err != nil {
		return nil, err
	}
	// Count running tasks per service for the replicas string.
	tasks, _ := p.cli.TaskList(ctx, swarmTaskListOptions(filters.NewArgs()))
	running := map[string]int{}
	for _, t := range tasks {
		if t.Status.State == swarm.TaskStateRunning {
			running[t.ServiceID]++
		}
	}

	out := make([]ServiceInfo, 0, len(services))
	for _, s := range services {
		mode := "replicated"
		replicas := ""
		if s.Spec.Mode.Global != nil {
			mode = "global"
		} else if s.Spec.Mode.Replicated != nil && s.Spec.Mode.Replicated.Replicas != nil {
			replicas = fmt.Sprintf("%d/%d", running[s.ID], *s.Spec.Mode.Replicated.Replicas)
		}
		out = append(out, ServiceInfo{
			ID:        s.ID,
			Name:      s.Spec.Name,
			Mode:      mode,
			Replicas:  replicas,
			Image:     s.Spec.TaskTemplate.ContainerSpec.Image,
			CreatedAt: s.CreatedAt.UTC(),
			Resources: readServiceResources(s.Spec.TaskTemplate.Resources),
		})
	}
	return out, nil
}

// readServiceResources flattens a TaskTemplate.Resources into the normalized
// ServiceResources view, converting NanoCPUs back to cores. Nil/absent
// sub-structs leave the corresponding fields at their zero value.
func readServiceResources(r *swarm.ResourceRequirements) ServiceResources {
	var out ServiceResources
	if r == nil {
		return out
	}
	if r.Limits != nil {
		if r.Limits.NanoCPUs > 0 {
			out.CpuLimit = float64(r.Limits.NanoCPUs) / 1e9
		}
		out.MemoryLimitBytes = r.Limits.MemoryBytes
	}
	if r.Reservations != nil {
		if r.Reservations.NanoCPUs > 0 {
			out.CpuReservation = float64(r.Reservations.NanoCPUs) / 1e9
		}
		out.MemoryReservationBytes = r.Reservations.MemoryBytes
	}
	return out
}

// NodeInfo is the normalized Swarm node summary the API exposes.
type NodeInfo struct {
	ID           string `json:"id"`
	Hostname     string `json:"hostname"`
	Role         string `json:"role"`
	Availability string `json:"availability"`
	State        string `json:"state"`
	Addr         string `json:"addr"`
}

// ListNodes returns normalized node summaries.
func (p *SwarmProvider) ListNodes(ctx context.Context) ([]NodeInfo, error) {
	nodes, err := p.cli.NodeList(ctx, swarmNodeListOptions())
	if err != nil {
		return nil, err
	}
	out := make([]NodeInfo, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, NodeInfo{
			ID:           n.ID,
			Hostname:     n.Description.Hostname,
			Role:         string(n.Spec.Role),
			Availability: string(n.Spec.Availability),
			State:        string(n.Status.State),
			Addr:         n.Status.Addr,
		})
	}
	return out, nil
}

// TaskCount returns the number of swarm tasks (for the host summary).
func (p *SwarmProvider) TaskCount(ctx context.Context) int {
	tasks, err := p.cli.TaskList(ctx, swarmTaskListOptions(filters.NewArgs()))
	if err != nil {
		return 0
	}
	return len(tasks)
}
