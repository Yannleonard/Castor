package provider

import "sync"

// Registry holds the active providers, keyed by Provider.ID(). The API resolves
// a workload to its owning provider via Workload.ProviderID. In V1 the registry
// has exactly the providers configured locally (docker + optionally swarm +
// optionally kube). In V2 each enrolled agent registers as an additional
// Provider with the SAME interface — no API/UI change.
type Registry struct {
	mu   sync.RWMutex
	byID map[string]Provider
}

// NewRegistry returns an empty Registry.
func NewRegistry() *Registry {
	return &Registry{byID: make(map[string]Provider)}
}

// Register adds (or replaces) a provider keyed by p.ID().
func (r *Registry) Register(p Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.byID[p.ID()] = p
}

// Get returns the provider with the given id.
func (r *Registry) Get(id string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.byID[id]
	return p, ok
}

// List returns all registered providers (order is unspecified).
func (r *Registry) List() []Provider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Provider, 0, len(r.byID))
	for _, p := range r.byID {
		out = append(out, p)
	}
	return out
}
