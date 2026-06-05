package kube

// storage.go adds the Kubernetes storage-management surface: read
// PersistentVolumes, PersistentVolumeClaims, and StorageClasses, plus create and
// delete a PVC. Reads go through the typed clientset (CoreV1 / StorageV1); the
// PVC create builds a corev1.PersistentVolumeClaim with a BinarySI storage
// request. These power the storage endpoints (api/k8s_storage.go). Write errors
// are normalized to provider sentinels via mapKubeWriteErr (404 / 409); reads
// surface wrapped errors (-> 500).

import (
	"context"
	"sort"

	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/gtek-it/castor/server/internal/provider"
)

// defaultStorageClassAnnotation marks the cluster-default StorageClass (the
// beta annotation is still emitted alongside the GA one by most provisioners; we
// treat either as "default").
const (
	defaultStorageClassAnnotation     = "storageclass.kubernetes.io/is-default-class"
	defaultStorageClassAnnotationBeta = "storageclass.beta.kubernetes.io/is-default-class"
)

// PVInfo is the normalized PersistentVolume summary the API exposes. Capacity is
// the Quantity .String() form ("10Gi", …) and is "" when unset; Claim is the
// bound PVC as "<namespace>/<name>" (empty when unbound).
type PVInfo struct {
	Name          string   `json:"name"`
	Capacity      string   `json:"capacity"`
	AccessModes   []string `json:"accessModes"`
	ReclaimPolicy string   `json:"reclaimPolicy"`
	Status        string   `json:"status"`
	StorageClass  string   `json:"storageClass"`
	Claim         string   `json:"claim"`
}

