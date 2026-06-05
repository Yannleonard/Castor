// Package helm implements Castor's Helm management surface on top of the Helm
// Go SDK (helm.sh/helm/v3). It builds an action.Configuration from the same
// *rest.Config that backs the Kubernetes provider's typed clientset, using the
// Kubernetes Secrets storage driver in the target namespace (so releases are
// stored exactly like `helm --driver secrets`, the modern default). Repository
// state (the repositories.yaml file and the per-repo cached index.yaml files)
// lives under a writable data directory (default /data/helm), Castor's
// persistent volume.
//
// Files:
//   - getter.go  — a genericclioptions.RESTClientGetter built from *rest.Config.
//   - helm.go     — the Service holding restConfig + repo/cache paths; builds
//     per-namespace action.Configuration values.
//   - repo.go     — repository add/list/remove/update + chart search.
//   - release.go  — install/upgrade/rollback/uninstall + list/history/values.
package helm

import (
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"

	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// restConfigGetter adapts a *rest.Config into a genericclioptions.RESTClientGetter,
// which is what action.Configuration.Init and the Helm chart-install machinery
// consume. Castor already holds a fully-formed *rest.Config (loaded from the
// mounted kubeconfig / in-cluster config), so there is no kubeconfig file to
// parse — every accessor derives from that single config plus a target
// namespace. The discovery client is memory-cached and the RESTMapper is the
// deferred discovery mapper, matching how the provider's ApplyManifest builds
// its mapper.
type restConfigGetter struct {
	cfg       *rest.Config
	namespace string
}

// newRESTClientGetter builds a RESTClientGetter for the given namespace.
func newRESTClientGetter(cfg *rest.Config, namespace string) *restConfigGetter {
	if namespace == "" {
		namespace = "default"
	}
	return &restConfigGetter{cfg: cfg, namespace: namespace}
}

// ToRESTConfig returns a shallow copy of the backing config so callers (Helm)
// can mutate transport-level fields (e.g. content type, warning handler) without
// corrupting the shared provider config.
func (g *restConfigGetter) ToRESTConfig() (*rest.Config, error) {
	return rest.CopyConfig(g.cfg), nil
}

// ToDiscoveryClient returns a memory-cached discovery client (Helm calls this
// repeatedly while resolving chart kinds; caching avoids re-hitting /api,
// /apis on every lookup).
func (g *restConfigGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	c := rest.CopyConfig(g.cfg)
	// Burst/QPS bumps keep discovery snappy for large clusters (mirrors the
	// defaults the Helm CLI applies to its own getter).
	c.Burst = 100
	c.QPS = 50
	dc, err := discovery.NewDiscoveryClientForConfig(c)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(dc), nil
}

// ToRESTMapper builds a deferred discovery REST mapper over the cached discovery
// client — the exact construction the Kubernetes provider uses for server-side
// apply (kube/write.go). Helm only needs RESTMapping resolution, so the deferred
// discovery mapper is returned directly (no kubectl shortcut expander, which is
// version-fragile and unnecessary here).
func (g *restConfigGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(dc), nil
}

// ToRawKubeConfigLoader returns a minimal in-memory clientcmd loader pinned to
// the target namespace. Helm uses it only to resolve the default namespace; the
// connection itself always comes from ToRESTConfig, so an empty kubeconfig with
// the namespace set is sufficient.
func (g *restConfigGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	overrides := &clientcmd.ConfigOverrides{Context: clientcmdapi.Context{Namespace: g.namespace}}
	return clientcmd.NewDefaultClientConfig(*clientcmdapi.NewConfig(), overrides)
}

// Compile-time assertion that we satisfy the interface Helm requires.
var _ genericclioptions.RESTClientGetter = (*restConfigGetter)(nil)
