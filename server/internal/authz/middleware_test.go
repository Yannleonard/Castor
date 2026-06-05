package authz

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/store"
)

// resolveEnv wires a Deps over a real (temp) store for exercising resolveUser's
// sliding-TTL touch without an HTTP stack or Docker daemon.
type resolveEnv struct {
	d      *Deps
	st     *store.Store
	userID string
}

func newResolveEnv(t *testing.T, d *Deps) *resolveEnv {
	t.Helper()
	st, err := store.Connect(&config.Config{DBPath: filepath.Join(t.TempDir(), "authz.db")})
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ctx := t.Context()
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if err := st.Seed(ctx); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	uid := store.NewUUID()
	if err := st.CreateUser(ctx, &store.User{ID: uid, Username: "u", IsActive: true}); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	d.Store = st
	return &resolveEnv{d: d, st: st, userID: uid}
}

// mintSession inserts a session row with explicit created/expires timestamps and
// returns the raw (unhashed) session id to place in the request cookie.
func (e *resolveEnv) mintSession(t *testing.T, createdAt, expiresAt int64) string {
	t.Helper()
	raw, err := RandomToken(SessionIDBytes)
	if err != nil {
		t.Fatalf("RandomToken: %v", err)
	}
	sess := &store.Session{
		ID:         HashSessionID(raw),
		UserID:     e.userID,
		CSRFToken:  "csrf",
		AMR:        AMRPassword,
		CreatedAt:  createdAt,
		LastSeenAt: createdAt,
		ExpiresAt:  expiresAt,
	}
	if err := e.st.CreateSession(t.Context(), sess); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return raw
}

// resolveExpiry runs resolveUser for the given raw session id and returns the
// session's expires_at as persisted afterwards (i.e. the result of the touch).
func (e *resolveEnv) resolveExpiry(t *testing.T, rawID string) int64 {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: rawID})
	if _, apiErr := e.d.resolveUser(r); apiErr != nil {
		t.Fatalf("resolveUser unexpected error: %v", apiErr)
	}
	sess, err := e.st.GetSession(t.Context(), HashSessionID(rawID))
	if err != nil {
		t.Fatalf("GetSession after resolve: %v", err)
	}
	return sess.ExpiresAt
}

// assertNear fails if got is not within slack seconds of want. The sliding touch
// is computed from time.Now().Unix() inside resolveUser, so allow a small window
// for clock granularity and test execution time.
func assertNear(t *testing.T, label string, got, want, slack int64) {
	t.Helper()
	if d := got - want; d < -slack || d > slack {
		t.Errorf("%s: expires_at = %d, want ~%d (±%ds), off by %ds", label, got, want, slack, d)
	}
}

const nearSlack = 5 // seconds

// TestResolveUserUsesConfiguredSlidingTTL proves the env-derived SessionTTL (not
// the old hardcoded 12h) drives the sliding extension.
func TestResolveUserUsesConfiguredSlidingTTL(t *testing.T) {
	e := newResolveEnv(t, &Deps{SessionTTL: 2 * time.Hour, SessionAbsoluteTTL: 24 * time.Hour})
	now := time.Now().Unix()
	// Fresh session expiring soon, so the slide applies. Created now.
	raw := e.mintSession(t, now, now+60)

	got := e.resolveExpiry(t, raw)
	assertNear(t, "configured 2h sliding TTL", got, now+int64((2*time.Hour).Seconds()), nearSlack)

	// Regression guard: it must NOT be the old hardcoded 12h literal.
	if hardcoded := now + int64((12*time.Hour).Seconds()); got >= hardcoded-nearSlack {
		t.Errorf("expires_at = %d looks like the old hardcoded 12h (%d); sliding TTL is being ignored", got, hardcoded)
	}
}

