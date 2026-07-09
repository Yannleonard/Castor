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

// K8sStatefulSets lists statefulsets from the cache, optionally by namespace.
func (s *Server) K8sStatefulSets(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ns := r.URL.Query().Get("namespace")
	sets := make([]kube.StatefulSetInfo, 0, len(snap.KubeStatefulSets))
	for _, v := range snap.KubeStatefulSets {
		if ns != "" && v.Namespace != ns {
			continue
		}
		sets = append(sets, v)
	}
	ok2json(w, sets)
}

// K8sDaemonSets lists daemonsets from the cache, optionally by namespace.
func (s *Server) K8sDaemonSets(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ns := r.URL.Query().Get("namespace")
	sets := make([]kube.DaemonSetInfo, 0, len(snap.KubeDaemonSets))
	for _, v := range snap.KubeDaemonSets {
		if ns != "" && v.Namespace != ns {
			continue
		}
		sets = append(sets, v)
	}
	ok2json(w, sets)
}

// K8sJobs lists jobs from the cache, optionally by namespace.
func (s *Server) K8sJobs(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ns := r.URL.Query().Get("namespace")
	jobs := make([]kube.JobInfo, 0, len(snap.KubeJobs))
	for _, v := range snap.KubeJobs {
		if ns != "" && v.Namespace != ns {
			continue
		}
		jobs = append(jobs, v)
	}
	ok2json(w, jobs)
}

// K8sCronJobs lists cronjobs from the cache, optionally by namespace.
func (s *Server) K8sCronJobs(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ns := r.URL.Query().Get("namespace")
	crons := make([]kube.CronJobInfo, 0, len(snap.KubeCronJobs))
	for _, v := range snap.KubeCronJobs {
		if ns != "" && v.Namespace != ns {
			continue
		}
		crons = append(crons, v)
	}
	ok2json(w, crons)
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
