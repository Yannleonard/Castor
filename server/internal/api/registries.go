package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/docker/docker/api/types/registry"
	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// registryView is the SAFE projection of a store.Registry returned to clients.
// It deliberately omits secret_enc and exposes only HasSecret so the UI can show
// whether a credential is set without ever receiving it. Field names mirror the
// store.Registry json tags plus hasSecret.
type registryView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	HasSecret bool   `json:"hasSecret"`
	CreatedAt int64  `json:"createdAt"`
}

func toRegistryView(rg *store.Registry) registryView {
	return registryView{
		ID:        rg.ID,
		Name:      rg.Name,
		Type:      rg.Type,
		URL:       rg.URL,
		Username:  rg.Username,
		Email:     rg.Email,
		HasSecret: rg.HasSecret(),
		CreatedAt: rg.CreatedAt,
	}
}

// validRegistryTypes is the accepted set for Registry.Type.
var validRegistryTypes = map[string]struct{}{
	"dockerhub": {}, "ghcr": {}, "gitlab": {}, "quay": {}, "ecr": {}, "custom": {},
}

type createRegistryRequest struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Secret   string `json:"secret"`
	Email    string `json:"email"`
}

// updateRegistryRequest mirrors create but Secret is a pointer: omit it to keep
// the stored credential, send "" to clear it, send a value to replace it.
type updateRegistryRequest struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	URL      string  `json:"url"`
	Username string  `json:"username"`
	Secret   *string `json:"secret"`
	Email    string  `json:"email"`
}

// ListRegistries returns all registries (never their secrets).
func (s *Server) ListRegistries(w http.ResponseWriter, r *http.Request) {
	regs, err := s.store.ListRegistries(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]registryView, 0, len(regs))
	for _, rg := range regs {
		out = append(out, toRegistryView(rg))
	}
	ok(w, out)
}

// CreateRegistry creates a registry credential (perm marketplace.registry.write).
func (s *Server) CreateRegistry(w http.ResponseWriter, r *http.Request) {
	var req createRegistryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	rgType, err := normalizeRegistryType(req.Type)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Registry name is required."))
		return
	}
	rg := &store.Registry{
		ID:       store.NewUUID(),
		Name:     strings.TrimSpace(req.Name),
		Type:     rgType,
		URL:      strings.TrimSpace(req.URL),
		Username: req.Username,
		Email:    req.Email,
	}
	// Seal the credential in the API layer (the store never imports the crypto
	// package — authz already imports store, so sealing there would cycle). Mirror
	// the TOTP enroll path which seals via authz.SealSecret(s.cfg.SecretKey, …).
	if req.Secret != "" {
		sealed, err := authz.SealSecret(s.cfg.SecretKey, []byte(req.Secret))
		if err != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		rg.SecretEnc = sealed
	}
	if err := s.store.CreateRegistry(r.Context(), rg); err != nil {
		// Likely a UNIQUE(name) collision.
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A registry with that name already exists."))
		return
	}
	authz.SetAuditTarget(r, "registry", rg.ID, rg.Name)
	created(w, toRegistryView(rg))
}

// UpdateRegistry updates a registry (perm marketplace.registry.write). Omitting
// "secret" preserves the stored credential.
func (s *Server) UpdateRegistry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateRegistryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	existing, err := s.store.GetRegistry(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	rgType, err := normalizeRegistryType(req.Type)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Registry name is required."))
		return
	}
	authz.SetAuditTarget(r, "registry", id, existing.Name)
	rg := &store.Registry{
		ID:       id,
		Name:     strings.TrimSpace(req.Name),
		Type:     rgType,
		URL:      strings.TrimSpace(req.URL),
		Username: req.Username,
		Email:    req.Email,
	}
	// "secret" semantics: omitted (nil) -> keep stored credential; "" -> clear it;
	// non-empty -> re-seal and replace. Sealing happens here (see CreateRegistry).
	setSecret := req.Secret != nil
	if setSecret && *req.Secret != "" {
		sealed, err := authz.SealSecret(s.cfg.SecretKey, []byte(*req.Secret))
		if err != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		rg.SecretEnc = sealed
	}
	if err := s.store.UpdateRegistry(ctx, rg, setSecret); err != nil {
		if err == store.ErrNotFound {
			writeMapped(w, r, err)
			return
		}
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A registry with that name already exists."))
		return
	}
	fresh, _ := s.store.GetRegistry(ctx, id)
	ok(w, toRegistryView(fresh))
}

