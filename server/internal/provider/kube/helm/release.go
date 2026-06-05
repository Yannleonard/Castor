package helm

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
)

// installTimeout bounds a single install/upgrade so a stuck chart (e.g. a
// CRD-install hook that never completes) cannot hold the request open
// indefinitely. We do NOT set --wait, so this is mostly a guard on the API
// round-trips, not on workload readiness.
const installTimeout = 5 * time.Minute

// ReleaseInfo is the safe projection of one Helm release for list/detail views.
type ReleaseInfo struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Revision   int    `json:"revision"`
	Status     string `json:"status"`     // deployed / failed / pending-install / superseded / ...
	Chart      string `json:"chart"`      // "<chartName>-<chartVersion>"
	AppVersion string `json:"appVersion"` // upstream app version
	Updated    string `json:"updated"`    // RFC3339 last-deployed time ("" if unknown)
}

// ReleaseRevision is one entry in a release's history.
type ReleaseRevision struct {
	Revision    int    `json:"revision"`
	Status      string `json:"status"`
	Chart       string `json:"chart"`
	AppVersion  string `json:"appVersion"`
	Updated     string `json:"updated"`     // RFC3339 ("" if unknown)
	Description string `json:"description"` // Helm's per-revision note (e.g. "Upgrade complete")
}

// InstallChart installs chartRef ("repo/name") as release into namespace. version
// pins a chart version (empty => latest in the repo index). values is the merged
// user value overrides (may be nil). It locates the chart through the configured
// repositories + cache, loads it, and runs a Helm install with the Secrets
// driver. The created release's summary is returned.
func (s *Service) InstallChart(ctx context.Context, release, chartRef, namespace, version string, values map[string]interface{}) (*ReleaseInfo, error) {
	release = strings.TrimSpace(release)
	chartRef = strings.TrimSpace(chartRef)
	if release == "" || chartRef == "" {
		return nil, errors.New("helm: release name and chart are required")
	}
	if namespace == "" {
		namespace = "default"
	}
	cfg, err := s.actionConfig(namespace)
	if err != nil {
		return nil, err
	}

	inst := action.NewInstall(cfg)
	inst.ReleaseName = release
	inst.Namespace = namespace
	inst.CreateNamespace = true
	inst.Version = version
	inst.Timeout = installTimeout

	ch, err := s.loadChartForAction(&inst.ChartPathOptions, chartRef, version)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, installTimeout)
	defer cancel()
	rel, err := inst.RunWithContext(ctx, ch, values)
	if err != nil {
		return nil, fmt.Errorf("helm: install %q: %w", release, err)
	}
	return mapRelease(rel), nil
}

// UpgradeRelease upgrades an existing release to chartRef (optionally re-pinning
// version) with the given values. The release must already exist in the
// namespace (a missing release surfaces as an error -> mapped to 404/500 by the
// API layer).
func (s *Service) UpgradeRelease(ctx context.Context, release, chartRef, namespace, version string, values map[string]interface{}) (*ReleaseInfo, error) {
	release = strings.TrimSpace(release)
	chartRef = strings.TrimSpace(chartRef)
	if release == "" || chartRef == "" {
		return nil, errors.New("helm: release name and chart are required")
	}
	if namespace == "" {
		namespace = "default"
	}
	cfg, err := s.actionConfig(namespace)
	if err != nil {
		return nil, err
	}

	up := action.NewUpgrade(cfg)
	up.Namespace = namespace
	up.Version = version
	up.Timeout = installTimeout
	// MaxHistory keeps the release-history Secrets from growing without bound.
	up.MaxHistory = 10

	ch, err := s.loadChartForAction(&up.ChartPathOptions, chartRef, version)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, installTimeout)
	defer cancel()
	rel, err := up.RunWithContext(ctx, release, ch, values)
	if err != nil {
		return nil, mapReleaseErr(fmt.Errorf("helm: upgrade %q: %w", release, err), err)
	}
	return mapRelease(rel), nil
}

