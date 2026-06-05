# ADR-CASTOR-002 — Provider Abstraction (one `Provider` interface for Docker / Swarm / Kubernetes)

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** System Architect (Castor)
- **Scope:** Plan items **D3** (multi-orchestrator abstraction) and **D5** (Kubernetes V1 perimeter)
- **Supersedes / refines:** `PLAN-ORCHESTRATION-CASTOR.md` §3 ("Provider abstraction"), §2 rows D3/D5
- **Related:** ADR-CASTOR-001 (transport & scalability), ADR-CASTOR-003 (server stack + DB)

---

## 1. Context

Castor must present Docker, Docker Swarm and Kubernetes under **one coherent UX** (the
logo and positioning promise all three orchestrators in V1). The backend therefore needs
a **single, stable seam** that the HTTP/WS API layer talks to, regardless of which engine
is behind it. Without this seam the API and the React UI would branch on orchestrator kind
everywhere — exactly the divergence we want to avoid.

Two hard constraints from the locked scoping:

1. **Asymmetric capabilities.** Docker is **full read + write**. Swarm and Kubernetes are
   **read-only in V1**. The abstraction must let the API and UI know — *declaratively, before
   any call* — which actions a given provider supports, so the UI can grey out write buttons
   instead of letting the user click and get a runtime error.

2. **V2 multi-host is coming but is NOT built now.** V1 = one Castor container talking to the
   **local** Docker socket (`/var/run/docker.sock`) and a **mounted kubeconfig**. The interface
   must be shaped so a future Go agent (remote host) is *just another `Provider` implementation*
   behind the same seam — no API/UI rework when agents land.

### Options considered

| Option | Summary | Verdict |
|---|---|---|
| **A. Three separate backends** (DockerService / SwarmService / K8sService), API branches per kind | No shared seam; API & UI duplicate logic 3×; capability handling ad-hoc | ❌ Rejected — violates "one coherent UX", high divergence cost |
| **B. One `Provider` interface, capabilities as runtime probing** (try the call, catch "not implemented") | Single seam, but UI can't know up-front what to grey out; users hit errors | ❌ Rejected — bad UX, the explicit anti-pattern we want to kill |
| **C. One `Provider` interface + declarative `Capability` bitset** (this ADR) | Single seam; read methods always present; mutations return `ErrUnsupported`; capabilities queryable before any call | ✅ **Chosen** |

---

## 2. Decision

**One common Go interface `Provider`** in package `internal/provider`, implemented by three
packages: `internal/provider/docker`, `internal/provider/swarm`, `internal/provider/kube`.

- All providers implement the **read surface** (`ListWorkloads`, `InspectWorkload`, `Logs`,
  `Stats`) and a metadata surface (`Kind`, `ID`, `Capabilities`, `Ping`, `Close`).
- All providers also expose the **mutating surface** (`Start`, `Stop`, `Restart`, `Remove`,
  `Exec`) in the interface, but **read-only providers return `provider.ErrUnsupported`** from
  those methods. They do this for free by embedding a shared `ReadOnlyMutations` helper.
- A provider declares what it can do via a **`Capability` bitset** returned by
  `Capabilities()`. The API serializes these flags to the UI so write affordances are greyed
  out *before* the user clicks.
- A normalized **`Workload`** struct unifies a Docker container, a Swarm service-task and a
  K8s pod into one shape the API and UI consume uniformly.

### 2.1 V1 capability matrix (locked)

| Provider | Kind | Read (List/Inspect/Logs/Stats) | Start/Stop/Restart/Remove | Exec | Capability flags set |
|---|---|---|---|---|---|
| Docker | `KindDocker` | ✅ | ✅ | ✅ | `CapList \| CapInspect \| CapLogs \| CapStats \| CapStart \| CapStop \| CapRestart \| CapRemove \| CapExec \| CapEvents \| CapImages \| CapNetworks \| CapVolumes` |
| Swarm | `KindSwarm` | ✅ (services/nodes/tasks) | ❌ `ErrUnsupported` | ❌ `ErrUnsupported` | `CapList \| CapInspect \| CapLogs \| CapStats \| CapReadOnly` |
| Kubernetes | `KindKubernetes` | ✅ (pods/deployments/nodes) | ❌ `ErrUnsupported` | ❌ `ErrUnsupported` | `CapList \| CapInspect \| CapLogs \| CapReadOnly` (no `CapStats` in V1 — see §2.5) |

