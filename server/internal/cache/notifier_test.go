// Castor by IT Leonard
package cache

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/notify"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
)

func newNotifierTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Connect(&config.Config{DBPath: filepath.Join(t.TempDir(), "notif.db")})
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if err := st.Seed(ctx); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return st
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}

// TestNotifierDispatchAndDebounce covers the full pipeline: a container "die"
// StateEvent resolves the name from the snapshot, unseals the channel URL,
// delivers to the subscribed webhook exactly once per debounce window,
// ignores clean exits (code 0), exposes NotifyUpdateAvailable for the update
// checker, skips disabled channels, and audits every send without ever
// writing the URL.
func TestNotifierDispatchAndDebounce(t *testing.T) {
	// The webhook endpoint is a loopback httptest server, refused by the dial
	// guard unless allowed.
	t.Setenv("CASTOR_NOTIFY_ALLOW_LOOPBACK", "true")
	key := make([]byte, 32)
	st := newNotifierTestStore(t)
	ctx := context.Background()

	var mu sync.Mutex
	var got []notify.Event
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ev notify.Event
		_ = json.NewDecoder(r.Body).Decode(&ev)
		mu.Lock()
		got = append(got, ev)
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	sent := func() int { mu.Lock(); defer mu.Unlock(); return len(got) }

	sealed, err := authz.SealSecret(key, []byte(srv.URL))
	if err != nil {
		t.Fatalf("SealSecret: %v", err)
	}
	if err := st.CreateNotificationChannel(ctx, &store.NotificationChannel{
		ID: store.NewUUID(), Name: "hook", Type: "webhook", URLEnc: sealed,
		Events: []string{"container.down", "update.available"}, Enabled: true,
	}); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	// A disabled channel pointing at the same endpoint must never fire.
	if err := st.CreateNotificationChannel(ctx, &store.NotificationChannel{
		ID: store.NewUUID(), Name: "off", Type: "webhook", URLEnc: sealed,
		Events: []string{"container.down"}, Enabled: false,
	}); err != nil {
		t.Fatalf("create disabled channel: %v", err)
	}

	m := NewManager(&config.Config{}, nil, nil, nil)
	m.Store().SeedSnapshotForTest(HostID, provider.Workload{
		ID: "c1", Name: "web", Kind: provider.KindDocker,
	})
	m.ConfigureNotifications(st, func(enc []byte) ([]byte, error) {
		return authz.OpenSecret(key, enc)
	})
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	m.startNotifier(runCtx)

	// The dispatcher must be subscribed before we publish, or the event drops.
	waitFor(t, "broker subscription", func() bool {
		m.broker.mu.RLock()
		defer m.broker.mu.RUnlock()
		return len(m.broker.subs) > 0
	})

	m.Broker().Publish(StateEvent{HostID: HostID, Kind: "container", Action: "die", ID: "c1"})
	waitFor(t, "container.down delivery", func() bool { return sent() == 1 })
	mu.Lock()
	if got[0].Kind != "container.down" || got[0].Target != "web" {
		t.Errorf("event = %+v want kind container.down target web", got[0])
	}
	mu.Unlock()

	// Same container again inside the 5-minute window -> debounced.
	m.Broker().Publish(StateEvent{HostID: HostID, Kind: "container", Action: "die", ID: "c1"})
	time.Sleep(200 * time.Millisecond)
	if n := sent(); n != 1 {
		t.Fatalf("debounce failed: %d sends, want 1", n)
	}

	// Irrelevant actions must not notify.
	m.Broker().Publish(StateEvent{HostID: HostID, Kind: "container", Action: "start", ID: "c2"})
	m.Broker().Publish(StateEvent{HostID: HostID, Kind: "image", Action: "pull", ID: "img"})
	time.Sleep(100 * time.Millisecond)
	if n := sent(); n != 1 {
		t.Fatalf("non-down events must not notify: %d sends", n)
	}

	// A clean exit (code 0: docker stop, compose down, restart) is not an
	// incident and must not notify.
	m.Broker().Publish(StateEvent{HostID: HostID, Kind: "container", Action: "die", ID: "c3", ExitCode: "0"})
	time.Sleep(100 * time.Millisecond)
	if n := sent(); n != 1 {
		t.Fatalf("clean exit must not notify: %d sends", n)
	}

	// A non-zero exit on a different container is an incident.
	m.Broker().Publish(StateEvent{HostID: HostID, Kind: "container", Action: "die", ID: "c3", ExitCode: "137"})
	waitFor(t, "crash (exit 137) delivery", func() bool { return sent() == 2 })

	// The public hook for the update checker.
	m.NotifyUpdateAvailable(HostID, "web", "nginx:1.27")
	waitFor(t, "update.available delivery", func() bool { return sent() == 3 })
	mu.Lock()
	if got[2].Kind != "update.available" || got[2].Target != "web" {
		t.Errorf("event = %+v want kind update.available target web", got[2])
	}
	mu.Unlock()

	// Every send is audited, success, and detail never contains the URL.
	rows, _, err := st.ListAudit(ctx, store.AuditFilter{Action: "notify.send"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("audit rows = %d want 3", len(rows))
	}
	for _, row := range rows {
		if row.Result != "success" {
			t.Errorf("audit result = %q", row.Result)
		}
		if row.TargetName != "hook" {
			t.Errorf("audit target = %q want hook", row.TargetName)
		}
		if strings.Contains(row.Detail, srv.URL) {
			t.Errorf("audit detail leaks the webhook URL: %s", row.Detail)
		}
	}
}
