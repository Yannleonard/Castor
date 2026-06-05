package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/templates"
)

// templateEnvView is one env-var in a marketplace template (built-in or custom).
type templateEnvView struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Required bool   `json:"required"`
}

// templateView is a unified marketplace template entry as returned by
// GET /templates. It is the merge shape of the built-in catalog and the custom
// templates table, tagged with source. Built-in entries carry their UI logo
// path in `logo`; custom entries carry the operator-supplied `logoUrl` there.
// `id` is empty for built-in entries (they have no DB row) and the row id for
// custom entries.
type templateView struct {
	ID          string            `json:"id"`
	Source      string            `json:"source"` // "builtin" | "custom"
	Name        string            `json:"name"`
	Slug        string            `json:"slug"`
	Category    string            `json:"category"`
	Image       string            `json:"image"`
	Description string            `json:"description"`
	Ports       []int             `json:"ports"`
	Env         []templateEnvView `json:"env"`
	Volumes     []string          `json:"volumes"`
	Logo        string            `json:"logo"`
	CreatedAt   *int64            `json:"createdAt,omitempty"`
}

// templateWriteRequest is the POST/PUT body for a custom template.
type templateWriteRequest struct {
	Name        string            `json:"name"`
	Slug        string            `json:"slug"`
	Category    string            `json:"category"`
	Image       string            `json:"image"`
	Description string            `json:"description"`
	Ports       []int             `json:"ports"`
	Env         []templateEnvView `json:"env"`
	Volumes     []string          `json:"volumes"`
	LogoURL     string            `json:"logoUrl"`
}

// Templates serves the merged marketplace catalog: built-in templates followed
// by operator-authored custom templates. Read for any authenticated user
// (no per-host scope; the catalog is global).
func (s *Server) Templates(w http.ResponseWriter, r *http.Request) {
	out := make([]templateView, 0, 64)
	for _, t := range templates.BuiltinTemplates() {
		out = append(out, builtinView(t))
	}
	customs, err := s.store.ListCustomTemplates(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	for _, c := range customs {
		out = append(out, customView(c))
	}
	ok(w, out)
}

// CreateTemplate adds a custom template (admin/superuser).
func (s *Server) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	var req templateWriteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := validateTemplateWrite(&req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	t := &store.CustomTemplate{
		ID:          store.NewUUID(),
		Name:        strings.TrimSpace(req.Name),
		Slug:        normalizeSlug(req.Slug),
		Category:    strings.TrimSpace(req.Category),
		Image:       strings.TrimSpace(req.Image),
		Description: req.Description,
		Ports:       req.Ports,
		Env:         toStoreEnv(req.Env),
		Volumes:     req.Volumes,
		LogoURL:     strings.TrimSpace(req.LogoURL),
	}
	if u := authz.UserFrom(r); u != nil {
		t.CreatedBy = u.ID
	}
	authz.SetAuditTarget(r, "template", t.ID, t.Name)

	if err := s.store.CreateCustomTemplate(r.Context(), t); err != nil {
		writeMapped(w, r, mapTemplateConflict(err))
		return
	}
	stored, err := s.store.GetCustomTemplate(r.Context(), t.ID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	created(w, customView(stored))
}

// UpdateTemplate replaces a custom template by id (admin/superuser).
func (s *Server) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req templateWriteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := validateTemplateWrite(&req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	t := &store.CustomTemplate{
		ID:          id,
		Name:        strings.TrimSpace(req.Name),
		Slug:        normalizeSlug(req.Slug),
		Category:    strings.TrimSpace(req.Category),
		Image:       strings.TrimSpace(req.Image),
		Description: req.Description,
		Ports:       req.Ports,
		Env:         toStoreEnv(req.Env),
		Volumes:     req.Volumes,
		LogoURL:     strings.TrimSpace(req.LogoURL),
	}
	authz.SetAuditTarget(r, "template", id, t.Name)

	if err := s.store.UpdateCustomTemplate(r.Context(), t); err != nil {
		writeMapped(w, r, mapTemplateConflict(err))
		return
	}
	stored, err := s.store.GetCustomTemplate(r.Context(), id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, customView(stored))
}

// DeleteTemplate removes a custom template by id (admin/superuser).
func (s *Server) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "template", id, id)
	if err := s.store.DeleteCustomTemplate(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// deployRequest is the POST /hosts/{hostID}/templates/deploy body. Either
// templateSlug (resolved against built-in + custom catalogs) or an inline image
// must be supplied. name is the container name. ports/env/volumes/restartPolicy
// override or augment the template defaults.
type deployRequest struct {
	TemplateSlug  string            `json:"templateSlug"`
	Image         string            `json:"image"`
	Name          string            `json:"name"`
	Env           map[string]string `json:"env"`
	Ports         []docker.PortMap  `json:"ports"`
	Volumes       []docker.VolMount `json:"volumes"`
	Labels        map[string]string `json:"labels"`
	RestartPolicy string            `json:"restartPolicy"`

	// Optional resource limits/reservations (<=0 means unset). Same semantics as
	// docker.DeploySpec: cpu values are cores, memory values are bytes.
	CpuLimit               float64 `json:"cpuLimit"`
	MemoryLimitBytes       int64   `json:"memoryLimitBytes"`
	CpuReservation         float64 `json:"cpuReservation"`
	MemoryReservationBytes int64   `json:"memoryReservationBytes"`

	// AllowHostMounts is an admin-only opt-in to permit (ordinary) host bind
	// mounts in this deploy. It is honored ONLY when the caller holds global
	// superuser; a non-admin that sets it (or requests any host bind) is denied
	// 403 (audited). The always-blocked host paths (docker.sock, /, /etc, ...)
	// stay denied even for admins via the API.
	AllowHostMounts bool `json:"allowHostMounts"`
}

// deployResponse is returned on a successful one-click deploy.
type deployResponse struct {
	OK          bool   `json:"ok"`
	ContainerID string `json:"containerId"`
	Name        string `json:"name"`
	Image       string `json:"image"`
}

// DeployTemplate builds a DeploySpec from a template slug (built-in or custom)
// plus request overrides and creates+starts the container on the host's Docker
// engine (perm docker.container.create at host scope). The host must be the
// local Docker host in V1.
func (s *Server) DeployTemplate(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, ok := s.manager.Store().Get(hostID); !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}

	var req deployRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}

	spec, err := s.buildDeploySpec(r, &req)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "container", spec.Name, spec.Name)

	id, err := s.manager.Docker().ContainerCreateAndStart(r.Context(), spec)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "container", id, spec.Name)
	created(w, deployResponse{OK: true, ContainerID: id, Name: spec.Name, Image: spec.Image})
}

