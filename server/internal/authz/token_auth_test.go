// Castor by IT Leonard
package authz

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/store"
)

// mintToken inserts a PAT row for the env user and returns the raw token to
// place in the Authorization header. mutate may adjust the row before insert
// (e.g. to set expires_at / revoked_at / last_used_at).
func (e *resolveEnv) mintToken(t *testing.T, mutate func(*store.APIToken)) string {
	t.Helper()
	raw, prefix, err := GenerateAPIToken()
	if err != nil {
		t.Fatalf("GenerateAPIToken: %v", err)
	}
	tok := &store.APIToken{
		ID:        HashSessionID(raw),
		UserID:    e.userID,
		Name:      "test-token",
		Prefix:    prefix,
		CreatedAt: time.Now().Unix(),
	}
	if mutate != nil {
		mutate(tok)
	}
	if err := e.st.CreateAPIToken(t.Context(), tok); err != nil {
		t.Fatalf("CreateAPIToken: %v", err)
	}
	return raw
}

// capture wraps a terminal handler that records the context user and writes 200.
func capture(seen **User) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = UserFrom(r)
		w.WriteHeader(http.StatusOK)
	})
}

// TestSessionAuthBearerToken proves a valid PAT authenticates the request: the
// user lands in the context with AMR "token" and the token hash as
// SessionHashID.
func TestSessionAuthBearerToken(t *testing.T) {
	d := &Deps{}
	env := newResolveEnv(t, d)
	raw := env.mintToken(t, nil)

	var seen *User
	chain := d.SessionAuth(capture(&seen))

	r := httptest.NewRequest(http.MethodGet, "/api/v1/hosts", nil)
	r.Header.Set("Authorization", "Bearer "+raw)
	w := httptest.NewRecorder()
	chain.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d want 200", w.Code)
	}
	if seen == nil {
		t.Fatal("handler saw no user in context")
	}
	if seen.ID != env.userID {
		t.Errorf("user id = %q want %q", seen.ID, env.userID)
	}
	if seen.AMR != AMRToken {
		t.Errorf("AMR = %q want %q", seen.AMR, AMRToken)
	}
	if seen.SessionHashID != HashSessionID(raw) {
		t.Errorf("SessionHashID must be the token hash")
	}
}

// TestSessionAuthBearerRejects proves revoked, expired, and unknown tokens all
// yield 401 with no user in context (and no cookie fallback).
func TestSessionAuthBearerRejects(t *testing.T) {
	d := &Deps{}
	env := newResolveEnv(t, d)
	now := time.Now().Unix()

	revoked := env.mintToken(t, func(tok *store.APIToken) {
		v := now - 10
		tok.RevokedAt = &v
	})
	expired := env.mintToken(t, func(tok *store.APIToken) {
		v := now - 10
		tok.ExpiresAt = &v
	})

	cases := map[string]string{
		"revoked": revoked,
		"expired": expired,
		"unknown": APITokenPrefix + "deadbeef",
	}
	for name, raw := range cases {
		var seen *User
		chain := d.SessionAuth(capture(&seen))
		r := httptest.NewRequest(http.MethodGet, "/api/v1/hosts", nil)
		r.Header.Set("Authorization", "Bearer "+raw)
		w := httptest.NewRecorder()
		chain.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s token: status = %d want 401", name, w.Code)
		}
		if seen != nil {
			t.Errorf("%s token: handler must not run", name)
		}
	}

	// A non-expired future expiry still authenticates.
	future := env.mintToken(t, func(tok *store.APIToken) {
		v := now + 3600
		tok.ExpiresAt = &v
	})
	var seen *User
	chain := d.SessionAuth(capture(&seen))
	r := httptest.NewRequest(http.MethodGet, "/api/v1/hosts", nil)
	r.Header.Set("Authorization", "Bearer "+future)
	w := httptest.NewRecorder()
	chain.ServeHTTP(w, r)
	if w.Code != http.StatusOK || seen == nil {
		t.Errorf("future-expiry token: status = %d want 200", w.Code)
	}
}

// TestCSRFSkippedForBearer proves a Bearer-authenticated mutation passes CSRF
// with no Origin and no X-Castor-CSRF header, while a cookie session on the
// same chain is still rejected without them (the skip is Bearer-only).
func TestCSRFSkippedForBearer(t *testing.T) {
	d := &Deps{}
	env := newResolveEnv(t, d)
	raw := env.mintToken(t, nil)

	var seen *User
	chain := d.SessionAuth(d.CSRF(capture(&seen)))

	// Bearer POST: no cookie, no Origin, no CSRF header -> allowed.
	r := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/workloads/x/start", nil)
	r.Header.Set("Authorization", "Bearer "+raw)
	w := httptest.NewRecorder()
	chain.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("bearer mutation: status = %d want 200 (CSRF must not apply)", w.Code)
	}

	// Cookie session POST without CSRF header/Origin: still rejected.
	now := time.Now().Unix()
	rawSess := env.mintSession(t, now, now+3600)
	seen = nil
	r = httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/workloads/x/start", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: rawSess})
	w = httptest.NewRecorder()
	chain.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Errorf("cookie mutation without CSRF: status = %d want 403", w.Code)
	}
	if seen != nil {
		t.Error("cookie mutation without CSRF must not reach the handler")
	}
}