// RollbackRelease rolls a release back to a prior revision (revision 0 => the
// immediately previous one, matching `helm rollback`).
func (s *Service) RollbackRelease(release, namespace string, revision int) error {
	release = strings.TrimSpace(release)
	if release == "" {
		return errors.New("helm: release name is required")
	}
	if revision < 0 {
		return errors.New("helm: revision must be >= 0")
	}
	if namespace == "" {
		namespace = "default"
	}
	cfg, err := s.actionConfig(namespace)
	if err != nil {
		return err
	}
	rb := action.NewRollback(cfg)
	rb.Version = revision
	rb.Timeout = installTimeout
	rb.MaxHistory = 10
	if err := rb.Run(release); err != nil {
		return mapReleaseErr(fmt.Errorf("helm: rollback %q: %w", release, err), err)
	}
	return nil
}

// UninstallRelease removes a release (and its Kubernetes objects) from the
// namespace.
func (s *Service) UninstallRelease(release, namespace string) error {
	release = strings.TrimSpace(release)
	if release == "" {
		return errors.New("helm: release name is required")
	}
	if namespace == "" {
		namespace = "default"
	}
	cfg, err := s.actionConfig(namespace)
	if err != nil {
		return err
	}
	un := action.NewUninstall(cfg)
	un.Timeout = installTimeout
	if _, err := un.Run(release); err != nil {
		return mapReleaseErr(fmt.Errorf("helm: uninstall %q: %w", release, err), err)
	}
	return nil
}

// ListReleases lists releases. When allNamespaces is true every namespace is
// searched (action config bound to ""); otherwise only the "default" namespace
// is listed — callers wanting a specific namespace should use a per-namespace
// path. Results are sorted by namespace then name.
func (s *Service) ListReleases(allNamespaces bool) ([]ReleaseInfo, error) {
	ns := "default"
	if allNamespaces {
		ns = ""
	}
	cfg, err := s.actionConfig(ns)
	if err != nil {
		return nil, err
	}
	list := action.NewList(cfg)
	list.All = true
	list.AllNamespaces = allNamespaces
	list.SetStateMask()
	rels, err := list.Run()
	if err != nil {
		return nil, fmt.Errorf("helm: list releases: %w", err)
	}
	out := make([]ReleaseInfo, 0, len(rels))
	for _, r := range rels {
		out = append(out, *mapRelease(r))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// GetRelease returns the current revision summary of a named release in a
// namespace.
func (s *Service) GetRelease(name, namespace string) (*ReleaseInfo, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("helm: release name is required")
	}
	if namespace == "" {
		namespace = "default"
	}
	cfg, err := s.actionConfig(namespace)
	if err != nil {
		return nil, err
	}
	get := action.NewGet(cfg)
	rel, err := get.Run(name)
	if err != nil {
		return nil, mapReleaseErr(fmt.Errorf("helm: get release %q: %w", name, err), err)
	}
	return mapRelease(rel), nil
}

// GetReleaseHistory returns every stored revision of a release, newest first.
func (s *Service) GetReleaseHistory(name, namespace string) ([]ReleaseRevision, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("helm: release name is required")
	}
	if namespace == "" {
		namespace = "default"
	}
	cfg, err := s.actionConfig(namespace)
	if err != nil {
		return nil, err
	}
	h := action.NewHistory(cfg)
	rels, err := h.Run(name)
	if err != nil {
		return nil, mapReleaseErr(fmt.Errorf("helm: history %q: %w", name, err), err)
	}
	out := make([]ReleaseRevision, 0, len(rels))
	for _, r := range rels {
		rev := ReleaseRevision{
			Revision: r.Version,
			Status:   statusString(r),
			Chart:    chartString(r),
		}
		if r.Chart != nil && r.Chart.Metadata != nil {
			rev.AppVersion = r.Chart.Metadata.AppVersion
		}
		if r.Info != nil {
			rev.Description = r.Info.Description
			if !r.Info.LastDeployed.IsZero() {
				rev.Updated = r.Info.LastDeployed.Time.UTC().Format(time.RFC3339)
			}
		}
		out = append(out, rev)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Revision > out[j].Revision })
	return out, nil
}

