package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/web"
)

// scopeFromHost derives the request scope from the {hostID} URL param so RBAC
// can match host-scoped bindings. Global-scoped bindings match everything.
func scopeFromHost(r *http.Request) authz.Scope {
	if id := chi.URLParam(r, "hostID"); id != "" {
		return authz.Scope{Type: "host", ID: id}
	}
	return authz.Scope{Type: "global"}
}

// Router builds the complete chi mux: public routes, the protected /api/v1
// group with the fixed middleware chain, the WebSocket route, and the SPA +
// embedded-UI fallback. No net/http.ServeMux is used.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	az := s.authz

	// Base middleware applied to EVERY request (incl. UI assets): request id,
	// real ip, panic recovery, security headers.
	r.Use(az.RequestID)
	r.Use(az.RealIP)
	r.Use(az.Recoverer)
	r.Use(az.SecurityHeaders)

	r.Route("/api/v1", func(api chi.Router) {
		// ---- public routes (no auth chain) ----
		api.Get("/healthz", s.Healthz)
		api.Get("/bootstrap/status", s.BootstrapStatus)
		api.Post("/bootstrap", s.Bootstrap)
		api.Post("/auth/login", s.bootstrapGate(http.HandlerFunc(s.Login)).ServeHTTP)

		// ---- public SSO routes (pre-auth) ----
		// Enumerating enabled providers is a non-sensitive read (no secrets, no
		// audit). The login flows ARE audited (AuditWrap outermost) so every
		// external sign-in attempt — including ones rejected before bootstrap — is
		// recorded exactly once, and they are bootstrap-gated like /auth/login.
		api.Get("/auth/providers", s.AuthProviders)
		api.Get("/auth/oidc/start", s.audited("auth.oidc.start", s.bootstrapGate(http.HandlerFunc(s.OIDCStart))))
		api.Get("/auth/oidc/callback", s.audited("auth.oidc.callback", s.bootstrapGate(http.HandlerFunc(s.OIDCCallback))))
		api.Post("/auth/ldap/login", s.audited("auth.ldap.login", s.bootstrapGate(http.HandlerFunc(s.LDAPLogin))))

		// ---- protected routes (SessionAuth required) ----
		api.Group(func(pr chi.Router) {
			pr.Use(s.bootstrapGateMW)
			pr.Use(az.SessionAuth)
			pr.Use(az.CSRF)

			// auth surfaces (SessionAuth only; AAL handled per-route where needed)
			pr.Post("/auth/logout", s.audited("auth.logout", http.HandlerFunc(s.Logout)))
			pr.Get("/auth/me", s.Me)
			pr.Post("/auth/totp/verify", s.audited("auth.totp.verify", http.HandlerFunc(s.TOTPVerify)))
			pr.Post("/auth/totp/enroll", s.audited("auth.totp.enroll", http.HandlerFunc(s.TOTPEnroll)))
			pr.Post("/auth/totp/confirm", s.audited("auth.totp.confirm", http.HandlerFunc(s.TOTPConfirm)))
			// disable + password change require AAL2 when 2FA is on. AuditWrap is
			// outermost so an AAL denial (403) is still recorded as one audit row.
			pr.With(az.AuditWrap("auth.totp.disable"), az.RequireAAL).Post("/auth/totp/disable", http.HandlerFunc(s.TOTPDisable))
			pr.With(az.AuditWrap("auth.password.change"), az.RequireAAL).Post("/auth/password", http.HandlerFunc(s.PasswordChange))

			// providers / hosts
			pr.Get("/providers", s.Providers)
			pr.Get("/hosts", s.Hosts)
			pr.Get("/hosts/{hostID}", s.HostDetail)

			// WebSocket (single socket; SessionAuth ran above, Origin re-checked
			// inside HandleWS before Accept).
			pr.Get("/ws", s.HandleWS)

			s.mountWorkloadRoutes(pr)
			s.mountResourceRoutes(pr)
			s.mountBackupRoutes(pr)
			s.mountSwarmK8sRoutes(pr)
			s.mountK8sStorageRoutes(pr)
			s.mountHelmRoutes(pr)
			s.mountK8sClusterRoutes(pr)
			s.mountAdminRoutes(pr)
			s.mountAuthAdminRoutes(pr)
			s.mountTemplateRoutes(pr)
			s.mountMarketplaceConfigRoutes(pr)
			s.mountStackRoutes(pr)
		})
	})

	// SPA + embedded UI for everything else.
	r.NotFound(web.Handler().ServeHTTP)
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		authz.WriteError(w, req, authz.ErrMethodNotAllowed)
	})

	return r
}