// TestRequireAALPassesForToken proves an AMR "token" request satisfies the
// step-up gate even when the instance requires TOTP for mutations and the
// user has TOTP enabled — while the same user's pwd-only session is denied.
func TestRequireAALPassesForToken(t *testing.T) {
	d := &Deps{}
	env := newResolveEnv(t, d)
	ctx := t.Context()

	// Enroll TOTP on the user and require TOTP for mutations instance-wide.
	if err := env.st.SetTOTPPending(ctx, env.userID, []byte("sealed")); err != nil {
		t.Fatalf("SetTOTPPending: %v", err)
	}
	if err := env.st.ConfirmTOTP(ctx, env.userID); err != nil {
		t.Fatalf("ConfirmTOTP: %v", err)
	}
	if err := env.st.SetSetting(ctx, store.SettingTOTPRequiredForMut, "true"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	raw := env.mintToken(t, nil)
	var seen *User
	chain := d.SessionAuth(d.RequireAAL(capture(&seen)))

	// Bearer mutation passes the AAL gate (machine-to-machine).
	r := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/prune", nil)
	r.Header.Set("Authorization", "Bearer "+raw)
	w := httptest.NewRecorder()
	chain.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("bearer mutation: status = %d want 200 (AAL must pass for AMR token)", w.Code)
	}

	// The same user's pwd-only session must still be forced to step up.
	now := time.Now().Unix()
	rawSess := env.mintSession(t, now, now+3600) // AMR pwd
	seen = nil
	r = httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/prune", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: rawSess})
	w = httptest.NewRecorder()
	chain.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Errorf("pwd session mutation: status = %d want 403 (step-up required)", w.Code)
	}
	if seen != nil {
		t.Error("pwd session mutation must not reach the handler")
	}
}

// TestBearerTouchThrottled proves last_used_at is written at most once per
// tokenTouchInterval: a recent stamp is left untouched, a stale one is updated.
func TestBearerTouchThrottled(t *testing.T) {
	d := &Deps{}
	env := newResolveEnv(t, d)
	now := time.Now().Unix()
	ctx := t.Context()

	resolve := func(raw string) {
		t.Helper()
		var seen *User
		chain := d.SessionAuth(capture(&seen))
		r := httptest.NewRequest(http.MethodGet, "/api/v1/hosts", nil)
		r.Header.Set("Authorization", "Bearer "+raw)
		w := httptest.NewRecorder()
		chain.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("resolve: status = %d want 200", w.Code)
		}
	}

	// Recent stamp (inside the window): must NOT be rewritten.
	recent := now - 10
	rawRecent := env.mintToken(t, func(tok *store.APIToken) { tok.LastUsedAt = &recent })
	resolve(rawRecent)
	tok, err := env.st.GetAPITokenByID(ctx, HashSessionID(rawRecent))
	if err != nil {
		t.Fatalf("GetAPITokenByID: %v", err)
	}
	if tok.LastUsedAt == nil || *tok.LastUsedAt != recent {
		t.Errorf("recent last_used_at rewritten: got %v want %d (throttle broken)", tok.LastUsedAt, recent)
	}

	// Stale stamp (outside the window): must be advanced to ~now.
	stale := now - 2*tokenTouchInterval
	rawStale := env.mintToken(t, func(tok *store.APIToken) { tok.LastUsedAt = &stale })
	resolve(rawStale)
	tok, err = env.st.GetAPITokenByID(ctx, HashSessionID(rawStale))
	if err != nil {
		t.Fatalf("GetAPITokenByID: %v", err)
	}
	if tok.LastUsedAt == nil || *tok.LastUsedAt == stale {
		t.Fatalf("stale last_used_at not updated: %v", tok.LastUsedAt)
	}
	assertNear(t, "touched last_used_at", *tok.LastUsedAt, now, nearSlack)

	// Never-used token: first use stamps it.
	rawFresh := env.mintToken(t, nil)
	resolve(rawFresh)
	tok, err = env.st.GetAPITokenByID(ctx, HashSessionID(rawFresh))
	if err != nil {
		t.Fatalf("GetAPITokenByID: %v", err)
	}
	if tok.LastUsedAt == nil {
		t.Fatal("first use must stamp last_used_at")
	}
	assertNear(t, "first-use last_used_at", *tok.LastUsedAt, now, nearSlack)
}
