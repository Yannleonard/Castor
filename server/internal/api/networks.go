package api

import (
	"net/http"

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
