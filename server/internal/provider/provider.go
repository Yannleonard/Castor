// Package provider defines the single, engine-agnostic seam the Castor API and
// in-memory cache talk to, regardless of which orchestrator is behind it
// (Docker, Swarm, Kubernetes). See ADR-CASTOR-002.
//
// This package MUST NOT import any orchestrator SDK (docker/client, client-go).
// The concrete implementations live in the subpackages provider/docker,
// provider/swarm and provider/kube.
package provider

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"
)

// ErrUnsupported is returned by mutating methods on read-only providers
// (Swarm, Kubernetes in V1). The API maps it to HTTP 405 Method Not Allowed.
var ErrUnsupported = errors.New("provider: operation not supported by this orchestrator")

// ErrNotFound is returned when a workload id is unknown to the provider.
// The API maps it to HTTP 404.
var ErrNotFound = errors.New("provider: workload not found")

// ErrConflict is returned when a destructive operation is refused by the engine
// because the resource is still in use (e.g. deleting an image referenced by a
// container, a network with active endpoints, or a volume in use) and the caller
// did not force it. The API maps it to HTTP 409 conflict — NOT 500 — so the UI
// can surface a clear "resource in use" message instead of a generic error.
var ErrConflict = errors.New("provider: operation conflicts with current resource state")

// MsgContainerRunning is the user-facing 409 message for ErrContainerRunning. It
// is the single source of truth the API surfaces to the client (the wrapped
// ErrContainerRunning.Error() also carries the internal "provider: ..." prefix,
// which must not leak to the UI).
const MsgContainerRunning = "Container is running — stop it first, or remove with force."

// ErrContainerRunning is the specific ErrConflict raised when a container removal
// is refused because the container is still running and the caller did not force
// it. It wraps ErrConflict so errors.Is(err, ErrConflict) is true and the API maps
// it to HTTP 409 — but it carries an actionable message the UI can show verbatim
// (and offer a force-remove on), instead of the opaque generic-500 the bare daemon
// error used to produce.
var ErrContainerRunning = fmt.Errorf("%w: %s", ErrConflict, MsgContainerRunning)

// ErrForbidden is returned when a request is rejected by a server-side security
// policy (not by missing RBAC, which is enforced earlier at the middleware). The
// canonical case is ErrHostMountDenied below. The API maps it to HTTP 403.
var ErrForbidden = errors.New("provider: operation forbidden by policy")

// ErrHostMountDenied is returned by the deploy/mount guard when a container spec
// requests a host bind mount (or one of the always-blocked host paths such as
// the Docker socket) and the caller is not permitted to use host mounts. It
// wraps ErrForbidden so errors.Is(err, ErrForbidden) is true and the API maps it
// to HTTP 403. Host binds are root-equivalent (mounting /, /var/run/docker.sock,
// etc. lets a container escape to the host), so they are admin-only by design.
var ErrHostMountDenied = fmt.Errorf("%w: host bind mounts are not permitted", ErrForbidden)

// OrchestratorKind identifies the engine behind a Provider.
type OrchestratorKind string

const (
	// KindDocker is a standalone Docker engine (full read+write).
	KindDocker OrchestratorKind = "docker"
	// KindSwarm is a Docker Swarm cluster (read-only in V1).
	KindSwarm OrchestratorKind = "swarm"
	// KindKubernetes is a Kubernetes cluster (read-only in V1).
	KindKubernetes OrchestratorKind = "kubernetes"
)

// Provider is the single seam the API/UI layer talks to, regardless of
// orchestrator. Read methods MUST be implemented by every provider. Mutating
// methods MUST return ErrUnsupported on read-only providers (use the
// ReadOnlyMutations embeddable helper).
type Provider interface {
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

	// ListWorkloads returns the normalized workloads visible to this provider.
	ListWorkloads(ctx context.Context, opts ListOptions) ([]Workload, error)

	// InspectWorkload returns one workload plus its raw, engine-specific JSON.
	InspectWorkload(ctx context.Context, id string) (*WorkloadDetail, error)

	// Logs streams logs for a workload. The caller closes the returned ReadCloser
	// to stop the stream. Honors LogOptions (Follow, Tail, Since, Timestamps).
	Logs(ctx context.Context, id string, opts LogOptions) (io.ReadCloser, error)

	// Stats streams resource samples for a workload until ctx is cancelled or the
	// returned channel is closed. Providers without stats set !CapStats and return
	// ErrUnsupported here (V1: Kubernetes).
	Stats(ctx context.Context, id string) (<-chan StatSample, error)

	// Start starts a stopped workload.
	Start(ctx context.Context, id string) error
	// Stop stops a running workload, with an optional graceful timeout.
	Stop(ctx context.Context, id string, timeout *time.Duration) error
	// Restart restarts a workload, with an optional graceful timeout.
	Restart(ctx context.Context, id string, timeout *time.Duration) error
	// Remove deletes a workload.
	Remove(ctx context.Context, id string, opts RemoveOptions) error

	// Exec runs an interactive command inside a workload. Returns a bidirectional
	// stream (stdin/stdout/stderr multiplexed). Read-only providers return ErrUnsupported.
	Exec(ctx context.Context, id string, opts ExecOptions) (ExecStream, error)
}
