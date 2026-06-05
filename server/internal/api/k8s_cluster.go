package api

// k8s_cluster.go holds the Kubernetes autoscaling + core cluster-object surface
// (Wave 3): HorizontalPodAutoscalers (list/create/delete), Namespaces (list/
// create/delete), and the read-only Services / ConfigMaps / Secrets / Events
// lists. They reach the provider via s.kubeProvider (which 404s when no
// kubeconfig is wired), decode the small body, call the provider, and map errors
// via writeMapped. RBAC + AAL + AuditWrap are applied by the router, not here.
//
// SECURITY: the secrets handler returns only key NAMES + the secret type — never
// any secret value (enforced in kube.ListSecrets).

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/kube"
)

// k8sNamespaceQuery reads the optional ?namespace= filter ("" = all namespaces).
func k8sNamespaceQuery(r *http.Request) string {
	return r.URL.Query().Get("namespace")
}

// hpaCreateRequest is the body for POST .../k8s/hpas. Mirrors kube.HPACreateSpec.
type hpaCreateRequest struct {
	Name             string `json:"name"`
	TargetDeployment string `json:"targetDeployment"`
	MinReplicas      int32  `json:"minReplicas"`
	MaxReplicas      int32  `json:"maxReplicas"`
	CpuPercent       int32  `json:"cpuPercent"`
}

// namespaceCreateRequest is the body for POST .../k8s/namespaces.
type namespaceCreateRequest struct {
	Name string `json:"name"`
}

/* ============================ HPA ============================ */

// K8sHPAs lists HorizontalPodAutoscalers (perm k8s.hpa.read), optionally filtered
// by ?namespace=.
func (s *Server) K8sHPAs(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	hpas, err := k.ListHPAs(r.Context(), k8sNamespaceQuery(r))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if hpas == nil {
		hpas = []kube.HPAInfo{}
	}
	ok(w, hpas)
}

// K8sCreateHPA creates a CPU-utilization HPA targeting a Deployment
// (perm k8s.hpa.write). The namespace is required (path-agnostic body carries the
// rest); min/max/cpu are validated by the provider.
func (s *Server) K8sCreateHPA(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	var req hpaCreateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ns := k8sNamespaceQuery(r)
	if ns == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "namespace is required."))
		return
	}
	if req.Name == "" || req.TargetDeployment == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "name and targetDeployment are required."))
		return
	}
	if req.MinReplicas < 0 || req.MaxReplicas < 0 || req.CpuPercent < 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "replica and cpu values must be >= 0."))
		return
	}
	authz.SetAuditTarget(r, "k8s.hpa", ns+"/"+req.Name, req.Name)

	spec := kube.HPACreateSpec{
		Name:             req.Name,
		TargetDeployment: req.TargetDeployment,
		MinReplicas:      req.MinReplicas,
		MaxReplicas:      req.MaxReplicas,
		CpuPercent:       req.CpuPercent,
	}
	if err := k.CreateHPA(r.Context(), ns, spec); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeleteHPA deletes an HPA (perm k8s.hpa.write). {ns}/{name} are distinct path
