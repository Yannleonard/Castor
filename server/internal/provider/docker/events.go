package docker

import (
	"context"

	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
)

// StateEvent is a normalized engine event the cache watcher consumes to patch
// the snapshot and emit a targeted UI update (Docker-only; CapEvents).
type StateEvent struct {
	Action string // "create" | "start" | "die" | "stop" | "destroy" | "health_status" | ...
	Kind   string // "container" | "network" | "volume" | "image"
	ID     string // resource id
	Actor  map[string]string
}

// Events subscribes to the Docker event stream, filtered to the resource types
// Castor reacts to (containers, networks, volumes, images). It returns a
// receive-only channel of normalized StateEvents and a channel of errors. Both
// close when ctx is cancelled or the underlying stream errors; the cache
// watcher then reconnects with backoff and forces a full resync.
func (p *DockerProvider) Events(ctx context.Context) (<-chan StateEvent, <-chan error) {
	f := filters.NewArgs()
	f.Add("type", string(events.ContainerEventType))
	f.Add("type", string(events.NetworkEventType))
	f.Add("type", string(events.VolumeEventType))
	f.Add("type", string(events.ImageEventType))

	msgCh, errCh := p.cli.Events(ctx, events.ListOptions{Filters: f})

	out := make(chan StateEvent)
	outErr := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(outErr)
		for {
			select {
			case <-ctx.Done():
				return
			case err, ok := <-errCh:
				if !ok {
					return
				}
				if err != nil {
					select {
					case outErr <- err:
					default:
					}
				}
				return
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				se := normalizeEvent(msg)
				if se.Kind == "" {
					continue
				}
				select {
				case out <- se:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return out, outErr
}

// normalizeEvent converts an events.Message into a StateEvent.
func normalizeEvent(m events.Message) StateEvent {
	kind := ""
	switch m.Type {
	case events.ContainerEventType:
		kind = "container"
	case events.NetworkEventType:
		kind = "network"
	case events.VolumeEventType:
		kind = "volume"
	case events.ImageEventType:
		kind = "image"
	default:
		return StateEvent{}
	}
	id := m.Actor.ID
	return StateEvent{
		Action: string(m.Action),
		Kind:   kind,
		ID:     id,
		Actor:  m.Actor.Attributes,
	}
}