// DeleteRegistry removes a registry (perm marketplace.registry.write).
func (s *Server) DeleteRegistry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "registry", id, "")
	if err := s.store.DeleteRegistry(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// registryTestResult is the body of POST /registries/{id}/test.
type registryTestResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// TestRegistry attempts a registry login with the stored credential via the
// Docker daemon's RegistryLogin and reports the outcome (perm
// marketplace.registry.write). It never echoes the secret.
func (s *Server) TestRegistry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	rg, err := s.store.GetRegistry(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "registry", id, rg.Name)

	secret, err := s.openRegistrySecret(rg)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	auth := registry.AuthConfig{
		Username:      rg.Username,
		Password:      string(secret),
		ServerAddress: registryServerAddress(rg),
		Email:         rg.Email,
	}

	tctx, cancel := contextWithTimeout(r, registryTestTimeout)
	defer cancel()

	body, err := s.manager.Docker().Client().RegistryLogin(tctx, auth)
	if err != nil {
		// A failed auth is a normal, non-error API outcome: return ok:false with the
		// daemon's message so the operator can fix the credential, not a 5xx.
		ok(w, registryTestResult{OK: false, Message: sanitizeRegistryError(err.Error())})
		return
	}
	msg := strings.TrimSpace(body.Status)
	if msg == "" {
		msg = "Login succeeded."
	}
	ok(w, registryTestResult{OK: true, Message: msg})
}

// openRegistrySecret decrypts a registry's stored credential for internal use
// (the test probe here, and authenticated pulls elsewhere). Returns nil with no
// error when the registry has no stored secret. The plaintext is NEVER returned
// over the API — only used to build a registry.AuthConfig.
func (s *Server) openRegistrySecret(rg *store.Registry) ([]byte, error) {
	if len(rg.SecretEnc) == 0 {
		return nil, nil
	}
	return authz.OpenSecret(s.cfg.SecretKey, rg.SecretEnc)
}

// RegistryAuthSecret returns the decrypted password/token for a registry by id,
// for internal callers (e.g. an authenticated image pull). It is never exposed
// over the API surface. Returns nil with no error when no secret is stored.
func (s *Server) RegistryAuthSecret(ctx context.Context, id string) ([]byte, error) {
	rg, err := s.store.GetRegistry(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.openRegistrySecret(rg)
}

// registryServerAddress resolves the address passed to RegistryLogin: the
// explicit URL when set, else a sensible default for the well-known types
// (empty falls back to Docker Hub inside the daemon).
func registryServerAddress(rg *store.Registry) string {
	if u := strings.TrimSpace(rg.URL); u != "" {
		return u
	}
	switch rg.Type {
	case "ghcr":
		return "ghcr.io"
	case "quay":
		return "quay.io"
	default:
		return ""
	}
}

// normalizeRegistryType validates and defaults the registry type.
func normalizeRegistryType(t string) (string, error) {
	t = strings.TrimSpace(strings.ToLower(t))
	if t == "" {
		return "custom", nil
	}
	if _, ok := validRegistryTypes[t]; !ok {
		return "", authz.Errorf(authz.ErrValidation, "type must be one of dockerhub, ghcr, gitlab, quay, ecr, custom.")
	}
	return t, nil
}

// sanitizeRegistryError trims a daemon error to a single concise line so the
// test result message stays readable and never leaks multi-line internals.
func sanitizeRegistryError(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return "Login failed."
	}
	return s
}
