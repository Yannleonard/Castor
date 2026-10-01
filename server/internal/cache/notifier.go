// Castor by IT Leonard
package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gtek-it/castor/server/internal/notify"
	"github.com/gtek-it/castor/server/internal/store"
)

// notifyDebounce is the minimum interval between two notifications for the
// same (event kind, container) pair.
const notifyDebounce = 5 * time.Minute

// notifySendTimeout caps one channel delivery from the dispatcher side.
const notifySendTimeout = 20 * time.Second

// notifyQueueSize bounds the queue between the broker loop and the delivery
// workers. Deliveries block on outbound HTTP (up to notifySendTimeout per
// channel), while the broker subscription only buffers 64 events — so sends
// must never run inline in the broker loop.
const notifyQueueSize = 256

// notifyWorkers is the number of concurrent delivery goroutines.
const notifyWorkers = 2

// notifier dispatches outbound notifications: it subscribes to the event
// Broker, reacts to container die/oom events, resolves the container name from
// the snapshot, and delivers to every enabled channel subscribed to the event
// kind. Webhook URLs are stored sealed; the unseal func is injected by the
// composition layer so this package never holds the secret key. Every send
// (success or failure) is recorded in the append-only audit log WITHOUT the
// URL (it embeds a secret token) — only channel type + name are ever logged.
type notifier struct {
	st     *store.Store
	unseal func([]byte) ([]byte, error)
	sender *notify.Sender
	broker *Broker
	snaps  *Store

	queue   chan notify.Event // broker loop -> delivery workers
	dropped atomic.Uint64     // events lost to a saturated queue

	mu       sync.Mutex
	lastSent map[string]time.Time // debounce, keyed kind|host|target
}

func newNotifier(st *store.Store, unseal func([]byte) ([]byte, error), broker *Broker, snaps *Store) *notifier {
	return &notifier{
		st:       st,
		unseal:   unseal,
		sender:   notify.NewSender(),
		broker:   broker,
		snaps:    snaps,
		queue:    make(chan notify.Event, notifyQueueSize),
		lastSent: make(map[string]time.Time),
	}
}

// ConfigureNotifications wires the outbound-notification dispatcher. The
// unseal func is injected by the API layer at composition time (it owns the
// secret key; the cache never does). Safe to call before or after Start: the
// dispatch loop launches once both the notifier and the run context exist.
// Channels are re-read from the store on every event, so channels created at
// runtime take effect immediately without a resubscribe.
func (m *Manager) ConfigureNotifications(st *store.Store, unseal func([]byte) ([]byte, error)) {
	m.notifMu.Lock()
	defer m.notifMu.Unlock()
	if m.notif != nil {
		return
	}
	m.notif = newNotifier(st, unseal, m.broker, m.store)
	if m.runCtx != nil && !m.notifStarted {
		m.notifStarted = true
		go m.notif.run(m.runCtx)
	}
}

// NotifyUpdateAvailable emits an "update.available" notification for a
// container whose image has a newer version. Called by the update checker.
// No-op until ConfigureNotifications ran; debounced like container.down.
// Delivery happens on the worker pool, so the event is only consumed once
// the dispatch loop is running (Start).
func (m *Manager) NotifyUpdateAvailable(hostID, containerName, image string) {
	m.notifMu.Lock()
	n := m.notif
	m.notifMu.Unlock()
	if n == nil {
		return
	}
	n.updateAvailable(hostID, containerName, image)
}

// startNotifier launches the dispatch loop from Manager.Start (when the
// notifier was configured before Start). Caller: Start only.
func (m *Manager) startNotifier(ctx context.Context) {
	m.notifMu.Lock()
	defer m.notifMu.Unlock()
	m.runCtx = ctx
	if m.notif != nil && !m.notifStarted {
		m.notifStarted = true
		go m.notif.run(ctx)
	}
}

// run consumes broker events until ctx is cancelled. Only container die/oom
// events are notification-worthy; everything else streams by unharmed. The
// loop itself never performs HTTP sends — those block for up to
// notifySendTimeout while the broker subscription only buffers 64 events —
// it enqueues, and the worker pool drains the queue.
func (n *notifier) run(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < notifyWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n.worker(ctx)
		}()
	}
	defer wg.Wait()

	ch, unsub := n.broker.Subscribe()
	defer unsub()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			if ev.Kind != "container" || (ev.Action != "die" && ev.Action != "oom") {
				continue
			}
			// Exit code 0 means a deliberate stop (docker stop, compose down,
			// restart), not an incident. An app that exits non-zero on a
			// voluntary stop will still notify — accepted limitation. An
			// empty code (unknown origin) notifies rather than staying
			// silent. oom always notifies.
			if ev.Action == "die" && ev.ExitCode == "0" {
				continue
			}
			n.containerDown(ev)
		}
	}
}

