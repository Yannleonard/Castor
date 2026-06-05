package kube

// resources.go adds the Deployment resource-management surface: read the
// per-container requests/limits the pod template declares, set them via an
// AppsV1 update, and compute a Pod's QoS class from container resources using
// the same rules the kubelet applies. These power the K8s resources endpoint
// (api/k8s_write.go) and enrich the Deployment list (extra.go).

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/gtek-it/castor/server/internal/provider"
)

// ResourceSpec is one CPU+memory pair (a request OR a limit) for a container.
// CpuMilli is millicores (1000 = 1 core); MemoryBytes is bytes. A zero field is
// "unset" — SetDeploymentResources leaves the corresponding entry untouched.
type ResourceSpec struct {
	CpuMilli    int64 `json:"cpuMilli"`
	MemoryBytes int64 `json:"memoryBytes"`
}

// K8sContainerResources is the normalized requests/limits view of one container.
// Each field is the Quantity .String() form ("100m", "128Mi", …) and is "" when
// that entry is unset on the container.
type K8sContainerResources struct {
	Name       string `json:"name"`
	CpuRequest string `json:"cpuRequest"`
	CpuLimit   string `json:"cpuLimit"`
	MemRequest string `json:"memRequest"`
	MemLimit   string `json:"memLimit"`
}

// SetDeploymentResources sets requests/limits on a Deployment container and
// updates the Deployment (AppsV1). containerName selects the target; when empty
// the first container is used. Only entries with a value > 0 are applied — a
// zero CpuMilli/MemoryBytes leaves that specific request/limit entry unchanged
// (V1: set-or-keep, never clear). Existing other entries are preserved.
func (p *KubeProvider) SetDeploymentResources(ctx context.Context, ns, name, containerName string, req, lim ResourceSpec) error {
	if ns == "" || name == "" {
		return provider.ErrNotFound
	}
	dep, err := p.clientset.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return mapKubeWriteErr(err)
	}

	containers := dep.Spec.Template.Spec.Containers
	if len(containers) == 0 {
		return provider.ErrNotFound
	}
	idx := 0
	if containerName != "" {
		idx = -1
		for i := range containers {
			if containers[i].Name == containerName {
				idx = i
				break
			}
		}
		if idx < 0 {
			return provider.ErrNotFound
		}
	}

	c := &containers[idx]
	applyResourceSpec(&c.Resources.Requests, req)
	applyResourceSpec(&c.Resources.Limits, lim)

	if _, err := p.clientset.AppsV1().Deployments(ns).Update(ctx, dep, metav1.UpdateOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// applyResourceSpec writes the >0 entries of spec into the given ResourceList,
// allocating it on first use. CPU is a DecimalSI millicore quantity, memory a
// BinarySI byte quantity (so they render as "250m" / "128Mi").
func applyResourceSpec(list *corev1.ResourceList, spec ResourceSpec) {
	if spec.CpuMilli <= 0 && spec.MemoryBytes <= 0 {
		return
	}
	if *list == nil {
		*list = corev1.ResourceList{}
	}
	if spec.CpuMilli > 0 {
		(*list)[corev1.ResourceCPU] = *resource.NewMilliQuantity(spec.CpuMilli, resource.DecimalSI)
	}
	if spec.MemoryBytes > 0 {
		(*list)[corev1.ResourceMemory] = *resource.NewQuantity(spec.MemoryBytes, resource.BinarySI)
	}
}

// containerResources projects a container's declared requests/limits into the
// normalized K8sContainerResources (empty strings for unset entries).
func containerResources(c *corev1.Container) K8sContainerResources {
	out := K8sContainerResources{Name: c.Name}
	if q, ok := c.Resources.Requests[corev1.ResourceCPU]; ok {
		out.CpuRequest = q.String()
	}
	if q, ok := c.Resources.Limits[corev1.ResourceCPU]; ok {
		out.CpuLimit = q.String()
	}
	if q, ok := c.Resources.Requests[corev1.ResourceMemory]; ok {
		out.MemRequest = q.String()
	}
	if q, ok := c.Resources.Limits[corev1.ResourceMemory]; ok {
		out.MemLimit = q.String()
	}
	return out
}

// containersResources maps a slice of containers to the normalized view.
func containersResources(containers []corev1.Container) []K8sContainerResources {
	out := make([]K8sContainerResources, 0, len(containers))
	for i := range containers {
		out = append(out, containerResources(&containers[i]))
	}
	return out
}

// QoS class string values (mirror corev1.PodQOSClass; duplicated as plain
// strings so callers/JSON consumers do not depend on the corev1 alias).
const (
	qosGuaranteed = "Guaranteed"
	qosBurstable  = "Burstable"
	qosBestEffort = "BestEffort"
)

// QosClassForContainers computes a pod's QoS class from its containers using the
// kubelet rules:
//   - BestEffort: no container sets ANY request or limit.
//   - Guaranteed: EVERY container sets cpu+mem on BOTH requests and limits, and
//     for each of cpu and mem the request equals the limit.
//   - Burstable: anything in between.
//
// (Init containers and pod-level overhead are out of V1 scope — Deployments in
// the perimeter use ordinary app containers; the kubelet-reported value is read
// directly for the pods view.)
func QosClassForContainers(containers []corev1.Container) string {
	if len(containers) == 0 {
		return qosBestEffort
	}
	anySet := false
	guaranteed := true

	for i := range containers {
		r := containers[i].Resources

		cpuReq, hasCPUReq := r.Requests[corev1.ResourceCPU]
		memReq, hasMemReq := r.Requests[corev1.ResourceMemory]
		cpuLim, hasCPULim := r.Limits[corev1.ResourceCPU]
		memLim, hasMemLim := r.Limits[corev1.ResourceMemory]

		if hasCPUReq || hasMemReq || hasCPULim || hasMemLim {
			anySet = true
		}

		// Guaranteed requires cpu+mem on requests AND limits, with req==lim.
		if !hasCPUReq || !hasMemReq || !hasCPULim || !hasMemLim {
			guaranteed = false
			continue
		}
		if cpuReq.Cmp(cpuLim) != 0 || memReq.Cmp(memLim) != 0 {
			guaranteed = false
		}
	}

	switch {
	case !anySet:
		return qosBestEffort
	case guaranteed:
		return qosGuaranteed
	default:
		return qosBurstable
	}
}
