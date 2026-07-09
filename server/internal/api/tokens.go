package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// maxTokenNameLen caps a personal-access-token display name.
const maxTokenNameLen = 64

type createTokenRequest struct {
	Name string `json:"name"`
	// ExpiresInDays, when present, must be > 0; absent means the token never
	// expires (revocation remains the kill switch).
	ExpiresInDays *int `json:"expiresInDays,omitempty"`
}

// tokenView is the list shape of a PAT. The id is the hex SHA-256 of the raw
// token: it cannot be inverted and doubles as the revocation handle, so it is
// safe to expose. The raw token itself is returned exactly once, at creation.
type tokenView struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	CreatedAt  int64  `json:"createdAt"`
	ExpiresAt  *int64 `json:"expiresAt,omitempty"`
	LastUsedAt *int64 `json:"lastUsedAt,omitempty"`
	RevokedAt  *int64 `json:"revokedAt,omitempty"`
}

// createTokenResponse carries the one-time raw token alongside the metadata.
type createTokenResponse struct {
	Token string `json:"token"`
	tokenView
}

func toTokenView(t *store.APIToken) tokenView {
	return tokenView{
		ID:         t.ID,
		Name:       t.Name,
		Prefix:     t.Prefix,
		CreatedAt:  t.CreatedAt,
		ExpiresAt:  t.ExpiresAt,
		LastUsedAt: t.LastUsedAt,
		RevokedAt:  t.RevokedAt,
	}
}

// requireInteractiveUser resolves the caller and rejects PAT-authenticated
// requests: a stolen token must not be able to mint or revoke tokens
// (self-multiplication / covering tracks). Writes the error response and
// returns nil on rejection.
func requireInteractiveUser(w http.ResponseWriter, r *http.Request) *authz.User {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return nil
	}
	if u.AMR == authz.AMRToken {
		authz.WriteError(w, r, authz.Errorf(authz.ErrForbidden, "API tokens cannot manage tokens."))
		return nil
	}
	return u
}

// ListAPITokens returns the caller's tokens (metadata only — never a raw
// token, which is not stored anywhere). Includes revoked/expired rows so the
// UI can show history.
func (s *Server) ListAPITokens(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	toks, err := s.store.ListAPITokensForUser(r.Context(), u.ID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]tokenView, 0, len(toks))
	for _, t := range toks {
		out = append(out, toTokenView(t))
	}
	ok(w, out)
}

// CreateAPIToken mints a PAT for the caller and returns the raw token exactly
// once. Only the SHA-256 hash is persisted (same contract as sessions); the
// audit row carries the hashed id + name, never the raw value.
func (s *Server) CreateAPIToken(w http.ResponseWriter, r *http.Request) {
	u := requireInteractiveUser(w, r)
	if u == nil {
		return
	}
	var req createTokenRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > maxTokenNameLen {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation,
			"Token name is required and must be at most 64 characters."))
		return
	}
	now := time.Now().Unix()
	var expiresAt *int64
	if req.ExpiresInDays != nil {
		if *req.ExpiresInDays <= 0 {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation,
				"expiresInDays must be a positive integer."))
			return
		}
		v := now + int64(*req.ExpiresInDays)*86400
		expiresAt = &v
	}

	raw, prefix, err := authz.GenerateAPIToken()
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	tok := &store.APIToken{
		ID:        authz.HashSessionID(raw),
		UserID:    u.ID,
		Name:      name,
		Prefix:    prefix,
		CreatedAt: now,
		ExpiresAt: expiresAt,
	}
	if err := s.store.CreateAPIToken(r.Context(), tok); err != nil {
		writeMapped(w, r, err)
		return
	}
	// Audit target: hashed id + name only. The raw token must never reach the
	// audit trail.
	authz.SetAuditTarget(r, "api_token", tok.ID, tok.Name)

	created(w, createTokenResponse{Token: raw, tokenView: toTokenView(tok)})
}

// RevokeAPIToken soft-deletes one of the caller's tokens. The store predicate
// is scoped to the current user, so a foreign or unknown id yields 404 (no
// ownership enumeration).
func (s *Server) RevokeAPIToken(w http.ResponseWriter, r *http.Request) {
	u := requireInteractiveUser(w, r)
	if u == nil {
		return
	}
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "api_token", id, "")
	if err := s.store.RevokeAPIToken(r.Context(), id, u.ID, time.Now().Unix()); err != nil {
		writeMapped(w, r, err)
		return
	}
	// Ownership is proven by the successful revoke; enrich the audit row with
	// the token's display name.
	if tok, err := s.store.GetAPITokenByID(r.Context(), id); err == nil {
		authz.SetAuditTarget(r, "api_token", id, tok.Name)
	}
	noContent(w)
}
