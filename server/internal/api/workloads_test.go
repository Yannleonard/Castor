package api

import (
	"context"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider"
)

// fakeDockerProvider is a writable provider double for workload-lifecycle handler
// tests. It records the last RemoveOptions it saw and returns a configurable
// error, so tests can assert both the ?force plumbing and the error mapping
// without a Docker daemon. ID()/Kind() mimic the local docker provider so the
// handler's reg.Get(wl.ProviderID) resolves it.
type fakeDockerProvider struct {
	provider.ReadOnlyMutations // satisfies Start/Stop/Restart/Exec we don't exercise

	mu         sync.Mutex
	removeErr  error
	lastRemove provider.RemoveOptions
	removeSeen bool
}

var _ provider.Provider = (*fakeDockerProvider)(nil)

func (*fakeDockerProvider) Kind() provider.OrchestratorKind { return provider.KindDocker }
func (*fakeDockerProvider) ID() string                      { return "local-docker" }
func (*fakeDockerProvider) Capabilities() provider.Capability {
	return provider.CapList | provider.CapInspect | provider.CapStart | provider.CapStop |
		provider.CapRestart | provider.CapRemove
}
func (*fakeDockerProvider) Ping(context.Context) error { return nil }
func (*fakeDockerProvider) Close() error               { return nil }
func (*fakeDockerProvider) ListWorkloads(context.Context, provider.ListOptions) ([]provider.Workload, error) {
	return nil, nil
}
func (*fakeDockerProvider) InspectWorkload(context.Context, string) (*provider.WorkloadDetail, error) {
	return nil, provider.ErrNotFound
}
func (*fakeDockerProvider) Logs(context.Context, string, provider.LogOptions) (io.ReadCloser, error) {
	return nil, provider.ErrUnsupported
}
func (*fakeDockerProvider) Stats(context.Context, string) (<-chan provider.StatSample, error) {
	return nil, provider.ErrUnsupported
}

// Remove records the options and returns the configured error.
func (f *fakeDockerProvider) Remove(_ context.Context, _ string, opts provider.RemoveOptions) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastRemove = opts
	f.removeSeen = true
	return f.removeErr
}

// adminSession bootstraps + logs in an admin (perm "*") and returns its cookies
// and CSRF token for mutating calls.
func adminSession(t *testing.T, e *testEnv) ([]*http.Cookie, string) {
	t.Helper()
	e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin", "password": "supersecretpw1", "email": "admin@example.test",
	}, nil, "")
	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("admin login code = %d (%s)", rec.Code, rec.Body.String())
	}
	csrf, _ := decodeBody(t, rec)["csrfToken"].(string)
	if csrf == "" {
		t.Fatalf("admin login did not return csrfToken")
	}
	return rec.Result().Cookies(), csrf
}

// seedWorkload registers a single non-protected docker container in the cache so
// RemoveWorkload resolves it to the fake provider.
func seedWorkload(e *testEnv) {
	e.srv.manager.Store().SeedSnapshotForTest(cache.HostID, provider.Workload{
		ID:         "c1",
		Name:       "web",
		Kind:       provider.KindDocker,
		ProviderID: "local-docker",
		State:      provider.StateRunning,
	})
}

// TestRemoveWorkloadRunningReturns409 proves the headline fix: when the provider
// refuses a running container (ErrContainerRunning), the API returns 409 conflict
// with the actionable message — NOT a generic 500.
func TestRemoveWorkloadRunningReturns409(t *testing.T) {
	e := newTestEnv(t)
	fake := &fakeDockerProvider{removeErr: provider.ErrContainerRunning}
	e.srv.reg.Register(fake)
	seedWorkload(e)
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodDelete, "/api/v1/hosts/local/workloads/c1", nil, cookies, csrf)
	if rec.Code != http.StatusConflict {
		t.Fatalf("remove running container = %d want 409 (%s)", rec.Code, rec.Body.String())
	}
	errObj := decodeBody(t, rec)["error"].(map[string]any)
	if errObj["code"] != "conflict" {
		t.Errorf("error code = %v want conflict", errObj["code"])
	}
	if errObj["message"] != provider.MsgContainerRunning {
		t.Errorf("error message = %q want %q", errObj["message"], provider.MsgContainerRunning)
	}
	// The provider must have been asked WITHOUT force (that's why it refused).
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.lastRemove.Force {
		t.Errorf("expected Force=false on the un-forced remove")
	}
}

// TestRemoveWorkloadForceQueryPlumbsThrough proves ?force=true reaches the
// provider as RemoveOptions{Force:true} and a successful force-remove yields 200.
func TestRemoveWorkloadForceQueryPlumbsThrough(t *testing.T) {
	e := newTestEnv(t)
	fake := &fakeDockerProvider{removeErr: nil} // force succeeds
	e.srv.reg.Register(fake)
	seedWorkload(e)
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodDelete, "/api/v1/hosts/local/workloads/c1?force=true&volumes=true", nil, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("force remove = %d want 200 (%s)", rec.Code, rec.Body.String())
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if !fake.removeSeen {
		t.Fatal("provider.Remove was never called")
	}
	if !fake.lastRemove.Force {
		t.Errorf("?force=true did not plumb through as RemoveOptions{Force:true}")
	}
	if !fake.lastRemove.RemoveVolumes {
		t.Errorf("?volumes=true did not plumb through as RemoveOptions{RemoveVolumes:true}")
	}
}

// TestRemoveWorkloadGenericConflict confirms a non-running ErrConflict still maps
// to 409 (generic message), so the conflict path is not over-fit to the running
// case.
func TestRemoveWorkloadGenericConflict(t *testing.T) {
	e := newTestEnv(t)
	fake := &fakeDockerProvider{removeErr: provider.ErrConflict}
	e.srv.reg.Register(fake)
	seedWorkload(e)
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodDelete, "/api/v1/hosts/local/workloads/c1", nil, cookies, csrf)
	if rec.Code != http.StatusConflict {
		t.Fatalf("generic conflict = %d want 409 (%s)", rec.Code, rec.Body.String())
	}
	if errObj := decodeBody(t, rec)["error"].(map[string]any); errObj["code"] != "conflict" {
		t.Errorf("error code = %v want conflict", errObj["code"])
	}
}
