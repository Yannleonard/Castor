package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider"
)

// TestMetricsEndpoint proves /api/v1/metrics (and the top-level /metrics
// alias) requires authentication, accepts both a session and a Bearer PAT,
// and emits the hand-written Prometheus 0.0.4 exposition with counts
// aggregated from the cache snapshot.
func TestMetricsEndpoint(t *testing.T) {
	e := newTestEnv(t)

	// Seed the local snapshot with a known state breakdown.
	e.srv.manager.Store().SeedSnapshotForTest(cache.HostID,
		provider.Workload{ID: "a", Name: "w1", Kind: provider.KindDocker, State: provider.StateRunning},
		provider.Workload{ID: "b", Name: "w2", Kind: provider.KindDocker, State: provider.StateRunning},
		provider.Workload{ID: "c", Name: "w3", Kind: provider.KindDocker, State: provider.StateStopped},
	)

	cookies, csrf := adminSession(t, e)

	// Unauthenticated: 401 on both mounts.
	for _, path := range []string{"/api/v1/metrics", "/metrics"} {
		rec := e.do(t, http.MethodGet, path, nil, nil, "")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("unauthenticated GET %s = %d want 401", path, rec.Code)
		}
	}

	// Authenticated session: 200 with the expected exposition on both mounts.
	for _, path := range []string{"/api/v1/metrics", "/metrics"} {
		rec := e.do(t, http.MethodGet, path, nil, cookies, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d (%s)", path, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "version=0.0.4") {
			t.Errorf("%s Content-Type = %q want text format 0.0.4", path, ct)
		}
		body := rec.Body.String()
		for _, want := range []string{
			`castor_build_info{version="dev"} 1`,
			`castor_containers{state="running"} 2`,
			`castor_containers{state="stopped"} 1`,
			"castor_images_total 0",
			"castor_volumes_total 0",
			"castor_networks_total 0",
		} {
			if !strings.Contains(body, want) {
				t.Errorf("%s body missing %q\n%s", path, want, body)
			}
		}
		// Swarm/kube are inactive in this env: their series must be absent.
		for _, absent := range []string{"castor_swarm_services_total", "castor_kube_pods_total"} {
			if strings.Contains(body, absent) {
				t.Errorf("%s body must not contain %q when inactive", path, absent)
			}
		}
	}

	// Bearer PAT: the machine-to-machine scrape path works end-to-end.
	raw, _ := createToken(t, e, cookies, csrf, map[string]any{"name": "scraper"})
	rec := e.doBearer(t, http.MethodGet, "/api/v1/metrics", raw, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("bearer GET /api/v1/metrics = %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "castor_build_info") {
		t.Errorf("bearer scrape missing castor_build_info")
	}
}