> Swarm/K8s `CapLogs` is set because both engines stream logs read-only (Docker daemon for
> Swarm tasks; `pods/log` subresource for K8s). Swarm sets `CapStats` (per-task stats via the
> Docker daemon); **K8s does NOT set `CapStats` in V1** because that requires metrics-server
> and is out of the read-only-via-core-API perimeter (D5).

### 2.2 The `Provider` interface (canonical — builders implement exactly this)

Package: `internal/provider`

```go
package provider

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrUnsupported is returned by mutating methods on read-only providers
// (Swarm, Kubernetes in V1). The API maps it to HTTP 405 Method Not Allowed.
var ErrUnsupported = errors.New("provider: operation not supported by this orchestrator")

// ErrNotFound is returned when a workload id is unknown to the provider.
// The API maps it to HTTP 404.
var ErrNotFound = errors.New("provider: workload not found")

// OrchestratorKind identifies the engine behind a Provider.
type OrchestratorKind string

const (
	KindDocker     OrchestratorKind = "docker"
	KindSwarm      OrchestratorKind = "swarm"
	KindKubernetes OrchestratorKind = "kubernetes"
)

// Provider is the single seam the API/UI layer talks to, regardless of orchestrator.
// Read methods MUST be implemented by every provider. Mutating methods MUST return
// ErrUnsupported on read-only providers (use the ReadOnlyMutations embeddable helper).
type Provider interface {
	// --- identity & capability (cheap, no remote call except Ping) ---

	// Kind returns the orchestrator family (docker/swarm/kubernetes).
	Kind() OrchestratorKind

	// ID is the stable provider instance id. In V1 this is the local provider
	// (e.g. "local-docker"); in V2 it is the agent/host id. Workload.ProviderID
	// always equals this.
	ID() string

	// Capabilities returns the declarative bitset the UI uses to grey out actions.
	Capabilities() Capability

	// Ping verifies connectivity to the underlying engine. Used for health.
	Ping(ctx context.Context) error

	// Close releases the underlying client/connection.
	Close() error

	// --- read surface (ALL providers implement) ---

	// ListWorkloads returns the normalized workloads visible to this provider.
	ListWorkloads(ctx context.Context, opts ListOptions) ([]Workload, error)

	// InspectWorkload returns one workload plus its raw, engine-specific JSON
	// (Raw is opaque to the API; the UI shows it in an "inspect" panel).
	InspectWorkload(ctx context.Context, id string) (*WorkloadDetail, error)

	// Logs streams logs for a workload. The caller closes the returned ReadCloser
	// to stop the stream. Honors LogOptions (Follow, Tail, Since, Timestamps).
	Logs(ctx context.Context, id string, opts LogOptions) (io.ReadCloser, error)

	// Stats streams resource samples for a workload until ctx is cancelled or the
	// returned channel is closed. Providers without stats set !CapStats and return
	// ErrUnsupported here (V1: Kubernetes).
	Stats(ctx context.Context, id string) (<-chan StatSample, error)

	// --- mutating surface (read-only providers return ErrUnsupported) ---

	Start(ctx context.Context, id string) error
	Stop(ctx context.Context, id string, timeout *time.Duration) error
	Restart(ctx context.Context, id string, timeout *time.Duration) error
	Remove(ctx context.Context, id string, opts RemoveOptions) error

	// Exec runs an interactive command inside a workload. Returns a bidirectional
	// stream (stdin/stdout/stderr multiplexed). Read-only providers return ErrUnsupported.
	Exec(ctx context.Context, id string, opts ExecOptions) (ExecStream, error)
}
```

