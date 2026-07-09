package helm

import (
	"context"
	"io"
	"testing"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chartutil"
	kubefake "helm.sh/helm/v3/pkg/kube/fake"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	helmtime "helm.sh/helm/v3/pkg/time"
)

// testActionConfig builds an in-memory, non-networked action.Configuration:
// releases live in the memory driver and the Kube client is a no-op printer, so
// a "client" dry-run renders manifests without touching any cluster.
func testActionConfig() *action.Configuration {
	return &action.Configuration{
		Releases:     storage.Init(driver.NewMemory()),
		KubeClient:   &kubefake.PrintingKubeClient{Out: io.Discard},
		Capabilities: chartutil.DefaultCapabilities,
		Log:          func(string, ...interface{}) {},
	}
}

// testChartArchive writes a minimal single-manifest chart to a temp dir and
// returns the archive path, which loadChartForAction resolves directly (an
// existing path bypasses repository lookup).
func testChartArchive(t *testing.T) string {
	t.Helper()
	ch := &chart.Chart{
		Metadata: &chart.Metadata{
			APIVersion: chart.APIVersionV1,
			Name:       "demo",
			Version:    "0.1.0",
		},
		Templates: []*chart.File{
			{
				Name: "templates/configmap.yaml",
				Data: []byte("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo\ndata:\n  key: value\n"),
			},
		},
	}
	path, err := chartutil.Save(ch, t.TempDir())
	if err != nil {
		t.Fatalf("save chart: %v", err)
	}
	return path
}

// TestPreviewUpgradeNonexistentRelease is the regression guard: for a release
// that does not exist, PreviewUpgrade must NOT error out on the upgrade path
// (which would surface as a 500). It must fall back to an install dry-run,
// yielding Current == "" and a non-empty Pending manifest.
func TestPreviewUpgradeNonexistentRelease(t *testing.T) {
	s := &Service{}
	cfg := testActionConfig()
	chartPath := testChartArchive(t)

	out, err := s.previewUpgradeWithConfig(context.Background(), cfg, "ghost", chartPath, "default", "", nil, "client")
	if err != nil {
		t.Fatalf("previewUpgradeWithConfig(nonexistent): unexpected error: %v", err)
	}
	if out.Current != "" {
		t.Errorf("Current = %q, want empty for a nonexistent release", out.Current)
	}
	if out.Pending == "" {
		t.Error("Pending is empty, want a rendered install manifest")
	}
	// The dry-run must not have written a release into storage.
	if _, err := cfg.Releases.Deployed("ghost"); err == nil {
		t.Error("a release was persisted; the install preview must be a strict dry-run")
	}
}

// TestPreviewUpgradeExistingRelease covers the pre-existing (upgrade) path:
// Current is the seeded manifest and Pending is the re-rendered upgrade.
func TestPreviewUpgradeExistingRelease(t *testing.T) {
	s := &Service{}
	cfg := testActionConfig()
	chartPath := testChartArchive(t)

	now := helmtime.Now()
	seeded := &release.Release{
		Name:      "demo",
		Namespace: "default",
		Version:   1,
		Info:      &release.Info{FirstDeployed: now, LastDeployed: now, Status: release.StatusDeployed},
		Chart: &chart.Chart{Metadata: &chart.Metadata{
			APIVersion: chart.APIVersionV1, Name: "demo", Version: "0.1.0",
		}},
		Manifest: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo\ndata:\n  key: old\n",
	}
	if err := cfg.Releases.Create(seeded); err != nil {
		t.Fatalf("seed release: %v", err)
	}

	out, err := s.previewUpgradeWithConfig(context.Background(), cfg, "demo", chartPath, "default", "", nil, "client")
	if err != nil {
		t.Fatalf("previewUpgradeWithConfig(existing): unexpected error: %v", err)
	}
	if out.Current != seeded.Manifest {
		t.Errorf("Current = %q, want the seeded manifest %q", out.Current, seeded.Manifest)
	}
	if out.Pending == "" {
		t.Error("Pending is empty, want a rendered upgrade manifest")
	}
	// The upgrade dry-run must not have advanced the release revision.
	dep, err := cfg.Releases.Deployed("demo")
	if err != nil {
		t.Fatalf("deployed lookup: %v", err)
	}
	if dep.Version != 1 {
		t.Errorf("release revision = %d, want 1 (dry-run must not mutate history)", dep.Version)
	}
}