// buildDeploySpec resolves the (optional) template slug and merges the request
// overrides into a docker.DeploySpec. Request-supplied ports/env/volumes REPLACE
// the template defaults when provided (non-nil); env maps are merged so the
// caller can fill in just the required values.
func (s *Server) buildDeploySpec(r *http.Request, req *deployRequest) (docker.DeploySpec, error) {
	spec := docker.DeploySpec{
		Image:                  strings.TrimSpace(req.Image),
		Name:                   strings.TrimSpace(req.Name),
		Env:                    map[string]string{},
		Ports:                  req.Ports,
		Volumes:                req.Volumes,
		Labels:                 req.Labels,
		RestartPolicy:          req.RestartPolicy,
		CpuLimit:               req.CpuLimit,
		MemoryLimitBytes:       req.MemoryLimitBytes,
		CpuReservation:         req.CpuReservation,
		MemoryReservationBytes: req.MemoryReservationBytes,
	}

	if slug := normalizeSlug(req.TemplateSlug); slug != "" {
		tpl, found, err := s.resolveTemplate(r, slug)
		if err != nil {
			return spec, err
		}
		if !found {
			return spec, authz.Errorf(authz.ErrValidation, "Unknown template: "+slug)
		}
		if spec.Image == "" {
			spec.Image = tpl.Image
		}
		// Seed env from the template defaults; request env (below) overrides.
		for _, e := range tpl.Env {
			spec.Env[e.Key] = e.Value
		}
		// When the caller did not override ports/volumes, derive them from the
		// template (container ports published 1:1, named volumes auto-created).
		if spec.Ports == nil {
			spec.Ports = make([]docker.PortMap, 0, len(tpl.Ports))
			for _, p := range tpl.Ports {
				spec.Ports = append(spec.Ports, docker.PortMap{Host: p, Container: p, Proto: "tcp"})
			}
		}
		if spec.Volumes == nil {
			spec.Volumes = make([]docker.VolMount, 0, len(tpl.Volumes))
			for _, v := range tpl.Volumes {
				spec.Volumes = append(spec.Volumes, docker.VolMount{Source: "", Target: v})
			}
		}
	}

	// Merge request env over template defaults.
	for k, v := range req.Env {
		spec.Env[k] = v
	}

	if spec.Image == "" {
		return spec, authz.Errorf(authz.ErrValidation, "An image or a known templateSlug is required.")
	}
	if !docker.ValidImageRef(spec.Image) {
		return spec, authz.Errorf(authz.ErrValidation, "Invalid image reference.")
	}
	if spec.Name != "" && !validContainerName(spec.Name) {
		return spec, authz.Errorf(authz.ErrValidation, "Invalid container name.")
	}

	// Host-mount escalation guard: only a global superuser may opt into host bind
	// mounts, and a non-admin that requests one (in the merged volume set) is
	// denied 403 (audited). authorizeHostMounts sets spec.AllowHostMounts on the
	// admin path. ValidateMounts inside the provider re-checks as defense-in-depth.
	if err := s.authorizeHostMounts(r, &spec, req.AllowHostMounts); err != nil {
		return spec, err
	}
	return spec, nil
}

