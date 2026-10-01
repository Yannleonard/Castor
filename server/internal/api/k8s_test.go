// Castor by IT Leonard
package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider/kube"
)

// seedKubeKinds fills the local host snapshot with a small controller-kind
// dataset spanning two namespaces so the ?namespace= filter is observable.
func seedKubeKinds(e *testEnv) {
	e.srv.manager.Store().SeedKubeKindsForTest(cache.HostID, cache.KubeKinds{
		StatefulSets: []kube.StatefulSetInfo{
			{Namespace: "prod", Name: "db", Replicas: 3, Ready: 3},
			{Namespace: "dev", Name: "db", Replicas: 1, Ready: 1},
		},
		DaemonSets: []kube.DaemonSetInfo{
			{Namespace: "kube-system", Name: "kube-proxy", Desired: 2, Ready: 2},
		},
		Jobs: []kube.JobInfo{
			{Namespace: "prod", Name: "migrate", Succeeded: 1},
			{Namespace: "dev", Name: "migrate", Active: 1},
		},
		CronJobs: []kube.CronJobInfo{
			{Namespace: "prod", Name: "backup", Schedule: "0 3 * * *"},
		},
	})
}

// TestK8sStatefulSetsFilterByNamespace proves the read handler serves the cache
// snapshot and honors the ?namespace= filter (and returns everything without it).
func TestK8sStatefulSetsFilterByNamespace(t *testing.T) {
	e := newTestEnv(t)
	seedKubeKinds(e)
	cookies, _ := adminSession(t, e)

	rec := e.do(t, http.MethodGet, "/api/v1/hosts/local/k8s/statefulsets?namespace=prod", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("statefulsets?namespace=prod = %d (%s)", rec.Code, rec.Body.String())
	}
	var sets []kube.StatefulSetInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &sets); err != nil {
		t.Fatalf("decode statefulsets: %v", err)
	}
	if len(sets) != 1 || sets[0].Namespace != "prod" || sets[0].Name != "db" {
		t.Fatalf("filtered statefulsets = %+v want exactly prod/db", sets)
	}

	rec = e.do(t, http.MethodGet, "/api/v1/hosts/local/k8s/statefulsets", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("statefulsets = %d (%s)", rec.Code, rec.Body.String())
	}
	sets = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &sets); err != nil {
		t.Fatalf("decode statefulsets: %v", err)
	}
	if len(sets) != 2 {
		t.Fatalf("unfiltered statefulsets = %d entries want 2", len(sets))
	}

	// A namespace with no match returns an empty JSON array, never null.
	rec = e.do(t, http.MethodGet, "/api/v1/hosts/local/k8s/statefulsets?namespace=ghost", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("statefulsets?namespace=ghost = %d", rec.Code)
	}
	if body := rec.Body.String(); body == "null\n" || body == "null" {
		t.Fatalf("empty filter must serialize as [], got %q", body)
	}
}

// TestK8sKindListsServeSnapshot covers the remaining kind lists: daemonsets,
// jobs (with namespace filter), and cronjobs all serve the seeded snapshot.
func TestK8sKindListsServeSnapshot(t *testing.T) {
	e := newTestEnv(t)
	seedKubeKinds(e)
	cookies, _ := adminSession(t, e)

	rec := e.do(t, http.MethodGet, "/api/v1/hosts/local/k8s/daemonsets", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("daemonsets = %d (%s)", rec.Code, rec.Body.String())
	}
	var ds []kube.DaemonSetInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &ds); err != nil {
		t.Fatalf("decode daemonsets: %v", err)
	}
	if len(ds) != 1 || ds[0].Name != "kube-proxy" {
		t.Fatalf("daemonsets = %+v want exactly kube-system/kube-proxy", ds)
	}

	rec = e.do(t, http.MethodGet, "/api/v1/hosts/local/k8s/jobs?namespace=dev", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("jobs?namespace=dev = %d (%s)", rec.Code, rec.Body.String())
	}
	var jobs []kube.JobInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &jobs); err != nil {
		t.Fatalf("decode jobs: %v", err)
	}
	if len(jobs) != 1 || jobs[0].Namespace != "dev" || jobs[0].Active != 1 {
		t.Fatalf("filtered jobs = %+v want exactly dev/migrate", jobs)
	}

	rec = e.do(t, http.MethodGet, "/api/v1/hosts/local/k8s/cronjobs", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("cronjobs = %d (%s)", rec.Code, rec.Body.String())
	}
	var crons []kube.CronJobInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &crons); err != nil {
		t.Fatalf("decode cronjobs: %v", err)
	}
	if len(crons) != 1 || crons[0].Schedule != "0 3 * * *" {
		t.Fatalf("cronjobs = %+v want exactly prod/backup", crons)
	}
}
