// Castor by IT Leonard
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// doBearer performs a request authenticated with a raw PAT only (no cookies,
// no CSRF header, no Origin — the Bearer path must not need any of them).
func (e *testEnv) doBearer(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	return rec
}

// createToken creates a PAT via the API and returns the raw token + its id.
func createToken(t *testing.T, e *testEnv, cookies []*http.Cookie, csrf string, body map[string]any) (raw, id string) {
	t.Helper()
	rec := e.do(t, http.MethodPost, "/api/v1/auth/tokens", body, cookies, csrf)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create token code = %d (%s)", rec.Code, rec.Body.String())
	}
	resp := decodeBody(t, rec)
	raw, _ = resp["token"].(string)
	id, _ = resp["id"].(string)
	if raw == "" || id == "" {
		t.Fatalf("create token response missing token/id: %s", rec.Body.String())
	}
	return raw, id
}

// TestAPITokenCreateListRevoke covers the full lifecycle: creation returns the
// raw token exactly once and only the hash reaches the DB and the audit trail;
// the list never exposes the raw value; revocation kills the token.
func TestAPITokenCreateListRevoke(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)

	// --- create (name is trimmed; 30-day expiry) ---
	raw, id := createToken(t, e, cookies, csrf, map[string]any{
		"name": "  ci-token  ", "expiresInDays": 30,
	})
	if !strings.HasPrefix(raw, authz.APITokenPrefix) {
		t.Errorf("raw token %q must start with %q", raw, authz.APITokenPrefix)
	}
	if id != authz.HashSessionID(raw) {
		t.Errorf("id must be the SHA-256 of the raw token")
	}

	// DB holds the hash, the trimmed name, and an expiry ~30 days out.
	tok, err := e.st.GetAPITokenByID(ctx, id)
	if err != nil {
		t.Fatalf("GetAPITokenByID: %v", err)
	}
	if tok.Name != "ci-token" {
		t.Errorf("stored name = %q want %q (trimmed)", tok.Name, "ci-token")
	}
	if tok.ID == raw || strings.Contains(tok.ID, raw) {
		t.Errorf("raw token must never be stored")
	}
	if tok.ExpiresAt == nil {
		t.Fatalf("expiresAt not stored")
	}
	wantExp := time.Now().Unix() + 30*86400
	if diff := *tok.ExpiresAt - wantExp; diff < -60 || diff > 60 {
		t.Errorf("expiresAt = %d want ~%d", *tok.ExpiresAt, wantExp)
	}

	// The creation audit row carries hashed id + name — never the raw token.
	entries, _, err := e.st.ListAudit(ctx, store.AuditFilter{Action: "auth.token.create"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 auth.token.create audit row, got %d", len(entries))
	}
	row := entries[0]
	if row.Result != "success" || row.TargetID != id || row.TargetName != "ci-token" {
		t.Errorf("audit row = result %q target %q/%q", row.Result, row.TargetID, row.TargetName)
	}
	if strings.Contains(row.TargetID+row.TargetName+row.Detail, raw) {
		t.Errorf("raw token leaked into the audit row")
	}

	// --- list: metadata only, never the raw token ---
	rec := e.do(t, http.MethodGet, "/api/v1/auth/tokens", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list code = %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), raw) {
		t.Fatalf("list response leaked the raw token")
	}
	var items []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("list len = %d want 1", len(items))
	}
	if items[0]["id"] != id || items[0]["name"] != "ci-token" {
		t.Errorf("list item = %v", items[0])
	}
	if _, has := items[0]["token"]; has {
		t.Errorf("list item must not carry a token field")
	}
	if _, has := items[0]["revokedAt"]; has {
		t.Errorf("live token must not carry revokedAt")
	}

	// --- the raw token authenticates a read end-to-end through the router ---
	rec = e.doBearer(t, http.MethodGet, "/api/v1/auth/tokens", raw, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("bearer list code = %d (%s)", rec.Code, rec.Body.String())
	}

	// --- revoke ---
	rec = e.do(t, http.MethodDelete, "/api/v1/auth/tokens/"+id, nil, cookies, csrf)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("revoke code = %d (%s)", rec.Code, rec.Body.String())
	}
	tok, err = e.st.GetAPITokenByID(ctx, id)
	if err != nil {
		t.Fatalf("GetAPITokenByID after revoke: %v", err)
	}
	if tok.RevokedAt == nil {
		t.Fatalf("revoked_at not set")
	}

	// The revoked token no longer authenticates.
	rec = e.doBearer(t, http.MethodGet, "/api/v1/auth/tokens", raw, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("revoked bearer code = %d want 401", rec.Code)
	}

	// Revoking again (or a foreign/unknown id) yields 404.
	rec = e.do(t, http.MethodDelete, "/api/v1/auth/tokens/"+id, nil, cookies, csrf)
	if rec.Code != http.StatusNotFound {
		t.Errorf("double revoke code = %d want 404", rec.Code)
	}

	// The revocation audit row names the token, without the raw value.
	entries, _, err = e.st.ListAudit(ctx, store.AuditFilter{Action: "auth.token.revoke"})
	if err != nil {
		t.Fatalf("ListAudit revoke: %v", err)
	}
	if len(entries) < 1 {
		t.Fatalf("expected auth.token.revoke audit rows")
	}
	// Newest-first ordering is not guaranteed here; just assert none leaked.
	for _, row := range entries {
		if strings.Contains(row.TargetID+row.TargetName+row.Detail, raw) {
			t.Errorf("raw token leaked into a revoke audit row")
		}
	}
}

