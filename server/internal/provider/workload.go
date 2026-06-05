package provider

import (
	"encoding/json"
	"time"
)

// WorkloadState is the normalized lifecycle state across orchestrators.
type WorkloadState string

const (
	// StateRunning — the workload is up and running.
	StateRunning WorkloadState = "running"
	// StateStopped — docker: exited; k8s: Succeeded/Failed terminal.
	StateStopped WorkloadState = "stopped"
	// StatePaused — docker only.
	StatePaused WorkloadState = "paused"
	// StateRestarting — the workload is restarting.
	StateRestarting WorkloadState = "restarting"
	// StatePending — k8s Pending; swarm task allocating.
	StatePending WorkloadState = "pending"
	// StateUnknown — state could not be normalized.
	StateUnknown WorkloadState = "unknown"
)

// Port is a normalized published/exposed port.
type Port struct {
	Private  uint16 `json:"private"`          // container/pod port
	Public   uint16 `json:"public,omitempty"` // host/published port (0 if none)
	Protocol string `json:"protocol"`         // "tcp" | "udp" | "sctp"
}

// Workload is the unified, orchestrator-agnostic shape the API and UI consume.
// One Workload == one Docker container | one Swarm service-task | one K8s pod.
type Workload struct {
	// ID is the provider-native id: docker container id, swarm task id, or
	// "<namespace>/<podName>" for K8s. Unique within (ProviderID).
	ID string `json:"id"`

	// Name is the human-friendly name (container name / service.task / pod name).
	Name string `json:"name"`

	// Kind is the orchestrator family this workload came from.
	Kind OrchestratorKind `json:"kind"`

	// ProviderID is the provider instance that owns this workload. Equals Provider.ID().
	ProviderID string `json:"providerId"`

	// Node is the physical placement: docker -> hostname; swarm -> node hostname;
	// k8s -> spec.nodeName. Empty if unscheduled/pending.
	Node string `json:"node,omitempty"`

	// State is the normalized lifecycle state.
	State WorkloadState `json:"state"`

	// StateRaw is the engine-native state string, shown verbatim in the UI.
	StateRaw string `json:"stateRaw,omitempty"`

	// Image is the container image reference.
	Image string `json:"image"`

	// Ports are the normalized published/exposed ports.
	Ports []Port `json:"ports,omitempty"`

	// Labels are the merged labels/annotations used by the UI for grouping/filtering.
	Labels map[string]string `json:"labels,omitempty"`

	// CreatedAt is the creation timestamp (UTC).
	CreatedAt time.Time `json:"createdAt"`

	// Group is an optional logical grouping key the UI uses for the "stack/app" view:
	// docker -> com.docker.compose.project; swarm -> service name; k8s -> owner name.
	Group string `json:"group,omitempty"`

	// Protected marks system/Castor-own workloads that must NOT be removed by accident.
	Protected bool `json:"protected"`
}

// WorkloadDetail is the full inspect payload: the normalized header + opaque raw JSON.
type WorkloadDetail struct {
	Workload
	// Raw is the engine-specific inspect document marshalled to JSON. Opaque to the API.
	Raw json.RawMessage `json:"raw"`
}
