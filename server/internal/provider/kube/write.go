package kube

// write.go adds the mutating surface of the Kubernetes provider: scale a
// Deployment/StatefulSet, rollout-restart a Deployment/StatefulSet/DaemonSet,
// delete a Pod/Deployment/StatefulSet/DaemonSet/Job/CronJob, trigger or suspend
// a CronJob, and apply a (multi-document) YAML manifest via server-side apply.
// These are reached through dedicated API endpoints (api/k8s_write.go), NOT the
// generic Provider mutation interface (Start/Stop/... remain ErrUnsupported via
// the embedded ReadOnlyMutations — those are container verbs that do not map to
// k8s objects).
//
// Errors are normalized to provider.ErrNotFound / provider.ErrConflict where the
// apiserver reports "not found" / "already exists" so the API layer maps them to
// 404 / 409; everything else surfaces as a wrapped error (-> 500).

import (
	"context"
	"fmt"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	memory "k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/restmapper"
	"sigs.k8s.io/yaml"

	"github.com/gtek-it/castor/server/internal/provider"
)

// fieldManager identifies Castor as the owner of fields it server-side applies.
const fieldManager = "castor"

// ScaleDeployment sets a Deployment's replica count via the /scale subresource.
// It inspects the current scale (to carry the resourceVersion) then updates it.
func (p *KubeProvider) ScaleDeployment(ctx context.Context, ns, name string, replicas int32) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	if replicas < 0 {
		return provider.ErrConflict
	}
	sc, err := p.clientset.AppsV1().Deployments(ns).GetScale(ctx, name, metav1.GetOptions{})
	if err != nil {
		return mapKubeWriteErr(err)
	}
	sc.Spec.Replicas = replicas
	if _, err := p.clientset.AppsV1().Deployments(ns).UpdateScale(ctx, name, sc, metav1.UpdateOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// RolloutRestart triggers a rolling restart of a Deployment by stamping the
// standard kubectl restartedAt annotation on the pod template (a strategic-merge
// patch), exactly as `kubectl rollout restart` does.
func (p *KubeProvider) RolloutRestart(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	_, err := p.clientset.AppsV1().Deployments(ns).Patch(
		ctx, name, types.StrategicMergePatchType, restartedAtPatch(), metav1.PatchOptions{},
	)
	if err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// restartedAtPatch is the strategic-merge patch stamping the standard kubectl
// restartedAt annotation on a workload's pod template, shared by the
// Deployment / StatefulSet / DaemonSet rollout-restart methods.
func restartedAtPatch() []byte {
	now := time.Now().UTC().Format(time.RFC3339)
	return []byte(fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":%q}}}}}`,
		now,
	))
}

// ScaleStatefulSet sets a StatefulSet's replica count via the /scale
// subresource, mirroring ScaleDeployment.
func (p *KubeProvider) ScaleStatefulSet(ctx context.Context, ns, name string, replicas int32) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	if replicas < 0 {
		return provider.ErrConflict
	}
	sc, err := p.clientset.AppsV1().StatefulSets(ns).GetScale(ctx, name, metav1.GetOptions{})
	if err != nil {
		return mapKubeWriteErr(err)
	}
	sc.Spec.Replicas = replicas
	if _, err := p.clientset.AppsV1().StatefulSets(ns).UpdateScale(ctx, name, sc, metav1.UpdateOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// RolloutRestartStatefulSet triggers a rolling restart of a StatefulSet via the
// restartedAt annotation patch, exactly as RolloutRestart does for Deployments.
func (p *KubeProvider) RolloutRestartStatefulSet(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	_, err := p.clientset.AppsV1().StatefulSets(ns).Patch(
		ctx, name, types.StrategicMergePatchType, restartedAtPatch(), metav1.PatchOptions{},
	)
	if err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// RolloutRestartDaemonSet triggers a rolling restart of a DaemonSet via the
// restartedAt annotation patch, exactly as RolloutRestart does for Deployments.
func (p *KubeProvider) RolloutRestartDaemonSet(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	_, err := p.clientset.AppsV1().DaemonSets(ns).Patch(
		ctx, name, types.StrategicMergePatchType, restartedAtPatch(), metav1.PatchOptions{},
	)
	if err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeletePod deletes a single Pod (the controller, if any, recreates it).
func (p *KubeProvider) DeletePod(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.CoreV1().Pods(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeleteDeployment deletes a Deployment (and its owned ReplicaSets/Pods via the
// default foreground/background cascade chosen by the apiserver).
func (p *KubeProvider) DeleteDeployment(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.AppsV1().Deployments(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeleteStatefulSet deletes a StatefulSet (its Pods follow via the default
// cascade; PVCs created from volumeClaimTemplates are retained by Kubernetes).
func (p *KubeProvider) DeleteStatefulSet(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.AppsV1().StatefulSets(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeleteDaemonSet deletes a DaemonSet (and its owned Pods via the default cascade).
func (p *KubeProvider) DeleteDaemonSet(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.AppsV1().DaemonSets(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeleteJob deletes a Job. The propagation policy is set to Background
// explicitly: the batch/v1 legacy default is Orphan, which would leave the
// Job's Pods behind (kubectl delete job uses background cascading too).
func (p *KubeProvider) DeleteJob(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	prop := metav1.DeletePropagationBackground
	if err := p.clientset.BatchV1().Jobs(ns).Delete(ctx, name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeleteCronJob deletes a CronJob (its owned Jobs/Pods follow via the garbage
// collector's background cascade).
func (p *KubeProvider) DeleteCronJob(ctx context.Context, ns, name string) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	prop := metav1.DeletePropagationBackground
	if err := p.clientset.BatchV1().CronJobs(ns).Delete(ctx, name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// TriggerCronJob creates a one-off Job from a CronJob's jobTemplate, exactly as
// `kubectl create job --from=cronjob/<name>` does: the template's labels and
// annotations are carried over and the manual-instantiation marker annotation is
// added. Like kubectl, no ownerReference is set: a controller reference would
// make the CronJob controller adopt the manual Job (counted in .status.active,
// garbage-collected under successful/failedJobsHistoryLimit). The created Job's
// name is returned.
func (p *KubeProvider) TriggerCronJob(ctx context.Context, ns, name string) (string, error) {
	if ns == "" || name == "" {
		return "", provider.ErrNotFound
	}
	cj, err := p.clientset.BatchV1().CronJobs(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", mapKubeWriteErr(err)
	}

	// "<cron>-manual-<unixts>", truncating the base so the job name stays a
	// valid label value (<= 63 chars): the job controller stamps it into the
	// pods' job-name label.
	suffix := fmt.Sprintf("-manual-%d", time.Now().Unix())
	base := name
	if max := 63 - len(suffix); len(base) > max {
		base = base[:max]
	}
	jobName := base + suffix

	annotations := make(map[string]string, len(cj.Spec.JobTemplate.Annotations)+1)
	for k, v := range cj.Spec.JobTemplate.Annotations {
		annotations[k] = v
	}
	annotations["cronjob.kubernetes.io/instantiate"] = "manual"
	labels := make(map[string]string, len(cj.Spec.JobTemplate.Labels))
	for k, v := range cj.Spec.JobTemplate.Labels {
		labels[k] = v
	}

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:        jobName,
			Namespace:   ns,
			Labels:      labels,
			Annotations: annotations,
		},
		Spec: cj.Spec.JobTemplate.Spec,
	}
	if _, err := p.clientset.BatchV1().Jobs(ns).Create(ctx, job, metav1.CreateOptions{}); err != nil {
		return "", mapKubeWriteErr(err)
	}
	return jobName, nil
}

// SuspendCronJob sets a CronJob's spec.suspend flag (true pauses scheduling,
// false resumes it) via a strategic-merge patch.
func (p *KubeProvider) SuspendCronJob(ctx context.Context, ns, name string, suspend bool) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	patch := fmt.Sprintf(`{"spec":{"suspend":%t}}`, suspend)
	_, err := p.clientset.BatchV1().CronJobs(ns).Patch(
		ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// ApplyResult is the per-document outcome of an ApplyManifest call. Action is one
// of "created", "configured", "unchanged", or "error" (with Error populated).
type ApplyResult struct {
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Action    string `json:"action"`
	Error     string `json:"error,omitempty"`
}

// ApplyManifest applies a (possibly multi-document) YAML manifest using
// server-side apply through the dynamic client. Each document is resolved to its
// GroupVersionResource via a discovery-backed RESTMapper; namespaced objects
// default to their declared namespace or "default". One document's failure does
// NOT abort the others — its result carries Action="error". The function returns
// an error only on a wholesale failure (e.g. discovery client construction).
func (p *KubeProvider) ApplyManifest(ctx context.Context, manifest string) ([]ApplyResult, error) {
	dynClient, err := dynamic.NewForConfig(p.restConfig)
	if err != nil {
		return nil, fmt.Errorf("kube: dynamic client: %w", err)
	}
	disco, err := discovery.NewDiscoveryClientForConfig(p.restConfig)
	if err != nil {
		return nil, fmt.Errorf("kube: discovery client: %w", err)
	}
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(memory.NewMemCacheClient(disco))

	docs := splitYAMLDocuments(manifest)
	if len(docs) == 0 {
		return nil, provider.ErrConflict
	}

	results := make([]ApplyResult, 0, len(docs))
	for _, doc := range docs {
		results = append(results, p.applyOne(ctx, dynClient, mapper, doc))
	}
	return results, nil
}

// applyOne decodes a single YAML document, resolves its REST mapping, and
// performs a server-side apply, returning the normalized ApplyResult.
func (p *KubeProvider) applyOne(ctx context.Context, dynClient dynamic.Interface, mapper *restmapper.DeferredDiscoveryRESTMapper, doc string) ApplyResult {
	obj := &unstructured.Unstructured{}
	jsonBytes, err := yaml.YAMLToJSON([]byte(doc))
	if err != nil {
		return ApplyResult{Action: "error", Error: "invalid yaml: " + err.Error()}
	}
	if err := obj.UnmarshalJSON(jsonBytes); err != nil {
		return ApplyResult{Action: "error", Error: "invalid object: " + err.Error()}
	}

	gvk := obj.GroupVersionKind()
	res := ApplyResult{
		Group:     gvk.Group,
		Version:   gvk.Version,
		Kind:      gvk.Kind,
		Namespace: obj.GetNamespace(),
		Name:      obj.GetName(),
	}
	if gvk.Kind == "" || obj.GetName() == "" {
		res.Action = "error"
		res.Error = "manifest document missing kind or metadata.name"
		return res
	}

	mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil {
		res.Action = "error"
		res.Error = "no REST mapping for " + gvk.String() + ": " + err.Error()
		return res
	}

	var ri dynamic.ResourceInterface
	if mapping.Scope.Name() == meta_RESTScopeNameNamespace {
		ns := obj.GetNamespace()
		if ns == "" {
			ns = "default"
			obj.SetNamespace(ns)
			res.Namespace = ns
		}
		ri = dynClient.Resource(mapping.Resource).Namespace(ns)
	} else {
		ri = dynClient.Resource(mapping.Resource)
	}

	// Capture the prior resourceVersion to classify created vs configured.
	prior, _ := ri.Get(ctx, obj.GetName(), metav1.GetOptions{})

	applied, err := ri.Apply(ctx, obj.GetName(), obj, metav1.ApplyOptions{
		FieldManager: fieldManager,
		Force:        true,
	})
	if err != nil {
		res.Action = "error"
		res.Error = mapKubeWriteErr(err).Error()
		return res
	}

	switch {
	case prior == nil:
		res.Action = "created"
	case prior.GetResourceVersion() == applied.GetResourceVersion():
		res.Action = "unchanged"
	default:
		res.Action = "configured"
	}
	return res
}

// meta_RESTScopeNameNamespace mirrors meta.RESTScopeNameNamespace without pulling
// the alias into the file header; the value is the stable string "namespace".
const meta_RESTScopeNameNamespace = "namespace"

// splitYAMLDocuments splits a multi-document YAML stream into its documents on
// lines that contain ONLY the "---" separator (the YAML standard), returning the
// non-blank documents (empty / comments-only docs dropped). Splitting per-line
// (rather than on the substring "\n---") avoids mis-splitting on content such as
// a value of "---foo" or a "----" rule inside a document.
func splitYAMLDocuments(manifest string) []string {
	manifest = strings.ReplaceAll(manifest, "\r\n", "\n")
	manifest = strings.ReplaceAll(manifest, "\r", "\n")

	var (
		out     []string
		current []string
	)
	flush := func() {
		doc := strings.TrimSpace(strings.Join(current, "\n"))
		current = current[:0]
		if doc == "" || onlyCommentsOrDirective(doc) {
			return
		}
		out = append(out, doc)
	}
	for _, line := range strings.Split(manifest, "\n") {
		if isYAMLSeparator(line) {
			flush()
			continue
		}
		current = append(current, line)
	}
	flush()
	return out
}

// isYAMLSeparator reports whether a line is a standalone document separator
// ("---", optionally with trailing spaces or a trailing "# comment").
func isYAMLSeparator(line string) bool {
	t := strings.TrimRight(line, " \t")
	if t != "---" {
		// Allow "--- # comment" style separators.
		if strings.HasPrefix(t, "---") {
			rest := strings.TrimSpace(t[3:])
			return rest == "" || strings.HasPrefix(rest, "#")
		}
		return false
	}
	return true
}

// onlyCommentsOrDirective reports whether every non-blank line is a comment (#…)
// or the YAML document end marker.
func onlyCommentsOrDirective(doc string) bool {
	for _, line := range strings.Split(doc, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || t == "..." || strings.HasPrefix(t, "#") {
			continue
		}
		return false
	}
	return true
}

// mapKubeWriteErr normalizes apiserver errors to provider sentinels for the API
// layer's status mapping (404 / 409); other errors pass through wrapped.
func mapKubeWriteErr(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case apierrors.IsNotFound(err):
		return provider.ErrNotFound
	case apierrors.IsConflict(err), apierrors.IsAlreadyExists(err), apierrors.IsInvalid(err):
		return provider.ErrConflict
	}
	// Fallback for transports that do not preserve typed status errors.
	low := strings.ToLower(err.Error())
	if strings.Contains(low, "not found") {
		return provider.ErrNotFound
	}
	return fmt.Errorf("kube: %w", err)
}
