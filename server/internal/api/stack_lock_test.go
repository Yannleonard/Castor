package api

import (
	"sync"
	"testing"
)

// newLockServer builds a Server with only the per-stack lock registry wired, which
// is all stackMutex needs. It avoids constructing the full dependency graph so the
// concurrency behavior can be exercised in isolation.
func newLockServer() *Server {
	return &Server{stackLocks: make(map[string]*sync.Mutex)}
}

// TestStackMutexIdentity checks the registry hands back the same mutex for a given
// stack id and distinct mutexes for different ids, so the lock actually serializes
// per stack (and does not accidentally globalize).
func TestStackMutexIdentity(t *testing.T) {
	s := newLockServer()
	a1 := s.stackMutex("stack-a")
	a2 := s.stackMutex("stack-a")
	b := s.stackMutex("stack-b")

	if a1 != a2 {
		t.Fatal("stackMutex returned different mutexes for the same id")
	}
	if a1 == b {
		t.Fatal("stackMutex returned the same mutex for different ids")
	}
}

// TestStackMutexTryLock models the syncAndDeploy guard: while one sync holds a
// stack's mutex, a second TryLock on the same stack must fail (mapped to 409),
// while another stack's mutex is unaffected. Releasing the first lets a later sync
// proceed.
func TestStackMutexTryLock(t *testing.T) {
	s := newLockServer()

	first := s.stackMutex("stack-a")
	if !first.TryLock() {
		t.Fatal("first TryLock on an idle stack must succeed")
	}

	// A concurrent sync for the same stack is refused.
	if s.stackMutex("stack-a").TryLock() {
		t.Fatal("second TryLock on a busy stack must fail (would 409)")
	}

	// A different stack is not blocked.
	other := s.stackMutex("stack-b")
	if !other.TryLock() {
		t.Fatal("TryLock on a different stack must succeed")
	}
	other.Unlock()

	// Once the first sync finishes, a later sync of that stack can proceed.
	first.Unlock()
	if !s.stackMutex("stack-a").TryLock() {
		t.Fatal("TryLock after release must succeed")
	}
	s.stackMutex("stack-a").Unlock()
}

// TestStackMutexConcurrentRegistration hammers stackMutex from many goroutines to
// confirm the registry map is safe under concurrent first-use and always yields
// one canonical mutex per id.
func TestStackMutexConcurrentRegistration(t *testing.T) {
	s := newLockServer()
	const n = 64
	got := make([]*sync.Mutex, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(idx int) {
			defer wg.Done()
			got[idx] = s.stackMutex("same-id")
		}(i)
	}
	wg.Wait()
	for i := 1; i < n; i++ {
		if got[i] != got[0] {
			t.Fatalf("goroutine %d observed a different mutex for the same id", i)
		}
	}
}
