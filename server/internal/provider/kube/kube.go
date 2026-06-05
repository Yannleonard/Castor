// Package kube implements a Provider for Kubernetes via client-go, loading a
// mounted kubeconfig. The generic container-style Provider mutations (Start/
// Stop/Restart/Remove/Exec) return provider.ErrUnsupported via the embedded
// ReadOnlyMutations (those verbs do not map onto k8s objects); k8s-native writes
// (scale/restart/delete/apply) are exposed via dedicated methods in write.go and
// reached through dedicated API endpoints. Stats returns ErrUnsupported
// (metrics-server is out of the V1 perimeter). See ADR-CASTOR-002 (D5).
package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/gtek-it/castor/server/internal/provider"
)

// ProviderID is the stable id of the local Kubernetes provider in V1.
const ProviderID = "local-kube"

// KubeProvider is a Provider over the Kubernetes API. Reads/logs go through the
// typed clientset; the generic container mutations are unsupported (see package
// doc), while k8s-native writes use clientset + a dynamic client built from
// restConfig (write.go).
type KubeProvider struct {
	provider.ReadOnlyMutations
	clientset  kubernetes.Interface
	restConfig *rest.Config
	id         string
}

// Compile-time assertion.
var _ provider.Provider = (*KubeProvider)(nil)

// New constructs a KubeProvider from a kubeconfig path. If kubeconfigPath is
// empty, in-cluster config is attempted then the default loading rules
// (KUBECONFIG env / ~/.kube/config).
func New(kubeconfigPath string) (*KubeProvider, error) {
	cfg, err := buildConfig(kubeconfigPath)
	if err != nil {
		return nil, fmt.Errorf("kube: build config: %w", err)
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("kube: new clientset: %w", err)
	}
	return &KubeProvider{clientset: cs, restConfig: cfg, id: ProviderID}, nil
}

// buildConfig loads a *rest.Config from an explicit path or the default rules.
func buildConfig(kubeconfigPath string) (*rest.Config, error) {
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	if kubeconfigPath != "" {
		loadingRules = &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	}
	cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, &clientcmd.ConfigOverrides{})
	return cc.ClientConfig()
}

// Kind returns KindKubernetes.
func (p *KubeProvider) Kind() provider.OrchestratorKind { return provider.KindKubernetes }

// ID returns the provider id ("local-kube").
func (p *KubeProvider) ID() string { return p.id }

// Capabilities returns the Kubernetes capability set. CapReadOnly is NOT set:
// the provider performs k8s-native writes (scale/restart/delete/apply) via
// dedicated endpoints, so the UI must not grey those affordances out. CapExec
// IS set: the provider implements interactive pod exec (exec.go) over the
// generic Provider.Exec seam, so the WS exec hub offers a pod terminal exactly
// as it does for Docker containers. The remaining generic container verbs
// (start/stop/restart/remove) stay unsupported and absent. CapStats stays out
// (per-workload streaming stats; live usage is surfaced via the metrics-server
// snapshot endpoints in metrics.go, not the Stats stream).
func (p *KubeProvider) Capabilities() provider.Capability {
	return provider.CapList | provider.CapInspect | provider.CapLogs | provider.CapExec
}

// Ping verifies API server reachability via a server-version call.
func (p *KubeProvider) Ping(ctx context.Context) error {
	_, err := p.clientset.Discovery().ServerVersion()
	return err
}

// Close is a no-op (client-go has no persistent connection to release).
func (p *KubeProvider) Close() error { return nil }

// Stats is unsupported in V1 (metrics-server out of perimeter).
func (p *KubeProvider) Stats(ctx context.Context, id string) (<-chan provider.StatSample, error) {
	return nil, provider.ErrUnsupported
}

// ListWorkloads returns one Workload per pod across the requested namespace
// ("" = all readable namespaces).
func (p *KubeProvider) ListWorkloads(ctx context.Context, opts provider.ListOptions) ([]provider.Workload, error) {
	ns := opts.Namespace
	listOpts := metav1.ListOptions{LabelSelector: labelSelector(opts.LabelSelector)}
	pods, err := p.clientset.CoreV1().Pods(ns).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("kube: list pods: %w", err)
	}
	out := make([]provider.Workload, 0, len(pods.Items))
	for i := range pods.Items {
		out = append(out, p.mapPod(&pods.Items[i]))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// InspectWorkload returns the pod header plus its raw JSON. id is "<ns>/<name>".
func (p *KubeProvider) InspectWorkload(ctx context.Context, id string) (*provider.WorkloadDetail, error) {
	ns, name, err := splitPodID(id)
	if err != nil {
		return nil, provider.ErrNotFound
	}
	pod, err := p.clientset.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, mapKubeNotFound(err)
	}
	raw, err := json.Marshal(pod)
	if err != nil {
		return nil, err
	}
	wl := p.mapPod(pod)
	return &provider.WorkloadDetail{Workload: wl, Raw: raw}, nil
}

