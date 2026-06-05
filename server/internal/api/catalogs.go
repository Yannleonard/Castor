package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

const (
	// catalogFetchTimeout caps a single remote-catalog HTTP fetch.
	catalogFetchTimeout = 15 * time.Second
	// catalogMaxBytes caps how much of a remote catalog body we read (~2 MiB).
	catalogMaxBytes = 2 << 20
	// registryTestTimeout caps a registry login probe via the Docker daemon.
	registryTestTimeout = 15 * time.Second
)

// catalogHTTPClient is the shared client for remote-catalog fetches. It does not
// follow infinite redirects and enforces a hard timeout.
var catalogHTTPClient = &http.Client{Timeout: catalogFetchTimeout}

// marketplaceTemplate is the normalized template shape returned by catalog
// reads. It mirrors store.CustomTemplate's json tags (so the UI renders built-in,
// custom and remote templates identically) plus a Source tag identifying origin
// (e.g. "remote:<catalog name>").
type marketplaceTemplate struct {
	Name        string                       `json:"name"`
	Slug        string                       `json:"slug"`
	Category    string                       `json:"category"`
	Image       string                       `json:"image"`
	Description string                       `json:"description"`
	Ports       []int                        `json:"ports"`
	Env         []store.CustomTemplateEnvVar `json:"env"`
	Volumes     []string                     `json:"volumes"`
	LogoURL     string                       `json:"logoUrl"`
	Source      string                       `json:"source"`
}

// rawCatalogEntry is the permissive decode target for a remote catalog item. It
// accepts BOTH Castor's native shape (name/slug/image/ports/env/volumes/logo)
// AND a Portainer-ish shape (title/categories/...) so third-party catalogs work
// without conversion. Unknown fields are ignored (no DisallowUnknownFields).
type rawCatalogEntry struct {
	// native + common
	Name        string `json:"name"`
	Title       string `json:"title"` // Portainer label
	Slug        string `json:"slug"`
	Image       string `json:"image"`
	Description string `json:"description"`
	Logo        string `json:"logo"`
	LogoURL     string `json:"logoUrl"`

	// category: native singular string OR Portainer plural array
	Category   string   `json:"category"`
	Categories []string `json:"categories"`

	// ports: accept []int, ["8080:80"], or [{"private":..}] — decoded loosely.
	Ports json.RawMessage `json:"ports"`

	// env: native [{key,value,required}] OR Portainer [{name,label,default}]
	Env []rawCatalogEnv `json:"env"`

	// volumes: native ["/path"] OR Portainer [{"container":"/path"}]
	Volumes json.RawMessage `json:"volumes"`
}

type rawCatalogEnv struct {
	Key      string `json:"key"`
	Name     string `json:"name"`    // Portainer
	Label    string `json:"label"`   // Portainer (human label)
	Value    string `json:"value"`
	Default  string `json:"default"` // Portainer
	Required bool   `json:"required"`
}

// catalogDocument tolerates either a bare JSON array of entries or a wrapped
// object {"templates":[...]} / {"items":[...]} (Portainer v2 uses
// {"version":"2","templates":[...]}).
type catalogDocument struct {
	Templates []rawCatalogEntry `json:"templates"`
	Items     []rawCatalogEntry `json:"items"`
}

type createCatalogRequest struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Enabled *bool  `json:"enabled"`
}

type updateCatalogRequest struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Enabled *bool  `json:"enabled"`
}

// ListCatalogs returns all remote catalog sources (perm marketplace.catalog.read).
func (s *Server) ListCatalogs(w http.ResponseWriter, r *http.Request) {
	cats, err := s.store.ListRemoteCatalogs(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if cats == nil {
		cats = []*store.RemoteCatalog{}
	}
	ok(w, cats)
}

// CreateCatalog registers a remote catalog source (perm marketplace.catalog.write).
func (s *Server) CreateCatalog(w http.ResponseWriter, r *http.Request) {
	var req createCatalogRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Catalog name is required."))
		return
	}
	if err := validateCatalogURL(req.URL); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	c := &store.RemoteCatalog{
		ID:      store.NewUUID(),
		Name:    strings.TrimSpace(req.Name),
		URL:     strings.TrimSpace(req.URL),
		Enabled: enabled,
	}
	if err := s.store.CreateRemoteCatalog(r.Context(), c); err != nil {
		// Likely a UNIQUE(url) collision.
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A catalog with that URL already exists."))
		return
	}
	authz.SetAuditTarget(r, "catalog", c.ID, c.Name)
	created(w, c)
}

