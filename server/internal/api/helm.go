package api

// helm.go holds the Helm management handlers: repository CRUD + index refresh,
// chart search across cached repo indexes, and release lifecycle (install /
// upgrade / rollback / uninstall) plus release reads (list / history / values).
// They reuse s.kubeProvider (404 when no kubeconfig is wired) and build a
// kube/helm.Service from the provider's *rest.Config + a /data/helm data dir
// (derived from CASTOR_DB_PATH like backupsDir). RBAC + AAL + AuditWrap are
// applied by the router; reads are gated by helm.*.read.
//
// The Helm SDK uses the Kubernetes Secrets storage driver in the target
// namespace, so releases are stored exactly like `helm --driver secrets`.

import (
	"errors"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/kube/helm"
)

// helmDataDir returns the writable directory for Helm repository state + chart
// cache, derived from the SQLite DB path (defaults to /data/helm alongside
// /data/castor.db), mirroring backupsDir.
func (s *Server) helmDataDir() string {
	base := filepath.Dir(s.cfg.DBPath)
	if base == "" || base == "." {
		base = "/data"
	}
	return filepath.Join(base, "helm")
}

// helmService returns a Helm service bound to the kube provider's rest config,
// or writes a 404/false when Kubernetes is not configured for this instance.
func (s *Server) helmService(w http.ResponseWriter, r *http.Request) (*helm.Service, bool) {
	k, available := s.kubeProvider(w, r)
	if !available {
		return nil, false
	}
	return helm.New(k.RestConfig(), s.helmDataDir()), true
}

/* ----- request bodies ----- */

// helmRepoRequest is the body for POST .../helm/repos.
type helmRepoRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// helmInstallRequest is the body for POST .../helm/releases.
type helmInstallRequest struct {
	Release   string                 `json:"release"`
	Chart     string                 `json:"chart"` // "repo/name"
	Namespace string                 `json:"namespace"`
	Version   string                 `json:"version"` // optional; "" => latest
	Values    map[string]interface{} `json:"values"`  // optional overrides
}

// helmUpgradeRequest is the body for POST .../helm/releases/{ns}/{name}/upgrade.
// The release name + namespace come from the path; chart/version/values from the
// body.
type helmUpgradeRequest struct {
	Chart   string                 `json:"chart"`
	Version string                 `json:"version"`
	Values  map[string]interface{} `json:"values"`
}

// helmRollbackRequest is the body for POST .../helm/releases/{ns}/{name}/rollback.
type helmRollbackRequest struct {
	Revision int `json:"revision"`
}

/* ----- repositories ----- */

// HelmRepos lists configured chart repositories (perm helm.repo.read).
func (s *Server) HelmRepos(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	repos, err := svc.ListRepos()
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2json(w, repos)
}

// HelmAddRepo adds (or updates) a chart repository and downloads its index
// (perm helm.repo.write).
func (s *Server) HelmAddRepo(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	var req helmRepoRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.URL) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "repo name and url are required."))
		return
	}
	authz.SetAuditTarget(r, "helm.repo", req.Name, req.Name)

	if err := svc.AddRepo(req.Name, req.URL); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// HelmRemoveRepo deletes a chart repository (perm helm.repo.write).
func (s *Server) HelmRemoveRepo(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	name := pathUnescape(chi.URLParam(r, "name"))
	authz.SetAuditTarget(r, "helm.repo", name, name)

	if err := svc.RemoveRepo(name); err != nil {
		writeMapped(w, r, mapHelmNotFound(err))
		return
	}
	ok2(w)
}

// HelmUpdateRepos re-downloads every repository index (perm helm.repo.write).
func (s *Server) HelmUpdateRepos(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	authz.SetAuditTarget(r, "helm.repo", "update", "repos")

	if err := svc.UpdateRepos(); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// HelmCharts searches cached repository indexes for charts matching ?q=
// (perm helm.repo.read; an empty q lists every chart's latest version).
func (s *Server) HelmCharts(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	charts, err := svc.SearchCharts(r.URL.Query().Get("q"))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2json(w, charts)
}

/* ----- releases ----- */

// HelmReleases lists releases across all namespaces (perm helm.release.read).
func (s *Server) HelmReleases(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	releases, err := svc.ListReleases(true)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2json(w, releases)
}

// HelmInstall installs a chart as a new release (perm helm.release.install).
func (s *Server) HelmInstall(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	var req helmInstallRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Release) == "" || strings.TrimSpace(req.Chart) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "release and chart are required."))
		return
	}
	ns := req.Namespace
	if ns == "" {
		ns = "default"
	}
	authz.SetAuditTarget(r, "helm.release", ns+"/"+req.Release, req.Release)

	rel, err := svc.InstallChart(r.Context(), req.Release, req.Chart, ns, req.Version, req.Values)
	if err != nil {
		writeMapped(w, r, mapHelmNotFound(err))
		return
	}
	ok(w, rel)
}

// HelmUpgrade upgrades an existing release (perm helm.release.upgrade). The
// release name + namespace come from the path.
func (s *Server) HelmUpgrade(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	var req helmUpgradeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Chart) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "chart is required."))
		return
	}
	authz.SetAuditTarget(r, "helm.release", ns+"/"+name, name)

	rel, err := svc.UpgradeRelease(r.Context(), name, req.Chart, ns, req.Version, req.Values)
	if err != nil {
		writeMapped(w, r, mapHelmNotFound(err))
		return
	}
	ok(w, rel)
}

// HelmRollback rolls a release back to a prior revision (perm
// helm.release.rollback). revision 0 => the immediately previous revision.
func (s *Server) HelmRollback(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	var req helmRollbackRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Revision < 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "revision must be >= 0."))
		return
	}
	authz.SetAuditTarget(r, "helm.release", ns+"/"+name, name)

	if err := svc.RollbackRelease(name, ns, req.Revision); err != nil {
		writeMapped(w, r, mapHelmNotFound(err))
		return
	}
	ok2(w)
}

// HelmUninstall removes a release (perm helm.release.uninstall).
func (s *Server) HelmUninstall(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	authz.SetAuditTarget(r, "helm.release", ns+"/"+name, name)

	if err := svc.UninstallRelease(name, ns); err != nil {
		writeMapped(w, r, mapHelmNotFound(err))
		return
	}
	ok2(w)
}

// HelmReleaseHistory returns a release's revision history (perm
// helm.release.read).
func (s *Server) HelmReleaseHistory(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	history, err := svc.GetReleaseHistory(name, ns)
	if err != nil {
		writeMapped(w, r, mapHelmNotFound(err))
		return
	}
	ok2json(w, history)
}

// HelmReleaseValues returns a release's user-supplied values (perm
// helm.release.read).
func (s *Server) HelmReleaseValues(w http.ResponseWriter, r *http.Request) {
	svc, available := s.helmService(w, r)
	if !available {
		return
	}
	ns, name := k8sNsName(r)
	values, err := svc.GetReleaseValues(name, ns)
	if err != nil {
		writeMapped(w, r, mapHelmNotFound(err))
		return
	}
	ok(w, values)
}

// mapHelmNotFound converts the Helm "release not found" sentinel into the
// shared not_found envelope; other errors pass through unchanged for writeMapped
// to classify (-> 500).
func mapHelmNotFound(err error) error {
	if errors.Is(err, helm.ErrReleaseNotFound) {
		return authz.ErrNotFound
	}
	return err
}