// authorizeHostMounts decides whether spec.Volumes may include host bind mounts
// and records the decision on spec.AllowHostMounts. It is the single handler-side
// host-mount choke point shared by the template-deploy and (indirectly) the stack
// paths. Rules:
//
//   - No host binds requested -> always allowed (named volumes are safe).
//   - The caller holds global superuser -> AllowHostMounts is honored (the wire
//     flag); the always-blocked host paths still fail later in ValidateMounts.
//   - Otherwise (non-admin requesting a host bind, or a non-admin that set the
//     flag) -> 403 forbidden, audited with the offending host paths.
func (s *Server) authorizeHostMounts(r *http.Request, spec *docker.DeploySpec, requested bool) error {
	hostPaths := docker.HostMountSources(spec.Volumes)
	actor := authz.UserFrom(r)
	isAdmin := actor != nil && actor.HasGlobalSuperuser()

	if !isAdmin && (len(hostPaths) > 0 || requested) {
		authz.AddAuditDetail(r, "denied", "host_mount")
		if len(hostPaths) > 0 {
			authz.AddAuditDetail(r, "hostPaths", hostPaths)
		}
		authz.SetAuditResult(r, "denied")
		return authz.Errorf(authz.ErrForbidden,
			"Host bind mounts require administrator privileges; only named volumes are allowed.")
	}

	// Admin: honor the explicit opt-in. (ValidateMounts still hard-rejects the
	// always-blocked host paths for everyone.)
	spec.AllowHostMounts = isAdmin && requested
	if len(hostPaths) > 0 {
		authz.AddAuditDetail(r, "hostMounts", hostPaths)
	}
	return nil
}

// resolvedTemplate is the minimal template shape buildDeploySpec needs.
type resolvedTemplate struct {
	Image   string
	Env     []templateEnvView
	Ports   []int
	Volumes []string
}

// resolveTemplate looks up a slug first in the built-in catalog, then in the
// custom templates table.
func (s *Server) resolveTemplate(r *http.Request, slug string) (resolvedTemplate, bool, error) {
	for _, t := range templates.BuiltinTemplates() {
		if t.Slug == slug {
			return resolvedTemplate{
				Image:   t.Image,
				Env:     fromBuiltinEnv(t.Env),
				Ports:   t.Ports,
				Volumes: t.Volumes,
			}, true, nil
		}
	}
	customs, err := s.store.ListCustomTemplates(r.Context())
	if err != nil {
		return resolvedTemplate{}, false, mapError(err)
	}
	for _, c := range customs {
		if c.Slug == slug {
			return resolvedTemplate{
				Image:   c.Image,
				Env:     fromStoreEnv(c.Env),
				Ports:   c.Ports,
				Volumes: c.Volumes,
			}, true, nil
		}
	}
	return resolvedTemplate{}, false, nil
}

