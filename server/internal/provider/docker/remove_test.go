package docker

import (
	"errors"
	"fmt"
	"testing"

	cerrdefs "github.com/containerd/errdefs"

	"github.com/gtek-it/castor/server/internal/provider"
)

// TestMapRemoveErr covers the ContainerRemove error translation: the ordinary
// "you cannot remove a running container" refusal must become the specific
// ErrContainerRunning (a 409 with an actionable message) instead of a generic
// 500; not-found stays 404; other 409 conflicts stay a generic conflict; and
// unrelated errors pass through untouched.
func TestMapRemoveErr(t *testing.T) {
	// The exact phrasing the Docker daemon returns for a running container.
	dockerRunning := errors.New("Error response from daemon: You cannot remove a running container 9f8e7d. Stop the container before attempting removal or force remove")

	cases := []struct {
		name    string
		in      error
		wantIs  error // errors.Is target the result must match (nil => want nil)
		wantNil bool
	}{
		{name: "nil", in: nil, wantNil: true},
		{
			name:   "running container (daemon string)",
			in:     dockerRunning,
			wantIs: provider.ErrContainerRunning,
		},
		{
			name:   "running container wrapped in errdefs conflict",
			in:     fmt.Errorf("%w: %s", cerrdefs.ErrConflict, dockerRunning.Error()),
			wantIs: provider.ErrContainerRunning,
		},
		{
			name:   "not found via errdefs",
			in:     fmt.Errorf("%w: no such container", cerrdefs.ErrNotFound),
			wantIs: provider.ErrNotFound,
		},
		{
			name:   "not found via bare string",
			in:     errors.New("Error: No such container: deadbeef"),
			wantIs: provider.ErrNotFound,
		},
		{
			name:   "other conflict stays generic",
			in:     fmt.Errorf("%w: endpoint still in use", cerrdefs.ErrConflict),
			wantIs: provider.ErrConflict,
		},
		{
			name:   "unrelated error passes through",
			in:     errors.New("connection refused"),
			wantIs: nil, // mapped to itself; checked below
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapRemoveErr(tc.in)
			if tc.wantNil {
				if got != nil {
					t.Fatalf("mapRemoveErr(nil) = %v, want nil", got)
				}
				return
			}
			if tc.wantIs == nil {
				// Passthrough: must be the same error, and NOT a provider sentinel.
				if got != tc.in {
					t.Fatalf("passthrough error changed: got %v, want %v", got, tc.in)
				}
				if errors.Is(got, provider.ErrConflict) || errors.Is(got, provider.ErrNotFound) {
					t.Fatalf("unrelated error must not map to a provider sentinel: %v", got)
				}
				return
			}
			if !errors.Is(got, tc.wantIs) {
				t.Fatalf("mapRemoveErr(%q) = %v; want errors.Is(..., %v)", tc.in, got, tc.wantIs)
			}
		})
	}
}

// TestErrContainerRunningIsConflict locks the invariant the API mapping relies
// on: ErrContainerRunning must satisfy errors.Is(err, ErrConflict) so it maps to
// 409, while remaining a distinct sentinel the API can special-case for its
// message.
func TestErrContainerRunningIsConflict(t *testing.T) {
	if !errors.Is(provider.ErrContainerRunning, provider.ErrConflict) {
		t.Fatal("ErrContainerRunning must wrap ErrConflict (errors.Is) to map to 409")
	}
	if errors.Is(provider.ErrConflict, provider.ErrContainerRunning) {
		t.Fatal("the generic ErrConflict must NOT be mistaken for ErrContainerRunning")
	}
}
