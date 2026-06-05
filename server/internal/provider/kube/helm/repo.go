package helm

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"

	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/repo"
)

// RepoInfo is the safe projection of one configured chart repository.
type RepoInfo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ChartInfo is one chart hit from a repository index search.
type ChartInfo struct {
	Name        string `json:"name"`        // chart name (without repo prefix)
	Repo        string `json:"repo"`        // owning repo name
	Version     string `json:"version"`     // latest chart version
	AppVersion  string `json:"appVersion"`  // upstream app version
	Description string `json:"description"` // chart description
}

// repoFileMu serializes repositories.yaml read-modify-write cycles within this
// process. The Helm repo.File type is not concurrency-safe and Castor may field
// parallel repo mutations; the lock keeps add/remove atomic. (Cross-process
// safety is not required: Castor is the sole writer of this file.)
var repoFileMu sync.Mutex

// AddRepo adds (or updates) a chart repository entry and downloads its index so
// it is immediately searchable. A blank name/url is rejected; re-adding an
// existing name overwrites its URL (idempotent, matching `helm repo add`).
func (s *Service) AddRepo(name, url string) error {
	name = strings.TrimSpace(name)
	url = strings.TrimSpace(url)
	if name == "" || url == "" {
		return errors.New("helm: repo name and url are required")
	}
	if err := s.ensureDirs(); err != nil {
		return err
	}

	repoFileMu.Lock()
	defer repoFileMu.Unlock()

	f, err := s.loadRepoFile()
	if err != nil {
		return err
	}

	entry := &repo.Entry{Name: name, URL: url}
	cr, err := repo.NewChartRepository(entry, getter.All(s.envSettings()))
	if err != nil {
		return fmt.Errorf("helm: build chart repository: %w", err)
	}
	cr.CachePath = s.repositoryCache()
	// Download the index now so SearchCharts works right after AddRepo and so a
	// bad URL is surfaced as an error at add time.
	if _, err := cr.DownloadIndexFile(); err != nil {
		return fmt.Errorf("helm: download index for %q: %w", name, err)
	}

	f.Update(entry)
	if err := f.WriteFile(s.repositoryFile(), 0o640); err != nil {
		return fmt.Errorf("helm: write repositories file: %w", err)
	}
	return nil
}

// ListRepos returns the configured repositories (name + url), sorted by name.
func (s *Service) ListRepos() ([]RepoInfo, error) {
	f, err := s.loadRepoFile()
	if err != nil {
		return nil, err
	}
	out := make([]RepoInfo, 0, len(f.Repositories))
	for _, e := range f.Repositories {
		out = append(out, RepoInfo{Name: e.Name, URL: e.URL})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// RemoveRepo deletes a repository entry and its cached index file. Removing a
// missing repo is an error (404 at the API layer), matching `helm repo remove`.
func (s *Service) RemoveRepo(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("helm: repo name is required")
	}

	repoFileMu.Lock()
	defer repoFileMu.Unlock()

	f, err := s.loadRepoFile()
	if err != nil {
		return err
	}
	if !f.Remove(name) {
		return fmt.Errorf("helm: repository %q not found", name)
	}
	if err := f.WriteFile(s.repositoryFile(), 0o640); err != nil {
		return fmt.Errorf("helm: write repositories file: %w", err)
	}
	// Best-effort cache cleanup (a stale index file is harmless, so ignore errs).
	_ = os.Remove(s.indexCachePath(name))
	return nil
}

// UpdateRepos re-downloads the index.yaml for every configured repository. A
// per-repo download failure is collected and returned as a combined error, but
// all repos are still attempted (one unreachable repo does not block the rest).
func (s *Service) UpdateRepos() error {
	if err := s.ensureDirs(); err != nil {
		return err
	}
	f, err := s.loadRepoFile()
	if err != nil {
		return err
	}
	if len(f.Repositories) == 0 {
		return nil
	}
	providers := getter.All(s.envSettings())
	var errs []string
	for _, e := range f.Repositories {
		cr, err := repo.NewChartRepository(e, providers)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name, err))
			continue
		}
		cr.CachePath = s.repositoryCache()
		if _, err := cr.DownloadIndexFile(); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name, err))
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("helm: update repos: %s", strings.Join(errs, "; "))
	}
	return nil
}

// SearchCharts searches the cached repository indexes for charts whose name or
// description contains query (case-insensitive; an empty query returns every
// chart's latest version). Results are de-duplicated to the latest version per
// chart and sorted by repo then chart name. Repos whose index has not been
// downloaded yet are skipped.
func (s *Service) SearchCharts(query string) ([]ChartInfo, error) {
	f, err := s.loadRepoFile()
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(strings.TrimSpace(query))

	var out []ChartInfo
	for _, e := range f.Repositories {
		idxPath := s.indexCachePath(e.Name)
		if _, statErr := os.Stat(idxPath); statErr != nil {
			continue // index not downloaded yet — skip silently
		}
		idx, loadErr := repo.LoadIndexFile(idxPath)
		if loadErr != nil {
			continue // corrupt/old index — skip rather than fail the whole search
		}
		for chartName, versions := range idx.Entries {
			if len(versions) == 0 {
				continue
			}
			// idx.Entries are sorted newest-first by SortEntries during load, but
			// guard anyway by picking the first non-nil entry.
			latest := versions[0]
			if q != "" &&
				!strings.Contains(strings.ToLower(chartName), q) &&
				!strings.Contains(strings.ToLower(latest.Description), q) {
				continue
			}
			out = append(out, ChartInfo{
				Name:        chartName,
				Repo:        e.Name,
				Version:     latest.Version,
				AppVersion:  latest.AppVersion,
				Description: latest.Description,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Repo != out[j].Repo {
			return out[i].Repo < out[j].Repo
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// loadRepoFile loads repositories.yaml, returning an empty (non-nil) file when
// it does not exist yet so the first AddRepo can populate it.
func (s *Service) loadRepoFile() (*repo.File, error) {
	path := s.repositoryFile()
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return repo.NewFile(), nil
	}
	f, err := repo.LoadFile(path)
	if err != nil {
		return nil, fmt.Errorf("helm: load repositories file: %w", err)
	}
	return f, nil
}

// indexCachePath is the on-disk path of a repo's cached index, matching the
// "<name>-index.yaml" naming the Helm downloader uses under RepositoryCache.
func (s *Service) indexCachePath(repoName string) string {
	return s.repositoryCache() + string(os.PathSeparator) + repoName + "-index.yaml"
}
