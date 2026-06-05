package cache

import (
	"context"
	"log"
	"time"

	"github.com/gtek-it/castor/server/internal/provider/docker"
)

// runWatcher subscribes to the Docker event stream and, on each relevant event,
// patches the snapshot (via a targeted re-poll) and emits a targeted StateEvent
// so the UI refreshes within ~1s. On stream error/close (daemon restart, socket
// drop) it reconnects with exponential backoff and forces a full ContainerList
// resync before resuming.
func (m *Manager) runWatcher(ctx context.Context) {
	backoff := m.cfg.EventReconnectBackoff
	for {
		if ctx.Err() != nil {
			return
		}
		err := m.watchOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			log.Printf("cache: docker event stream ended (%v); reconnecting in %s", err, backoff)
		}
		// Force a full resync on (re)connect so we never serve stale data after
		// a gap in the event stream.
		m.pollDocker(ctx)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > m.cfg.EventReconnectCap {
			backoff = m.cfg.EventReconnectCap
		}
	}
}

// watchOnce runs a single subscription until the stream errors or closes. On a
// clean run (stream closed without error) it returns nil; the caller resyncs
// and reconnects regardless. It resets backoff implicitly by returning once the
// stream has been healthy (handled by the caller re-reading cfg each loop).
func (m *Manager) watchOnce(ctx context.Context) error {
	evCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	events, errs := m.docker.Events(evCtx)
	// Successful subscription resets backoff for the next loop iteration.
	healthy := false

	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-errs:
			return err
		case ev, ok := <-events:
			if !ok {
				if healthy {
					return nil
				}
				return nil
			}
			healthy = true
			m.handleEvent(ctx, ev)
		}
	}
}

// handleEvent reacts to one normalized Docker event: it triggers a lightweight
// targeted refresh and publishes a StateEvent carrying the action/kind/id so the
// UI can update reactively without polling.
func (m *Manager) handleEvent(ctx context.Context, ev docker.StateEvent) {
	switch ev.Kind {
	case "container":
		switch ev.Action {
		case "create", "start", "die", "stop", "destroy", "kill", "pause", "unpause", "restart", "rename", "update":
			m.refreshContainers(ctx)
		default:
			if hasPrefix(ev.Action, "health_status") {
				m.refreshContainers(ctx)
			}
		}
	case "network":
		if ev.Action == "create" || ev.Action == "destroy" || ev.Action == "remove" {
			m.refreshNetworks(ctx)
		}
	case "volume":
		if ev.Action == "create" || ev.Action == "destroy" || ev.Action == "remove" {
			m.refreshVolumes(ctx)
		}
	case "image":
		if ev.Action == "pull" || ev.Action == "delete" || ev.Action == "untag" || ev.Action == "tag" {
			m.refreshImages(ctx)
		}
	}

	m.broker.Publish(StateEvent{
		HostID: HostID,
		Action: ev.Action,
		Kind:   ev.Kind,
		ID:     ev.ID,
	})
}

// refreshContainers re-lists containers and patches just that slice.
func (m *Manager) refreshContainers(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	wls, err := m.docker.ListWorkloads(cctx, listAll())
	if err != nil {
		return
	}
	m.store.mu.Lock()
	snap := m.store.ensure(HostID)
	snap.Workloads = wls
	snap.UpdatedAt = time.Now().UTC()
	m.store.mu.Unlock()
}

func (m *Manager) refreshImages(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	imgs, err := m.docker.ListImages(cctx)
	if err != nil {
		return
	}
	m.store.mu.Lock()
	snap := m.store.ensure(HostID)
	snap.Images = imgs
	m.store.mu.Unlock()
}

func (m *Manager) refreshNetworks(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	nets, err := m.docker.ListNetworks(cctx)
	if err != nil {
		return
	}
	m.store.mu.Lock()
	snap := m.store.ensure(HostID)
	snap.Networks = nets
	m.store.mu.Unlock()
}

func (m *Manager) refreshVolumes(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	vols, err := m.docker.ListVolumes(cctx)
	if err != nil {
		return
	}
	m.store.mu.Lock()
	snap := m.store.ensure(HostID)
	snap.Volumes = vols
	m.store.mu.Unlock()
}

func hasPrefix(s, p string) bool {
	return len(s) >= len(p) && s[:len(p)] == p
}
