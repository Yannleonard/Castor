package docker

import (
	"errors"
	"fmt"
	"testing"

	cerrdefs "github.com/containerd/errdefs"

	"github.com/gtek-it/castor/server/internal/provider"
)

// TestMapDeployCreateErr covers ContainerCreate error translation: the daemon's
// "container name already in use" conflict must become the specific
// ErrNameConflict (a 409 with an actionable message) rather than a generic
// conflict; other errors defer to mapResourceErr.
func TestMapDeployCreateErr(t *testing.T) {
	// Exact daemon phrasing for a taken name.
	nameTaken := errors.New("Error response from daemon: Conflict. The container name \"/web\" is already in use by container \"abc123\". You have to remove (or rename) that container to be able to reuse that name.")

	cases := []struct {
		name    string
		in      error
		wantIs  error
		wantNil bool
	}{
		{name: "nil", in: nil, wantNil: true},
		{name: "name taken (daemon string)", in: nameTaken, wantIs: provider.ErrNameConflict},
		{name: "name taken via errdefs conflict", in: fmt.Errorf("%w: name in use", cerrdefs.ErrConflict), wantIs: provider.ErrNameConflict},
		{name: "not found defers to mapResourceErr", in: fmt.Errorf("no such image: x"), wantIs: provider.ErrNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := mapDeployCreateErr(c.in)
			if c.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %v", got)
				}
				return
			}
			if !errors.Is(got, c.wantIs) {
				t.Fatalf("want errors.Is(_, %v), got %v", c.wantIs, got)
			}
		})
	}
}

// TestMapDeployStartErr covers ContainerStart error translation: a host-port
// clash must become the specific ErrPortConflict (409) instead of falling
// through to a generic 500; unknown-container stays not-found.
func TestMapDeployStartErr(t *testing.T) {
	// Exact daemon phrasings for a port clash.
	portBind := errors.New("Error response from daemon: driver failed programming external connectivity on endpoint web: Bind for 0.0.0.0:8080 failed: port is already allocated")
	addrInUse := errors.New("Error response from daemon: failed to bind host port for 0.0.0.0:8080: address already in use")

	cases := []struct {
		name    string
		in      error
		wantIs  error
		wantNil bool
	}{
		{name: "nil", in: nil, wantNil: true},
		{name: "port already allocated", in: portBind, wantIs: provider.ErrPortConflict},
		{name: "address already in use", in: addrInUse, wantIs: provider.ErrPortConflict},
		{name: "unknown container stays not-found", in: errors.New("No such container: abc"), wantIs: provider.ErrNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := mapDeployStartErr(c.in)
			if c.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %v", got)
				}
				return
			}
			if !errors.Is(got, c.wantIs) {
				t.Fatalf("want errors.Is(_, %v), got %v", c.wantIs, got)
			}
		})
	}
}

// TestIsImageRefErr covers the bad-reference / auth classification used to turn a
// failed pull into ErrImageNotFound.
func TestIsImageRefErr(t *testing.T) {
	yes := []error{
		errors.New("manifest unknown: manifest tagged by \"9.9\" is not found"),
		errors.New("pull access denied for foo/bar, repository does not exist or may require 'docker login'"),
		errors.New("Error response from daemon: unauthorized: authentication required"),
		fmt.Errorf("%w: nope", cerrdefs.ErrNotFound),
	}
	no := []error{
		nil,
		errors.New("Error response from daemon: i/o timeout"),
		errors.New("connection refused"),
	}
	for _, e := range yes {
		if !isImageRefErr(e) {
			t.Errorf("expected image-ref error for: %v", e)
		}
	}
	for _, e := range no {
		if isImageRefErr(e) {
			t.Errorf("did not expect image-ref error for: %v", e)
		}
	}
}