// --- view + conversion helpers ---

func builtinView(t templates.Template) templateView {
	return templateView{
		ID:          "",
		Source:      "builtin",
		Name:        t.Name,
		Slug:        t.Slug,
		Category:    t.Category,
		Image:       t.Image,
		Description: t.Description,
		Ports:       normInts(t.Ports),
		Env:         fromBuiltinEnv(t.Env),
		Volumes:     normStrs(t.Volumes),
		Logo:        t.Logo,
	}
}

func customView(c *store.CustomTemplate) templateView {
	createdAt := c.CreatedAt
	return templateView{
		ID:          c.ID,
		Source:      "custom",
		Name:        c.Name,
		Slug:        c.Slug,
		Category:    c.Category,
		Image:       c.Image,
		Description: c.Description,
		Ports:       normInts(c.Ports),
		Env:         fromStoreEnv(c.Env),
		Volumes:     normStrs(c.Volumes),
		Logo:        c.LogoURL,
		CreatedAt:   &createdAt,
	}
}

func fromBuiltinEnv(in []templates.EnvVar) []templateEnvView {
	out := make([]templateEnvView, 0, len(in))
	for _, e := range in {
		out = append(out, templateEnvView{Key: e.Key, Value: e.Value, Required: e.Required})
	}
	return out
}

func fromStoreEnv(in []store.CustomTemplateEnvVar) []templateEnvView {
	out := make([]templateEnvView, 0, len(in))
	for _, e := range in {
		out = append(out, templateEnvView{Key: e.Key, Value: e.Value, Required: e.Required})
	}
	return out
}

func toStoreEnv(in []templateEnvView) []store.CustomTemplateEnvVar {
	out := make([]store.CustomTemplateEnvVar, 0, len(in))
	for _, e := range in {
		out = append(out, store.CustomTemplateEnvVar{Key: e.Key, Value: e.Value, Required: e.Required})
	}
	return out
}

func normInts(v []int) []int {
	if v == nil {
		return []int{}
	}
	return v
}

func normStrs(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// validateTemplateWrite enforces the minimal invariants for a custom template.
func validateTemplateWrite(req *templateWriteRequest) error {
	if strings.TrimSpace(req.Name) == "" {
		return authz.Errorf(authz.ErrValidation, "Template name is required.")
	}
	if normalizeSlug(req.Slug) == "" {
		return authz.Errorf(authz.ErrValidation, "A valid slug (a-z, 0-9, -) is required.")
	}
	img := strings.TrimSpace(req.Image)
	if img == "" {
		return authz.Errorf(authz.ErrValidation, "Template image is required.")
	}
	if !docker.ValidImageRef(img) {
		return authz.Errorf(authz.ErrValidation, "Invalid image reference.")
	}
	for _, e := range req.Env {
		if strings.TrimSpace(e.Key) == "" {
			return authz.Errorf(authz.ErrValidation, "Env entries must have a key.")
		}
	}
	return nil
}

// normalizeSlug lowercases and keeps only [a-z0-9-], collapsing other runs to a
// single '-'. Returns "" when nothing usable remains.
func normalizeSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, c := range s {
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteRune(c)
			prevDash = false
		case c == '-' || c == '_' || c == ' ' || c == '.' || c == '/':
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// validContainerName mirrors Docker's accepted container name charset
// ([a-zA-Z0-9][a-zA-Z0-9_.-]*).
func validContainerName(name string) bool {
	if name == "" || len(name) > 255 {
		return false
	}
	for i, c := range name {
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
		if i > 0 {
			ok = ok || c == '_' || c == '.' || c == '-'
		}
		if !ok {
			return false
		}
	}
	return true
}

// mapTemplateConflict turns a UNIQUE(slug) violation into a 409 conflict.
func mapTemplateConflict(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unique") || strings.Contains(msg, "constraint") {
		return authz.Errorf(authz.ErrConflict, "A template with that slug already exists.")
	}
	return err
}