// Logs streams logs for a pod container ("" = first container).
func (p *KubeProvider) Logs(ctx context.Context, id string, opts provider.LogOptions) (io.ReadCloser, error) {
	ns, name, err := splitPodID(id)
	if err != nil {
		return nil, provider.ErrNotFound
	}
	podLogOpts := &corev1.PodLogOptions{
		Follow:     opts.Follow,
		Timestamps: opts.Timestamps,
		Container:  opts.Container,
	}
	if opts.Tail > 0 {
		tl := int64(opts.Tail)
		podLogOpts.TailLines = &tl
	}
	if !opts.Since.IsZero() {
		t := metav1.NewTime(opts.Since)
		podLogOpts.SinceTime = &t
	}
	req := p.clientset.CoreV1().Pods(ns).GetLogs(name, podLogOpts)
	rc, err := req.Stream(ctx)
	if err != nil {
		return nil, mapKubeNotFound(err)
	}
	return rc, nil
}

// LabelQoS is the synthetic Workload label carrying a pod's QoS class
// (Guaranteed / Burstable / BestEffort). The Workload struct is shared across
// orchestrators, so rather than widen it the kubelet-reported QoS is surfaced in
// the labels map under this key for the K8s pods view to read.
const LabelQoS = "io.castor.qos"

// mapPod converts a corev1.Pod into a normalized Workload.
func (p *KubeProvider) mapPod(pod *corev1.Pod) provider.Workload {
	id := pod.Namespace + "/" + pod.Name
	image := ""
	if len(pod.Spec.Containers) > 0 {
		image = pod.Spec.Containers[0].Image
	}
	state, stateRaw := podState(pod)
	return provider.Workload{
		ID:         id,
		Name:       pod.Name,
		Kind:       provider.KindKubernetes,
		ProviderID: p.id,
		Node:       pod.Spec.NodeName,
		State:      state,
		StateRaw:   stateRaw,
		Image:      image,
		Ports:      podPorts(pod),
		Labels:     podLabels(pod),
		CreatedAt:  pod.CreationTimestamp.UTC(),
		Group:      ownerName(pod),
		Protected:  false,
	}
}

// podLabels returns the pod's labels plus a synthetic io.castor.qos entry with
// the kubelet-reported QoS class. The source map is copied (never mutated) so
// the cached informer/API object is left untouched. The QoS entry is added only
// when the kubelet has populated Status.QOSClass.
func podLabels(pod *corev1.Pod) map[string]string {
	qos := string(pod.Status.QOSClass)
	out := make(map[string]string, len(pod.Labels)+1)
	for k, v := range pod.Labels {
		out[k] = v
	}
	if qos != "" {
		out[LabelQoS] = qos
	}
	return out
}

// podState derives a normalized state plus a fidelity StateRaw, surfacing
// container waiting reasons like CrashLoopBackOff.
func podState(pod *corev1.Pod) (provider.WorkloadState, string) {
	// Surface a waiting reason if any container is stuck (e.g. CrashLoopBackOff).
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			reason := cs.State.Waiting.Reason
			st := provider.StatePending
			if strings.Contains(reason, "BackOff") || strings.Contains(reason, "Err") {
				st = provider.StateRestarting
			}
			return st, reason
		}
	}
	switch pod.Status.Phase {
	case corev1.PodRunning:
		return provider.StateRunning, string(pod.Status.Phase)
	case corev1.PodPending:
		return provider.StatePending, string(pod.Status.Phase)
	case corev1.PodSucceeded, corev1.PodFailed:
		return provider.StateStopped, string(pod.Status.Phase)
	default:
		return provider.StateUnknown, string(pod.Status.Phase)
	}
}

// podPorts collects declared container ports.
func podPorts(pod *corev1.Pod) []provider.Port {
	var out []provider.Port
	for _, c := range pod.Spec.Containers {
		for _, prt := range c.Ports {
			proto := strings.ToLower(string(prt.Protocol))
			if proto == "" {
				proto = "tcp"
			}
			out = append(out, provider.Port{
				Private:  uint16(prt.ContainerPort),
				Protocol: proto,
			})
		}
	}
	return out
}

// ownerName returns the controlling owner (Deployment/StatefulSet/etc) name.
func ownerName(pod *corev1.Pod) string {
	for _, o := range pod.OwnerReferences {
		if o.Controller != nil && *o.Controller {
			return o.Name
		}
	}
	if len(pod.OwnerReferences) > 0 {
		return pod.OwnerReferences[0].Name
	}
	return ""
}

func splitPodID(id string) (ns, name string, err error) {
	parts := strings.SplitN(id, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("kube: invalid pod id %q", id)
	}
	return parts[0], parts[1], nil
}

func labelSelector(sel map[string]string) string {
	if len(sel) == 0 {
		return ""
	}
	parts := make([]string, 0, len(sel))
	for k, v := range sel {
		if v == "" {
			parts = append(parts, k)
		} else {
			parts = append(parts, k+"="+v)
		}
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

func mapKubeNotFound(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "not found") {
		return provider.ErrNotFound
	}
	return err
}