// TestAPITokenCreateValidation exercises name/expiry validation.
func TestAPITokenCreateValidation(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	cases := []map[string]any{
		{"name": ""},                        // empty
		{"name": "   "},                     // whitespace only
		{"name": strings.Repeat("x", 65)},   // too long
		{"name": "ok", "expiresInDays": 0},  // non-positive
		{"name": "ok", "expiresInDays": -3}, // negative
	}
	for i, body := range cases {
		rec := e.do(t, http.MethodPost, "/api/v1/auth/tokens", body, cookies, csrf)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("case %d: code = %d want 422 (%s)", i, rec.Code, rec.Body.String())
		}
	}

	// A token without expiresInDays never expires.
	_, id := createToken(t, e, cookies, csrf, map[string]any{"name": "forever"})
	tok, err := e.st.GetAPITokenByID(context.Background(), id)
	if err != nil {
		t.Fatalf("GetAPITokenByID: %v", err)
	}
	if tok.ExpiresAt != nil {
		t.Errorf("expiresAt = %v want nil (never expires)", *tok.ExpiresAt)
	}
}

// TestAPITokenCannotManageTokens proves a PAT cannot mint or revoke tokens
// (403), while listing stays allowed — a stolen token must not be able to
// self-multiply or cover its tracks.
func TestAPITokenCannotManageTokens(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)
	raw, id := createToken(t, e, cookies, csrf, map[string]any{"name": "bearer"})

	// Create via Bearer: refused.
	rec := e.doBearer(t, http.MethodPost, "/api/v1/auth/tokens", raw, map[string]any{"name": "evil"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("bearer create code = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
	errObj := decodeBody(t, rec)["error"].(map[string]any)
	if msg, _ := errObj["message"].(string); !strings.Contains(msg, "API tokens cannot manage tokens") {
		t.Errorf("bearer create message = %q", msg)
	}

	// Revoke via Bearer: refused, and the token stays live.
	rec = e.doBearer(t, http.MethodDelete, "/api/v1/auth/tokens/"+id, raw, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("bearer revoke code = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
	tok, err := e.st.GetAPITokenByID(context.Background(), id)
	if err != nil {
		t.Fatalf("GetAPITokenByID: %v", err)
	}
	if tok.RevokedAt != nil {
		t.Errorf("bearer revoke must not take effect")
	}

	// No second token was minted.
	rec = e.do(t, http.MethodGet, "/api/v1/auth/tokens", nil, cookies, "")
	var items []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(items) != 1 {
		t.Errorf("list len = %d want 1 (bearer create must not mint)", len(items))
	}

	// List via Bearer stays allowed (read-only self-inspection).
	rec = e.doBearer(t, http.MethodGet, "/api/v1/auth/tokens", raw, nil)
	if rec.Code != http.StatusOK {
		t.Errorf("bearer list code = %d want 200", rec.Code)
	}
}
