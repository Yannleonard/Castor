package api

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

// Tuning for the live stats sweep. The handler must stay responsive, so we cap
// both the per-sample wait and the number of containers we probe, and bound the
// fan-out so we never open more than statsConcurrency simultaneous streams.
const (
	dashboardBudget   = 3 * time.Second // overall ceiling for the live sweep
	statsSampleWait   = 2 * time.Second // max wait for a single container's sample
	statsConcurrency  = 8               // simultaneous stats streams
	statsMaxContainer = 64              // never probe more than this many containers
	dashboardTopN     = 5               // size of topByCpu / topByMem
)

// containerStat is one running container's live sample, carried alongside its
// identity for the top-N rankings.
type containerStat struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpuPercent"`
	MemBytes   uint64  `json:"memBytes"`
}

type containerCounts struct {
	Total   int `json:"total"`
	Running int `json:"running"`
	Stopped int `json:"stopped"`
	Paused  int `json:"paused"`
}

type cpuMetrics struct {
	UsedPercent float64 `json:"usedPercent"` // sum of container cpu% (may exceed 100 across cores)
	Cores       int     `json:"cores"`       // engine info NCPU
}

type memoryMetrics struct {
	UsedBytes   uint64  `json:"usedBytes"`   // sum over running containers
	TotalBytes  int64   `json:"totalBytes"`  // engine info MemTotal
	UsedPercent float64 `json:"usedPercent"` // usedBytes / totalBytes * 100 (0 if total unknown)
}

type stateBucket struct {
	State string `json:"state"`
	Count int    `json:"count"`
}

type engineSummary struct {
	Version       string `json:"version"`
	NCPU          int    `json:"ncpu"`
	MemTotalBytes int64  `json:"memTotalBytes"`
}

type dashboardMetrics struct {
	Containers     containerCounts `json:"containers"`
	Images         int             `json:"images"`
	Networks       int             `json:"networks"`
	Volumes        int             `json:"volumes"`
	SwarmServices  int             `json:"swarmServices"`
	SwarmTasks     int             `json:"swarmTasks"`
	K8sPods        int             `json:"k8sPods"`
	CPU            cpuMetrics      `json:"cpu"`
	Memory         memoryMetrics   `json:"memory"`
	StateBreakdown []stateBucket   `json:"stateBreakdown"`
	TopByCPU       []containerStat `json:"topByCpu"`
	TopByMem       []containerStat `json:"topByMem"`
	Engine         engineSummary   `json:"engine"`
}

// DashboardMetrics aggregates the host's BI-dashboard numbers. Counts come from
// the cache snapshot (no daemon calls); live CPU/RAM is sampled from the running
// Docker containers with a bounded fan-out and a short budget so a slow or
// unreachable daemon degrades gracefully (missing samples are skipped) rather
// than blocking the request.
func (s *Server) DashboardMetrics(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	snap, _ := s.manager.Store().Get(hostID)

	// ---- counts + state breakdown from the snapshot ----
	counts := containerCounts{Total: len(snap.Workloads)}
	byState := map[string]int{}
	running := make([]provider.Workload, 0, len(snap.Workloads))
	for _, wl := range snap.Workloads {
		byState[string(wl.State)]++
		switch wl.State {
		case provider.StateRunning:
			counts.Running++
			running = append(running, wl)
		case provider.StatePaused:
			counts.Paused++
		case provider.StateStopped:
			counts.Stopped++
		}
	}

	out := dashboardMetrics{
		Containers:     counts,
		Images:         len(snap.Images),
		Networks:       len(snap.Networks),
		Volumes:        len(snap.Volumes),
		SwarmServices:  len(snap.SwarmServices),
		SwarmTasks:     len(snap.Swarm),
		K8sPods:        len(snap.Kube),
		StateBreakdown: stateBreakdown(byState),
		TopByCPU:       []containerStat{},
		TopByMem:       []containerStat{},
	}

	// ---- engine capacity (cached `docker info`) ----
	var cores int
	var memTotal int64
	if snap.Engine != nil {
		out.Engine = engineSummary{
			Version:       snap.Engine.EngineVersion,
			NCPU:          snap.Engine.NCPU,
			MemTotalBytes: snap.Engine.MemTotalBytes,
		}
		cores = snap.Engine.NCPU
		memTotal = snap.Engine.MemTotalBytes
	}
	out.CPU.Cores = cores
	out.Memory.TotalBytes = memTotal

	// ---- live CPU/RAM sweep over running containers ----
	samples := s.sampleRunning(r.Context(), running)

	var cpuSum float64
	var memSum uint64
	for _, st := range samples {
		cpuSum += st.CPUPercent
		memSum += st.MemBytes
	}
	out.CPU.UsedPercent = cpuSum
	out.Memory.UsedBytes = memSum
	if memTotal > 0 {
		out.Memory.UsedPercent = float64(memSum) / float64(memTotal) * 100.0
	}

	out.TopByCPU = topN(samples, dashboardTopN, func(a, b containerStat) bool {
		return a.CPUPercent > b.CPUPercent
	})
	out.TopByMem = topN(samples, dashboardTopN, func(a, b containerStat) bool {
		return a.MemBytes > b.MemBytes
	})

	ok(w, out)
}

