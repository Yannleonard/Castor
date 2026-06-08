// Package cache holds the in-memory state model (ADR-CASTOR-001): per-host
// snapshots fed by pollers and an event watcher, read by the REST API (never
// inline daemon calls), plus the per-session stream registry that enforces the
// one-live-stats-stream rule.
package cache

import (
	"sync"
	"time"

	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/provider/kube"
	"github.com/gtek-it/castor/server/internal/provider/swarm"
)

// Snapshot is the cached state for one host at a point in time. It is replaced
// atomically by the poller and patched by the watcher.
type Snapshot struct {
	HostID    string              `json:"hostId"`
	Workloads []provider.Workload `json:"workloads"` // docker containers
	Swarm     []provider.Workload `json:"swarm"`     // swarm tasks
	Kube      []provider.Workload `json:"kube"`      // k8s pods

	Images   []docker.ImageInfo   `json:"images"`
	Networks []docker.NetworkInfo `json:"networks"`
	Volumes  []docker.VolumeInfo  `json:"volumes"`

	SwarmServices []swarm.ServiceInfo `json:"swarmServices"`
	SwarmNodes    []swarm.NodeInfo    `json:"swarmNodes"`

	KubeDeployments []kube.DeploymentInfo `json:"kubeDeployments"`
	KubeNodes       []kube.NodeInfo       `json:"kubeNodes"`

	// Engine holds host capacity + inventory from `docker info` (CPU/RAM/OS/engine).
	// nil until the first successful info poll.
	Engine *docker.EngineInfo `json:"engine,omitempty"`

	UpdatedAt time.Time `json:"updatedAt"`
	Degraded  bool      `json:"degraded"` // a poll failed; serving last-good data
}

// clone returns a shallow copy safe to hand out to readers (slices are shared
// read-only; the cache never mutates a slice after publishing it).
func (s *Snapshot) clone() Snapshot {
	if s == nil {
		return Snapshot{}
	}
	return *s
}

// Store is the concurrency-safe snapshot map keyed by host id.
type Store struct {
	mu        sync.RWMutex
	snapshots map[string]*Snapshot
}

// NewStore returns an empty snapshot store.
func NewStore() *Store {
	return &Store{snapshots: make(map[string]*Snapshot)}
}

// Get returns a copy of the host's snapshot and whether it exists.
func (s *Store) Get(hostID string) (Snapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snap, ok := s.snapshots[hostID]
	if !ok {
		return Snapshot{}, false
	}
	return snap.clone(), true
}

// replaceDocker atomically swaps the docker portion of a host snapshot.
func (s *Store) replaceDocker(hostID string, wls []provider.Workload, imgs []docker.ImageInfo, nets []docker.NetworkInfo, vols []docker.VolumeInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := s.ensure(hostID)
	snap.Workloads = wls
	snap.Images = imgs
	snap.Networks = nets
	snap.Volumes = vols
	snap.UpdatedAt = time.Now().UTC()
	snap.Degraded = false
}

// replaceSwarm atomically swaps the swarm portion of a host snapshot.
func (s *Store) replaceSwarm(hostID string, tasks []provider.Workload, services []swarm.ServiceInfo, nodes []swarm.NodeInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := s.ensure(hostID)
	snap.Swarm = tasks
	snap.SwarmServices = services
	snap.SwarmNodes = nodes
	snap.UpdatedAt = time.Now().UTC()
}

// replaceKube atomically swaps the k8s portion of a host snapshot.
func (s *Store) replaceKube(hostID string, pods []provider.Workload, deps []kube.DeploymentInfo, nodes []kube.NodeInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := s.ensure(hostID)
	snap.Kube = pods
	snap.KubeDeployments = deps
	snap.KubeNodes = nodes
	snap.UpdatedAt = time.Now().UTC()
}

// setEngine atomically updates the host's engine info (from `docker info`).
func (s *Store) setEngine(hostID string, ei *docker.EngineInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := s.ensure(hostID)
	snap.Engine = ei
}

// markDegraded flags a host as degraded (a poll failed), keeping last-good data.
func (s *Store) markDegraded(hostID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := s.ensure(hostID)
	snap.Degraded = true
}

// IsDegraded reports the degraded flag for a host.
func (s *Store) IsDegraded(hostID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if snap, ok := s.snapshots[hostID]; ok {
		return snap.Degraded
	}
	return false
}

// ensure returns the host snapshot, creating it if missing. Caller holds mu.
func (s *Store) ensure(hostID string) *Snapshot {
	snap, ok := s.snapshots[hostID]
	if !ok {
		snap = &Snapshot{HostID: hostID}
		s.snapshots[hostID] = snap
	}
	return snap
}

// SeedSnapshotForTest registers a snapshot for hostID so handler/API tests that
// resolve a host (e.g. via Get) can run against an unstarted Manager without a
// live poller/daemon. Any docker workloads passed are seeded into the snapshot so
// FindWorkload resolves them. Test-only: production snapshots are created by the
// pollers. Safe for concurrent use.
func (s *Store) SeedSnapshotForTest(hostID string, docker ...provider.Workload) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := s.ensure(hostID)
	if len(docker) > 0 {
		snap.Workloads = docker
	}
}

// FindWorkload returns the workload with the given id across docker/swarm/kube
// for a host, plus its provider kind. Used by the API to resolve a target
// without a daemon call.
func (s *Store) FindWorkload(hostID, id string) (provider.Workload, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snap, ok := s.snapshots[hostID]
	if !ok {
		return provider.Workload{}, false
	}
	for _, set := range [][]provider.Workload{snap.Workloads, snap.Swarm, snap.Kube} {
		for i := range set {
			if set[i].ID == id {
				return set[i], true
			}
		}
	}
	return provider.Workload{}, false
}
