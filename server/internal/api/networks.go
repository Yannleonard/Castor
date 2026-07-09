package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

// Networks lists networks from the cache snapshot.
func (s *Server) Networks(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	nets := snap.Networks
	if nets == nil {
		nets = []docker.NetworkInfo{}
	}
	ok2json(w, nets)
}

// CreateNetwork creates a Docker network (perm docker.network.create; operator).
// Body: {name (required), driver? (default bridge), internal?, labels?}. Returns
// the created network summary.
func (s *Server) CreateNetwork(w http.ResponseWriter, r *http.Request) {
	var spec docker.NetworkSpec
	if err := decodeJSON(w, r, &spec); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	spec.Name = strings.TrimSpace(spec.Name)
	if !validVolumeName(spec.Name) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Invalid network name."))
		return
	}
	authz.SetAuditTarget(r, "network", spec.Name, spec.Name)

	info, err := s.manager.Docker().CreateNetwork(r.Context(), spec)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, info)
}

// DeleteNetwork removes a network by id (perm docker.network.delete; admin).
func (s *Server) DeleteNetwork(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "network", id, id)

	if err := s.manager.Docker().DeleteNetwork(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}
