package kube

// metrics.go adds live resource-usage reads backed by metrics-server
// (metrics.k8s.io/v1beta1) through the metrics versioned clientset built from
// the same *rest.Config as the typed clientset. It returns per-node and per-pod
// CPU (millicores) + memory (bytes) USAGE — distinct from the configured
// requests/limits surfaced elsewhere.
//
// metrics-server is OPTIONAL. When the metrics.k8s.io API group is not served
// (no metrics-server installed) the apiserver returns a NotFound / NoMatch /
// "ServiceUnavailable"-style error for the aggregated API. We translate that
// single condition into ErrMetricsUnavailable so callers can render a clear
// "metrics unavailable — install metrics-server" hint and the API layer can
// answer 200 with available=false instead of a 500. Any OTHER error (RBAC,
// connectivity) is returned wrapped so it still surfaces as a real failure.

import (
	"context"
	"errors"
	"sort"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// ErrMetricsUnavailable is the sentinel returned by NodeMetrics/PodMetrics when
// the metrics.k8s.io API group is not served by the cluster (metrics-server is
// not installed / not yet ready). It is NOT a transport or RBAC failure — the
// API layer treats it as a normal "available:false" result, not a 500.
var ErrMetricsUnavailable = errors.New("kube: metrics.k8s.io API unavailable (metrics-server not installed?)")

// NodeMetric is the normalized live usage of a single node. CpuMilli is CPU
// usage in millicores (1000 = 1 core); MemoryBytes is the working-set memory in
// bytes. Timestamp is the metrics-server sample time (RFC3339 in JSON).
type NodeMetric struct {
	Name        string `json:"name"`
	CpuMilli    int64  `json:"cpuMilli"`
	MemoryBytes int64  `json:"memoryBytes"`
	Timestamp   string `json:"timestamp"`
}

// PodMetric is the normalized live usage of a single pod, summed across its
// containers. CpuMilli is millicores; MemoryBytes is bytes.
type PodMetric struct {
	Namespace   string `json:"namespace"`
	Name        string `json:"name"`
	CpuMilli    int64  `json:"cpuMilli"`
	MemoryBytes int64  `json:"memoryBytes"`
	Timestamp   string `json:"timestamp"`
}

// metricsClient builds a metrics.k8s.io versioned clientset from the provider's
// rest.Config (the same config backing the typed clientset).
func (p *KubeProvider) metricsClient() (metricsclient.Interface, error) {
	return metricsclient.NewForConfig(p.restConfig)
}

// NodeMetrics returns live per-node CPU+memory usage from metrics-server. When
// metrics-server is not installed it returns ErrMetricsUnavailable.
func (p *KubeProvider) NodeMetrics(ctx context.Context) ([]NodeMetric, error) {
	mc, err := p.metricsClient()
	if err != nil {
		return nil, err
	}
	list, err := mc.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, mapMetricsErr(err)
	}
	out := make([]NodeMetric, 0, len(list.Items))
	for i := range list.Items {
		n := &list.Items[i]
		cpu, mem := usageCPUMem(n.Usage)
		out = append(out, NodeMetric{
			Name:        n.Name,
			CpuMilli:    cpu,
			MemoryBytes: mem,
			Timestamp:   n.Timestamp.Time.UTC().Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// PodMetrics returns live per-pod CPU+memory usage (summed over containers) for
// a namespace ("" = all). When metrics-server is not installed it returns
// ErrMetricsUnavailable.
func (p *KubeProvider) PodMetrics(ctx context.Context, namespace string) ([]PodMetric, error) {
	mc, err := p.metricsClient()
	if err != nil {
		return nil, err
	}
	list, err := mc.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, mapMetricsErr(err)
	}
	out := make([]PodMetric, 0, len(list.Items))
	for i := range list.Items {
		pm := &list.Items[i]
		var cpu, mem int64
		for j := range pm.Containers {
			c, m := usageCPUMem(pm.Containers[j].Usage)
			cpu += c
			mem += m
		}
		out = append(out, PodMetric{
			Namespace:   pm.Namespace,
			Name:        pm.Name,
			CpuMilli:    cpu,
			MemoryBytes: mem,
			Timestamp:   pm.Timestamp.Time.UTC().Format("2006-01-02T15:04:05Z07:00"),
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

// usageCPUMem extracts CPU millicores + memory bytes from a metrics usage
// ResourceList. CPU MilliValue() yields millicores; memory Value() yields bytes.
func usageCPUMem(usage corev1.ResourceList) (cpuMilli int64, memBytes int64) {
	if q, ok := usage[corev1.ResourceCPU]; ok {
		cpuMilli = q.MilliValue()
	}
	if q, ok := usage[corev1.ResourceMemory]; ok {
		memBytes = q.Value()
	}
	return cpuMilli, memBytes
}

// mapMetricsErr translates a metrics list error: the "API group not served"
// family (no metrics-server) becomes ErrMetricsUnavailable; everything else is
// returned as-is (RBAC/connectivity surface as a real 500). The aggregated
// metrics API can report its absence as 404 NotFound, a discovery NoMatch, or a
// 503 ServiceUnavailable depending on the apiserver/aggregator state, so all
// three are folded into the sentinel.
func mapMetricsErr(err error) error {
	if err == nil {
		return nil
	}
	if apierrors.IsNotFound(err) || apierrors.IsServiceUnavailable(err) || meta.IsNoMatchError(err) {
		return ErrMetricsUnavailable
	}
	return err
}