// GetReleaseValues returns the user-supplied values of a release's current
// revision (the "all=false" view: overrides only, not the computed/coalesced
// chart defaults). Returns an empty map when no overrides were supplied.
func (s *Service) GetReleaseValues(name, namespace string) (map[string]interface{}, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("helm: release name is required")
	}
	if namespace == "" {
		namespace = "default"
	}
	cfg, err := s.actionConfig(namespace)
	if err != nil {
		return nil, err
	}
	gv := action.NewGetValues(cfg)
	gv.AllValues = false
	vals, err := gv.Run(name)
	if err != nil {
		return nil, mapReleaseErr(fmt.Errorf("helm: get values %q: %w", name, err), err)
	}
	if vals == nil {
		vals = map[string]interface{}{}
	}
	return vals, nil
}

// loadChartForAction resolves chartRef to a local chart archive (locating it via
// the configured repositories + cache, downloading if needed) and loads it into
// a *chart.Chart ready for install/upgrade. version pins the chart version.
func (s *Service) loadChartForAction(cpo *action.ChartPathOptions, chartRef, version string) (*chart.Chart, error) {
	settings := s.envSettings()
	cpo.Version = version
	// LocateChart consults repositories.yaml + the index cache and pulls the
	// archive into RepositoryCache when not already present, returning its path.
	path, err := cpo.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("helm: locate chart %q: %w", chartRef, err)
	}
	ch, err := loader.Load(path)
	if err != nil {
		return nil, fmt.Errorf("helm: load chart %q: %w", chartRef, err)
	}
	return ch, nil
}

// mapRelease projects a Helm *release.Release into the safe ReleaseInfo wire
// shape.
func mapRelease(r *release.Release) *ReleaseInfo {
	if r == nil {
		return &ReleaseInfo{}
	}
	info := &ReleaseInfo{
		Name:      r.Name,
		Namespace: r.Namespace,
		Revision:  r.Version,
		Status:    statusString(r),
		Chart:     chartString(r),
	}
	if r.Chart != nil && r.Chart.Metadata != nil {
		info.AppVersion = r.Chart.Metadata.AppVersion
	}
	if r.Info != nil && !r.Info.LastDeployed.IsZero() {
		info.Updated = r.Info.LastDeployed.Time.UTC().Format(time.RFC3339)
	}
	return info
}

// statusString returns the release status as a lower-case string ("deployed",
// "failed", …) or "" when unknown.
func statusString(r *release.Release) string {
	if r == nil || r.Info == nil {
		return ""
	}
	return r.Info.Status.String()
}

// chartString returns "<chartName>-<chartVersion>" for a release, or "" when the
// chart metadata is absent.
func chartString(r *release.Release) string {
	if r == nil || r.Chart == nil || r.Chart.Metadata == nil {
		return ""
	}
	m := r.Chart.Metadata
	if m.Version == "" {
		return m.Name
	}
	return m.Name + "-" + m.Version
}

// mapReleaseErr converts a Helm "release: not found" condition into a sentinel
// the API layer maps to 404; everything else is returned as-is (wrapped). cause
// is the raw error from the Helm action (pre-wrapping) used for the typed check.
func mapReleaseErr(wrapped, cause error) error {
	if errors.Is(cause, driver.ErrReleaseNotFound) ||
		strings.Contains(strings.ToLower(cause.Error()), "release: not found") {
		return ErrReleaseNotFound
	}
	return wrapped
}

// ErrReleaseNotFound is returned when a named release does not exist. The API
// layer maps it to a 404.
var ErrReleaseNotFound = errors.New("helm: release not found")