// mountWorkloadRoutes wires the unified workload surface (reads + mutations).
func (s *Server) mountWorkloadRoutes(pr chi.Router) {
	az := s.authz

	// reads (require docker.container.read at host scope). The {id} param holds
	// the workload id; for k8s "<ns>/<pod>" the UI URL-encodes the slash (%2F),
	// which chi delivers as a single path segment.
	pr.With(az.RequirePermission("docker.container.read", scopeFromHost)).
		Get("/hosts/{hostID}/workloads", s.Workloads)
	pr.With(az.RequirePermission("docker.container.read", scopeFromHost)).
		Get("/hosts/{hostID}/workloads/{id}", s.WorkloadDetail)

	// Aggregated BI-dashboard metrics for the host: snapshot counts plus a bounded
	// live CPU/RAM sweep over running containers. A read; gated like the other
	// host-scoped container reads (no audit row for reads).
	pr.With(az.RequirePermission("docker.container.read", scopeFromHost)).
		Get("/hosts/{hostID}/dashboard/metrics", s.DashboardMetrics)

	// mutations — each: AuditWrap -> AAL -> RequirePermission -> handler.
	// AuditWrap is the OUTERMOST of the per-route middlewares so it attaches the
	// audit record BEFORE the AAL/RBAC gates run and persists exactly one row even
	// when those gates deny (403) before the handler executes — otherwise a denied
	// mutation would write no audit row at all. GuardDestructive runs inside the
	// handler (after RBAC, before the provider).
	pr.With(az.AuditWrap("docker.container.start"), az.RequireAAL, az.RequirePermission("docker.container.start", scopeFromHost)).
		Post("/hosts/{hostID}/workloads/{id}/start", s.StartWorkload)
	pr.With(az.AuditWrap("docker.container.stop"), az.RequireAAL, az.RequirePermission("docker.container.stop", scopeFromHost)).
		Post("/hosts/{hostID}/workloads/{id}/stop", s.StopWorkload)
	pr.With(az.AuditWrap("docker.container.restart"), az.RequireAAL, az.RequirePermission("docker.container.restart", scopeFromHost)).
		Post("/hosts/{hostID}/workloads/{id}/restart", s.RestartWorkload)
	pr.With(az.AuditWrap("docker.container.remove"), az.RequireAAL, az.RequirePermission("docker.container.remove", scopeFromHost)).
		Delete("/hosts/{hostID}/workloads/{id}", s.RemoveWorkload)

	// logs/stats one-shot reads
	pr.With(az.RequirePermission("docker.container.logs", scopeFromHost)).
		Get("/hosts/{hostID}/workloads/{id}/logs", s.Logs)
	pr.With(az.RequirePermission("docker.container.stats", scopeFromHost)).
		Get("/hosts/{hostID}/workloads/{id}/stats", s.Stats)
}

// mountResourceRoutes wires Docker images/networks/volumes (read + gated write).
func (s *Server) mountResourceRoutes(pr chi.Router) {
	az := s.authz

	pr.With(az.RequirePermission("docker.image.read", scopeFromHost)).
		Get("/hosts/{hostID}/images", s.Images)
	pr.With(az.AuditWrap("docker.image.pull"), az.RequireAAL, az.RequirePermission("docker.image.pull", scopeFromHost)).
		Post("/hosts/{hostID}/images/pull", s.PullImage)
	pr.With(az.AuditWrap("docker.image.delete"), az.RequireAAL, az.RequirePermission("docker.image.delete", scopeFromHost)).
		Delete("/hosts/{hostID}/images/{id}", s.DeleteImage)

	pr.With(az.RequirePermission("docker.network.read", scopeFromHost)).
		Get("/hosts/{hostID}/networks", s.Networks)
	pr.With(az.AuditWrap("docker.network.delete"), az.RequireAAL, az.RequirePermission("docker.network.delete", scopeFromHost)).
		Delete("/hosts/{hostID}/networks/{id}", s.DeleteNetwork)

	pr.With(az.RequirePermission("docker.volume.read", scopeFromHost)).
		Get("/hosts/{hostID}/volumes", s.Volumes)
	pr.With(az.AuditWrap("docker.volume.remove"), az.RequireAAL, az.RequirePermission("docker.volume.remove", scopeFromHost)).
		Delete("/hosts/{hostID}/volumes/{name}", s.DeleteVolume)
}

// mountBackupRoutes wires Docker volume backup/restore (read list + gated
// backup/restore/delete). Listing and downloading reuse docker.volume.read;
// creating/deleting an archive requires docker.volume.backup; restoring into a
// volume requires docker.volume.restore. Mutations follow the fixed
// AuditWrap -> AAL -> RequirePermission ordering.
func (s *Server) mountBackupRoutes(pr chi.Router) {
	az := s.authz

	pr.With(az.RequirePermission("docker.volume.read", scopeFromHost)).
		Get("/hosts/{hostID}/backups", s.Backups)
	pr.With(az.RequirePermission("docker.volume.read", scopeFromHost)).
		Get("/hosts/{hostID}/backups/{id}/download", s.DownloadBackup)

	pr.With(az.AuditWrap("docker.volume.backup"), az.RequireAAL, az.RequirePermission("docker.volume.backup", scopeFromHost)).
		Post("/hosts/{hostID}/backups", s.CreateBackup)
	pr.With(az.AuditWrap("docker.volume.restore"), az.RequireAAL, az.RequirePermission("docker.volume.restore", scopeFromHost)).
		Post("/hosts/{hostID}/backups/{id}/restore", s.RestoreBackup)
	pr.With(az.AuditWrap("docker.volume.backup.delete"), az.RequireAAL, az.RequirePermission("docker.volume.backup", scopeFromHost)).
		Delete("/hosts/{hostID}/backups/{id}", s.DeleteBackup)
}

