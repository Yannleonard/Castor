package cache

import "sync"

// StateEvent is a normalized state-change notification the WS "events" channel
// relays to subscribed UI tabs to drive reactive refresh within ~1s.
type StateEvent struct {
	HostID        string         `json:"hostId"`
	Action        string         `json:"action"` // create|start|die|stop|destroy|health_status|snapshot.replaced|...
	Kind          string         `json:"kind"`   // container|network|volume|image|""(fleet)
	ID            string         `json:"id"`
	SnapshotDelta map[string]any `json:"snapshotDelta,omitempty"`
}

// Broker is a simple fan-out of StateEvents to registered subscribers. The WS
// hub registers one subscriber per connected tab; the poller and watcher
// publish events.
type Broker struct {
	mu   sync.RWMutex
	subs map[int]chan StateEvent
	next int
}

// NewBroker returns an empty event broker.
func NewBroker() *Broker {
	return &Broker{subs: make(map[int]chan StateEvent)}
}

// Subscribe registers a new subscriber, returning the channel and an
// unsubscribe func. The channel is buffered; slow consumers drop events rather
// than block the publisher.
func (b *Broker) Subscribe() (<-chan StateEvent, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.next
	b.next++
	ch := make(chan StateEvent, 64)
	b.subs[id] = ch
	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if c, ok := b.subs[id]; ok {
			delete(b.subs, id)
			close(c)
		}
	}
}

// Publish delivers an event to all subscribers, dropping it for any subscriber
// whose buffer is full (reactive refresh is best-effort; the poller is the
// source of truth).
func (b *Broker) Publish(ev StateEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}
