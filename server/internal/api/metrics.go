// Castor by IT Leonard
package api

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gtek-it/castor/server/internal/version"
)

// Metrics serves aggregate counters from the cache snapshots in the Prometheus
// text exposition format 0.0.4, written by hand (no client_golang dependency
// by design). It is authenticated — session cookie or Bearer PAT, resolved by
// SessionAuth upstream — but requires no specific permission: the payload is
// read-only aggregate counts, strictly less sensitive than any list endpoint.
// Non-mutating, so no audit row.
func (s *Server) Metrics(w http.ResponseWriter, r *http.Request) {
	hosts, err := s.store.ListHosts(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}

	// Aggregate across all registered hosts' snapshots (V1 has one host, but
	// the loop keeps the endpoint correct if more are registered).
	byState := map[string]int{}
	var images, volumes, networks, swarmServices, kubePods int
	swarmActive, kubeActive := false, false
	for _, h := range hosts {
		snap, ok := s.manager.Store().Get(h.ID)
		if !ok {
			continue
		}
		for _, wl := range snap.Workloads {
			byState[string(wl.State)]++
		}
		images += len(snap.Images)
		volumes += len(snap.Volumes)
		networks += len(snap.Networks)
		// Swarm/kube series are emitted only when the orchestrator is actually
		// present: an inactive swarm/cluster leaves its snapshot portion empty
		// (the pollers store nil), so absence of data means absence of series.
		if (snap.Engine != nil && snap.Engine.SwarmActive) || len(snap.SwarmServices) > 0 || len(snap.SwarmNodes) > 0 {
			swarmActive = true
			swarmServices += len(snap.SwarmServices)
		}
		if len(snap.Kube) > 0 || len(snap.KubeDeployments) > 0 || len(snap.KubeNodes) > 0 {
			kubeActive = true
			kubePods += len(snap.Kube)
		}
	}

	var b strings.Builder
	b.WriteString("# HELP castor_build_info Castor build metadata (value is always 1).\n")
	b.WriteString("# TYPE castor_build_info gauge\n")
	fmt.Fprintf(&b, "castor_build_info{version=%s} 1\n", promLabel(version.Version))

	b.WriteString("# HELP castor_containers Docker containers by state.\n")
	b.WriteString("# TYPE castor_containers gauge\n")
	states := make([]string, 0, len(byState))
	for st := range byState {
		states = append(states, st)
	}
	sort.Strings(states) // deterministic output
	for _, st := range states {
		fmt.Fprintf(&b, "castor_containers{state=%s} %d\n", promLabel(st), byState[st])
	}

	writeGauge := func(name, help string, v int) {
		fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s gauge\n%s %d\n", name, help, name, name, v)
	}
	writeGauge("castor_images_total", "Docker images in the cache snapshot.", images)
	writeGauge("castor_volumes_total", "Docker volumes in the cache snapshot.", volumes)
	writeGauge("castor_networks_total", "Docker networks in the cache snapshot.", networks)
	if swarmActive {
		writeGauge("castor_swarm_services_total", "Swarm services (series absent when swarm is inactive).", swarmServices)
	}
	if kubeActive {
		writeGauge("castor_kube_pods_total", "Kubernetes pods (series absent when no cluster is connected).", kubePods)
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(b.String()))
}

// promLabel quotes a label value for the Prometheus text format. Go quoting is
// a superset of the required escapes (\\, \" and \n); the values used here
// (version strings, workload states) contain no other control characters.
func promLabel(v string) string { return strconv.Quote(v) }