// mountSwarmK8sRoutes wires the swarm + kubernetes surfaces: read-only overviews
// plus the gated service/node and deployment/pod/manifest mutations.
func (s *Server) mountSwarmK8sRoutes(pr chi.Router) {
	az := s.authz

	pr.With(az.RequirePermission("swarm.service.read", scopeFromHost)).
		Get("/hosts/{hostID}/swarm/services", s.SwarmServices)
	pr.With(az.RequirePermission("swarm.task.read", scopeFromHost)).
		Get("/hosts/{hostID}/swarm/tasks", s.SwarmTasks)
	pr.With(az.RequirePermission("swarm.node.read", scopeFromHost)).
		Get("/hosts/{hostID}/swarm/nodes", s.SwarmNodes)

	// Swarm service/node lifecycle writes. AuditWrap is OUTERMOST (records one
	// row even when AAL/RBAC deny), then RequireAAL, then the host-scoped
	// permission, then the handler. Restart reuses swarm.service.update (it is a
	// forced no-op spec update).
	pr.With(az.AuditWrap("swarm.service.create"), az.RequireAAL, az.RequirePermission("swarm.service.create", scopeFromHost)).
		Post("/hosts/{hostID}/swarm/services", s.SwarmServiceCreate)
	pr.With(az.AuditWrap("swarm.service.scale"), az.RequireAAL, az.RequirePermission("swarm.service.scale", scopeFromHost)).
		Post("/hosts/{hostID}/swarm/services/{id}/scale", s.SwarmServiceScale)
	pr.With(az.AuditWrap("swarm.service.update"), az.RequireAAL, az.RequirePermission("swarm.service.update", scopeFromHost)).
		Put("/hosts/{hostID}/swarm/services/{id}", s.SwarmServiceUpdate)
	pr.With(az.AuditWrap("swarm.service.restart"), az.RequireAAL, az.RequirePermission("swarm.service.update", scopeFromHost)).
		Post("/hosts/{hostID}/swarm/services/{id}/restart", s.SwarmServiceRestart)
	pr.With(az.AuditWrap("swarm.service.remove"), az.RequireAAL, az.RequirePermission("swarm.service.remove", scopeFromHost)).
		Delete("/hosts/{hostID}/swarm/services/{id}", s.SwarmServiceRemove)
	pr.With(az.AuditWrap("swarm.node.update"), az.RequireAAL, az.RequirePermission("swarm.node.update", scopeFromHost)).
		Post("/hosts/{hostID}/swarm/nodes/{id}/availability", s.SwarmNodeAvailability)

	// Swarm secrets + configs. Reads list metadata only (swarm.secret.read /
	// swarm.config.read); a single config GET also returns its (non-secret)
	// payload. There is deliberately NO get-secret-data route — secret values are
	// write-only. Create/delete follow the fixed chain AuditWrap (OUTERMOST) ->
	// RequireAAL -> RequirePermission -> handler, so a denied mutation still
	// records exactly one audit row.
	pr.With(az.RequirePermission("swarm.secret.read", scopeFromHost)).
		Get("/hosts/{hostID}/swarm/secrets", s.SwarmSecrets)
	pr.With(az.AuditWrap("swarm.secret.create"), az.RequireAAL, az.RequirePermission("swarm.secret.write", scopeFromHost)).
		Post("/hosts/{hostID}/swarm/secrets", s.SwarmSecretCreate)
	pr.With(az.AuditWrap("swarm.secret.remove"), az.RequireAAL, az.RequirePermission("swarm.secret.write", scopeFromHost)).
		Delete("/hosts/{hostID}/swarm/secrets/{id}", s.SwarmSecretRemove)
	pr.With(az.RequirePermission("swarm.config.read", scopeFromHost)).
		Get("/hosts/{hostID}/swarm/configs", s.SwarmConfigs)
	pr.With(az.RequirePermission("swarm.config.read", scopeFromHost)).
		Get("/hosts/{hostID}/swarm/configs/{id}", s.SwarmConfigGet)
	pr.With(az.AuditWrap("swarm.config.create"), az.RequireAAL, az.RequirePermission("swarm.config.write", scopeFromHost)).
		Post("/hosts/{hostID}/swarm/configs", s.SwarmConfigCreate)
	pr.With(az.AuditWrap("swarm.config.remove"), az.RequireAAL, az.RequirePermission("swarm.config.write", scopeFromHost)).
		Delete("/hosts/{hostID}/swarm/configs/{id}", s.SwarmConfigRemove)

	pr.With(az.RequirePermission("k8s.pod.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/pods", s.K8sPods)
	pr.With(az.RequirePermission("k8s.deployment.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/deployments", s.K8sDeployments)
	pr.With(az.RequirePermission("k8s.node.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/nodes", s.K8sNodes)

	// Kubernetes mutations. Fixed chain: AuditWrap (OUTERMOST) -> RequireAAL ->
	// RequirePermission -> handler, so a denied mutation still records exactly one
	// audit row. Scale/restart are operator-grade; delete + apply are admin-grade.
	// {ns}/{name} are separate path segments (a Deployment/Pod name is a DNS label,
	// never containing '/'), so no encoded-slash handling is needed at the router.
	pr.With(az.AuditWrap("k8s.deployment.scale"), az.RequireAAL, az.RequirePermission("k8s.deployment.scale", scopeFromHost)).
		Post("/hosts/{hostID}/k8s/deployments/{ns}/{name}/scale", s.K8sScaleDeployment)
	pr.With(az.AuditWrap("k8s.deployment.restart"), az.RequireAAL, az.RequirePermission("k8s.deployment.restart", scopeFromHost)).
		Post("/hosts/{hostID}/k8s/deployments/{ns}/{name}/restart", s.K8sRestartDeployment)
	pr.With(az.AuditWrap("k8s.deployment.resources"), az.RequireAAL, az.RequirePermission("k8s.deployment.resources", scopeFromHost)).
		Post("/hosts/{hostID}/k8s/deployments/{ns}/{name}/resources", s.K8sSetDeploymentResources)
	pr.With(az.AuditWrap("k8s.deployment.delete"), az.RequireAAL, az.RequirePermission("k8s.workload.delete", scopeFromHost)).
		Delete("/hosts/{hostID}/k8s/deployments/{ns}/{name}", s.K8sDeleteDeployment)
	pr.With(az.AuditWrap("k8s.pod.delete"), az.RequireAAL, az.RequirePermission("k8s.workload.delete", scopeFromHost)).
		Delete("/hosts/{hostID}/k8s/pods/{ns}/{name}", s.K8sDeletePod)
	pr.With(az.AuditWrap("k8s.manifest.apply"), az.RequireAAL, az.RequirePermission("k8s.manifest.apply", scopeFromHost)).
		Post("/hosts/{hostID}/k8s/apply", s.K8sApply)
}

// mountK8sClusterRoutes wires the Kubernetes autoscaling + core cluster-object
// surface (Wave 3): HorizontalPodAutoscaler list/create/delete, Namespace
// list/create/delete, and the read-only Service / ConfigMap / Secret / Event
// lists. Reads are host-scoped (k8s.hpa.read / k8s.namespace.read /
// k8s.service.read / k8s.config.read). HPA writes are operator-grade
// (k8s.hpa.write); Namespace create/delete are cluster-level and admin-only
// (k8s.namespace.write). Every mutation follows the fixed chain AuditWrap
// (OUTERMOST) -> RequireAAL -> RequirePermission -> handler, so a denied mutation
// still records exactly one audit row. {ns}/{name} are distinct path segments (a
// DNS label never contains '/'), so no encoded-slash handling is needed.
func (s *Server) mountK8sClusterRoutes(pr chi.Router) {
	az := s.authz

	// HPA: read + create/delete.
	pr.With(az.RequirePermission("k8s.hpa.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/hpas", s.K8sHPAs)
	pr.With(az.AuditWrap("k8s.hpa.create"), az.RequireAAL, az.RequirePermission("k8s.hpa.write", scopeFromHost)).
		Post("/hosts/{hostID}/k8s/hpas", s.K8sCreateHPA)
	pr.With(az.AuditWrap("k8s.hpa.delete"), az.RequireAAL, az.RequirePermission("k8s.hpa.write", scopeFromHost)).
		Delete("/hosts/{hostID}/k8s/hpas/{ns}/{name}", s.K8sDeleteHPA)

	// Namespaces: read + create/delete (writes admin-only).
	pr.With(az.RequirePermission("k8s.namespace.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/namespaces", s.K8sNamespaces)
	pr.With(az.AuditWrap("k8s.namespace.create"), az.RequireAAL, az.RequirePermission("k8s.namespace.write", scopeFromHost)).
		Post("/hosts/{hostID}/k8s/namespaces", s.K8sCreateNamespace)
	pr.With(az.AuditWrap("k8s.namespace.delete"), az.RequireAAL, az.RequirePermission("k8s.namespace.write", scopeFromHost)).
		Delete("/hosts/{hostID}/k8s/namespaces/{name}", s.K8sDeleteNamespace)

	// Read-only cluster objects.
	pr.With(az.RequirePermission("k8s.service.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/services", s.K8sServices)
	pr.With(az.RequirePermission("k8s.config.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/configmaps", s.K8sConfigMaps)
	pr.With(az.RequirePermission("k8s.config.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/secrets", s.K8sSecrets)
	pr.With(az.RequirePermission("k8s.config.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/events", s.K8sEvents)

	// Ingresses: read + delete (create/update goes through the manifest-apply
	// path). Read is operator/viewer-grade (k8s.ingress.read); delete is an
	// operator-grade write (k8s.ingress.write) gated by the fixed mutation chain
	// AuditWrap (OUTERMOST) -> RequireAAL -> RequirePermission -> handler.
	pr.With(az.RequirePermission("k8s.ingress.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/ingresses", s.K8sIngresses)
	pr.With(az.AuditWrap("k8s.ingress.delete"), az.RequireAAL, az.RequirePermission("k8s.ingress.write", scopeFromHost)).
		Delete("/hosts/{hostID}/k8s/ingresses/{ns}/{name}", s.K8sDeleteIngress)

	// Live metrics (metrics-server). Reads gated by k8s.metrics.read; a missing
	// metrics-server is reported as {available:false} (200), not an error.
	pr.With(az.RequirePermission("k8s.metrics.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/metrics/nodes", s.K8sNodeMetrics)
	pr.With(az.RequirePermission("k8s.metrics.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/metrics/pods", s.K8sPodMetrics)
}

// mountHelmRoutes wires the Helm management surface: chart-repository CRUD +
// index refresh, chart search, and release lifecycle (install/upgrade/rollback/
// uninstall) plus release reads (list/history/values). Reads use helm.repo.read
// / helm.release.read at host scope. Repository writes use helm.repo.write;
// release writes use the per-verb helm.release.{install,upgrade,rollback,
// uninstall} permissions. Repo index refresh is a side-effecting network fetch,
// so it is treated as a write (helm.repo.write) and audited. Every mutation
// follows the fixed chain AuditWrap (OUTERMOST) -> RequireAAL -> RequirePermission
// -> handler, so a denied mutation still records exactly one audit row. The
// release {ns}/{name} are distinct path segments (a release name + namespace are
// DNS labels, never containing '/'), so no encoded-slash handling is needed.
func (s *Server) mountHelmRoutes(pr chi.Router) {
	az := s.authz

	// Repositories (read + gated write/refresh).
	pr.With(az.RequirePermission("helm.repo.read", scopeFromHost)).
		Get("/hosts/{hostID}/helm/repos", s.HelmRepos)
	pr.With(az.AuditWrap("helm.repo.add"), az.RequireAAL, az.RequirePermission("helm.repo.write", scopeFromHost)).
		Post("/hosts/{hostID}/helm/repos", s.HelmAddRepo)
	pr.With(az.AuditWrap("helm.repo.update"), az.RequireAAL, az.RequirePermission("helm.repo.write", scopeFromHost)).
		Post("/hosts/{hostID}/helm/repos/update", s.HelmUpdateRepos)
	pr.With(az.AuditWrap("helm.repo.remove"), az.RequireAAL, az.RequirePermission("helm.repo.write", scopeFromHost)).
		Delete("/hosts/{hostID}/helm/repos/{name}", s.HelmRemoveRepo)

	// Chart search over the cached repo indexes (read).
	pr.With(az.RequirePermission("helm.repo.read", scopeFromHost)).
		Get("/hosts/{hostID}/helm/charts", s.HelmCharts)

	// Releases (read).
	pr.With(az.RequirePermission("helm.release.read", scopeFromHost)).
		Get("/hosts/{hostID}/helm/releases", s.HelmReleases)
	pr.With(az.RequirePermission("helm.release.read", scopeFromHost)).
		Get("/hosts/{hostID}/helm/releases/{ns}/{name}/history", s.HelmReleaseHistory)
	pr.With(az.RequirePermission("helm.release.read", scopeFromHost)).
		Get("/hosts/{hostID}/helm/releases/{ns}/{name}/values", s.HelmReleaseValues)

	// Release lifecycle (gated writes, per-verb permissions).
	pr.With(az.AuditWrap("helm.release.install"), az.RequireAAL, az.RequirePermission("helm.release.install", scopeFromHost)).
		Post("/hosts/{hostID}/helm/releases", s.HelmInstall)
	pr.With(az.AuditWrap("helm.release.upgrade"), az.RequireAAL, az.RequirePermission("helm.release.upgrade", scopeFromHost)).
		Post("/hosts/{hostID}/helm/releases/{ns}/{name}/upgrade", s.HelmUpgrade)
	pr.With(az.AuditWrap("helm.release.rollback"), az.RequireAAL, az.RequirePermission("helm.release.rollback", scopeFromHost)).
		Post("/hosts/{hostID}/helm/releases/{ns}/{name}/rollback", s.HelmRollback)
	pr.With(az.AuditWrap("helm.release.uninstall"), az.RequireAAL, az.RequirePermission("helm.release.uninstall", scopeFromHost)).
		Delete("/hosts/{hostID}/helm/releases/{ns}/{name}", s.HelmUninstall)
}

// mountK8sStorageRoutes wires the Kubernetes storage surface: read-only PV/PVC/
// StorageClass listings plus gated PVC create/delete. Reads use k8s.storage.read
// at host scope; create/delete use k8s.storage.write. The create/delete
// mutations follow the fixed chain AuditWrap (OUTERMOST) -> RequireAAL ->
// RequirePermission -> handler, so a denied mutation still records exactly one
// audit row. {ns}/{name} on the delete route are distinct path segments (both
// are DNS labels, never containing '/'), so no encoded-slash handling is needed.
func (s *Server) mountK8sStorageRoutes(pr chi.Router) {
	az := s.authz

	pr.With(az.RequirePermission("k8s.storage.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/pvs", s.K8sPVs)
	pr.With(az.RequirePermission("k8s.storage.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/pvcs", s.K8sPVCs)
	pr.With(az.RequirePermission("k8s.storage.read", scopeFromHost)).
		Get("/hosts/{hostID}/k8s/storageclasses", s.K8sStorageClasses)

	pr.With(az.AuditWrap("k8s.pvc.create"), az.RequireAAL, az.RequirePermission("k8s.storage.write", scopeFromHost)).
		Post("/hosts/{hostID}/k8s/pvcs", s.K8sCreatePVC)
	pr.With(az.AuditWrap("k8s.pvc.delete"), az.RequireAAL, az.RequirePermission("k8s.storage.write", scopeFromHost)).
		Delete("/hosts/{hostID}/k8s/pvcs/{ns}/{name}", s.K8sDeletePVC)
}

// mountAdminRoutes wires audit, RBAC and settings surfaces.
func (s *Server) mountAdminRoutes(pr chi.Router) {
	az := s.authz
	g := authz.GlobalScope

	pr.With(az.RequirePermission("audit.read", g)).Get("/audit", s.Audit)

	pr.With(az.RequirePermission("rbac.user.read", g)).Get("/users", s.ListUsers)
	pr.With(az.AuditWrap("rbac.user.create"), az.RequireAAL, az.RequirePermission("rbac.user.create", g)).Post("/users", s.CreateUser)
	pr.With(az.AuditWrap("rbac.user.update"), az.RequireAAL, az.RequirePermission("rbac.user.update", g)).Patch("/users/{id}", s.UpdateUser)
	pr.With(az.AuditWrap("rbac.user.delete"), az.RequireAAL, az.RequirePermission("rbac.user.delete", g)).Delete("/users/{id}", s.DeleteUser)
	pr.With(az.AuditWrap("rbac.binding.create"), az.RequireAAL, az.RequirePermission("rbac.binding.create", g)).Post("/users/{id}/roles", s.CreateBinding)
	pr.With(az.AuditWrap("rbac.binding.delete"), az.RequireAAL, az.RequirePermission("rbac.binding.delete", g)).Delete("/users/{id}/roles/{bindingId}", s.DeleteBinding)

	pr.With(az.RequirePermission("rbac.role.read", g)).Get("/roles", s.ListRoles)
	pr.With(az.AuditWrap("rbac.role.create"), az.RequireAAL, az.RequirePermission("rbac.role.create", g)).Post("/roles", s.CreateRole)
	pr.With(az.AuditWrap("rbac.role.update"), az.RequireAAL, az.RequirePermission("rbac.role.update", g)).Patch("/roles/{id}", s.UpdateRole)
	pr.With(az.AuditWrap("rbac.role.delete"), az.RequireAAL, az.RequirePermission("rbac.role.delete", g)).Delete("/roles/{id}", s.DeleteRole)

	pr.With(az.RequirePermission("rbac.role.read", g)).Get("/permissions", s.Permissions)

	pr.With(az.RequirePermission("settings.read", g)).Get("/settings", s.GetSettings)
	pr.With(az.AuditWrap("settings.update"), az.RequireAAL, az.RequirePermission("settings.update", g)).Put("/settings", s.UpdateSettings)
}

// mountAuthAdminRoutes wires the admin-only SSO configuration surface: auth
// provider CRUD (LDAP + OIDC), a connectivity/credential test probe, and
// group->role mapping CRUD. All routes are global-scoped and superuser-gated via
// the auth.provider.read / auth.provider.write permissions (only the built-in
// admin role's "*" grant satisfies them — operators/viewers cannot configure
// SSO). Mutations follow the fixed chain AuditWrap (OUTERMOST) -> RequireAAL ->
// RequirePermission -> handler, identical to the marketplace admin routes, so a
// denied mutation still records exactly one audit row. The /test probe performs
// network I/O against the IdP/directory and is treated as a write-gated, audited
// action (it reads the sealed secret), mirroring the registry /test pattern.
func (s *Server) mountAuthAdminRoutes(pr chi.Router) {
	az := s.authz
	g := authz.GlobalScope

	// Provider CRUD.
	pr.With(az.RequirePermission("auth.provider.read", g)).
		Get("/admin/auth/providers", s.ListAuthProviders)
	pr.With(az.RequirePermission("auth.provider.read", g)).
		Get("/admin/auth/providers/{id}", s.GetAuthProvider)
	pr.With(az.AuditWrap("auth.provider.create"), az.RequireAAL, az.RequirePermission("auth.provider.write", g)).
		Post("/admin/auth/providers", s.CreateAuthProvider)
	pr.With(az.AuditWrap("auth.provider.update"), az.RequireAAL, az.RequirePermission("auth.provider.write", g)).
		Put("/admin/auth/providers/{id}", s.UpdateAuthProvider)
	pr.With(az.AuditWrap("auth.provider.delete"), az.RequireAAL, az.RequirePermission("auth.provider.write", g)).
		Delete("/admin/auth/providers/{id}", s.DeleteAuthProvider)
	pr.With(az.AuditWrap("auth.provider.test"), az.RequireAAL, az.RequirePermission("auth.provider.write", g)).
		Post("/admin/auth/providers/{id}/test", s.TestAuthProvider)

	// Group -> role mappings (nested under a provider).
	pr.With(az.RequirePermission("auth.provider.read", g)).
		Get("/admin/auth/providers/{id}/mappings", s.ListGroupMappings)
	pr.With(az.AuditWrap("auth.provider.mapping.create"), az.RequireAAL, az.RequirePermission("auth.provider.write", g)).
		Post("/admin/auth/providers/{id}/mappings", s.CreateGroupMapping)
	pr.With(az.AuditWrap("auth.provider.mapping.delete"), az.RequireAAL, az.RequirePermission("auth.provider.write", g)).
		Delete("/admin/auth/providers/{id}/mappings/{mappingId}", s.DeleteGroupMapping)
}

// mountTemplateRoutes wires the marketplace app-template surface: the merged
// built-in+custom catalog (read), custom-template CRUD (admin), and one-click
// deploy onto a host's Docker engine.
//
// Mutations follow the fixed chain AuditWrap (OUTERMOST) -> RequireAAL ->
// RequirePermission -> handler, identical to the workload/resource routes, so a
// denied mutation still records exactly one audit row. Deploy is host-scoped
// (docker.container.create); custom CRUD is global and admin-gated via the
// marketplace.template.* permissions (admin's "*" grant covers them).
func (s *Server) mountTemplateRoutes(pr chi.Router) {
	az := s.authz
	g := authz.GlobalScope

	// Catalog read: any authenticated user (the catalog is non-sensitive and
	// global). Gated only by the protected-group SessionAuth/CSRF chain.
	pr.Get("/templates", s.Templates)

	// Custom-template CRUD (admin-only via marketplace.template.* at global scope).
	pr.With(az.AuditWrap("marketplace.template.create"), az.RequireAAL, az.RequirePermission("marketplace.template.create", g)).
		Post("/templates", s.CreateTemplate)
	pr.With(az.AuditWrap("marketplace.template.update"), az.RequireAAL, az.RequirePermission("marketplace.template.update", g)).
		Put("/templates/{id}", s.UpdateTemplate)
	pr.With(az.AuditWrap("marketplace.template.delete"), az.RequireAAL, az.RequirePermission("marketplace.template.delete", g)).
		Delete("/templates/{id}", s.DeleteTemplate)

	// One-click deploy: creates+starts a container (host-scoped permission).
	pr.With(az.AuditWrap("docker.container.create"), az.RequireAAL, az.RequirePermission("docker.container.create", scopeFromHost)).
		Post("/hosts/{hostID}/templates/deploy", s.DeployTemplate)
}

// mountMarketplaceConfigRoutes wires the admin-only marketplace configuration
// surfaces: image registries (private/public pull credentials) and remote
// template catalogs. All routes are global-scoped and admin-gated via the
// marketplace.registry.* / marketplace.catalog.* permissions (admin's "*" grant
// covers them).
//
// Mutations follow the fixed chain AuditWrap (OUTERMOST) -> RequireAAL ->
// RequirePermission -> handler, identical to the other admin routes, so a denied
// mutation still records exactly one audit row. The /test (registry login probe)
// and /refresh (remote fetch) POSTs are treated as mutating side-effecting
// actions: they require AAL + the write permission and are audited.
func (s *Server) mountMarketplaceConfigRoutes(pr chi.Router) {
	az := s.authz
	g := authz.GlobalScope

	// Registries.
	pr.With(az.RequirePermission("marketplace.registry.read", g)).
		Get("/registries", s.ListRegistries)
	pr.With(az.AuditWrap("marketplace.registry.create"), az.RequireAAL, az.RequirePermission("marketplace.registry.write", g)).
		Post("/registries", s.CreateRegistry)
	pr.With(az.AuditWrap("marketplace.registry.update"), az.RequireAAL, az.RequirePermission("marketplace.registry.write", g)).
		Put("/registries/{id}", s.UpdateRegistry)
	pr.With(az.AuditWrap("marketplace.registry.delete"), az.RequireAAL, az.RequirePermission("marketplace.registry.write", g)).
		Delete("/registries/{id}", s.DeleteRegistry)
	pr.With(az.AuditWrap("marketplace.registry.test"), az.RequireAAL, az.RequirePermission("marketplace.registry.write", g)).
		Post("/registries/{id}/test", s.TestRegistry)

	// Remote catalogs.
	pr.With(az.RequirePermission("marketplace.catalog.read", g)).
		Get("/catalogs", s.ListCatalogs)
	pr.With(az.AuditWrap("marketplace.catalog.create"), az.RequireAAL, az.RequirePermission("marketplace.catalog.write", g)).
		Post("/catalogs", s.CreateCatalog)
	pr.With(az.AuditWrap("marketplace.catalog.update"), az.RequireAAL, az.RequirePermission("marketplace.catalog.write", g)).
		Put("/catalogs/{id}", s.UpdateCatalog)
	pr.With(az.AuditWrap("marketplace.catalog.delete"), az.RequireAAL, az.RequirePermission("marketplace.catalog.write", g)).
		Delete("/catalogs/{id}", s.DeleteCatalog)
	pr.With(az.AuditWrap("marketplace.catalog.refresh"), az.RequireAAL, az.RequirePermission("marketplace.catalog.write", g)).
		Post("/catalogs/{id}/refresh", s.RefreshCatalog)
	pr.With(az.RequirePermission("marketplace.catalog.read", g)).
		Get("/catalogs/{id}/templates", s.CatalogTemplates)
}

// mountStackRoutes wires the compose stack surface: validate (pure parse),
// create+up, list, detail, and delete (down). Deploys create+start containers,
// so the create/up path is gated by docker.container.create at host scope and
// teardown by docker.container.remove; reads use docker.container.read. The
// builder/generate endpoint is a pure YAML generator (no host, no deploy) gated
// by docker.container.create at global scope. Mutations follow the fixed chain
// AuditWrap (OUTERMOST) -> RequireAAL -> RequirePermission -> handler so a denied
// mutation still records exactly one audit row.
func (s *Server) mountStackRoutes(pr chi.Router) {
	az := s.authz
	g := authz.GlobalScope

	// Reads.
	pr.With(az.RequirePermission("docker.container.read", scopeFromHost)).
		Get("/hosts/{hostID}/stacks", s.ListStacks)
	pr.With(az.RequirePermission("docker.container.read", scopeFromHost)).
		Get("/hosts/{hostID}/stacks/{id}", s.StackDetail)

	// Validate is a pure parse (no daemon) but is gated to deploy-capable
	// operators; it is non-mutating so it is not audited.
	pr.With(az.RequirePermission("docker.container.create", scopeFromHost)).
		Post("/hosts/{hostID}/stacks/validate", s.ValidateStack)

	// Create + up: creates+starts containers on the host engine.
	pr.With(az.AuditWrap("docker.container.create"), az.RequireAAL, az.RequirePermission("docker.container.create", scopeFromHost)).
		Post("/hosts/{hostID}/stacks", s.CreateStack)

	// Delete + down: stop+remove the stack's containers and network.
	pr.With(az.AuditWrap("docker.container.remove"), az.RequireAAL, az.RequirePermission("docker.container.remove", scopeFromHost)).
		Delete("/hosts/{hostID}/stacks/{id}", s.DeleteStack)

	// Builder: pure compose-YAML generation. Global-scoped, deploy-capable only.
	pr.With(az.RequirePermission("docker.container.create", g)).
		Post("/stacks/builder/generate", s.BuilderGenerate)
}

// audited wraps a handler with AuditWrap for the given action (used on auth
// routes that mutate but are not behind RequirePermission).
func (s *Server) audited(action string, h http.Handler) http.HandlerFunc {
	return s.authz.AuditWrap(action)(h).ServeHTTP
}

// bootstrapGate rejects a handler when the instance is still in bootstrap mode.
func (s *Server) bootstrapGate(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.bootstrapRequired(r.Context()) {
			authz.WriteError(w, r, authz.ErrBootstrapRequired)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// bootstrapGateMW is the middleware form of bootstrapGate for the protected group.
func (s *Server) bootstrapGateMW(next http.Handler) http.Handler {
	return s.bootstrapGate(next)
}
