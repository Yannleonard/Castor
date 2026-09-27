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

// MsgNameConflict is the user-facing 409 message when a container cannot be
// created because its name is already taken by another container.
const MsgNameConflict = "A container with this name already exists. Choose a different name, or remove the existing one first."

// ErrNameConflict is the specific ErrConflict raised when ContainerCreate is
// refused because the requested name is already in use. It wraps ErrConflict so
// errors.Is(err, ErrConflict) holds and the API maps it to HTTP 409, but it
// carries an actionable message instead of the daemon's opaque
// "Conflict. The container name ... is already in use" string.
var ErrNameConflict = fmt.Errorf("%w: %s", ErrConflict, MsgNameConflict)

// MsgPortConflict is the user-facing 409 message when a container fails to start
// because a published host port is already bound by something else.
const MsgPortConflict = "A published port is already in use on the host. Pick a different host port, or free the one in use."

// ErrPortConflict is the specific ErrConflict raised when ContainerStart fails
// because a requested host port is already allocated. The bare daemon error
// ("driver failed programming external connectivity ... bind: address already in
// use") otherwise fell through to a generic HTTP 500; this maps it to a clear 409.
var ErrPortConflict = fmt.Errorf("%w: %s", ErrConflict, MsgPortConflict)

// MsgImageNotFound is the user-facing 404-style message when the image for a
// deploy cannot be found or pulled (bad tag, private registry without creds,
// typo in the reference).
const MsgImageNotFound = "Image not found or could not be pulled. Check the image name and tag, and that any private registry credentials are configured."

// ErrImageNotFound is returned by the deploy path when the image cannot be
// resolved (local lookup miss + pull failure). It wraps ErrNotFound so the API
// maps it to HTTP 404 with an actionable message instead of a generic 500.
var ErrImageNotFound = fmt.Errorf("%w: %s", ErrNotFound, MsgImageNotFound)

// MsgNetworkExists is the user-facing 409 message when a network cannot be
// created because its name is already taken.
const MsgNetworkExists = "A network with this name already exists."

// ErrNetworkExists is the specific ErrConflict raised when NetworkCreate is
// refused because the name is in use. It wraps ErrConflict (HTTP 409).
var ErrNetworkExists = fmt.Errorf("%w: %s", ErrConflict, MsgNetworkExists)

// MsgSubnetOverlap is the user-facing 409 message when a requested subnet
// collides with the address space of an existing network.
const MsgSubnetOverlap = "This subnet overlaps an existing network's address space. Choose a different subnet."

// ErrSubnetOverlap is the specific ErrConflict raised when the daemon's IPAM
// refuses a pool because it overlaps another network. It wraps ErrConflict.
var ErrSubnetOverlap = fmt.Errorf("%w: %s", ErrConflict, MsgSubnetOverlap)

// MsgIPInUse is the user-facing 409 message when a static address requested for
// a container is already allocated to another endpoint on that network.
const MsgIPInUse = "That IP address is already used on this network."

// ErrIPInUse is the specific ErrConflict raised when a network connect (or a
// deploy with a static address) is refused because the IP is taken.
var ErrIPInUse = fmt.Errorf("%w: %s", ErrConflict, MsgIPInUse)

// MsgAlreadyConnected is the user-facing 409 message when a container is
// connected to a network it already belongs to.
const MsgAlreadyConnected = "This container is already connected to that network."

// ErrAlreadyConnected is the specific ErrConflict raised when NetworkConnect
// finds an endpoint for the container on that network already.
var ErrAlreadyConnected = fmt.Errorf("%w: %s", ErrConflict, MsgAlreadyConnected)

// MsgNotConnected is the user-facing 404 message when a container is
// disconnected from a network it does not belong to.
const MsgNotConnected = "This container is not connected to that network."

// ErrNotConnected is the specific ErrNotFound raised when NetworkDisconnect
// finds no endpoint for the container on that network. It wraps ErrNotFound.
var ErrNotConnected = fmt.Errorf("%w: %s", ErrNotFound, MsgNotConnected)

// MsgStaticIPUnsupported is the user-facing 409 message when a static address
// is requested on a network that cannot honor one (the default bridge, or any
// network without a user-configured subnet).
const MsgStaticIPUnsupported = "Static IP addresses are only supported on user-defined networks, not on the default bridge."

// ErrStaticIPUnsupported is the specific ErrConflict raised when the daemon
// rejects a user-specified IP on a network without a configured subnet.
var ErrStaticIPUnsupported = fmt.Errorf("%w: %s", ErrConflict, MsgStaticIPUnsupported)

// MsgNetworkInUse is the user-facing 409 message when a network cannot be
// removed because containers are still attached to it.
const MsgNetworkInUse = "This network still has connected containers. Disconnect them first."

// ErrNetworkInUse is the specific ErrConflict raised when NetworkRemove is
// refused because the network still has active endpoints.
var ErrNetworkInUse = fmt.Errorf("%w: %s", ErrConflict, MsgNetworkInUse)

// MsgAliasUnsupported is the user-facing 409 message when a network-scoped
// alias is requested on a network that cannot register one (the default
// bridge, or any network that is not user-defined).
const MsgAliasUnsupported = "Network aliases are only supported on user-defined networks, not on the default bridge."

// ErrAliasUnsupported is the specific ErrConflict raised when the daemon
// rejects a network-scoped alias on a non user-defined network.
var ErrAliasUnsupported = fmt.Errorf("%w: %s", ErrConflict, MsgAliasUnsupported)

// MsgIPPoolExhausted is the user-facing 409 message when a network has no free
// address left in its pools for a new endpoint.
const MsgIPPoolExhausted = "This network has no free IP address left in its address pools. Disconnect a container from it, or use a network with a larger subnet."

// ErrIPPoolExhausted is the specific ErrConflict raised when the daemon's IPAM
// cannot allocate an address for a connect or a deploy.
var ErrIPPoolExhausted = fmt.Errorf("%w: %s", ErrConflict, MsgIPPoolExhausted)

// MsgNetworkModeUnjoinable is the explanation ErrInvalidNetworkConfig carries
// when a container running in host, none or container:<id> network mode is
// connected to a network: it has no network sandbox of its own to attach.
const MsgNetworkModeUnjoinable = "A container using host/none/container network mode cannot join other networks."

// ErrInvalidNetworkConfig is returned when the daemon rejects a network or
// endpoint configuration as malformed (bad CIDR, gateway outside the subnet,
// address outside the pool). The wrapping error carries the daemon's cleaned
// explanation. The API maps it to HTTP 422.
var ErrInvalidNetworkConfig = errors.New("provider: invalid network configuration")

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
	// Pause suspends a running workload's processes.
	Pause(ctx context.Context, id string) error
	// Unpause resumes a paused workload's processes.
	Unpause(ctx context.Context, id string) error
	// Remove deletes a workload.
	Remove(ctx context.Context, id string, opts RemoveOptions) error

	// Exec runs an interactive command inside a workload. Returns a bidirectional
	// stream (stdin/stdout/stderr multiplexed). Read-only providers return ErrUnsupported.
	Exec(ctx context.Context, id string, opts ExecOptions) (ExecStream, error)
}
