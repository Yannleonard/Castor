package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/store"
)

type providerView struct {
	ID           string   `json:"id"`
	Kind         string   `json:"kind"`
	Capabilities []string `json:"capabilities"`
}

// Providers returns the registered providers and their capabilities. The UI
// greys out a write action iff the owning provider lacks the matching cap.
func (s *Server) Providers(w http.ResponseWriter, r *http.Request) {
	provs := s.reg.List()
	out := make([]providerView, 0, len(provs))
	for _, p := range provs {
		out = append(out, providerView{
			ID:           p.ID(),
			Kind:         string(p.Kind()),
			Capabilities: p.Capabilities().Strings(),
		})
	}
	ok(w, out)
}

type hostView struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Kind        string             `json:"kind"`
	Connection  string             `json:"connection"`
	Status      string             `json:"status"`
	ProviderIDs []string           `json:"providerIds"`
	Degraded    bool               `json:"degraded"`
	Engine      *docker.EngineInfo `json:"engine,omitempty"`
}

// hostStatusForAPI trusts remote-agent status only while a live authenticated
// transport is registered. Persisted state alone can never claim connected.
func hostStatusForAPI(h *store.Host) string {
	if h.Connection == "remote-agent" {
		if h.Status == "revoked" {
			return "revoked"
		}
		if h.Status == "pending" {
			return "pending"
		}
		return h.Status
	}
	return h.Status
}

// Hosts returns registered hosts with live status and the providers they own.
func (s *Server) Hosts(w http.ResponseWriter, r *http.Request) {
	hosts, err := s.store.ListHosts(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	visible := make([]*store.Host, 0, len(hosts))
	for _, h := range hosts {
		if h.Status != "revoked" {
			visible = append(visible, h)
		}
	}
	out := make([]hostView, 0, len(hosts))
	for _, h := range visible {
		status := hostStatusForAPI(h)
		degraded := false
		var engine *docker.EngineInfo
		providerIDs := make([]string, 0)
		if h.ID == cache.HostID {
			for _, p := range s.reg.List() {
				providerIDs = append(providerIDs, p.ID())
			}
			degraded = s.manager.Store().IsDegraded(h.ID)
			if degraded {
				status = "down"
			} else {
				status = "connected"
			}
			if snap, ok := s.manager.Store().Get(h.ID); ok {
				engine = snap.Engine
			}
		}
		if h.Connection != "remote-agent" && h.ID != cache.HostID {
			status = "down"
		}
		if h.Connection == "remote-agent" {
			degraded = s.manager.Store().IsDegraded(h.ID)
			if s.agentHostLive(h.ID) && h.Status != "revoked" {
				status = "connected"
				if degraded {
					status = "down"
				}
				if _, ok := s.reg.Get(h.ID); ok {
					providerIDs = append(providerIDs, h.ID)
				} else {
					status = "down"
				}
			} else if h.Status != "pending" {
				status = "down"
			}
		}
		out = append(out, hostView{
			ID:          h.ID,
			Name:        h.Name,
			Kind:        h.Kind,
			Connection:  h.Connection,
			Status:      status,
			ProviderIDs: providerIDs,
			Degraded:    degraded,
			Engine:      engine,
		})
	}
	ok(w, out)
}

// HostDetail returns one host plus summary counts derived from the cache.
func (s *Server) HostDetail(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	h, err := s.store.GetHost(r.Context(), hostID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if h.Status == "revoked" {
		writeMapped(w, r, authz.ErrNotFound)
		return
	}

	snap, _ := s.manager.Store().Get(hostID)
	running := 0
	for _, wl := range snap.Workloads {
		if wl.State == "running" {
			running++
		}
	}
	summary := map[string]any{
		"containers": len(snap.Workloads),
		"running":    running,
		"images":     len(snap.Images),
		"networks":   len(snap.Networks),
		"volumes":    len(snap.Volumes),
		"swarmTasks": len(snap.Swarm),
		"k8sPods":    len(snap.Kube),
	}

	providerIDs := make([]string, 0)
	if h.ID == cache.HostID {
		for _, p := range s.reg.List() {
			providerIDs = append(providerIDs, p.ID())
		}
	}
	status := hostStatusForAPI(h)
	if h.ID != cache.HostID && h.Connection != "remote-agent" {
		status = "down"
	}
	if h.Connection == "remote-agent" {
		if h.Status == "pending" {
			status = "pending"
		} else {
			status = "down"
		}
		if s.agentHostLive(h.ID) && h.Status != "revoked" {
			status = "connected"
			if s.manager.Store().IsDegraded(h.ID) {
				status = "down"
			}
			if _, ok := s.reg.Get(h.ID); ok {
				providerIDs = append(providerIDs, h.ID)
			} else {
				status = "down"
			}
		}
	}

	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"id":          h.ID,
		"name":        h.Name,
		"kind":        h.Kind,
		"connection":  h.Connection,
		"status":      status,
		"providerIds": providerIDs,
		"degraded":    s.manager.Store().IsDegraded(hostID),
		"summary":     summary,
		"engine":      snap.Engine,
	})
}
