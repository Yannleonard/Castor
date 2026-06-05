package provider

import (
	"context"
	"io"
	"reflect"
	"testing"
)

func TestCapabilityHas(t *testing.T) {
	c := CapList | CapInspect | CapStats
	if !c.Has(CapList) {
		t.Errorf("expected CapList set")
	}
	if !c.Has(CapList | CapStats) {
		t.Errorf("expected combined CapList|CapStats set")
	}
	if c.Has(CapStart) {
		t.Errorf("did not expect CapStart")
	}
	if c.Has(CapList | CapStart) {
		t.Errorf("Has must require ALL bits")
	}
}

func TestCapabilityStringsDeterministicOrder(t *testing.T) {
	// Docker full set.
	docker := CapList | CapInspect | CapLogs | CapStats | CapStart | CapStop |
		CapRestart | CapRemove | CapExec | CapEvents | CapImages | CapNetworks | CapVolumes
	got := docker.Strings()
	want := []string{"list", "inspect", "logs", "stats", "start", "stop",
		"restart", "remove", "exec", "events", "images", "networks", "volumes"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("docker caps =\n  %v\nwant\n  %v", got, want)
	}
}

func TestCapabilityStringsReadOnly(t *testing.T) {
	kube := CapList | CapInspect | CapLogs | CapReadOnly
	got := kube.Strings()
	want := []string{"list", "inspect", "logs", "readonly"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("kube caps = %v want %v", got, want)
	}
	// Crucially, kube must NOT advertise stats.
	for _, s := range got {
		if s == "stats" {
			t.Fatalf("kube must not advertise stats")
		}
	}
}

func TestReadOnlyMutationsReturnUnsupported(t *testing.T) {
	var ro ReadOnlyMutations
	if err := ro.Start(context.TODO(), "x"); err != ErrUnsupported {
		t.Errorf("Start: got %v want ErrUnsupported", err)
	}
	if err := ro.Stop(context.TODO(), "x", nil); err != ErrUnsupported {
		t.Errorf("Stop: got %v want ErrUnsupported", err)
	}
	if err := ro.Restart(context.TODO(), "x", nil); err != ErrUnsupported {
		t.Errorf("Restart: got %v want ErrUnsupported", err)
	}
	if err := ro.Remove(context.TODO(), "x", RemoveOptions{}); err != ErrUnsupported {
		t.Errorf("Remove: got %v want ErrUnsupported", err)
	}
	if _, err := ro.Exec(context.TODO(), "x", ExecOptions{}); err != ErrUnsupported {
		t.Errorf("Exec: got %v want ErrUnsupported", err)
	}
}

func TestRegistry(t *testing.T) {
	r := NewRegistry()
	if _, ok := r.Get("nope"); ok {
		t.Errorf("empty registry returned a provider")
	}
	p := &fakeProvider{id: "local-docker", kind: KindDocker}
	r.Register(p)
	got, ok := r.Get("local-docker")
	if !ok || got.ID() != "local-docker" {
		t.Fatalf("registry did not return registered provider")
	}
	if len(r.List()) != 1 {
		t.Errorf("List len = %d want 1", len(r.List()))
	}
}

// fakeProvider is a minimal, complete Provider for registry tests.
type fakeProvider struct {
	ReadOnlyMutations
	id   string
	kind OrchestratorKind
}

var _ Provider = (*fakeProvider)(nil)

func (f *fakeProvider) Kind() OrchestratorKind     { return f.kind }
func (f *fakeProvider) ID() string                 { return f.id }
func (f *fakeProvider) Capabilities() Capability   { return CapList | CapReadOnly }
func (f *fakeProvider) Ping(context.Context) error { return nil }
func (f *fakeProvider) Close() error               { return nil }
func (f *fakeProvider) ListWorkloads(context.Context, ListOptions) ([]Workload, error) {
	return nil, nil
}
func (f *fakeProvider) InspectWorkload(context.Context, string) (*WorkloadDetail, error) {
	return nil, ErrNotFound
}
func (f *fakeProvider) Logs(context.Context, string, LogOptions) (io.ReadCloser, error) {
	return nil, ErrUnsupported
}
func (f *fakeProvider) Stats(context.Context, string) (<-chan StatSample, error) {
	return nil, ErrUnsupported
}