### 2.3 The `Capability` bitset

```go
package provider

// Capability is a bitset of operations a Provider supports. The API serializes the
// active flags to the UI (as a string array) so write affordances are greyed out
// BEFORE the user clicks — never "click then 405".
type Capability uint32

const (
	CapList     Capability = 1 << iota // ListWorkloads
	CapInspect                         // InspectWorkload
	CapLogs                            // Logs (stream)
	CapStats                           // Stats (stream)
	CapStart                           // Start
	CapStop                            // Stop
	CapRestart                         // Restart
	CapRemove                          // Remove
	CapExec                            // Exec
	CapEvents                          // engine event stream (Docker V1 only)
	CapImages                          // image management (Docker V1 only)
	CapNetworks                        // network management (Docker V1 only)
	CapVolumes                         // volume management (Docker V1 only)
	CapReadOnly                        // marker: provider performs NO mutations
)

// Has reports whether all bits in c are set.
func (c Capability) Has(want Capability) bool { return c&want == want }

// Strings returns the active capabilities as stable lowercase tokens for the API/UI
// (e.g. ["list","inspect","logs","stats"]). Order is deterministic.
func (c Capability) Strings() []string { /* builder: map each set bit to its token */ }
```

### 2.4 The normalized `Workload` type

```go
package provider

import "time"

// WorkloadState is the normalized lifecycle state across orchestrators.
type WorkloadState string

const (
	StateRunning    WorkloadState = "running"
	StateStopped    WorkloadState = "stopped"    // docker: exited; k8s: Succeeded/Failed terminal
	StatePaused     WorkloadState = "paused"     // docker only
	StateRestarting WorkloadState = "restarting"
	StatePending    WorkloadState = "pending"    // k8s Pending; swarm task allocating
	StateUnknown    WorkloadState = "unknown"
)

// Port is a normalized published/exposed port.
type Port struct {
	Private  uint16 `json:"private"`            // container/pod port
	Public   uint16 `json:"public,omitempty"`   // host/published port (0 if none)
	Protocol string `json:"protocol"`           // "tcp" | "udp" | "sctp"
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
	// V1: the local provider. V2: the agent/host id. (Multi-host-ready, no schema change.)
	ProviderID string `json:"providerId"`

	// Node is the physical placement: docker -> hostname; swarm -> node id/hostname;
	// k8s -> spec.nodeName. Empty if unscheduled/pending.
	Node string `json:"node,omitempty"`

	// State is the normalized lifecycle state.
	State WorkloadState `json:"state"`

	// StateRaw is the engine-native state string (e.g. "Exited (0) 3 min ago",
	// "CrashLoopBackOff", "Running"), shown verbatim in the UI for fidelity.
	StateRaw string `json:"stateRaw,omitempty"`

	// Image is the container image reference (docker image; swarm task spec image;
	// k8s primary/first container image).
	Image string `json:"image"`

	// Ports are the normalized published/exposed ports.
	Ports []Port `json:"ports,omitempty"`

	// Labels are the merged labels/annotations (docker labels; swarm labels;
	// k8s labels). Used by the UI for grouping/filtering (stack, project, etc.).
	Labels map[string]string `json:"labels,omitempty"`

	// CreatedAt is the creation timestamp (UTC).
	CreatedAt time.Time `json:"createdAt"`

	// Group is an optional logical grouping key the UI uses for the "stack/app" view:
	// docker -> com.docker.compose.project label; swarm -> service name;
	// k8s -> owner (Deployment/StatefulSet) name. Empty if none.
	Group string `json:"group,omitempty"`

	// Protected marks system/Castor-own workloads that must NOT be removed by accident.
	// The API rejects Remove on a Protected workload (defense-in-depth with RBAC).
	Protected bool `json:"protected"`
}

// WorkloadDetail is the full inspect payload: the normalized header + opaque raw JSON.
type WorkloadDetail struct {
	Workload
	// Raw is the engine-specific inspect document (docker ContainerJSON,
	// swarm Task, or k8s Pod) marshalled to JSON. Opaque to the API.
	Raw json.RawMessage `json:"raw"`
}
```

