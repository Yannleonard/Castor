package kube

// kinds_test.go exercises the controller-kind read mappings and the CronJob
// writes against client-go's fake clientset — no cluster needed.

import (
	"context"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func int32Ptr(v int32) *int32 { return &v }
func boolPtr(v bool) *bool    { return &v }

func podTemplate(image string) corev1.PodTemplateSpec {
	return corev1.PodTemplateSpec{
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main", Image: image}},
		},
	}
}

func TestListStatefulSetsMapsAndFilters(t *testing.T) {
	cs := fake.NewClientset(
		&appsv1.StatefulSet{
			ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "db"},
			Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(3), Template: podTemplate("postgres:16")},
			Status:     appsv1.StatefulSetStatus{ReadyReplicas: 2, AvailableReplicas: 1},
		},
		&appsv1.StatefulSet{
			ObjectMeta: metav1.ObjectMeta{Namespace: "dev", Name: "db"},
			Spec:       appsv1.StatefulSetSpec{Template: podTemplate("postgres:16")},
		},
	)
	p := &KubeProvider{clientset: cs, id: ProviderID}

	all, err := p.ListStatefulSets(context.Background(), "")
	if err != nil {
		t.Fatalf("ListStatefulSets: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("all statefulsets = %d want 2", len(all))
	}
	// Sorted by namespace then name: dev before prod.
	if all[0].Namespace != "dev" || all[1].Namespace != "prod" {
		t.Errorf("sort order = %s,%s want dev,prod", all[0].Namespace, all[1].Namespace)
	}

	prod, err := p.ListStatefulSets(context.Background(), "prod")
	if err != nil {
		t.Fatalf("ListStatefulSets(prod): %v", err)
	}
	if len(prod) != 1 {
		t.Fatalf("prod statefulsets = %d want 1", len(prod))
	}
	got := prod[0]
	if got.Replicas != 3 || got.Ready != 2 || got.Available != 1 || got.Image != "postgres:16" {
		t.Errorf("mapped statefulset = %+v", got)
	}
}

func TestListJobsAndCronJobsMapping(t *testing.T) {
	started := metav1.NewTime(time.Date(2026, 7, 1, 3, 0, 0, 0, time.UTC))
	completed := metav1.NewTime(time.Date(2026, 7, 1, 3, 5, 0, 0, time.UTC))
	cs := fake.NewClientset(
		&batchv1.Job{
			ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "migrate"},
			Spec:       batchv1.JobSpec{Completions: int32Ptr(1)},
			Status: batchv1.JobStatus{
				Succeeded: 1, StartTime: &started, CompletionTime: &completed,
			},
		},
		&batchv1.CronJob{
			ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "backup"},
			Spec:       batchv1.CronJobSpec{Schedule: "0 3 * * *", Suspend: boolPtr(true)},
			Status: batchv1.CronJobStatus{
				Active:           []corev1.ObjectReference{{Name: "backup-1"}},
				LastScheduleTime: &started,
			},
		},
	)
	p := &KubeProvider{clientset: cs, id: ProviderID}

	jobs, err := p.ListJobs(context.Background(), "prod")
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("jobs = %d want 1", len(jobs))
	}
	j := jobs[0]
	if j.Completions != 1 || j.Succeeded != 1 || j.StartedAt == nil || j.CompletedAt == nil {
		t.Errorf("mapped job = %+v", j)
	}
	if j.StartedAt != nil && !j.StartedAt.Equal(started.Time) {
		t.Errorf("startedAt = %v want %v", j.StartedAt, started.Time)
	}

	crons, err := p.ListCronJobs(context.Background(), "")
	if err != nil {
		t.Fatalf("ListCronJobs: %v", err)
	}
	if len(crons) != 1 {
		t.Fatalf("cronjobs = %d want 1", len(crons))
	}
	c := crons[0]
	if c.Schedule != "0 3 * * *" || !c.Suspend || c.ActiveCount != 1 || c.LastScheduleAt == nil {
		t.Errorf("mapped cronjob = %+v", c)
	}
}

func TestTriggerCronJobCreatesManualJob(t *testing.T) {
	cj := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "backup", UID: "uid-1"},
		Spec: batchv1.CronJobSpec{
			Schedule: "0 3 * * *",
			JobTemplate: batchv1.JobTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels:      map[string]string{"app": "backup"},
					Annotations: map[string]string{"team": "ops"},
				},
				Spec: batchv1.JobSpec{Template: podTemplate("backup:1")},
			},
		},
	}
	cs := fake.NewClientset(cj)
	p := &KubeProvider{clientset: cs, id: ProviderID}

	jobName, err := p.TriggerCronJob(context.Background(), "prod", "backup")
	if err != nil {
		t.Fatalf("TriggerCronJob: %v", err)
	}
	if !strings.HasPrefix(jobName, "backup-manual-") {
		t.Errorf("job name = %q want backup-manual-<ts>", jobName)
	}

	job, err := cs.BatchV1().Jobs("prod").Get(context.Background(), jobName, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("created job not found: %v", err)
	}
	if job.Annotations["cronjob.kubernetes.io/instantiate"] != "manual" {
		t.Errorf("missing manual-instantiation annotation: %v", job.Annotations)
	}
	if job.Annotations["team"] != "ops" || job.Labels["app"] != "backup" {
		t.Errorf("template labels/annotations not carried over: %v / %v", job.Labels, job.Annotations)
	}
	// No ownerReference, matching `kubectl create job --from=cronjob`: a
	// controller reference would make the CronJob controller adopt the manual
	// Job (counted in .status.active, GC'd under the history limits).
	if len(job.OwnerReferences) != 0 {
		t.Errorf("ownerReferences = %+v want none", job.OwnerReferences)
	}
	if img := job.Spec.Template.Spec.Containers[0].Image; img != "backup:1" {
		t.Errorf("job template image = %q want backup:1", img)
	}

	// Missing CronJob normalizes to provider.ErrNotFound via mapKubeWriteErr.
	if _, err := p.TriggerCronJob(context.Background(), "prod", "ghost"); err == nil {
		t.Errorf("TriggerCronJob(ghost) should fail")
	}
}

func TestSuspendCronJobPatchesSpec(t *testing.T) {
	cs := fake.NewClientset(&batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "backup"},
		Spec:       batchv1.CronJobSpec{Schedule: "0 3 * * *"},
	})
	p := &KubeProvider{clientset: cs, id: ProviderID}

	if err := p.SuspendCronJob(context.Background(), "prod", "backup", true); err != nil {
		t.Fatalf("SuspendCronJob(true): %v", err)
	}
	got, err := cs.BatchV1().CronJobs("prod").Get(context.Background(), "backup", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Spec.Suspend == nil || !*got.Spec.Suspend {
		t.Errorf("spec.suspend = %v want true", got.Spec.Suspend)
	}

	if err := p.SuspendCronJob(context.Background(), "prod", "backup", false); err != nil {
		t.Fatalf("SuspendCronJob(false): %v", err)
	}
	got, err = cs.BatchV1().CronJobs("prod").Get(context.Background(), "backup", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Spec.Suspend == nil || *got.Spec.Suspend {
		t.Errorf("spec.suspend = %v want false", got.Spec.Suspend)
	}
}
