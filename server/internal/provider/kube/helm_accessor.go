package kube

// helm_accessor.go exposes the provider's *rest.Config to the Helm service
// layer (server/internal/provider/kube/helm). The restConfig field is unexported
// and kube.go is shared across cluster-management features, so rather than widen
// kube.go this small additive accessor lives in its own file. The Helm SDK needs
// the same *rest.Config that backs the typed clientset to build its
// action.Configuration (RESTClientGetter + secrets storage driver).

import "k8s.io/client-go/rest"

// RestConfig returns the *rest.Config backing this provider's clientset. The
// Helm service (kube/helm) wraps it in a RESTClientGetter to build per-namespace
// action.Configuration values. The returned pointer is the live config; callers
// must treat it as read-only.
func (p *KubeProvider) RestConfig() *rest.Config { return p.restConfig }