### 2.5 Option & stream support types

```go
package provider

import (
	"context"
	"io"
	"time"
)

// ListOptions filters/paginates ListWorkloads. All fields optional.
type ListOptions struct {
	All           bool              // include stopped/terminal workloads (docker All=true)
	LabelSelector map[string]string // label/annotation equality filters
	Namespace     string            // k8s only; "" = all namespaces the kubeconfig can read
}

// LogOptions controls Logs streaming.
type LogOptions struct {
	Follow     bool
	Tail       int    // 0 = all; N = last N lines
	Since      time.Time
	Timestamps bool
	Container  string // k8s: which container in the pod ("" = first/default)
}

// RemoveOptions controls Remove (Docker only in V1).
type RemoveOptions struct {
	Force         bool
	RemoveVolumes bool
}

// ExecOptions controls Exec (Docker only in V1).
type ExecOptions struct {
	Cmd        []string
	Tty        bool
	Env        []string
	WorkingDir string
}

// ExecStream is the bidirectional exec attachment.
type ExecStream interface {
	io.ReadWriteCloser
	// Resize updates the TTY size (rows, cols).
	Resize(ctx context.Context, rows, cols uint16) error
	// ExitCode blocks until the command exits and returns its code (-1 if unknown).
	ExitCode(ctx context.Context) (int, error)
}

// StatSample is one normalized resource sample emitted by Stats.
type StatSample struct {
	Timestamp     time.Time `json:"timestamp"`
	CPUPercent    float64   `json:"cpuPercent"`           // 0..(100*nCPU)
	MemUsageBytes uint64    `json:"memUsageBytes"`
	MemLimitBytes uint64    `json:"memLimitBytes"`        // 0 if unlimited/unknown
	NetRxBytes    uint64    `json:"netRxBytes"`
	NetTxBytes    uint64    `json:"netTxBytes"`
	BlkReadBytes  uint64    `json:"blkReadBytes"`
	BlkWriteBytes uint64    `json:"blkWriteBytes"`
}
```

### 2.6 `ReadOnlyMutations` — shared "return `ErrUnsupported`" helper

Read-only providers (`swarm`, `kube` in V1) embed this so they do **not** reimplement the
five mutating methods. This guarantees every read-only provider fails uniformly and the UI's
greying logic and the API's 405 mapping stay consistent.

```go
package provider

import (
	"context"
	"time"
)

// ReadOnlyMutations provides the mutating-method set, all returning ErrUnsupported.
// Embed it in any read-only Provider implementation (Swarm, Kubernetes in V1).
type ReadOnlyMutations struct{}

func (ReadOnlyMutations) Start(context.Context, string) error                  { return ErrUnsupported }
func (ReadOnlyMutations) Stop(context.Context, string, *time.Duration) error   { return ErrUnsupported }
func (ReadOnlyMutations) Restart(context.Context, string, *time.Duration) error{ return ErrUnsupported }
func (ReadOnlyMutations) Remove(context.Context, string, RemoveOptions) error  { return ErrUnsupported }
func (ReadOnlyMutations) Exec(context.Context, string, ExecOptions) (ExecStream, error) {
	return nil, ErrUnsupported
}
```

> **Note on `Stats` for K8s:** `Stats` is part of the *read* surface, so it cannot live in
> `ReadOnlyMutations`. The K8s provider implements `Stats` as a one-line
> `return nil, ErrUnsupported` and does **not** set `CapStats`. Swarm *does* implement `Stats`
> (per-task, via the Docker daemon) and sets `CapStats`.

### 2.7 Registry & V2-readiness

