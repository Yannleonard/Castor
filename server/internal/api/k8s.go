package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/kube"
)

// K8sPods lists pods (as Workloads kind=kubernetes) from the cache, optionally
// filtered by namespace.
func (s *Server) K8sPods(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ns := r.URL.Query().Get("namespace")
	pods := make([]provider.Workload, 0, len(snap.Kube))
	for _, p := range snap.Kube {
		if ns != "" && !strings.HasPrefix(p.ID, ns+"/") {
			continue
		}
		pods = append(pods, p)
	}
	ok2json(w, pods)
}

// K8sDeployments lists deployments from the cache, optionally by namespace.
func (s *Server) K8sDeployments(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ns := r.URL.Query().Get("namespace")
	deps := make([]kube.DeploymentInfo, 0, len(snap.KubeDeployments))
	for _, d := range snap.KubeDeployments {
		if ns != "" && d.Namespace != ns {
			continue
		}
		deps = append(deps, d)
	}
	ok2json(w, deps)
}

// K8sNodes lists Kubernetes nodes from the cache snapshot.
func (s *Server) K8sNodes(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	nodes := snap.KubeNodes
	if nodes == nil {
		nodes = []kube.NodeInfo{}
	}
	ok2json(w, nodes)
}
