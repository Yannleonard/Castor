// Castor by IT Leonard
package cache

import (
	"context"
	"errors"
	"testing"

	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/updates"
)

// TestCheckUpdatesOnceRefusesConcurrentSweep proves a second caller is turned
// away with ErrUpdateCheckRunning instead of blocking (a sweep may hold the
// run lock for up to updateCheckTimeout).
func TestCheckUpdatesOnceRefusesConcurrentSweep(t *testing.T) {
	st := newNotifierTestStore(t)
	m := NewManager(&config.Config{}, nil, nil, nil)
	// A zero provider is enough: the held lock below returns before any call.
	m.docker = &docker.DockerProvider{}
	m.ConfigureUpdates(st, updates.NewChecker(nil))

	m.updRunMu.Lock()
	defer m.updRunMu.Unlock()
	if err := m.CheckUpdatesOnce(context.Background()); !errors.Is(err, ErrUpdateCheckRunning) {
		t.Fatalf("CheckUpdatesOnce during a sweep = %v want ErrUpdateCheckRunning", err)
	}
}

// TestCheckUpdatesOnceNotConfigured pins the pre-configuration sentinel.
func TestCheckUpdatesOnceNotConfigured(t *testing.T) {
	m := NewManager(&config.Config{}, nil, nil, nil)
	if err := m.CheckUpdatesOnce(context.Background()); !errors.Is(err, errUpdatesNotConfigured) {
		t.Fatalf("CheckUpdatesOnce unconfigured = %v want errUpdatesNotConfigured", err)
	}
}
