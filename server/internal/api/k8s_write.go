package api

// k8s_write.go holds the mutating Kubernetes handlers: scale/restart/delete a
// Deployment or StatefulSet, restart/delete a DaemonSet, delete a Pod/Job/
// CronJob, trigger/suspend a CronJob, and apply a YAML manifest. They reach the
// provider via s.manager.Kube() (nil when no kubeconfig is wired -> 404,
// matching the read handlers' "host/feature absent" behavior). Each follows the
// codebase convention: resolve provider, set the audit target, decode the
// (small) body, call the provider, map errors via writeMapped, and return ok2 /
// a result body. RBAC + AAL + AuditWrap are applied by the router, not here.

import (
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/kube"
)

// scaleRequest is the body for POST .../scale.
type scaleRequest struct {
	Replicas int32 `json:"replicas"`
}

// suspendRequest is the body for POST .../cronjobs/{ns}/{name}/suspend.
type suspendRequest struct {
	Suspend bool `json:"suspend"`
}

// triggerCronJobResponse carries the name of the Job created from a CronJob's
// jobTemplate by a manual trigger.
type triggerCronJobResponse struct {
	OK  bool   `json:"ok"`
	Job string `json:"job"`
}

// applyRequest is the body for POST .../k8s/apply.
type applyRequest struct {
	YAML string `json:"yaml"`
}

// setResourcesRequest is the body for POST .../resources. containerName selects
// the target container (empty => first); requests/limits carry the cpu (milli)
// and memory (bytes) values to set (a 0 entry is left unchanged).
type setResourcesRequest struct {
	ContainerName string            `json:"containerName"`
	Requests      kube.ResourceSpec `json:"requests"`
	Limits        kube.ResourceSpec `json:"limits"`
}

// applyResponse wraps the per-document apply results.
type applyResponse struct {
	Results []kube.ApplyResult `json:"results"`
}

// kubeProvider returns the kube provider or writes a 404 and reports false when
// Kubernetes is not configured for this instance.
func (s *Server) kubeProvider(w http.ResponseWriter, r *http.Request) (*kube.KubeProvider, bool) {
	k := s.manager.Kube()
	if k == nil {
		authz.WriteError(w, r, authz.ErrNotFound)
		return nil, false
	}
	return k, true
}

// k8sNsName extracts and URL-unescapes the {ns} and {name} path params. The UI
// may percent-encode segments (e.g. a name is always a DNS label, but stay
// defensive and decode like workloadID does).
func k8sNsName(r *http.Request) (ns, name string) {
	return pathUnescape(chi.URLParam(r, "ns")), pathUnescape(chi.URLParam(r, "name"))
}

// pathUnescape best-effort percent-decodes a single path segment.
func pathUnescape(raw string) string {
	if dec, err := url.PathUnescape(raw); err == nil {
		return dec
	}
	return raw
}

// K8sScaleDeployment sets a Deployment's replicas (perm k8s.deployment.scale).
func (s *Server) K8sScaleDeployment(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.deployment", ns+"/"+name, name)

	var req scaleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Replicas < 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "replicas must be >= 0."))
		return
	}
	if err := k.ScaleDeployment(r.Context(), ns, name, req.Replicas); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sRestartDeployment triggers a rolling restart (perm k8s.deployment.restart).
func (s *Server) K8sRestartDeployment(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.deployment", ns+"/"+name, name)

	if err := k.RolloutRestart(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeleteDeployment deletes a Deployment (perm k8s.workload.delete).
func (s *Server) K8sDeleteDeployment(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.deployment", ns+"/"+name, name)

	if err := k.DeleteDeployment(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeletePod deletes a single Pod (perm k8s.workload.delete).
func (s *Server) K8sDeletePod(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.pod", ns+"/"+name, name)

	if err := k.DeletePod(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sApply applies a (multi-document) YAML manifest via server-side apply
// (perm k8s.manifest.apply). A per-document failure is reported inside the
// results array (action="error") with an overall 200; the call fails only on a
// wholesale error (e.g. discovery unavailable) or an empty/invalid body.
func (s *Server) K8sApply(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	var req applyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.YAML == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "yaml is required."))
		return
	}
	authz.SetAuditTarget(r, "k8s.manifest", "apply", "manifest")

	results, err := k.ApplyManifest(r.Context(), req.YAML)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, applyResponse{Results: results})
}

// K8sSetDeploymentResources sets a Deployment container's CPU/memory
// requests+limits (perm k8s.deployment.resources). A 0 cpuMilli/memoryBytes
// entry is left unchanged; negative values are rejected. The target container is
// the request's containerName, or the first container when omitted.
func (s *Server) K8sSetDeploymentResources(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.deployment", ns+"/"+name, name)

	var req setResourcesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Requests.CpuMilli < 0 || req.Requests.MemoryBytes < 0 ||
		req.Limits.CpuMilli < 0 || req.Limits.MemoryBytes < 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "resource values must be >= 0."))
		return
	}
	if err := k.SetDeploymentResources(r.Context(), ns, name, req.ContainerName, req.Requests, req.Limits); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sScaleStatefulSet sets a StatefulSet's replicas (perm k8s.statefulset.scale).
func (s *Server) K8sScaleStatefulSet(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.statefulset", ns+"/"+name, name)

	var req scaleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Replicas < 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "replicas must be >= 0."))
		return
	}
	if err := k.ScaleStatefulSet(r.Context(), ns, name, req.Replicas); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sRestartStatefulSet triggers a rolling restart (perm k8s.statefulset.restart).
func (s *Server) K8sRestartStatefulSet(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.statefulset", ns+"/"+name, name)

	if err := k.RolloutRestartStatefulSet(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeleteStatefulSet deletes a StatefulSet (perm k8s.workload.delete).
func (s *Server) K8sDeleteStatefulSet(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.statefulset", ns+"/"+name, name)

	if err := k.DeleteStatefulSet(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sRestartDaemonSet triggers a rolling restart (perm k8s.daemonset.restart).
func (s *Server) K8sRestartDaemonSet(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.daemonset", ns+"/"+name, name)

	if err := k.RolloutRestartDaemonSet(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeleteDaemonSet deletes a DaemonSet (perm k8s.workload.delete).
func (s *Server) K8sDeleteDaemonSet(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.daemonset", ns+"/"+name, name)

	if err := k.DeleteDaemonSet(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeleteJob deletes a Job (perm k8s.workload.delete).
func (s *Server) K8sDeleteJob(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.job", ns+"/"+name, name)

	if err := k.DeleteJob(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sTriggerCronJob creates a one-off Job from a CronJob's jobTemplate (perm
// k8s.cronjob.trigger) and returns the created Job's name.
func (s *Server) K8sTriggerCronJob(w http.ResponseWriter, r *http.Request) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.cronjob", ns+"/"+name, name)

	jobName, err := k.TriggerCronJob(r.Context(), ns, name)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, triggerCronJobResponse{OK: true, Job: jobName})
}

// K8sSuspendCronJob sets a CronJob's spec.suspend flag (perm k8s.cronjob.suspend).
func (s *Server) K8sSuspendCronJob(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.cronjob", ns+"/"+name, name)

	var req suspendRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := k.SuspendCronJob(r.Context(), ns, name, req.Suspend); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// K8sDeleteCronJob deletes a CronJob (perm k8s.workload.delete).
func (s *Server) K8sDeleteCronJob(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kubeProvider(w, r)
	if !ok {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "k8s.cronjob", ns+"/"+name, name)

	if err := k.DeleteCronJob(r.Context(), ns, name); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}
