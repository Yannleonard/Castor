package api

// k8s_storage.go holds the Kubernetes storage surface: read PersistentVolumes,
// PersistentVolumeClaims and StorageClasses, plus create + delete a PVC. They
// reach the provider via s.kubeProvider (404 when no kubeconfig is wired,
// matching the other k8s handlers). Reads list directly off the live clientset
// (storage objects are not in the cache snapshot). Each mutating handler follows
// the codebase convention: resolve provider, set the audit target, decode the
// (small) body, call the provider, map errors via writeMapped. RBAC + AAL +
// AuditWrap are applied by the router, not here.

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/kube"
)

// pvcCreateRequest is the body for POST .../k8s/pvcs. name + requestBytes are
// required; storageClass "" uses the cluster default; accessModes default to
// ["ReadWriteOnce"] when empty. requestBytes is the requested storage in bytes.
type pvcCreateRequest struct {
	Name         string   `json:"name"`
	Namespace    string   `json:"namespace"`
	StorageClass string   `json:"storageClass"`
	AccessModes  []string `json:"accessModes"`
	RequestBytes int64    `json:"requestBytes"`
}

// K8sPVs lists PersistentVolumes (perm k8s.storage.read).
func (s *Server) K8sPVs(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	pvs, err := k.ListPVs(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2json(w, pvs)
}

// K8sPVCs lists PersistentVolumeClaims (perm k8s.storage.read), optionally
// scoped to ?namespace= (empty => all namespaces).
func (s *Server) K8sPVCs(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	ns := r.URL.Query().Get("namespace")
	pvcs, err := k.ListPVCs(r.Context(), ns)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2json(w, pvcs)
}

// K8sStorageClasses lists StorageClasses (perm k8s.storage.read).
func (s *Server) K8sStorageClasses(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	scs, err := k.ListStorageClasses(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2json(w, scs)
}

// K8sCreatePVC creates a PersistentVolumeClaim (perm k8s.storage.write). The
// target namespace comes from the request body (defaulting to "default" when
// omitted). name + a positive requestBytes are required.
func (s *Server) K8sCreatePVC(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	var req pvcCreateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Name == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "name is required."))
		return
	}
	if req.RequestBytes <= 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "requestBytes must be > 0."))
		return
	}
	ns := req.Namespace
	if ns == "" {
		ns = "default"
	}
	authz.SetAuditTarget(r, "k8s.pvc", ns+"/"+req.Name, req.Name)

	pvc, err := k.CreatePVC(r.Context(), ns, kube.PVCCreateSpec{
		Name:         req.Name,
		StorageClass: req.StorageClass,
		AccessModes:  req.AccessModes,
		RequestBytes: req.RequestBytes,
	})
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	created(w, pvc)
}

// K8sDeletePVC deletes a PersistentVolumeClaim (perm k8s.storage.write). The
// {ns} and {name} path params are distinct segments (both are DNS labels).
func (s *Server) K8sDeletePVC(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	ns := pathUnescape(chi.URLParam(r, "ns"))
	name := pathUnescape(chi.URLParam(r, "name"))
	authz.SetAuditTarget(r, "k8s.pvc", ns+"/"+name, name)

	if err := k.DeletePVC(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}
