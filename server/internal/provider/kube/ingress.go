package kube

// ingress.go adds the read + delete surface for networking.k8s.io/v1 Ingresses.
// Listing is a typed call through the clientset; deletion is reached through a
// dedicated API endpoint (api/k8s_cluster.go), NOT the generic Provider mutation
// interface. Create/update is intentionally NOT a typed method here: arbitrary
// Ingress objects (rules, TLS, backend services, annotations) are created via
// the generic server-side-apply YAML path (ApplyManifest in write.go), which
// already covers Ingress like any other resource. Errors are normalized to
// provider.ErrNotFound / provider.ErrConflict via mapKubeWriteErr (write.go) so
// the API layer maps them to 404 / 409.

import (
	"context"
	"sort"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/gtek-it/castor/server/internal/provider"
)

// IngressInfo is the normalized Ingress summary. Class is the IngressClass
// (spec.ingressClassName, falling back to the legacy kubernetes.io/ingress.class
// annotation, "" when neither is set). Hosts are the distinct rule hosts (a "*"
// catch-all entry for a hostless rule). Paths are rendered "<host><path> ->
// <service>:<port>" so a single column conveys the routing table. Address is
// the first load-balancer ingress IP/hostname ("" until provisioned).
type IngressInfo struct {
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Class     string    `json:"class"`
	Hosts     []string  `json:"hosts"`
	Paths     []string  `json:"paths"`
	Address   string    `json:"address"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListIngresses returns normalized Ingress summaries for a namespace ("" = all),
// sorted by namespace then name.
func (p *KubeProvider) ListIngresses(ctx context.Context, namespace string) ([]IngressInfo, error) {
	list, err := p.clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]IngressInfo, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, mapIngress(&list.Items[i]))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// DeleteIngress deletes an Ingress by namespace + name.
func (p *KubeProvider) DeleteIngress(ctx context.Context, namespace, name string) error {
	if namespace == "" || name == "" {
		return provider.ErrNotFound
	}
	if err := p.clientset.NetworkingV1().Ingresses(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return mapKubeWriteErr(err)
	}
	return nil
}

// mapIngress normalizes a networking/v1 Ingress into IngressInfo.
func mapIngress(ing *networkingv1.Ingress) IngressInfo {
	info := IngressInfo{
		Namespace: ing.Namespace,
		Name:      ing.Name,
		Class:     ingressClass(ing),
		Hosts:     ingressHosts(ing),
		Paths:     ingressPaths(ing),
		Address:   ingressAddress(ing),
		CreatedAt: ing.CreationTimestamp.UTC(),
	}
	return info
}

// ingressClass returns spec.ingressClassName, falling back to the legacy
// kubernetes.io/ingress.class annotation, "" when neither is present.
func ingressClass(ing *networkingv1.Ingress) string {
	if ing.Spec.IngressClassName != nil && *ing.Spec.IngressClassName != "" {
		return *ing.Spec.IngressClassName
	}
	return ing.Annotations["kubernetes.io/ingress.class"]
}

// ingressHosts returns the distinct rule hosts (a hostless rule contributes
// "*"), preserving first-seen order.
func ingressHosts(ing *networkingv1.Ingress) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(ing.Spec.Rules))
	for _, rule := range ing.Spec.Rules {
		h := rule.Host
		if h == "" {
			h = "*"
		}
		if _, dup := seen[h]; dup {
			continue
		}
		seen[h] = struct{}{}
		out = append(out, h)
	}
	return out
}

// ingressPaths renders each HTTP rule path as "<host><path> -> <service>:<port>"
// (a hostless rule uses "*"; the default backend, if any, is rendered as
// "* -> <service>:<port>"). Numeric and named service ports are both handled.
func ingressPaths(ing *networkingv1.Ingress) []string {
	var out []string
	for _, rule := range ing.Spec.Rules {
		host := rule.Host
		if host == "" {
			host = "*"
		}
		if rule.HTTP == nil {
			continue
		}
		for _, pth := range rule.HTTP.Paths {
			out = append(out, host+pathOrRoot(pth.Path)+" -> "+backendString(pth.Backend))
		}
	}
	if ing.Spec.DefaultBackend != nil {
		out = append(out, "* -> "+backendString(*ing.Spec.DefaultBackend))
	}
	return out
}

// pathOrRoot returns the rule path, defaulting "" to "/".
func pathOrRoot(p string) string {
	if p == "" {
		return "/"
	}
	return p
}

// backendString renders an IngressBackend's target as "<service>:<port>"
// (numeric or named port), or a resource backend as "<kind>/<name>".
func backendString(b networkingv1.IngressBackend) string {
	if b.Service != nil {
		port := ""
		switch {
		case b.Service.Port.Number != 0:
			port = itoa(int64(b.Service.Port.Number))
		case b.Service.Port.Name != "":
			port = b.Service.Port.Name
		}
		if port == "" {
			return b.Service.Name
		}
		return b.Service.Name + ":" + port
	}
	if b.Resource != nil {
		return b.Resource.Kind + "/" + b.Resource.Name
	}
	return ""
}

// ingressAddress returns the first load-balancer ingress IP/hostname, "" until
// the controller provisions one.
func ingressAddress(ing *networkingv1.Ingress) string {
	for _, lb := range ing.Status.LoadBalancer.Ingress {
		if lb.IP != "" {
			return lb.IP
		}
		if lb.Hostname != "" {
			return lb.Hostname
		}
	}
	return ""
}