// sampleRunning probes the running Docker containers for one live stats sample
// each, bounded by statsConcurrency and the overall dashboardBudget. The Docker
// provider is the only one that supports per-container stats here; swarm/k8s
// workloads are skipped. A failed or slow sample is dropped, not fatal.
func (s *Server) sampleRunning(parent context.Context, running []provider.Workload) []containerStat {
	dp := s.manager.Docker()
	if dp == nil || len(running) == 0 {
		return nil
	}

	// Only Docker-kind workloads can be sampled via the docker provider.
	targets := make([]provider.Workload, 0, len(running))
	for _, wl := range running {
		if wl.Kind == provider.KindDocker {
			targets = append(targets, wl)
			if len(targets) >= statsMaxContainer {
				break
			}
		}
	}
	if len(targets) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(parent, dashboardBudget)
	defer cancel()

	out := make([]containerStat, 0, len(targets))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, statsConcurrency)

	for _, wl := range targets {
		select {
		case <-ctx.Done():
			// Budget exhausted while dispatching — stop scheduling more probes.
			wg.Wait()
			return out
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(wl provider.Workload) {
			defer wg.Done()
			defer func() { <-sem }()
			if st, ok := sampleOne(ctx, dp, wl); ok {
				mu.Lock()
				out = append(out, st)
				mu.Unlock()
			}
		}(wl)
	}
	wg.Wait()
	return out
}

// sampleOne opens a stats stream for one container, reads the first frame, then
// cancels. The streaming endpoint includes precpu in its first frame, so a single
// sample yields a valid CPU%. Returns ok=false on any error/timeout.
func sampleOne(parent context.Context, dp *docker.DockerProvider, wl provider.Workload) (containerStat, bool) {
	ctx, cancel := context.WithTimeout(parent, statsSampleWait)
	defer cancel()

	ch, err := dp.Stats(ctx, wl.ID)
	if err != nil {
		return containerStat{}, false
	}
	select {
	case sample, ok := <-ch:
		if !ok {
			return containerStat{}, false
		}
		return containerStat{
			ID:         wl.ID,
			Name:       wl.Name,
			CPUPercent: sample.CPUPercent,
			MemBytes:   sample.MemUsageBytes,
		}, true
	case <-ctx.Done():
		return containerStat{}, false
	}
}

// stateBreakdown turns the state->count map into a stable, count-desc slice
// suitable for a donut chart.
func stateBreakdown(m map[string]int) []stateBucket {
	out := make([]stateBucket, 0, len(m))
	for state, count := range m {
		out = append(out, stateBucket{State: state, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].State < out[j].State
	})
	return out
}

// topN returns the highest-ranked n samples per less, with a stable id tiebreak.
func topN(samples []containerStat, n int, less func(a, b containerStat) bool) []containerStat {
	ranked := make([]containerStat, len(samples))
	copy(ranked, samples)
	sort.Slice(ranked, func(i, j int) bool {
		if less(ranked[i], ranked[j]) {
			return true
		}
		if less(ranked[j], ranked[i]) {
			return false
		}
		return ranked[i].ID < ranked[j].ID
	})
	if len(ranked) > n {
		ranked = ranked[:n]
	}
	return ranked
}
