package helm

import (
	"fmt"
	"os"
	"path/filepath"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"k8s.io/client-go/rest"
)

// defaultDataDir is the writable root under which Helm repository state and
// cached chart indexes live. It sits on Castor's persistent /data volume,
// alongside /data/castor.db and /data/backups. The repositories.yaml file and
// the per-repo <name>-index.yaml caches are stored here so repos survive
// restarts.
const defaultDataDir = "/data/helm"

// Service is Castor's Helm facade. It is constructed once per request from the
// KubeProvider's *rest.Config (via kube.KubeProvider.RestConfig()) and a data
// directory; it is cheap to build and holds no long-lived connections (each
// action builds its own action.Configuration against the apiserver). All release
// storage uses the Kubernetes Secrets driver in the target namespace.
type Service struct {
	cfg     *rest.Config
	dataDir string // root for repository file + index cache (e.g. /data/helm)
}

// New builds a Helm Service from a *rest.Config and a data directory. When
// dataDir is empty it defaults to /data/helm. The directory (and its repository/
// cache subdirs) is created lazily on first use.
func New(cfg *rest.Config, dataDir string) *Service {
	if dataDir == "" {
		dataDir = defaultDataDir
	}
	return &Service{cfg: cfg, dataDir: dataDir}
}

// repositoryFile is the path to the persisted repositories.yaml.
func (s *Service) repositoryFile() string {
	return filepath.Join(s.dataDir, "repositories.yaml")
}

// repositoryCache is the directory holding the downloaded per-repo index.yaml
// files (named "<repo>-index.yaml" by the Helm downloader) plus pulled chart
// archives.
func (s *Service) repositoryCache() string {
	return filepath.Join(s.dataDir, "cache")
}

// ensureDirs creates the data directory and the repository cache directory.
func (s *Service) ensureDirs() error {
	if err := os.MkdirAll(s.dataDir, 0o750); err != nil {
		return fmt.Errorf("helm: create data dir: %w", err)
	}
	if err := os.MkdirAll(s.repositoryCache(), 0o750); err != nil {
		return fmt.Errorf("helm: create cache dir: %w", err)
	}
	return nil
}

// envSettings returns a *cli.EnvSettings wired to Castor's data directory so the
// Helm SDK's repository/cache file resolution and chart downloader use our
// writable paths instead of the user's $HOME. RepositoryConfig/RepositoryCache
// are what the action installers and the repo downloader read.
func (s *Service) envSettings() *cli.EnvSettings {
	settings := cli.New()
	settings.RepositoryConfig = s.repositoryFile()
	settings.RepositoryCache = s.repositoryCache()
	settings.Debug = false
	return settings
}

// actionConfig builds a Helm action.Configuration bound to a namespace using the
// Kubernetes Secrets storage driver (the modern Helm 3 default). Logging is a
// no-op — Castor surfaces errors through its own envelopes, not Helm's stderr.
func (s *Service) actionConfig(namespace string) (*action.Configuration, error) {
	if err := s.ensureDirs(); err != nil {
		return nil, err
	}
	if namespace == "" {
		namespace = "default"
	}
	getter := newRESTClientGetter(s.cfg, namespace)
	cfg := new(action.Configuration)
	// "secret" selects the Secrets storage driver; passing the namespace scopes
	// where release history Secrets are read/written. The no-op logf swallows
	// Helm's internal logging.
	if err := cfg.Init(getter, namespace, "secret", noopLog); err != nil {
		return nil, fmt.Errorf("helm: init action config: %w", err)
	}
	return cfg, nil
}

// noopLog discards Helm's internal log output (signature matches action.DebugLog).
func noopLog(format string, v ...interface{}) {}
