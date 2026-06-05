package cache

import (
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

func TestStoreReplaceAndGet(t *testing.T) {
	s := NewStore()
	if _, ok := s.Get("nope"); ok {
		t.Fatalf("empty store returned a snapshot")
	}

	wls := []provider.Workload{
		{ID: "c1", Name: "web", Kind: provider.KindDocker, State: provider.StateRunning},
		{ID: "c2", Name: "db", Kind: provider.KindDocker, State: provider.StateStopped},
	}
	s.replaceDocker("local", wls, []docker.ImageInfo{{ID: "img1"}}, nil, nil)

	snap, ok := s.Get("local")
	if !ok {
		t.Fatalf("snapshot missing after replace")
	}
	if len(snap.Workloads) != 2 {
		t.Errorf("workloads len = %d want 2", len(snap.Workloads))
	}
	if len(snap.Images) != 1 {
		t.Errorf("images len = %d want 1", len(snap.Images))
	}
	if snap.UpdatedAt.IsZero() {
		t.Errorf("UpdatedAt should be set")
	}
	if snap.Degraded {
		t.Errorf("replace should clear degraded")
	}
}

func TestStoreDegraded(t *testing.T) {
	s := NewStore()
	s.markDegraded("local")
	if !s.IsDegraded("local") {
		t.Errorf("expected degraded after markDegraded")
	}
	// A successful docker replace clears degraded.
	s.replaceDocker("local", nil, nil, nil, nil)
	if s.IsDegraded("local") {
		t.Errorf("replace should clear degraded")
	}
}

func TestFindWorkloadAcrossKinds(t *testing.T) {
	s := NewStore()
	s.replaceDocker("local", []provider.Workload{{ID: "dock1", Kind: provider.KindDocker}}, nil, nil, nil)
	s.replaceSwarm("local", []provider.Workload{{ID: "task1", Kind: provider.KindSwarm}}, nil, nil)
	s.replaceKube("local", []provider.Workload{{ID: "ns/pod1", Kind: provider.KindKubernetes}}, nil, nil)

	for _, id := range []string{"dock1", "task1", "ns/pod1"} {
		if _, ok := s.FindWorkload("local", id); !ok {
			t.Errorf("FindWorkload(%q) not found", id)
		}
	}
	if _, ok := s.FindWorkload("local", "ghost"); ok {
		t.Errorf("FindWorkload found a non-existent id")
	}
}

func TestBrokerFanOutAndDrop(t *testing.T) {
	b := NewBroker()
	ch, unsub := b.Subscribe()
	defer unsub()

	b.Publish(StateEvent{HostID: "local", Action: "start", Kind: "container", ID: "c1"})
	select {
	case ev := <-ch:
		if ev.Action != "start" || ev.ID != "c1" {
			t.Errorf("unexpected event %+v", ev)
		}
	case <-time.After(time.Second):
		t.Fatalf("did not receive published event")
	}

	// Unsubscribe closes the channel; further publishes must not panic.
	unsub()
	b.Publish(StateEvent{Action: "noop"})
}
