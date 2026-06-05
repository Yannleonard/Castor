package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// TestWorkloadIDDecodesEncodedSlash confirms that a k8s workload id
// "<ns>/<pod>", URL-encoded by the UI as "<ns>%2F<pod>", is decoded by
// workloadID() back to the value FindWorkload expects. chi itself does NOT
// decode encoded slashes within a path segment, so workloadID must.
func TestWorkloadIDDecodesEncodedSlash(t *testing.T) {
	r := chi.NewRouter()
	var got string
	r.Get("/w/{id}", func(w http.ResponseWriter, req *http.Request) {
		got = workloadID(req)
		w.WriteHeader(200)
	})

	req := httptest.NewRequest(http.MethodGet, "/w/kube-system%2Fcoredns-abc", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("route not matched, code=%d", rec.Code)
	}
	if got != "kube-system/coredns-abc" {
		t.Fatalf("workloadID = %q; want decoded %q", got, "kube-system/coredns-abc")
	}
}

// TestWorkloadIDPlain confirms a plain docker id passes through unchanged.
func TestWorkloadIDPlain(t *testing.T) {
	r := chi.NewRouter()
	var got string
	r.Get("/w/{id}", func(w http.ResponseWriter, req *http.Request) {
		got = workloadID(req)
	})
	req := httptest.NewRequest(http.MethodGet, "/w/abcdef0123456789", nil)
	r.ServeHTTP(httptest.NewRecorder(), req)
	if got != "abcdef0123456789" {
		t.Fatalf("workloadID = %q want abcdef0123456789", got)
	}
}
