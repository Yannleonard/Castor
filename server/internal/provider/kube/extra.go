package kube

import (
	"context"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// DeploymentInfo is the normalized Deployment summary the API exposes.
// Containers carries the per-container requests/limits declared on the pod
// template; QosClass is the QoS class those resources imply (Guaranteed /
// Burstable / BestEffort), computed with the kubelet rules.
type DeploymentInfo struct {
	Namespace  string                  `json:"namespace"`
	Name       string                  `json:"name"`
	Replicas   int32                   `json:"replicas"`
	Ready      int32                   `json:"ready"`
	Available  int32                   `json:"available"`
	Image      string                  `json:"image"`
	CreatedAt  time.Time               `json:"createdAt"`
	Containers []K8sContainerResources `json:"containers"`
	QosClass   string                  `json:"qosClass"`
}

// ListDeployments returns normalized Deployment summaries for a namespace
// ("" = all).
func (p *KubeProvider) ListDeployments(ctx context.Context, namespace string) ([]DeploymentInfo, error) {
	deps, err := p.clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]DeploymentInfo, 0, len(deps.Items))
	for i := range deps.Items {
		d := &deps.Items[i]
		var replicas int32
		if d.Spec.Replicas != nil {
			replicas = *d.Spec.Replicas
		}
		containers := d.Spec.Template.Spec.Containers
		image := ""
		if len(containers) > 0 {
			image = containers[0].Image
		}
		out = append(out, DeploymentInfo{
			Namespace:  d.Namespace,
			Name:       d.Name,
			Replicas:   replicas,
			Ready:      d.Status.ReadyReplicas,
			Available:  d.Status.AvailableReplicas,
			Image:      image,
			CreatedAt:  d.CreationTimestamp.UTC(),
			Containers: containersResources(containers),
			QosClass:   QosClassForContainers(containers),
		})
	}
	return out, nil
}

// NodeInfo is the normalized Node summary the API exposes.
type NodeInfo struct {
	Name       string   `json:"name"`
	Status     string   `json:"status"`
	Roles      []string `json:"roles"`
	Version    string   `json:"version"`
	InternalIP string   `json:"internalIP"`
}

// ListNodes returns normalized Node summaries.
func (p *KubeProvider) ListNodes(ctx context.Context) ([]NodeInfo, error) {
	nodes, err := p.clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]NodeInfo, 0, len(nodes.Items))
	for i := range nodes.Items {
		n := &nodes.Items[i]
		status := "NotReady"
		for _, c := range n.Status.Conditions {
			if string(c.Type) == "Ready" && string(c.Status) == "True" {
				status = "Ready"
			}
		}
		var roles []string
		for label := range n.Labels {
			const prefix = "node-role.kubernetes.io/"
			if strings.HasPrefix(label, prefix) {
				role := strings.TrimPrefix(label, prefix)
				if role == "" {
					role = "control-plane"
				}
				roles = append(roles, role)
			}
		}
		if roles == nil {
			roles = []string{}
		}
		internalIP := ""
		for _, addr := range n.Status.Addresses {
			if string(addr.Type) == "InternalIP" {
				internalIP = addr.Address
				break
			}
		}
		out = append(out, NodeInfo{
			Name:       n.Name,
			Status:     status,
			Roles:      roles,
			Version:    n.Status.NodeInfo.KubeletVersion,
			InternalIP: internalIP,
		})
	}
	return out, nil
}

// PodCount returns the number of pods across all namespaces (host summary).
func (p *KubeProvider) PodCount(ctx context.Context) int {
	pods, err := p.clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return 0
	}
	return len(pods.Items)
}