// worker drains the dispatch queue, one delivery (all channels) at a time.
func (n *notifier) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-n.queue:
			n.deliver(ctx, ev)
		}
	}
}

// enqueue hands an event to the delivery workers without ever blocking the
// caller; when the queue is saturated the event is dropped and counted.
func (n *notifier) enqueue(ev notify.Event) {
	select {
	case n.queue <- ev:
	default:
		log.Printf("cache: notify: dispatch queue full, dropping %s for %q (total dropped: %d)",
			ev.Kind, ev.Target, n.dropped.Add(1))
	}
}

// containerDown builds and enqueues a "container.down" event, resolving the
// human name from the snapshot (the watcher refreshed it before publishing).
func (n *notifier) containerDown(ev StateEvent) {
	if !n.shouldSend("container.down", ev.HostID, ev.ID) {
		return
	}
	name := shortID(ev.ID)
	if wl, ok := n.snaps.FindWorkload(ev.HostID, ev.ID); ok && wl.Name != "" {
		name = wl.Name
	}
	cause := "exited unexpectedly"
	if ev.Action == "oom" {
		cause = "was killed: out of memory"
	}
	n.enqueue(notify.Event{
		Kind:    "container.down",
		Title:   "Container down",
		Message: fmt.Sprintf("Container %q on host %s %s.", name, ev.HostID, cause),
		HostID:  ev.HostID,
		Target:  name,
		TS:      time.Now().Unix(),
	})
}

func (n *notifier) updateAvailable(hostID, containerName, image string) {
	if !n.shouldSend("update.available", hostID, containerName) {
		return
	}
	n.enqueue(notify.Event{
		Kind:    "update.available",
		Title:   "Update available",
		Message: fmt.Sprintf("A newer image is available for container %q (image %s) on host %s.", containerName, image, hostID),
		HostID:  hostID,
		Target:  containerName,
		TS:      time.Now().Unix(),
	})
}

// shouldSend enforces the per-(kind, container) debounce window and records
// the attempt. Expired entries are pruned lazily to bound the map.
func (n *notifier) shouldSend(kind, hostID, target string) bool {
	key := kind + "|" + hostID + "|" + target
	now := time.Now()
	n.mu.Lock()
	defer n.mu.Unlock()
	if t, ok := n.lastSent[key]; ok && now.Sub(t) < notifyDebounce {
		return false
	}
	if len(n.lastSent) > 1024 {
		for k, t := range n.lastSent {
			if now.Sub(t) >= notifyDebounce {
				delete(n.lastSent, k)
			}
		}
	}
	n.lastSent[key] = now
	return true
}

// deliver sends ev to every enabled channel subscribed to ev.Kind and audits
// each attempt. The sealed URL is opened just-in-time and never logged.
// Caller: worker only — this blocks on outbound HTTP.
func (n *notifier) deliver(ctx context.Context, ev notify.Event) {
	chans, err := n.st.ListNotificationChannels(ctx)
	if err != nil {
		log.Printf("cache: notify: list channels failed: %v", err)
		return
	}
	for _, ch := range chans {
		if !ch.Enabled || !ch.SubscribedTo(ev.Kind) {
			continue
		}
		rawURL, err := n.unseal(ch.URLEnc)
		if err != nil {
			n.audit(ctx, ch, ev, fmt.Errorf("unseal webhook URL failed"))
			log.Printf("cache: notify: %s channel %q: unseal failed", ch.Type, ch.Name)
			continue
		}
		sctx, cancel := context.WithTimeout(ctx, notifySendTimeout)
		sendErr := n.sender.Send(sctx, ch.Type, string(rawURL), ev)
		cancel()
		n.audit(ctx, ch, ev, sendErr)
		if sendErr != nil {
			// notify.Sender guarantees its errors never contain the URL.
			log.Printf("cache: notify: %s channel %q: %v", ch.Type, ch.Name, sendErr)
		}
	}
}

// audit appends one notify.send row per delivery attempt. Detail carries the
// channel type, event kind and target — never the URL.
func (n *notifier) audit(ctx context.Context, ch *store.NotificationChannel, ev notify.Event, sendErr error) {
	result := "success"
	detail := map[string]string{"channelType": ch.Type, "event": ev.Kind, "target": ev.Target}
	if sendErr != nil {
		result = "error"
		detail["error"] = sendErr.Error()
	}
	dj, _ := json.Marshal(detail)
	if err := n.st.InsertAudit(ctx, store.AuditInput{
		TS:         time.Now().Unix(),
		ActorName:  "system",
		Action:     "notify.send",
		TargetType: "notification_channel",
		TargetID:   ch.ID,
		TargetName: ch.Name,
		Result:     result,
		Detail:     string(dj),
	}); err != nil {
		log.Printf("cache: notify: audit write failed: %v", err)
	}
}

// shortID truncates a container id for display when no name resolves.
func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