// ListPVs returns normalized PersistentVolume summaries (cluster-scoped).
func (p *KubeProvider) ListPVs(ctx context.Context) ([]PVInfo, error) {
	pvs, err := p.clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]PVInfo, 0, len(pvs.Items))
	for i := range pvs.Items {
		pv := &pvs.Items[i]
		capacity := ""
		if q, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
			capacity = q.String()
		}
		claim := ""
		if ref := pv.Spec.ClaimRef; ref != nil && ref.Name != "" {
			claim = ref.Namespace + "/" + ref.Name
		}
		out = append(out, PVInfo{
			Name:          pv.Name,
			Capacity:      capacity,
			AccessModes:   accessModeStrings(pv.Spec.AccessModes),
			ReclaimPolicy: string(pv.Spec.PersistentVolumeReclaimPolicy),
			Status:        string(pv.Status.Phase),
			StorageClass:  pv.Spec.StorageClassName,
			Claim:         claim,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// PVCInfo is the normalized PersistentVolumeClaim summary the API exposes.
// Capacity is the bound capacity (status) Quantity .String() form, "" when not
// yet bound; Volume is the bound PV name (empty when Pending).
type PVCInfo struct {
	Namespace    string   `json:"namespace"`
	Name         string   `json:"name"`
	Status       string   `json:"status"`
	Volume       string   `json:"volume"`
	Capacity     string   `json:"capacity"`
	AccessModes  []string `json:"accessModes"`
	StorageClass string   `json:"storageClass"`
}

// ListPVCs returns normalized PersistentVolumeClaim summaries for a namespace
// ("" = all namespaces).
func (p *KubeProvider) ListPVCs(ctx context.Context, namespace string) ([]PVCInfo, error) {
	pvcs, err := p.clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]PVCInfo, 0, len(pvcs.Items))
	for i := range pvcs.Items {
		c := &pvcs.Items[i]
		capacity := ""
		if q, ok := c.Status.Capacity[corev1.ResourceStorage]; ok {
			capacity = q.String()
		}
		sc := ""
		if c.Spec.StorageClassName != nil {
			sc = *c.Spec.StorageClassName
		}
		out = append(out, PVCInfo{
			Namespace:    c.Namespace,
			Name:         c.Name,
			Status:       string(c.Status.Phase),
			Volume:       c.Spec.VolumeName,
			Capacity:     capacity,
			AccessModes:  accessModeStrings(c.Spec.AccessModes),
			StorageClass: sc,
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

// StorageClassInfo is the normalized StorageClass summary the API exposes.
// IsDefault reflects the is-default-class annotation (GA or beta).
type StorageClassInfo struct {
	Name              string `json:"name"`
	Provisioner       string `json:"provisioner"`
	ReclaimPolicy     string `json:"reclaimPolicy"`
	VolumeBindingMode string `json:"volumeBindingMode"`
	IsDefault         bool   `json:"isDefault"`
}

// ListStorageClasses returns normalized StorageClass summaries (cluster-scoped).
func (p *KubeProvider) ListStorageClasses(ctx context.Context) ([]StorageClassInfo, error) {
	scs, err := p.clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]StorageClassInfo, 0, len(scs.Items))
	for i := range scs.Items {
		sc := &scs.Items[i]
		out = append(out, StorageClassInfo{
			Name:              sc.Name,
			Provisioner:       sc.Provisioner,
			ReclaimPolicy:     reclaimPolicyString(sc.ReclaimPolicy),
			VolumeBindingMode: volumeBindingModeString(sc.VolumeBindingMode),
			IsDefault:         isDefaultStorageClass(sc),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// PVCCreateSpec is the input for CreatePVC. Name is the PVC name; StorageClass
// selects the class ("" leaves it unset so the cluster default applies);
// AccessModes are the requested access modes ("ReadWriteOnce", …) — when empty,
// ReadWriteOnce is assumed; RequestBytes is the requested storage in bytes
// (must be > 0), applied as a BinarySI quantity.
type PVCCreateSpec struct {
	Name         string   `json:"name"`
	StorageClass string   `json:"storageClass"`
	AccessModes  []string `json:"accessModes"`
	RequestBytes int64    `json:"requestBytes"`
}

// CreatePVC creates a PersistentVolumeClaim in the namespace from spec. It
// returns provider.ErrConflict on an invalid spec (missing name / non-positive
// request) and normalizes apiserver errors (already-exists -> ErrConflict,
// not-found -> ErrNotFound) via mapKubeWriteErr.
func (p *KubeProvider) CreatePVC(ctx context.Context, namespace string, spec PVCCreateSpec) (*PVCInfo, error) {
	if namespace == "" || spec.Name == "" {
		return nil, provider.ErrConflict
	}
	if spec.RequestBytes <= 0 {
		return nil, provider.ErrConflict
	}

	modes := accessModesFromStrings(spec.AccessModes)
	if len(modes) == 0 {
		modes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}
	}

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      spec.Name,
			Namespace: namespace,
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: modes,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: *resource.NewQuantity(spec.RequestBytes, resource.BinarySI),
				},
			},
		},
	}
	if spec.StorageClass != "" {
		sc := spec.StorageClass
		pvc.Spec.StorageClassName = &sc
	}

	created, err := p.clientset.CoreV1().PersistentVolumeClaims(namespace).Create(ctx, pvc, metav1.CreateOptions{})
	if err != nil {
		return nil, mapKubeWriteErr(err)
	}

	capacity := ""
	if q, ok := created.Status.Capacity[corev1.ResourceStorage]; ok {
		capacity = q.String()
	}
	scName := ""
	if created.Spec.StorageClassName != nil {
		scName = *created.Spec.StorageClassName
	}
	return &PVCInfo{
		Namespace:    created.Namespace,
		Name:         created.Name,
		Status:       string(created.Status.Phase),
		Volume:       created.Spec.VolumeName,
		Capacity:     capacity,
		AccessModes:  accessModeStrings(created.Spec.AccessModes),
		StorageClass: scName,
	}, nil
}

// DeletePVC deletes a PersistentVolumeClaim (the bound PV is reclaimed per its
// reclaim policy by the apiserver/controller).
func (p *KubeProvider) DeletePVC(ctx context.Context, namespace, name string) error {
	if namespace == "" || name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.CoreV1().PersistentVolumeClaims(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// accessModeStrings converts PV/PVC access modes to their string form, always
// returning a non-nil slice so the JSON encodes as [] not null.
func accessModeStrings(modes []corev1.PersistentVolumeAccessMode) []string {
	out := make([]string, 0, len(modes))
	for _, m := range modes {
		out = append(out, string(m))
	}
	return out
}

// accessModesFromStrings parses requested access-mode strings, dropping unknown
// values so an invalid entry cannot smuggle a bogus mode into the API object.
func accessModesFromStrings(in []string) []corev1.PersistentVolumeAccessMode {
	out := make([]corev1.PersistentVolumeAccessMode, 0, len(in))
	for _, s := range in {
		switch corev1.PersistentVolumeAccessMode(s) {
		case corev1.ReadWriteOnce:
			out = append(out, corev1.ReadWriteOnce)
		case corev1.ReadOnlyMany:
			out = append(out, corev1.ReadOnlyMany)
		case corev1.ReadWriteMany:
			out = append(out, corev1.ReadWriteMany)
		case corev1.ReadWriteOncePod:
			out = append(out, corev1.ReadWriteOncePod)
		}
	}
	return out
}

// reclaimPolicyString returns the StorageClass reclaim policy as a string,
// defaulting to Delete (the apiserver default when the field is nil).
func reclaimPolicyString(p *corev1.PersistentVolumeReclaimPolicy) string {
	if p == nil {
		return string(corev1.PersistentVolumeReclaimDelete)
	}
	return string(*p)
}

// volumeBindingModeString returns the StorageClass volume binding mode as a
// string, defaulting to Immediate (the apiserver default when the field is nil).
func volumeBindingModeString(m *storagev1.VolumeBindingMode) string {
	if m == nil {
		return string(storagev1.VolumeBindingImmediate)
	}
	return string(*m)
}

// isDefaultStorageClass reports whether the class carries an is-default-class
// annotation (GA or beta) set to "true".
func isDefaultStorageClass(sc *storagev1.StorageClass) bool {
	return sc.Annotations[defaultStorageClassAnnotation] == "true" ||
		sc.Annotations[defaultStorageClassAnnotationBeta] == "true"
}
