package api

import "github.com/gtek-it/castor/server/internal/authz"

// permissionCatalog is the single source of truth for known permission strings.
// The UI's rbac.ts mirrors this list; the role editor offers exactly these.
var permissionCatalog = []string{
	"*",
	// docker containers
	"docker.container.read",
	"docker.container.start",
	"docker.container.stop",
	"docker.container.restart",
	"docker.container.pause",
	"docker.container.unpause",
	"docker.container.remove",
	"docker.container.logs",
	"docker.container.stats",
	"docker.container.exec",
	"docker.container.create",
	"docker.container.inspect.secrets",
	// docker images
	"docker.image.read",
	"docker.image.pull",
	"docker.image.delete",
	// docker networks
	"docker.network.read",
	"docker.network.delete",
	// docker volumes
	"docker.volume.read",
	"docker.volume.remove",
	"docker.volume.backup",
	"docker.volume.restore",
	// swarm (read + service/node lifecycle writes)
	"swarm.service.read",
	"swarm.task.read",
	"swarm.node.read",
	"swarm.service.create",
	"swarm.service.scale",
	"swarm.service.update",
	"swarm.service.remove",
	"swarm.node.update",
	// swarm secrets + configs (read metadata / write = create+delete).
	// Secret values are write-only (never returned on read); config payloads are
	// non-secret and returned on a single-config GET (still gated by .read).
	"swarm.secret.read",
	"swarm.secret.write",
	"swarm.config.read",
	"swarm.config.write",
	// kubernetes (read + deployment/pod/manifest writes)
	"k8s.pod.read",
	"k8s.deployment.read",
	"k8s.node.read",
	"k8s.deployment.scale",
	"k8s.deployment.restart",
	"k8s.deployment.resources",
	"k8s.workload.delete",
	"k8s.manifest.apply",
	// kubernetes autoscaling + core cluster objects (Wave 3)
	"k8s.hpa.read",
	"k8s.hpa.write",
	"k8s.namespace.read",
	"k8s.namespace.write",
	"k8s.service.read",
	"k8s.config.read",
	// kubernetes ingresses (read + delete; create/update via manifest apply)
	"k8s.ingress.read",
	"k8s.ingress.write",
	// kubernetes live metrics (metrics-server: node + pod CPU/memory usage)
	"k8s.metrics.read",
	// kubernetes storage (read PV/PVC/StorageClass + PVC create/delete)
	"k8s.storage.read",
	"k8s.storage.write",
	// helm (chart repositories + release lifecycle)
	"helm.repo.read",
	"helm.repo.write",
	"helm.release.read",
	"helm.release.install",
	"helm.release.upgrade",
	"helm.release.rollback",
	"helm.release.uninstall",
	// rbac
	"rbac.user.create",
	"rbac.user.read",
	"rbac.user.update",
	"rbac.user.delete",
	"rbac.role.create",
	"rbac.role.read",
	"rbac.role.update",
	"rbac.role.delete",
	"rbac.binding.create",
	"rbac.binding.delete",
	// audit & settings
	"audit.read",
	"settings.read",
	"settings.update",
	// marketplace: image registries (private/public pull credentials)
	"marketplace.registry.read",
	"marketplace.registry.write",
	// marketplace: remote template catalogs
	"marketplace.catalog.read",
	"marketplace.catalog.write",
	// marketplace: custom app templates (operator-authored; admin)
	"marketplace.template.create",
	"marketplace.template.update",
	"marketplace.template.delete",
	// SSO / external identity providers (LDAP + OIDC) — admin-only configuration.
	// Read lists provider config (secrets redacted); write covers create/update/
	// delete/test + group-role mapping CRUD. Only admin's "*" grant satisfies these.
	"auth.provider.read",
	"auth.provider.write",
}

// catalogSet is the lookup set for validation.
var catalogSet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(permissionCatalog))
	for _, p := range permissionCatalog {
		m[p] = struct{}{}
	}
	return m
}()

// PermissionCatalog returns a copy of the permission catalog.
func PermissionCatalog() []string {
	out := make([]string, len(permissionCatalog))
	copy(out, permissionCatalog)
	return out
}

// validatePermissions rejects unknown permission strings (also accepts dotted
// wildcards like "docker.container.*" and "docker.*").
func validatePermissions(perms []string) error {
	for _, p := range perms {
		if _, ok := catalogSet[p]; ok {
			continue
		}
		if isWildcardPermission(p) {
			continue
		}
		return authz.Errorf(authz.ErrValidation, "Unknown permission: "+p)
	}
	return nil
}

// isWildcardPermission accepts hierarchical wildcards ending in ".*" whose
// prefix is a known domain/resource.
func isWildcardPermission(p string) bool {
	if len(p) < 3 || p[len(p)-2:] != ".*" {
		return false
	}
	prefix := p[:len(p)-2]
	for known := range catalogSet {
		if known == prefix || hasDotPrefix(known, prefix) {
			return true
		}
	}
	return false
}

func hasDotPrefix(s, prefix string) bool {
	return len(s) > len(prefix) && s[:len(prefix)] == prefix && s[len(prefix)] == '.'
}
