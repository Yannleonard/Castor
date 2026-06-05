package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/swarm"
)

// SwarmServices lists Swarm services from the cache snapshot.
func (s *Server) SwarmServices(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	svc := snap.SwarmServices
	if svc == nil {
		svc = []swarm.ServiceInfo{}
	}
	ok2json(w, svc)
}

// SwarmTasks lists Swarm tasks (as Workloads kind=swarm) from the cache.
func (s *Server) SwarmTasks(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	tasks := snap.Swarm
	if tasks == nil {
		tasks = []provider.Workload{}
	}
	ok2json(w, tasks)
}

// SwarmNodes lists Swarm nodes from the cache snapshot.
func (s *Server) SwarmNodes(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	nodes := snap.SwarmNodes
	if nodes == nil {
		nodes = []swarm.NodeInfo{}
	}
	ok2json(w, nodes)
}