// UpdateCatalog updates a catalog source (perm marketplace.catalog.write).
func (s *Server) UpdateCatalog(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateCatalogRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	existing, err := s.store.GetRemoteCatalog(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Catalog name is required."))
		return
	}
	if err := validateCatalogURL(req.URL); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	enabled := existing.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	authz.SetAuditTarget(r, "catalog", id, existing.Name)
	c := &store.RemoteCatalog{
		ID:      id,
		Name:    strings.TrimSpace(req.Name),
		URL:     strings.TrimSpace(req.URL),
		Enabled: enabled,
	}
	if err := s.store.UpdateRemoteCatalog(ctx, c); err != nil {
		if err == store.ErrNotFound {
			writeMapped(w, r, err)
			return
		}
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A catalog with that URL already exists."))
		return
	}
	fresh, _ := s.store.GetRemoteCatalog(ctx, id)
	ok(w, fresh)
}

// DeleteCatalog removes a catalog source (perm marketplace.catalog.write).
func (s *Server) DeleteCatalog(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "catalog", id, "")
	if err := s.store.DeleteRemoteCatalog(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// RefreshCatalog fetches the catalog URL, parses+normalizes the templates, and
// records template_count + last_fetched_at (or last_error on failure). It
// returns the refreshed catalog row (perm marketplace.catalog.write).
func (s *Server) RefreshCatalog(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	c, err := s.store.GetRemoteCatalog(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "catalog", id, c.Name)

	templates, ferr := s.fetchCatalogTemplates(ctx, c)
	if ferr != nil {
		_ = s.store.SetRemoteCatalogFetchResult(ctx, id, -1, sanitizeRegistryError(ferr.Error()))
		fresh, _ := s.store.GetRemoteCatalog(ctx, id)
		// The fetch failure is recorded on the row (last_error); the request itself
		// succeeds and returns the updated state so the UI can surface the error.
		ok(w, fresh)
		return
	}
	if err := s.store.SetRemoteCatalogFetchResult(ctx, id, len(templates), ""); err != nil {
		writeMapped(w, r, err)
		return
	}
	fresh, _ := s.store.GetRemoteCatalog(ctx, id)
	ok(w, fresh)
}

// CatalogTemplates fetches and returns the normalized templates of one catalog
// tagged source="remote:<name>" (perm marketplace.catalog.read). It also
// refreshes the row's fetch bookkeeping as a side effect.
func (s *Server) CatalogTemplates(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	c, err := s.store.GetRemoteCatalog(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	templates, ferr := s.fetchCatalogTemplates(ctx, c)
	if ferr != nil {
		_ = s.store.SetRemoteCatalogFetchResult(ctx, id, -1, sanitizeRegistryError(ferr.Error()))
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Failed to fetch catalog: "+sanitizeRegistryError(ferr.Error())))
		return
	}
	_ = s.store.SetRemoteCatalogFetchResult(ctx, id, len(templates), "")
	ok(w, templates)
}

// fetchCatalogTemplates GETs the catalog URL, reads at most catalogMaxBytes,
// JSON-parses it (array or wrapped object) and normalizes every entry, tagging
// each with source="remote:<name>".
func (s *Server) fetchCatalogTemplates(ctx context.Context, c *store.RemoteCatalog) ([]marketplaceTemplate, error) {
	reqCtx, cancel := context.WithTimeout(ctx, catalogFetchTimeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodGet, c.URL, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "Castor-Marketplace/1")

	resp, err := catalogHTTPClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errCatalogStatus(resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, catalogMaxBytes))
	if err != nil {
		return nil, err
	}

	entries, err := parseCatalogBody(body)
	if err != nil {
		return nil, err
	}

	source := "remote:" + c.Name
	out := make([]marketplaceTemplate, 0, len(entries))
	for i := range entries {
		t := normalizeCatalogEntry(&entries[i], source)
		if t.Image == "" {
			// Skip entries with no deployable image (e.g. Portainer "stack" type
			// entries that reference a compose repo rather than a single image).
			continue
		}
		out = append(out, t)
	}
	return out, nil
}

// parseCatalogBody decodes a catalog document as either a bare array of entries
// or a wrapped object ({templates|items:[...]}).
func parseCatalogBody(body []byte) ([]rawCatalogEntry, error) {
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "[") {
		var arr []rawCatalogEntry
		if err := json.Unmarshal(body, &arr); err != nil {
			return nil, err
		}
		return arr, nil
	}
	var doc catalogDocument
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	if len(doc.Templates) > 0 {
		return doc.Templates, nil
	}
	return doc.Items, nil
}