// TestResolveUserPersistedSettingOverridesEnv proves the persisted
// session.ttl_seconds setting takes precedence over the env-derived SessionTTL.
func TestResolveUserPersistedSettingOverridesEnv(t *testing.T) {
	e := newResolveEnv(t, &Deps{SessionTTL: 12 * time.Hour, SessionAbsoluteTTL: 24 * time.Hour})
	// Operator sets a 30-minute sliding window via the Settings UI.
	if err := e.st.SetSetting(t.Context(), store.SettingSessionTTLSeconds, "1800"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	now := time.Now().Unix()
	raw := e.mintSession(t, now, now+60)

	got := e.resolveExpiry(t, raw)
	assertNear(t, "persisted 30m sliding TTL", got, now+1800, nearSlack)

	// It must be the persisted 30m, not the env-derived 12h.
	if env12h := now + int64((12*time.Hour).Seconds()); got >= env12h-nearSlack {
		t.Errorf("expires_at = %d follows env 12h (%d); persisted setting did not override", got, env12h)
	}
}

// TestResolveUserAbsoluteCapBoundsSlide proves the absolute cap (created_at +
// SessionAbsoluteTTL) bounds the slide even when the sliding window is larger.
func TestResolveUserAbsoluteCapBoundsSlide(t *testing.T) {
	e := newResolveEnv(t, &Deps{SessionTTL: 12 * time.Hour, SessionAbsoluteTTL: 24 * time.Hour})
	now := time.Now().Unix()
	// Session created 23h50m ago: only 10m of absolute lifetime remains, so a 12h
	// slide must be clamped down to created_at + 24h (~now + 10m).
	created := now - int64((23*time.Hour + 50*time.Minute).Seconds())
	raw := e.mintSession(t, created, now+60)

	got := e.resolveExpiry(t, raw)
	wantCap := created + int64((24 * time.Hour).Seconds())
	assertNear(t, "absolute cap", got, wantCap, nearSlack)

	if slide := now + int64((12*time.Hour).Seconds()); got >= slide-nearSlack {
		t.Errorf("expires_at = %d exceeded the absolute cap (%d); slide was not bounded", got, wantCap)
	}
}

// TestResolveUserAbsoluteCapNotWeakenedBySliding proves that a persisted sliding
// TTL larger than the absolute cap does not push expiry past the hard cap — the
// cap is never weakened below the sliding TTL (the sliding window is clamped to
// the cap instead).
func TestResolveUserAbsoluteCapNotWeakenedBySliding(t *testing.T) {
	e := newResolveEnv(t, &Deps{SessionTTL: 12 * time.Hour, SessionAbsoluteTTL: 24 * time.Hour})
	// A 7-day sliding window — far beyond the 24h absolute cap.
	if err := e.st.SetSetting(t.Context(), store.SettingSessionTTLSeconds, "604800"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	now := time.Now().Unix()
	created := now // fresh session
	raw := e.mintSession(t, created, now+60)

	got := e.resolveExpiry(t, raw)
	// Effective sliding clamps to 24h; on a fresh session that equals the cap.
	wantCap := created + int64((24 * time.Hour).Seconds())
	assertNear(t, "sliding clamped to absolute cap", got, wantCap, nearSlack)
	if got > wantCap+nearSlack {
		t.Errorf("expires_at = %d exceeded the absolute cap (%d)", got, wantCap)
	}
}

// TestSlidingTTLClampsBelowFloor proves a sub-floor persisted value is raised to
// the 300s minimum rather than collapsing the session window.
func TestSlidingTTLClampsBelowFloor(t *testing.T) {
	e := newResolveEnv(t, &Deps{SessionTTL: 12 * time.Hour, SessionAbsoluteTTL: 24 * time.Hour})
	// A hostile/stale tiny value that bypassed the write-path clamp.
	if err := e.st.SetSetting(t.Context(), store.SettingSessionTTLSeconds, "1"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	got := e.d.slidingTTL(t.Context())
	if got != minSessionTTL {
		t.Errorf("slidingTTL = %v, want floor %v", got, minSessionTTL)
	}
}
