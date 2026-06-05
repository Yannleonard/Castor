package cache

import (
	"context"
	"log"
	"time"

	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/provider/kube"
	"github.com/gtek-it/castor/server/internal/provider/swarm"
)

// HostID is the single host id in V1.
const HostID = "local"

// listAll returns ListOptions including stopped/terminal workloads.
func listAll() provider.ListOptions { return provider.ListOptions{All: true} }

// Manager owns the snapshot store, the event broker, the per-session stream
// registry, and the background poller/watcher goroutines for the local host.
type Manager struct {
	cfg    *config.Config
	store  *Store
	broker *Broker
	reg    *Registry // per-session stream registry (one-live-stats rule)

	docker *docker.DockerProvider
	swarm  *swarm.SwarmProvider // may be nil
	kube   *kube.KubeProvider   // may be nil
}

// NewManager constructs a Manager. swarmP and kubeP may be nil if not enabled.
func NewManager(cfg *config.Config, dockerP *docker.DockerProvider, swarmP *swarm.SwarmProvider, kubeP *kube.KubeProvider) *Manager {
	return &Manager{
		cfg:    cfg,
		store:  NewStore(),
		broker: NewBroker(),
		reg:    NewRegistry(),
		docker: dockerP,
		swarm:  swarmP,
		kube:   kubeP,
	}
}

// Store exposes the snapshot store for the API read handlers.
func (m *Manager) Store() *Store { return m.store }

// Broker exposes the event broker for the WS hub.
func (m *Manager) Broker() *Broker { return m.broker }

// Streams exposes the per-session stream registry.
func (m *Manager) Streams() *Registry { return m.reg }

// Docker exposes the docker provider (for the WS exec/stats/logs handlers and
// gated resource writes; reads go through the snapshot store).
func (m *Manager) Docker() *docker.DockerProvider { return m.docker }

// Swarm exposes the swarm provider (may be nil).
func (m *Manager) Swarm() *swarm.SwarmProvider { return m.swarm }

// Kube exposes the kube provider (may be nil).
func (m *Manager) Kube() *kube.KubeProvider { return m.kube }

// Start launches the background goroutines: the docker poller, the docker event
// watcher, and (if enabled) the swarm and kube pollers. They all stop when ctx
// is cancelled. It performs one synchronous initial docker poll so the first
// API read is warm.
func (m *Manager) Start(ctx context.Context) {
	// Warm the docker snapshot synchronously so /workloads is populated at boot.
	m.pollDocker(ctx)

	go m.runDockerPoller(ctx)
	go m.runWatcher(ctx)

	if m.swarm != nil {
		go m.runSwarmPoller(ctx)
	}
	if m.kube != nil {
		go m.runKubePoller(ctx)
	}
}

func (m *Manager) runDockerPoller(ctx context.Context) {
	t := time.NewTicker(m.cfg.DockerSnapshotInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.pollDocker(ctx)
		}
	}
}

// pollDocker fetches the docker portion of the snapshot in one set of cheap list
// calls and atomically replaces it, emitting a snapshot.replaced event on change.
func (m *Manager) pollDocker(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	wls, err := m.docker.ListWorkloads(cctx, provider.ListOptions{All: true})
	if err != nil {
		m.store.markDegraded(HostID)
		log.Printf("cache: docker poll failed: %v", err)
		return
	}
	imgs, _ := m.docker.ListImages(cctx)
	nets, _ := m.docker.ListNetworks(cctx)
	vols, _ := m.docker.ListVolumes(cctx)

	m.store.replaceDocker(HostID, wls, imgs, nets, vols)

	// Engine capacity/inventory (CPU/RAM/OS/engine) for the Hosts overview.
	// Non-fatal: a failure here keeps last-good engine info and does not degrade
	// the host (the workload list above is the source of truth for health).
	if ei, err := m.docker.Info(cctx); err == nil {
		m.store.setEngine(HostID, ei)
	}

	m.broker.Publish(StateEvent{HostID: HostID, Action: "snapshot.replaced", Kind: ""})
}

func (m *Manager) runSwarmPoller(ctx context.Context) {
	// Initial poll, then ticker.
	m.pollSwarm(ctx)
	t := time.NewTicker(m.cfg.SwarmSnapshotInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.pollSwarm(ctx)
		}
	}
}

func (m *Manager) pollSwarm(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	// Swarm may not be active; treat errors as "no swarm data" (not degraded).
	if err := m.swarm.Ping(cctx); err != nil {
		m.store.replaceSwarm(HostID, nil, nil, nil)
		return
	}
	tasks, err := m.swarm.ListWorkloads(cctx, provider.ListOptions{All: true})
	if err != nil {
		return
	}
	services, _ := m.swarm.ListServices(cctx)
	nodes, _ := m.swarm.ListNodes(cctx)
	m.store.replaceSwarm(HostID, tasks, services, nodes)
	m.broker.Publish(StateEvent{HostID: HostID, Action: "snapshot.replaced", Kind: ""})
}

func (m *Manager) runKubePoller(ctx context.Context) {
	m.pollKube(ctx)
	t := time.NewTicker(m.cfg.K8sSnapshotInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.pollKube(ctx)
		}
	}
}

func (m *Manager) pollKube(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	pods, err := m.kube.ListWorkloads(cctx, provider.ListOptions{})
	if err != nil {
		log.Printf("cache: kube poll failed: %v", err)
		return
	}
	deps, _ := m.kube.ListDeployments(cctx, "")
	nodes, _ := m.kube.ListNodes(cctx)
	m.store.replaceKube(HostID, pods, deps, nodes)
	m.broker.Publish(StateEvent{HostID: HostID, Action: "snapshot.replaced", Kind: ""})
}
