package api

// swarm_secrets.go holds the Swarm SECRET and CONFIG management surface. Like
// the swarm service/node lifecycle (swarm_write.go), these are live calls
// against the Swarm manager via the swarm provider — they are NOT served from
// the cache snapshot. Each handler resolves the provider through
// swarmProviderOr405 (which 405s when the host is not a swarm manager), decodes
// the small body, calls the provider, and maps errors via writeMapped. RBAC +
// AAL + AuditWrap are applied by the router, not here.
//
// SECURITY: a secret's value is write-only. ListSecrets returns only id/name/
// timestamps (the Engine API never surfaces the data again). There is
// deliberately NO get-secret-data endpoint. Config payloads ARE non-sensitive,
// so a single-config GET returns the data — still gated by swarm.config.read.

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/swarm"
)

// swarmSecretCreateRequest is the body for POST .../swarm/secrets. The data is a
// UTF-8 string (most secrets/configs are text such as a token or a PEM block);
// it is the only place the value is ever transmitted.
type swarmSecretCreateRequest struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

// swarmConfigCreateRequest is the body for POST .../swarm/configs.
type swarmConfigCreateRequest struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

/* ============================ Secrets ============================ */

// SwarmSecrets lists swarm secrets (perm swarm.secret.read). SECURITY: returns
// id/name/timestamps only — never any secret value.
func (s *Server) SwarmSecrets(w http.ResponseWriter, r *http.Request) {
	p, available := s.swarmProviderOr405(w, r)
	if !available {
		return
	}
	secs, err := p.ListSecrets(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if secs == nil {
		secs = []swarm.SwarmSecretInfo{}
	}
	ok2json(w, secs)
}

// SwarmSecretCreate creates a swarm secret (perm swarm.secret.write) and returns
// the new id with 201. The value is write-only after creation.
func (s *Server) SwarmSecretCreate(w http.ResponseWriter, r *http.Request) {
	p, available := s.swarmProviderOr405(w, r)
	if !available {
		return
	}
	var req swarmSecretCreateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Secret name is required."))
		return
	}
	if req.Data == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Secret data is required."))
		return
	}
	authz.SetAuditTarget(r, "swarm-secret", req.Name, req.Name)

	id, err := p.CreateSecret(r.Context(), req.Name, []byte(req.Data))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "swarm-secret", id, req.Name)
	created(w, map[string]any{"ok": true, "id": id})
}

// SwarmSecretRemove deletes a swarm secret (perm swarm.secret.write). A secret
// still referenced by a service is rejected by the engine (409 conflict).
func (s *Server) SwarmSecretRemove(w http.ResponseWriter, r *http.Request) {
	p, available := s.swarmProviderOr405(w, r)
	if !available {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "swarm-secret", id, id)

	if err := p.DeleteSecret(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

/* ============================ Configs ============================ */

// SwarmConfigs lists swarm configs (perm swarm.config.read) — id/name/timestamps
// only (the payload is fetched via the single-config GET).
func (s *Server) SwarmConfigs(w http.ResponseWriter, r *http.Request) {
	p, available := s.swarmProviderOr405(w, r)
	if !available {
		return
	}
	cfgs, err := p.ListConfigs(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if cfgs == nil {
		cfgs = []swarm.SwarmConfigInfo{}
	}
	ok2json(w, cfgs)
}

// SwarmConfigGet returns a single config WITH its payload (perm
// swarm.config.read). Configs are non-secret (intended for files like
// nginx.conf), so the data is safe to return.
func (s *Server) SwarmConfigGet(w http.ResponseWriter, r *http.Request) {
	p, available := s.swarmProviderOr405(w, r)
	if !available {
		return
	}
	id := chi.URLParam(r, "id")
	detail, err := p.GetConfig(r.Context(), id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2json(w, detail)
}

// SwarmConfigCreate creates a swarm config (perm swarm.config.write) and returns
// the new id with 201.
func (s *Server) SwarmConfigCreate(w http.ResponseWriter, r *http.Request) {
	p, available := s.swarmProviderOr405(w, r)
	if !available {
		return
	}
	var req swarmConfigCreateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Config name is required."))
		return
	}
	if req.Data == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Config data is required."))
		return
	}
	authz.SetAuditTarget(r, "swarm-config", req.Name, req.Name)

	id, err := p.CreateConfig(r.Context(), req.Name, []byte(req.Data))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "swarm-config", id, req.Name)
	created(w, map[string]any{"ok": true, "id": id})
}

// SwarmConfigRemove deletes a swarm config (perm swarm.config.write). An in-use
// config is rejected by the engine (409 conflict).
func (s *Server) SwarmConfigRemove(w http.ResponseWriter, r *http.Request) {
	p, available := s.swarmProviderOr405(w, r)
	if !available {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "swarm-config", id, id)

	if err := p.DeleteConfig(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}
