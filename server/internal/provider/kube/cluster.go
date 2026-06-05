package kube

// cluster.go adds the autoscaling + core cluster-object surface of the
// Kubernetes provider (Wave 3): HorizontalPodAutoscalers, Namespaces, Services,
// ConfigMaps, Secrets (metadata only), and Events. Reads are typed list calls
// through the clientset; the writes (create/delete an HPA, create/delete a
// Namespace) are reached through dedicated API endpoints (api/k8s_cluster.go),
// NOT the generic Provider mutation interface. Errors are normalized to
// provider.ErrNotFound / provider.ErrConflict via mapKubeWriteErr (write.go) so
// the API layer maps them to 404 / 409.
//
// Secrets are deliberately surfaced as KEY NAMES + type only — values are NEVER
// returned. Events are sorted newest-first and capped to keep payloads bounded.

import (
	"context"
	"sort"
	"time"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/gtek-it/castor/server/internal/provider"
)

// eventsCap bounds the number of Events returned (newest-first) so a busy
// namespace cannot return an unbounded payload.
const eventsCap = 100

/* ============================ HPA ============================ */

// HPAInfo is the normalized HorizontalPodAutoscaler summary. Target is the
// scale-target ref in "<kind>/<name>" form (e.g. "Deployment/web"). The CPU
// fields are the configured target utilization and the last observed
// utilization; a nil/absent value is reported as 0.
type HPAInfo struct {
	Namespace         string `json:"namespace"`
	Name              string `json:"name"`
	Target            string `json:"target"`
	MinReplicas       int32  `json:"minReplicas"`
	MaxReplicas       int32  `json:"maxReplicas"`
	CurrentReplicas   int32  `json:"currentReplicas"`
	TargetCpuPercent  int32  `json:"targetCpuPercent"`
	CurrentCpuPercent int32  `json:"currentCpuPercent"`
}

// HPACreateSpec is the body for CreateHPA: an HPA named `name` that scales the
// Deployment `targetDeployment` between min/max replicas on a CPU-utilization
// Resource metric of `cpuPercent`.
type HPACreateSpec struct {
	Name             string `json:"name"`
	TargetDeployment string `json:"targetDeployment"`
	MinReplicas      int32  `json:"minReplicas"`
	MaxReplicas      int32  `json:"maxReplicas"`
	CpuPercent       int32  `json:"cpuPercent"`
}

// ListHPAs returns normalized HPA summaries for a namespace ("" = all). It reads
// autoscaling/v2 first and falls back to autoscaling/v1 when the v2 API is not
// served by the cluster (older clusters), normalizing either shape into HPAInfo.
func (p *KubeProvider) ListHPAs(ctx context.Context, namespace string) ([]HPAInfo, error) {
	v2list, err := p.clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		out := make([]HPAInfo, 0, len(v2list.Items))
		for i := range v2list.Items {
			out = append(out, mapHPAV2(&v2list.Items[i]))
		}
		sortHPAs(out)
		return out, nil
	}

	// Fall back to autoscaling/v1 when v2 is unavailable.
	v1list, v1err := p.clientset.AutoscalingV1().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
	if v1err != nil {
		// Surface the original v2 error (the primary path); both failing usually
		// means a real list error (RBAC/connectivity), not a missing API.
		return nil, err
	}
	out := make([]HPAInfo, 0, len(v1list.Items))
	for i := range v1list.Items {
		out = append(out, mapHPAV1(&v1list.Items[i]))
	}
	sortHPAs(out)
	return out, nil
}

