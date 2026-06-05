package cache

import (
	"context"
	"sync"
	"testing"
	"time"
)

// TestOneLiveStatsRule verifies that acquiring a new stats stream for a session
// cancels the previous one and notifies the old subId (ADR-CASTOR-001).
func TestOneLiveStatsRule(t *testing.T) {
	reg := NewRegistry()
	const sess = "session-A"

	ctx1 := reg.AcquireStats(context.Background(), sess, "sub1", func(string) {
		t.Fatalf("first acquire must not supersede anything")
	})
	if ctx1.Err() != nil {
		t.Fatalf("first stats ctx should be live")
	}

	var superseded []string
	var mu sync.Mutex
	ctx2 := reg.AcquireStats(context.Background(), sess, "sub2", func(old string) {
		mu.Lock()
		superseded = append(superseded, old)
		mu.Unlock()
	})

	// The first stream's context must now be cancelled.
	select {
	case <-ctx1.Done():
	case <-time.After(time.Second):
		t.Fatalf("first stats stream was not cancelled when the second was acquired")
	}
	if ctx2.Err() != nil {
		t.Fatalf("second stats ctx should be live")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(superseded) != 1 || superseded[0] != "sub1" {
		t.Fatalf("expected sub1 to be superseded, got %v", superseded)
	}
}

func TestReleaseStatsOnlyMatchingSubID(t *testing.T) {
	reg := NewRegistry()
	const sess = "s"
	ctx := reg.AcquireStats(context.Background(), sess, "subX", nil)

	// Releasing a different subId must NOT cancel the active stream.
	reg.ReleaseStats(sess, "other")
	if ctx.Err() != nil {
		t.Fatalf("releasing a non-matching subId must not cancel the stream")
	}

	// Releasing the matching subId cancels it.
	reg.ReleaseStats(sess, "subX")
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatalf("matching ReleaseStats did not cancel the stream")
	}
}

func TestCloseSessionCancelsStats(t *testing.T) {
	reg := NewRegistry()
	const sess = "s"
	ctx := reg.AcquireStats(context.Background(), sess, "subX", nil)
	reg.CloseSession(sess)
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatalf("CloseSession did not cancel the active stats stream")
	}
}

func TestStatsRuleIsPerSession(t *testing.T) {
	reg := NewRegistry()
	ctxA := reg.AcquireStats(context.Background(), "A", "a1", nil)
	// A different session acquiring must NOT affect session A.
	_ = reg.AcquireStats(context.Background(), "B", "b1", func(string) {
		t.Fatalf("acquiring for session B must not supersede session A")
	})
	if ctxA.Err() != nil {
		t.Fatalf("session A stream must remain live across sessions")
	}
}