```go
package provider

// Registry holds the active providers, keyed by Provider.ID(). The API resolves a
// workload to its owning provider via Workload.ProviderID. In V1 the registry has
// exactly the providers configured locally (docker + optionally swarm + optionally
// kube). In V2 each enrolled agent registers as an additional Provider with the SAME
// interface — no API/UI change.
type Registry struct{ /* map[string]Provider, RWMutex */ }

func (r *Registry) Register(p Provider)            { /* ... */ }
func (r *Registry) Get(id string) (Provider, bool) { /* ... */ }
func (r *Registry) List() []Provider               { /* ... */ }
```

This is the single design choice that makes multi-host a **V2 add, not a V2 rewrite**:
agents are providers, the seam never moves.

---

## 3. Provider implementation notes (per package)

### `internal/provider/docker` — FULL read+write

- **Module:** `github.com/docker/docker/client`
- **Client:** `client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())`.
  V1 connects to the **mounted unix socket** `/var/run/docker.sock` (default via `FromEnv` /
  `DOCKER_HOST`). API-version negotiation is mandatory (daemon may be older/newer than SDK).
- **Type packages:**
  - `github.com/docker/docker/api/types/container` — `ContainerList`, `ListOptions`, `StartOptions`, `StopOptions`, `RemoveOptions`, `LogsOptions`, `ExecOptions`, `Stats`
  - `github.com/docker/docker/api/types/image` — image ops (`CapImages`)
  - `github.com/docker/docker/api/types/network` — network ops (`CapNetworks`)
  - `github.com/docker/docker/api/types/volume` — volume ops (`CapVolumes`)
  - `github.com/docker/docker/api/types/filters` — list filters
  - `github.com/docker/docker/api/types/events` — engine event stream (`CapEvents`)
- **Mapping:** container id→`Workload.ID`; `Names[0]`→`Name`; `State`/`Status`→
  `State`/`StateRaw`; `Image`; `Ports`→`[]Port`; `Labels` (incl.
  `com.docker.compose.project`→`Group`); `Created`(unix)→`CreatedAt`. `Node` = daemon hostname.
- **Stats:** `ContainerStats(ctx, id, true)` → decode the streaming JSON → emit `StatSample`
  (compute CPU% from cpu/precpu deltas).
- **Exec:** `ContainerExecCreate` + `ContainerExecAttach` → wrap `HijackedResponse` as `ExecStream`.
- **Protected:** mark Castor's own container (env `CASTOR_SELF_CONTAINER_ID`) and any container
  labelled `castor.protected=true` → `Workload.Protected=true`.

### `internal/provider/swarm` — READ-ONLY

- **Module:** same Docker SDK (`github.com/docker/docker/client`); Swarm is the same daemon API.
- **Types:** `github.com/docker/docker/api/types/swarm` — `Service`, `Task`, `Node`.
- **Embeds `provider.ReadOnlyMutations`.**
- **Mapping:** one `Workload` **per task** (`ServiceList` + `TaskList` + `NodeList`):
  task id→`ID`; `<serviceName>.<slot>`→`Name`; service name→`Group`; `Task.NodeID`→resolve to
  node hostname→`Node`; `Task.Status.State`→`State`/`StateRaw`; `Task.Spec.ContainerSpec.Image`
  →`Image`. Sets `CapList|CapInspect|CapLogs|CapStats|CapReadOnly`.
- **Logs/Stats:** via the Docker daemon for the task's backing container (`ServiceLogs` /
  per-task container stats).

### `internal/provider/kube` — READ-ONLY (D5 perimeter)

- **Modules:**
  - `k8s.io/client-go/kubernetes` — typed `Clientset` (`kubernetes.NewForConfig(restCfg)`)
  - `k8s.io/client-go/tools/clientcmd` — load the **mounted kubeconfig**:
    `clientcmd.NewNonInteractiveDeferredLoadingClientConfig(&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}, &clientcmd.ConfigOverrides{}).ClientConfig()`
    (or `clientcmd.BuildConfigFromFlags("", kubeconfigPath)`). V1 honors `KUBECONFIG` /
    `/root/.kube/config` mounted into the Castor container.
  - `k8s.io/api/core/v1` — `Pod`, `PodList`, `Node` (alias `corev1`)
  - `k8s.io/apimachinery/pkg/apis/meta/v1` — `ListOptions`, `ObjectMeta` (alias `metav1`)