// CreateHPA creates an autoscaling/v2 HPA targeting the named Deployment with a
// single CPU-utilization Resource metric. minReplicas<=0 defaults to 1; an
// invalid max (< min, <= 0) is rejected as a conflict so the API layer maps it
// to 409.
func (p *KubeProvider) CreateHPA(ctx context.Context, namespace string, spec HPACreateSpec) error {
	if namespace == "" || spec.Name == "" || spec.TargetDeployment == "" {
		return provider.ErrNotFound
	}
	minReplicas := spec.MinReplicas
	if minReplicas <= 0 {
		minReplicas = 1
	}
	if spec.MaxReplicas <= 0 || spec.MaxReplicas < minReplicas {
		return provider.ErrConflict
	}
	cpu := spec.CpuPercent
	if cpu <= 0 {
		cpu = 80
	}

	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      spec.Name,
			Namespace: namespace,
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       spec.TargetDeployment,
			},
			MinReplicas: &minReplicas,
			MaxReplicas: spec.MaxReplicas,
			Metrics: []autoscalingv2.MetricSpec{{
				Type: autoscalingv2.ResourceMetricSourceType,
				Resource: &autoscalingv2.ResourceMetricSource{
					Name: corev1.ResourceCPU,
					Target: autoscalingv2.MetricTarget{
						Type:               autoscalingv2.UtilizationMetricType,
						AverageUtilization: &cpu,
					},
				},
			}},
		},
	}
	if _, err := p.clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Create(ctx, hpa, metav1.CreateOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeleteHPA deletes an HPA (autoscaling/v2; the object is API-version agnostic
// at the storage layer so a v2 delete removes a v1-created HPA too).
func (p *KubeProvider) DeleteHPA(ctx context.Context, namespace, name string) error {
	if namespace == "" || name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// mapHPAV2 normalizes an autoscaling/v2 HPA into HPAInfo.
func mapHPAV2(h *autoscalingv2.HorizontalPodAutoscaler) HPAInfo {
	info := HPAInfo{
		Namespace:       h.Namespace,
		Name:            h.Name,
		Target:          h.Spec.ScaleTargetRef.Kind + "/" + h.Spec.ScaleTargetRef.Name,
		MaxReplicas:     h.Spec.MaxReplicas,
		CurrentReplicas: h.Status.CurrentReplicas,
	}
	if h.Spec.MinReplicas != nil {
		info.MinReplicas = *h.Spec.MinReplicas
	}
	// Target CPU utilization from the first cpu Resource metric.
	for i := range h.Spec.Metrics {
		m := &h.Spec.Metrics[i]
		if m.Type == autoscalingv2.ResourceMetricSourceType && m.Resource != nil &&
			m.Resource.Name == corev1.ResourceCPU && m.Resource.Target.AverageUtilization != nil {
			info.TargetCpuPercent = *m.Resource.Target.AverageUtilization
			break
		}
	}
	// Current CPU utilization from the matching current metric status.
	for i := range h.Status.CurrentMetrics {
		m := &h.Status.CurrentMetrics[i]
		if m.Type == autoscalingv2.ResourceMetricSourceType && m.Resource != nil &&
			m.Resource.Name == corev1.ResourceCPU && m.Resource.Current.AverageUtilization != nil {
			info.CurrentCpuPercent = *m.Resource.Current.AverageUtilization
			break
		}
	}
	return info
}

// mapHPAV1 normalizes an autoscaling/v1 HPA into HPAInfo (CPU-only shape).
func mapHPAV1(h *autoscalingv1.HorizontalPodAutoscaler) HPAInfo {
	info := HPAInfo{
		Namespace:       h.Namespace,
		Name:            h.Name,
		Target:          h.Spec.ScaleTargetRef.Kind + "/" + h.Spec.ScaleTargetRef.Name,
		MaxReplicas:     h.Spec.MaxReplicas,
		CurrentReplicas: h.Status.CurrentReplicas,
	}
	if h.Spec.MinReplicas != nil {
		info.MinReplicas = *h.Spec.MinReplicas
	}
	if h.Spec.TargetCPUUtilizationPercentage != nil {
		info.TargetCpuPercent = *h.Spec.TargetCPUUtilizationPercentage
	}
	if h.Status.CurrentCPUUtilizationPercentage != nil {
		info.CurrentCpuPercent = *h.Status.CurrentCPUUtilizationPercentage
	}
	return info
}

func sortHPAs(in []HPAInfo) {
	sort.Slice(in, func(i, j int) bool {
		if in[i].Namespace != in[j].Namespace {
			return in[i].Namespace < in[j].Namespace
		}
		return in[i].Name < in[j].Name
	})
}

/* ============================ Namespaces ============================ */

// NamespaceInfo is the normalized Namespace summary.
type NamespaceInfo struct {
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListNamespaces returns normalized Namespace summaries (sorted by name).
func (p *KubeProvider) ListNamespaces(ctx context.Context) ([]NamespaceInfo, error) {
	list, err := p.clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]NamespaceInfo, 0, len(list.Items))
	for i := range list.Items {
		n := &list.Items[i]
		out = append(out, NamespaceInfo{
			Name:      n.Name,
			Status:    string(n.Status.Phase),
			CreatedAt: n.CreationTimestamp.UTC(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// CreateNamespace creates a Namespace by name.
func (p *KubeProvider) CreateNamespace(ctx context.Context, name string) error {
	if name == "" {
		return provider.ErrNotFound
	}
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name}}
	if _, err := p.clientset.CoreV1().Namespaces().Create(ctx, ns, metav1.CreateOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// DeleteNamespace deletes a Namespace (cascading delete of its contents is
// handled by the apiserver/garbage collector).
func (p *KubeProvider) DeleteNamespace(ctx context.Context, name string) error {
	if name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.CoreV1().Namespaces().Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

/* ============================ Services ============================ */

// ServiceInfoK8s is the normalized Service summary. Ports are rendered in the
// compact "<port>/<proto>" (or "<port>:<nodePort>/<proto>") form; ExternalIP is
// the first ingress IP/hostname for a LoadBalancer (or the first declared
// ExternalIP), "" when none.
type ServiceInfoK8s struct {
	Namespace  string   `json:"namespace"`
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	ClusterIP  string   `json:"clusterIP"`
	Ports      []string `json:"ports"`
	ExternalIP string   `json:"externalIP"`
}

// ListServices returns normalized Service summaries for a namespace ("" = all).
func (p *KubeProvider) ListServices(ctx context.Context, namespace string) ([]ServiceInfoK8s, error) {
	list, err := p.clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]ServiceInfoK8s, 0, len(list.Items))
	for i := range list.Items {
		s := &list.Items[i]
		out = append(out, ServiceInfoK8s{
			Namespace:  s.Namespace,
			Name:       s.Name,
			Type:       string(s.Spec.Type),
			ClusterIP:  s.Spec.ClusterIP,
			Ports:      servicePorts(s),
			ExternalIP: serviceExternalIP(s),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// servicePorts renders a Service's ports as "<port>/<proto>" (with the assigned
// nodePort appended as ":<nodePort>" when present).
func servicePorts(s *corev1.Service) []string {
	out := make([]string, 0, len(s.Spec.Ports))
	for _, p := range s.Spec.Ports {
		proto := string(p.Protocol)
		if proto == "" {
			proto = "TCP"
		}
		entry := itoa(int64(p.Port)) + "/" + proto
		if p.NodePort != 0 {
			entry = itoa(int64(p.Port)) + ":" + itoa(int64(p.NodePort)) + "/" + proto
		}
		out = append(out, entry)
	}
	return out
}

// serviceExternalIP returns the first LoadBalancer ingress IP/hostname, falling
// back to the first declared spec.ExternalIPs entry, or "" when none.
func serviceExternalIP(s *corev1.Service) string {
	for _, ing := range s.Status.LoadBalancer.Ingress {
		if ing.IP != "" {
			return ing.IP
		}
		if ing.Hostname != "" {
			return ing.Hostname
		}
	}
	if len(s.Spec.ExternalIPs) > 0 {
		return s.Spec.ExternalIPs[0]
	}
	return ""
}

/* ============================ ConfigMaps ============================ */

// ConfigMapInfo is the normalized ConfigMap summary: its key NAMES only (data +
// binaryData keys merged), never the values.
type ConfigMapInfo struct {
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Keys      []string  `json:"keys"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListConfigMaps returns normalized ConfigMap summaries for a namespace
// ("" = all). Only key names are returned (values are intentionally omitted).
func (p *KubeProvider) ListConfigMaps(ctx context.Context, namespace string) ([]ConfigMapInfo, error) {
	list, err := p.clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]ConfigMapInfo, 0, len(list.Items))
	for i := range list.Items {
		c := &list.Items[i]
		keys := make([]string, 0, len(c.Data)+len(c.BinaryData))
		for k := range c.Data {
			keys = append(keys, k)
		}
		for k := range c.BinaryData {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out = append(out, ConfigMapInfo{
			Namespace: c.Namespace,
			Name:      c.Name,
			Keys:      keys,
			CreatedAt: c.CreationTimestamp.UTC(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

/* ============================ Secrets ============================ */

// SecretInfo is the normalized Secret summary. It carries the secret TYPE and
// its key NAMES only — secret VALUES are NEVER returned by this API.
type SecretInfo struct {
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Keys      []string  `json:"keys"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListSecrets returns normalized Secret summaries for a namespace ("" = all).
// SECURITY: only the type and the key names are surfaced; the values in
// secret.Data/StringData are deliberately never read into the response.
func (p *KubeProvider) ListSecrets(ctx context.Context, namespace string) ([]SecretInfo, error) {
	list, err := p.clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]SecretInfo, 0, len(list.Items))
	for i := range list.Items {
		s := &list.Items[i]
		keys := make([]string, 0, len(s.Data))
		for k := range s.Data {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out = append(out, SecretInfo{
			Namespace: s.Namespace,
			Name:      s.Name,
			Type:      string(s.Type),
			Keys:      keys,
			CreatedAt: s.CreationTimestamp.UTC(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

/* ============================ Events ============================ */

// EventInfo is the normalized Event summary. Object is the involved object in
// "<kind>/<name>" form; LastSeen is the last-occurrence timestamp.
type EventInfo struct {
	Namespace string    `json:"namespace"`
	Type      string    `json:"type"`
	Reason    string    `json:"reason"`
	Object    string    `json:"object"`
	Message   string    `json:"message"`
	Count     int32     `json:"count"`
	LastSeen  time.Time `json:"lastSeen"`
}

// ListEvents returns normalized Events for a namespace ("" = all), sorted newest
// first by last-seen time and capped at eventsCap.
func (p *KubeProvider) ListEvents(ctx context.Context, namespace string) ([]EventInfo, error) {
	list, err := p.clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]EventInfo, 0, len(list.Items))
	for i := range list.Items {
		e := &list.Items[i]
		out = append(out, EventInfo{
			Namespace: e.Namespace,
			Type:      e.Type,
			Reason:    e.Reason,
			Object:    e.InvolvedObject.Kind + "/" + e.InvolvedObject.Name,
			Message:   e.Message,
			Count:     e.Count,
			LastSeen:  eventLastSeen(e),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen.After(out[j].LastSeen) })
	if len(out) > eventsCap {
		out = out[:eventsCap]
	}
	return out, nil
}

// eventLastSeen picks the most meaningful timestamp for an Event: LastTimestamp,
// then EventTime (events.k8s.io style), then the creation time, all in UTC.
func eventLastSeen(e *corev1.Event) time.Time {
	if !e.LastTimestamp.IsZero() {
		return e.LastTimestamp.UTC()
	}
	if !e.EventTime.IsZero() {
		return e.EventTime.UTC()
	}
	return e.CreationTimestamp.UTC()
}

// itoa is a tiny strconv.FormatInt(.,10) wrapper kept local so the file's port/
// nodePort rendering does not pull strconv into the header for a single use.
func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