// segments.
func (s *Server) K8sDeleteHPA(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.hpa", ns+"/"+name, name)

	if err := k.DeleteHPA(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

/* ============================ Namespaces ============================ */

// K8sNamespaces lists Namespaces (perm k8s.namespace.read).
func (s *Server) K8sNamespaces(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	nss, err := k.ListNamespaces(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if nss == nil {
		nss = []kube.NamespaceInfo{}
	}
	ok(w, nss)
}

// K8sCreateNamespace creates a Namespace (perm k8s.namespace.write, admin-only).
func (s *Server) K8sCreateNamespace(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	var req namespaceCreateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Name == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "name is required."))
		return
	}
	authz.SetAuditTarget(r, "k8s.namespace", req.Name, req.Name)

	if err := k.CreateNamespace(r.Context(), req.Name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeleteNamespace deletes a Namespace (perm k8s.namespace.write, admin-only).
func (s *Server) K8sDeleteNamespace(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	name := pathUnescape(chi.URLParam(r, "name"))
	authz.SetAuditTarget(r, "k8s.namespace", name, name)

	if err := k.DeleteNamespace(r.Context(), name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

/* ============================ Services / ConfigMaps / Secrets / Events ============================ */

// K8sServices lists Services (perm k8s.service.read), optionally by ?namespace=.
func (s *Server) K8sServices(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	svcs, err := k.ListServices(r.Context(), k8sNamespaceQuery(r))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if svcs == nil {
		svcs = []kube.ServiceInfoK8s{}
	}
	ok(w, svcs)
}

// K8sConfigMaps lists ConfigMaps (perm k8s.config.read), optionally by
// ?namespace=. Only key names are returned (values omitted).
func (s *Server) K8sConfigMaps(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	cms, err := k.ListConfigMaps(r.Context(), k8sNamespaceQuery(r))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if cms == nil {
		cms = []kube.ConfigMapInfo{}
	}
	ok(w, cms)
}

// K8sSecrets lists Secrets (perm k8s.config.read), optionally by ?namespace=.
// SECURITY: only key names + the secret type are returned — never any value.
func (s *Server) K8sSecrets(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	secs, err := k.ListSecrets(r.Context(), k8sNamespaceQuery(r))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if secs == nil {
		secs = []kube.SecretInfo{}
	}
	ok(w, secs)
}

// K8sEvents lists Events (perm k8s.config.read), optionally by ?namespace=,
// newest-first and capped.
func (s *Server) K8sEvents(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	evs, err := k.ListEvents(r.Context(), k8sNamespaceQuery(r))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if evs == nil {
		evs = []kube.EventInfo{}
	}
	ok(w, evs)
}

/* ============================ Ingresses ============================ */

// K8sIngresses lists networking/v1 Ingresses (perm k8s.ingress.read), optionally
// by ?namespace=. Create/update is covered by the generic manifest-apply path
// (POST .../k8s/apply); only list + delete are typed here.
func (s *Server) K8sIngresses(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	ings, err := k.ListIngresses(r.Context(), k8sNamespaceQuery(r))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if ings == nil {
		ings = []kube.IngressInfo{}
	}
	ok(w, ings)
}

// K8sDeleteIngress deletes an Ingress (perm k8s.ingress.write). {ns}/{name} are
// distinct path segments.
func (s *Server) K8sDeleteIngress(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.ingress", ns+"/"+name, name)

	if err := k.DeleteIngress(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

/* ============================ Live metrics (metrics-server) ============================ */

// nodeMetricsResponse / podMetricsResponse wrap the metrics list with an
// `available` flag. When metrics-server is not installed the handlers answer 200
// with available=false and an empty items array (NOT a 500), so the UI can show
// a clear "install metrics-server" hint rather than an error toast.
type nodeMetricsResponse struct {
	Available bool              `json:"available"`
	Items     []kube.NodeMetric `json:"items"`
}

type podMetricsResponse struct {
	Available bool             `json:"available"`
	Items     []kube.PodMetric `json:"items"`
}

// K8sNodeMetrics returns live per-node CPU/memory usage from metrics-server
// (perm k8s.metrics.read). Missing metrics-server -> {available:false, items:[]}.
func (s *Server) K8sNodeMetrics(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	metrics, err := k.NodeMetrics(r.Context())
	if err != nil {
		if errors.Is(err, kube.ErrMetricsUnavailable) {
			ok(w, nodeMetricsResponse{Available: false, Items: []kube.NodeMetric{}})
			return
		}
		writeMapped(w, r, err)
		return
	}
	if metrics == nil {
		metrics = []kube.NodeMetric{}
	}
	ok(w, nodeMetricsResponse{Available: true, Items: metrics})
}

// K8sPodMetrics returns live per-pod CPU/memory usage from metrics-server
// (perm k8s.metrics.read), optionally by ?namespace=. Missing metrics-server ->
// {available:false, items:[]}.
func (s *Server) K8sPodMetrics(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	metrics, err := k.PodMetrics(r.Context(), k8sNamespaceQuery(r))
	if err != nil {
		if errors.Is(err, kube.ErrMetricsUnavailable) {
			ok(w, podMetricsResponse{Available: false, Items: []kube.PodMetric{}})
			return
		}
		writeMapped(w, r, err)
		return
	}
	if metrics == nil {
		metrics = []kube.PodMetric{}
	}
	ok(w, podMetricsResponse{Available: true, Items: metrics})
}