- **Embeds `provider.ReadOnlyMutations`.**
- **Mapping:** one `Workload` **per pod** (`CoreV1().Pods(ns).List`):
  `"<namespace>/<name>"`→`ID`; pod name→`Name`; `Spec.NodeName`→`Node`; `Status.Phase`(+
  container statuses, e.g. `CrashLoopBackOff`)→`State`/`StateRaw`; first container image→
  `Image`; pod `Labels`→`Labels`; owner ref (Deployment/StatefulSet) name→`Group`;
  `CreationTimestamp`→`CreatedAt`. Deployments/nodes are exposed as supplementary read-only
  lists by the kube package (consumed by dedicated API endpoints, not folded into `Workload`).
- **Logs:** `CoreV1().Pods(ns).GetLogs(...).Stream(ctx)` (honors `LogOptions.Container`).
  Sets `CapList|CapInspect|CapLogs|CapReadOnly`.
- **Stats:** **NOT in V1.** `Stats` returns `ErrUnsupported`, `CapStats` unset (metrics-server
  is out of perimeter — revisit in V2 alongside write actions).

---

## 4. API/UI contract (how the seam is consumed)

- The API exposes `GET /api/providers` → for each provider: `{id, kind, capabilities:[...]}`
  (from `Capability.Strings()`). **The UI greys out a write button iff the owning provider
  lacks the matching capability** — no trial-and-error calls.
- The API maps `provider.ErrUnsupported` → **HTTP 405**, `provider.ErrNotFound` → **404**.
- Every mutating call (`Start/Stop/Restart/Remove/Exec`) is wrapped by the API in the audit-log
  + RBAC middleware; a `Workload.Protected==true` target is rejected **before** reaching the
  provider (belt-and-suspenders with the provider's own guard).

---

## 5. Consequences

**Positive**
- One seam: API and React UI never branch on orchestrator kind for the core workload surface.
- Capabilities are **declarative and pre-flight** → the UI greys out unsupported actions; users
  never "click then 405". This is a concrete differentiator vs a runtime-error UX.
- Read-only providers are trivial and uniform (embed `ReadOnlyMutations`) → low surface for bugs,
  and "Swarm/K8s are read-only in V1" is enforced *by construction*, not by discipline.
- **V2 multi-host is additive:** an agent is just another `Provider` registered in the `Registry`;
  `Workload.ProviderID`/`Node` already carry placement. No interface or UI change.

**Negative / trade-offs**
- The `Workload` lowest-common-denominator hides engine-specific richness; mitigated by
  `WorkloadDetail.Raw` (opaque engine JSON) for the inspect panel.
- Swarm reusing the Docker SDK couples both providers to one SDK major version — acceptable
  (they target the same daemon API) and called out for the dependency review.
- `Stats` living on the read surface (not in `ReadOnlyMutations`) means the K8s provider writes a
  one-line `ErrUnsupported` stub; trivial but explicit.

**Neutral**
- Adding write support to Swarm/K8s later = flip capability bits + implement the methods (drop the
  embed). No change to the interface, the `Workload` type, or any consumer.

---

## 6. Locked dependency module paths (for ADR-CASTOR-003 / go.mod)

| Purpose | Module path |
|---|---|
| Docker / Swarm SDK (client) | `github.com/docker/docker/client` |
| Docker types (container/image/network/volume/filters/events/swarm) | `github.com/docker/docker/api/types/...` |
| K8s typed clientset | `k8s.io/client-go/kubernetes` |
| K8s kubeconfig loading | `k8s.io/client-go/tools/clientcmd` |
| K8s rest config | `k8s.io/client-go/rest` |
| K8s core API types (Pod/Node) | `k8s.io/api/core/v1` |
| K8s apimachinery meta types | `k8s.io/apimachinery/pkg/apis/meta/v1` |
