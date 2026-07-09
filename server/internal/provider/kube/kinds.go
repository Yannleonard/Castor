package kube

// kinds.go extends the read surface of the Kubernetes provider with the
// remaining workload controller kinds: StatefulSets, DaemonSets, Jobs, and
// CronJobs. Each follows the ListDeployments/DeploymentInfo model (extra.go):
// a typed list call through the clientset normalized into a compact summary
// struct the API exposes from the cache snapshot. Lists are sorted by
// namespace then name for stable output.

import (
	"context"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StatefulSetInfo is the normalized StatefulSet summary the API exposes.
type StatefulSetInfo struct {
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Replicas  int32     `json:"replicas"`
	Ready     int32     `json:"ready"`
	Available int32     `json:"available"`
	Image     string    `json:"image"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListStatefulSets returns normalized StatefulSet summaries for a namespace
// ("" = all).
func (p *KubeProvider) ListStatefulSets(ctx context.Context, namespace string) ([]StatefulSetInfo, error) {
	sets, err := p.clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]StatefulSetInfo, 0, len(sets.Items))
	for i := range sets.Items {
		s := &sets.Items[i]
		var replicas int32
		if s.Spec.Replicas != nil {
			replicas = *s.Spec.Replicas
		}
		out = append(out, StatefulSetInfo{
			Namespace: s.Namespace,
			Name:      s.Name,
			Replicas:  replicas,
			Ready:     s.Status.ReadyReplicas,
			Available: s.Status.AvailableReplicas,
			Image:     firstContainerImage(s.Spec.Template.Spec.Containers),
			CreatedAt: s.CreationTimestamp.UTC(),
		})
	}
	sortByNamespaceName(out, func(v StatefulSetInfo) (string, string) { return v.Namespace, v.Name })
	return out, nil
}

// DaemonSetInfo is the normalized DaemonSet summary the API exposes.
type DaemonSetInfo struct {
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Desired   int32     `json:"desired"`
	Ready     int32     `json:"ready"`
	Available int32     `json:"available"`
	Image     string    `json:"image"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListDaemonSets returns normalized DaemonSet summaries for a namespace
// ("" = all).
func (p *KubeProvider) ListDaemonSets(ctx context.Context, namespace string) ([]DaemonSetInfo, error) {
	sets, err := p.clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]DaemonSetInfo, 0, len(sets.Items))
	for i := range sets.Items {
		d := &sets.Items[i]
		out = append(out, DaemonSetInfo{
			Namespace: d.Namespace,
			Name:      d.Name,
			Desired:   d.Status.DesiredNumberScheduled,
			Ready:     d.Status.NumberReady,
			Available: d.Status.NumberAvailable,
			Image:     firstContainerImage(d.Spec.Template.Spec.Containers),
			CreatedAt: d.CreationTimestamp.UTC(),
		})
	}
	sortByNamespaceName(out, func(v DaemonSetInfo) (string, string) { return v.Namespace, v.Name })
	return out, nil
}

// JobInfo is the normalized Job summary the API exposes. Completions is the
// declared spec.completions (0 when unset); StartedAt/CompletedAt are nil until
// the controller stamps them.
type JobInfo struct {
	Namespace   string     `json:"namespace"`
	Name        string     `json:"name"`
	Completions int32      `json:"completions"`
	Succeeded   int32      `json:"succeeded"`
	Failed      int32      `json:"failed"`
	Active      int32      `json:"active"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// ListJobs returns normalized Job summaries for a namespace ("" = all).
func (p *KubeProvider) ListJobs(ctx context.Context, namespace string) ([]JobInfo, error) {
	jobs, err := p.clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]JobInfo, 0, len(jobs.Items))
	for i := range jobs.Items {
		j := &jobs.Items[i]
		var completions int32
		if j.Spec.Completions != nil {
			completions = *j.Spec.Completions
		}
		out = append(out, JobInfo{
			Namespace:   j.Namespace,
			Name:        j.Name,
			Completions: completions,
			Succeeded:   j.Status.Succeeded,
			Failed:      j.Status.Failed,
			Active:      j.Status.Active,
			StartedAt:   metaTimePtr(j.Status.StartTime),
			CompletedAt: metaTimePtr(j.Status.CompletionTime),
			CreatedAt:   j.CreationTimestamp.UTC(),
		})
	}
	sortByNamespaceName(out, func(v JobInfo) (string, string) { return v.Namespace, v.Name })
	return out, nil
}

// CronJobInfo is the normalized CronJob summary the API exposes. ActiveCount is
// the number of currently running Jobs the controller tracks; LastScheduleAt is
// nil until the first scheduled run.
type CronJobInfo struct {
	Namespace      string     `json:"namespace"`
	Name           string     `json:"name"`
	Schedule       string     `json:"schedule"`
	Suspend        bool       `json:"suspend"`
	ActiveCount    int        `json:"activeCount"`
	LastScheduleAt *time.Time `json:"lastScheduleAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// ListCronJobs returns normalized CronJob summaries for a namespace ("" = all).
func (p *KubeProvider) ListCronJobs(ctx context.Context, namespace string) ([]CronJobInfo, error) {
	crons, err := p.clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]CronJobInfo, 0, len(crons.Items))
	for i := range crons.Items {
		c := &crons.Items[i]
		suspend := false
		if c.Spec.Suspend != nil {
			suspend = *c.Spec.Suspend
		}
		out = append(out, CronJobInfo{
			Namespace:      c.Namespace,
			Name:           c.Name,
			Schedule:       c.Spec.Schedule,
			Suspend:        suspend,
			ActiveCount:    len(c.Status.Active),
			LastScheduleAt: metaTimePtr(c.Status.LastScheduleTime),
			CreatedAt:      c.CreationTimestamp.UTC(),
		})
	}
	sortByNamespaceName(out, func(v CronJobInfo) (string, string) { return v.Namespace, v.Name })
	return out, nil
}

// firstContainerImage returns the first container's image ("" when the pod
// template declares none), matching the Deployment summary convention.
func firstContainerImage(containers []corev1.Container) string {
	if len(containers) > 0 {
		return containers[0].Image
	}
	return ""
}

// metaTimePtr converts an optional metav1.Time into a *time.Time in UTC (nil
// when absent or zero) for omitempty JSON serialization.
func metaTimePtr(t *metav1.Time) *time.Time {
	if t == nil || t.IsZero() {
		return nil
	}
	u := t.UTC()
	return &u
}

// sortByNamespaceName sorts a summary slice by namespace then name for stable
// list output across polls.
func sortByNamespaceName[T any](in []T, key func(T) (string, string)) {
	sort.Slice(in, func(i, j int) bool {
		nsI, nameI := key(in[i])
		nsJ, nameJ := key(in[j])
		if nsI != nsJ {
			return nsI < nsJ
		}
		return nameI < nameJ
	})
}
