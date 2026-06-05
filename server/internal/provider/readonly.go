package provider

import (
	"context"
	"time"
)

// ReadOnlyMutations provides the mutating-method set, all returning
// ErrUnsupported. Embed it in any read-only Provider implementation (Swarm,
// Kubernetes in V1) so they do not reimplement the five mutating methods.
//
// Note: Stats is part of the *read* surface and therefore is NOT here. The K8s
// provider implements Stats as a one-line ErrUnsupported and does not set
// CapStats; Swarm implements real per-task Stats.
type ReadOnlyMutations struct{}

// Start always returns ErrUnsupported.
func (ReadOnlyMutations) Start(context.Context, string) error { return ErrUnsupported }

// Stop always returns ErrUnsupported.
func (ReadOnlyMutations) Stop(context.Context, string, *time.Duration) error { return ErrUnsupported }

// Restart always returns ErrUnsupported.
func (ReadOnlyMutations) Restart(context.Context, string, *time.Duration) error {
	return ErrUnsupported
}

// Remove always returns ErrUnsupported.
func (ReadOnlyMutations) Remove(context.Context, string, RemoveOptions) error { return ErrUnsupported }

// Exec always returns ErrUnsupported.
func (ReadOnlyMutations) Exec(context.Context, string, ExecOptions) (ExecStream, error) {
	return nil, ErrUnsupported
}