// normalizeCatalogEntry maps a permissive raw entry onto the canonical
// marketplaceTemplate, reconciling native and Portainer-ish field names.
func normalizeCatalogEntry(e *rawCatalogEntry, source string) marketplaceTemplate {
	name := firstNonEmpty(e.Name, e.Title)
	category := e.Category
	if category == "" && len(e.Categories) > 0 {
		category = e.Categories[0]
	}
	if category == "" {
		category = "Remote"
	}
	logo := firstNonEmpty(e.LogoURL, e.Logo)

	t := marketplaceTemplate{
		Name:        name,
		Slug:        firstNonEmpty(e.Slug, slugify(name)),
		Category:    category,
		Image:       strings.TrimSpace(e.Image),
		Description: e.Description,
		Ports:       normalizePorts(e.Ports),
		Env:         normalizeEnv(e.Env),
		Volumes:     normalizeVolumes(e.Volumes),
		LogoURL:     logo,
		Source:      source,
	}
	return t
}

// normalizePorts accepts [8080], ["8080:80","53/udp"], or
// [{"private":80,"public":8080}] and reduces each to the container (private)
// port as an int. Unparseable entries are dropped.
func normalizePorts(raw json.RawMessage) []int {
	out := []int{}
	if len(raw) == 0 {
		return out
	}
	// Try []int first.
	var ints []int
	if err := json.Unmarshal(raw, &ints); err == nil {
		return ints
	}
	// Try []string ("8080:80", "8080", "53/udp").
	var strs []string
	if err := json.Unmarshal(raw, &strs); err == nil {
		for _, s := range strs {
			if p := portFromString(s); p > 0 {
				out = append(out, p)
			}
		}
		return out
	}
	// Try []{private,public,...}.
	var objs []struct {
		Private   int `json:"private"`
		Container int `json:"container"`
		Target    int `json:"target"`
	}
	if err := json.Unmarshal(raw, &objs); err == nil {
		for _, o := range objs {
			p := firstNonZero(o.Private, o.Container, o.Target)
			if p > 0 {
				out = append(out, p)
			}
		}
	}
	return out
}

// portFromString extracts the container port from "host:container",
// "container", or "container/proto" forms.
func portFromString(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	// strip protocol suffix
	if i := strings.IndexByte(s, '/'); i >= 0 {
		s = s[:i]
	}
	// "host:container" -> take the part after the last colon (container port)
	if i := strings.LastIndexByte(s, ':'); i >= 0 {
		s = s[i+1:]
	}
	return atoiSafe(s)
}

// normalizeEnv reconciles native {key,value,required} and Portainer
// {name,label,default} env specs.
func normalizeEnv(in []rawCatalogEnv) []store.CustomTemplateEnvVar {
	out := make([]store.CustomTemplateEnvVar, 0, len(in))
	for _, e := range in {
		key := firstNonEmpty(e.Key, e.Name)
		if key == "" {
			continue
		}
		out = append(out, store.CustomTemplateEnvVar{
			Key:      key,
			Value:    firstNonEmpty(e.Value, e.Default),
			Required: e.Required,
		})
	}
	return out
}

// normalizeVolumes accepts ["/data"] or [{"container":"/data","bind":...}] and
// reduces each to the container path string.
func normalizeVolumes(raw json.RawMessage) []string {
	out := []string{}
	if len(raw) == 0 {
		return out
	}
	var strs []string
	if err := json.Unmarshal(raw, &strs); err == nil {
		for _, v := range strs {
			if v = strings.TrimSpace(v); v != "" {
				out = append(out, v)
			}
		}
		return out
	}
	var objs []struct {
		Container string `json:"container"`
		Path      string `json:"path"`
		Target    string `json:"target"`
	}
	if err := json.Unmarshal(raw, &objs); err == nil {
		for _, o := range objs {
			if v := firstNonEmpty(o.Container, o.Path, o.Target); v != "" {
				out = append(out, v)
			}
		}
	}
	return out
}

// --- small helpers (local to the marketplace handlers) ---

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func firstNonZero(vals ...int) int {
	for _, v := range vals {
		if v != 0 {
			return v
		}
	}
	return 0
}

// slugify lowercases and replaces non-alphanumeric runs with single dashes.
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// atoiSafe parses a base-10 int, returning 0 on any error or out-of-range value.
func atoiSafe(s string) int {
	s = strings.TrimSpace(s)
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
		if n > 65535 {
			return 0
		}
	}
	return n
}

// validateCatalogURL enforces an http(s) absolute URL (anti-SSRF surface is the
// admin-only RBAC gate; here we just reject obviously malformed/unsupported
// schemes so we never hand a file:// or relative URL to the fetcher).
func validateCatalogURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return authz.Errorf(authz.ErrValidation, "Catalog URL is required.")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return authz.Errorf(authz.ErrValidation, "Catalog URL must be an absolute http(s) URL.")
	}
	return nil
}

// errCatalogStatus formats a non-2xx upstream status into an error.
func errCatalogStatus(code int) error {
	return authz.Errorf(authz.ErrValidation, "catalog returned HTTP "+strconv.Itoa(code))
}
