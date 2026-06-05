package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/swarm"
)

// swarmProviderOr405 returns the swarm provider, or writes a 405 (the host is
// not a swarm manager / swarm is not enabled) and reports false. Mirrors the
// "read-only -> ErrMethodNotAllowed" defense used for generic workloads.
func (s *Server) swarmProviderOr405(w http.ResponseWriter, r *http.Request) (*swarm.SwarmProvider, bool) {
	p := s.manager.Swarm()
	if p == nil {
		authz.WriteError(w, r, authz.ErrMethodNotAllowed)
		return nil, false
	}
	return p, true
}

// serviceScaleRequest is the body for POST .../swarm/services/{id}/scale.
type serviceScaleRequest struct {
	Replicas uint64 `json:"replicas"`
}

// nodeAvailabilityRequest is the body for POST .../swarm/nodes/{id}/availability.
type nodeAvailabilityRequest struct {
	Availability string `json:"availability"`
}

// SwarmServiceCreate creates a swarm service (perm swarm.service.create) and
// returns the created id with 201.
func (s *Server) SwarmServiceCreate(w http.ResponseWriter, r *http.Request) {
	p, ok := s.swarmProviderOr405(w, r)
	if !ok {
		return
	}
	var spec swarm.ServiceCreateSpec
	if err := decodeJSON(w, r, &spec); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(spec.Name) == "" || strings.TrimSpace(spec.Image) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Service name and image are required."))
		return
	}
	authz.SetAuditTarget(r, "swarm-service", spec.Name, spec.Name)

	id, err := p.ServiceCreate(r.Context(), spec)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "swarm-service", id, spec.Name)
	created(w, map[string]any{"ok": true, "id": id})
}

// SwarmServiceScale sets a replicated service's replica count
// (perm swarm.service.scale).
func (s *Server) SwarmServiceScale(w http.ResponseWriter, r *http.Request) {
	p, ok := s.swarmProviderOr405(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "swarm-service", id, id)

	var req serviceScaleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := p.ServiceScale(r.Context(), id, req.Replicas); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// SwarmServiceUpdate applies a partial update {image?,env?,replicas?}
// (perm swarm.service.update). An image change triggers a rolling update.
func (s *Server) SwarmServiceUpdate(w http.ResponseWriter, r *http.Request) {
	p, ok := s.swarmProviderOr405(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "swarm-service", id, id)

	var in swarm.ServiceUpdateInput
	if err := decodeJSON(w, r, &in); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := p.ServiceUpdateSpec(r.Context(), id, in); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// SwarmServiceRestart forces a rolling redeploy of a service's tasks
// (perm swarm.service.update — reuses the update permission, it is a forced
// no-op spec update).
func (s *Server) SwarmServiceRestart(w http.ResponseWriter, r *http.Request) {
	p, ok := s.swarmProviderOr405(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "swarm-service", id, id)

	if err := p.ServiceRollingRestart(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// SwarmServiceRemove deletes a swarm service (perm swarm.service.remove).
func (s *Server) SwarmServiceRemove(w http.ResponseWriter, r *http.Request) {
	p, ok := s.swarmProviderOr405(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "swarm-service", id, id)

	if err := p.ServiceRemove(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// SwarmNodeAvailability sets a node's scheduling availability
// (perm swarm.node.update). Body: {availability:"active"|"pause"|"drain"}.
func (s *Server) SwarmNodeAvailability(w http.ResponseWriter, r *http.Request) {
	p, ok := s.swarmProviderOr405(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "swarm-node", id, id)

	var req nodeAvailabilityRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	switch strings.ToLower(strings.TrimSpace(req.Availability)) {
	case "active", "pause", "drain":
	default:
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Availability must be one of: active, pause, drain."))
		return
	}
	if err := p.NodeUpdateAvailability(r.Context(), id, req.Availability); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}
