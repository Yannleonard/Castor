// Castor by IT Leonard
package cache

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/updates"
)

// Settings keys governing the periodic image-update check. Both are re-read
// every cycle so operators can tune them at runtime without a restart.
const (
	settingUpdatesEnabled  = "updates.enabled"        // "true" | "false", default true
	settingUpdatesInterval = "updates.interval_hours" // integer hours, default 6
)

// defaultUpdateInterval applies when the interval setting is absent/invalid.
const defaultUpdateInterval = 6 * time.Hour

// updateCheckTimeout caps one full check sweep (inspects + registry calls).
const updateCheckTimeout = 5 * time.Minute

// updateCheckStartDelay lets the first snapshot poll land before checking.
const updateCheckStartDelay = time.Minute

// errUpdatesNotConfigured is returned before ConfigureUpdates ran (or when the
// manager has no docker provider, e.g. in handler tests).
var errUpdatesNotConfigured = errors.New("cache: update checker not configured")

// ErrUpdateCheckRunning reports that an update sweep is already in flight. A
// sweep may hold the run lock for up to updateCheckTimeout — far longer than
// an interactive caller can be left blocking on it.
var ErrUpdateCheckRunning = errors.New("cache: update check already running")

// ConfigureUpdates wires the image-update checker. The checker's registry
// credentials come from the API layer (which owns the unseal key; the cache
// never does), mirroring ConfigureNotifications. Safe to call before or after
// Start: the periodic loop launches once both the checker and the run context
// exist.
func (m *Manager) ConfigureUpdates(st *store.Store, checker *updates.Checker) {
	m.updMu.Lock()
	defer m.updMu.Unlock()
	if m.updChecker != nil {
		return
	}
	m.updChecker = checker
	m.updStore = st
	if m.updCtx != nil && !m.updStarted {
		m.updStarted = true
		go m.runUpdateChecker(m.updCtx)
	}
}

// startUpdateChecker launches the periodic loop from Manager.Start (when the
// checker was configured before Start). Caller: Start only.
func (m *Manager) startUpdateChecker(ctx context.Context) {
	m.updMu.Lock()
	defer m.updMu.Unlock()
	m.updCtx = ctx
	if m.updChecker != nil && !m.updStarted {
		m.updStarted = true
		go m.runUpdateChecker(ctx)
	}
}

// runUpdateChecker periodically runs the update check (pattern: runDockerPoller,
// but the interval comes from settings and is re-read every cycle).
func (m *Manager) runUpdateChecker(ctx context.Context) {
	select {
	case <-ctx.Done():
		return
	case <-time.After(updateCheckStartDelay):
	}
	for {
		if m.updatesEnabled(ctx) {
			// An on-demand API sweep may be in flight; that is not a failure.
			if err := m.CheckUpdatesOnce(ctx); err != nil && !errors.Is(err, ErrUpdateCheckRunning) {
				log.Printf("cache: update check failed: %v", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(m.updatesInterval(ctx)):
		}
	}
}

// updatesEnabled reads the enable switch (default true).
func (m *Manager) updatesEnabled(ctx context.Context) bool {
	m.updMu.Lock()
	st := m.updStore
	m.updMu.Unlock()
	if st == nil {
		return false
	}
	return st.GetSettingDefault(ctx, settingUpdatesEnabled, "true") == "true"
}

// updatesInterval reads the check interval (hours, default 6, clamped 1..168).
func (m *Manager) updatesInterval(ctx context.Context) time.Duration {
	m.updMu.Lock()
	st := m.updStore
	m.updMu.Unlock()
	if st == nil {
		return defaultUpdateInterval
	}
	raw := st.GetSettingDefault(ctx, settingUpdatesInterval, "6")
	if h, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && h >= 1 && h <= 168 {
		return time.Duration(h) * time.Hour
	}
	return defaultUpdateInterval
}

// CheckUpdatesOnce runs one full update check now: it lists running docker
// containers, resolves each one's local image digest, compares against the
// registry, stores the statuses, and — on a no-update -> update transition —
// fires NotifyUpdateAvailable and appends an image.update_detected audit row.
// Sweeps never overlap: a concurrent caller gets ErrUpdateCheckRunning back
// instead of queueing behind the in-flight sweep.
func (m *Manager) CheckUpdatesOnce(ctx context.Context) error {
	m.updMu.Lock()
	checker, st := m.updChecker, m.updStore
	m.updMu.Unlock()
	if checker == nil || st == nil || m.docker == nil {
		return errUpdatesNotConfigured
	}
	if !m.updRunMu.TryLock() {
		return ErrUpdateCheckRunning
	}
	defer m.updRunMu.Unlock()

	cctx, cancel := context.WithTimeout(ctx, updateCheckTimeout)
	defer cancel()

	// Running containers only: a stopped container is not "outdated" in any
	// actionable sense and its image may be gone.
	wls, err := m.docker.ListWorkloads(cctx, provider.ListOptions{})
	if err != nil {
		return err
	}
	targets := make([]updates.Target, 0, len(wls))
	for i := range wls {
		wl := &wls[i]
		ref, digests, err := m.docker.ContainerImageIdentity(cctx, wl.ID)
		if err != nil {
			continue // container vanished mid-sweep, or a local-only image
		}
		targets = append(targets, updates.Target{
			ContainerID:   wl.ID,
			ContainerName: wl.Name,
			Image:         ref,
			RepoDigests:   digests,
		})
	}
	statuses := checker.Check(cctx, targets)

	m.updMu.Lock()
	prev := m.updStatuses
	next := make(map[string]updates.UpdateStatus, len(statuses))
	for _, s := range statuses {
		next[s.ContainerID] = s
	}
	m.updStatuses = next
	m.updMu.Unlock()

	for _, s := range statuses {
		if !s.UpdateAvailable {
			continue
		}
		if p, seen := prev[s.ContainerID]; seen && p.UpdateAvailable {
			continue // already known; only notify on the transition
		}
		m.NotifyUpdateAvailable(HostID, s.ContainerName, s.Image)
		m.auditUpdateDetected(ctx, st, s)
	}
	return nil
}

// UpdateStatuses returns the last computed update statuses for a host (V1:
// only "local"), sorted by container name. Never nil.
func (m *Manager) UpdateStatuses(hostID string) []updates.UpdateStatus {
	out := []updates.UpdateStatus{}
	if hostID != HostID {
		return out
	}
	m.updMu.Lock()
	for _, s := range m.updStatuses {
		out = append(out, s)
	}
	m.updMu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].ContainerName < out[j].ContainerName })
	return out
}

// auditUpdateDetected appends one image.update_detected row. Detail carries
// the image reference and both digests — nothing secret.
func (m *Manager) auditUpdateDetected(ctx context.Context, st *store.Store, s updates.UpdateStatus) {
	detail, _ := json.Marshal(map[string]string{
		"image":        s.Image,
		"localDigest":  s.LocalDigest,
		"remoteDigest": s.RemoteDigest,
	})
	if err := st.InsertAudit(ctx, store.AuditInput{
		TS:         time.Now().Unix(),
		ActorName:  "system",
		Action:     "image.update_detected",
		TargetType: "container",
		TargetID:   s.ContainerID,
		TargetName: s.ContainerName,
		Result:     "success",
		Detail:     string(detail),
	}); err != nil {
		log.Printf("cache: updates: audit write failed: %v", err)
	}
}
