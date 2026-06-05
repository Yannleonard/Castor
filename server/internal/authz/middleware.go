package authz

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/store"
)

// statusRecorder captures the response status so AuditWrap can infer outcome.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.written {
		s.status = code
		s.written = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.written {
		s.status = http.StatusOK
		s.written = true
	}
	return s.ResponseWriter.Write(b)
}

// Flush implements http.Flusher when the underlying writer supports it (for
// streaming endpoints and WebSocket upgrades to work cleanly).
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// RequestID assigns a per-request id (honoring an inbound X-Request-Id when
// present) and exposes it via context and the response header.
func (d *Deps) RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" {
			id, _ = RandomToken(12)
		}
		ctx := WithRequestID(r.Context(), id)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RealIP resolves the client IP, honoring X-Forwarded-For / X-Real-IP only when
// TrustProxy is enabled. The result is stashed for SessionAuth/audit.
func (d *Deps) RealIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := directIP(r)
		if d.TrustProxy {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				ip = strings.TrimSpace(strings.Split(xff, ",")[0])
			} else if xrip := r.Header.Get("X-Real-Ip"); xrip != "" {
				ip = strings.TrimSpace(xrip)
			}
		}
		r.RemoteAddr = ip
		next.ServeHTTP(w, r)
	})
}

func directIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Recoverer turns a panic into a 500 envelope, logging the stack to stderr.
func (d *Deps) Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				debug.PrintStack()
				_ = rec
				WriteError(w, r, ErrInternal)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// SecurityHeaders sets a conservative security header set and no-store on /api.
func (d *Deps) SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		// CSP: app is self-hosted SPA; allow inline styles (Vite) and data: imgs
		// (QR codes), websockets to self. frame-ancestors none mirrors X-Frame.
		h.Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "+
				"connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if IsHTTPS(r, d.TrustProxy) {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// SessionAuth resolves the session cookie -> hash -> session row -> user, builds
// the effective-permission set, and stashes the *User in context. On any
// failure it responds 401 (no enumeration). Bootstrap-mode is handled upstream.
func (d *Deps) SessionAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, apiErr := d.resolveUser(r)
		if apiErr != nil {
			WriteError(w, r, apiErr)
			return
		}
		next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), u)))
	})
}

// resolveUser performs the cookie->user resolution and sliding-TTL touch.
func (d *Deps) resolveUser(r *http.Request) (*User, *APIError) {
	c, err := r.Cookie(SessionCookieName)
	if err != nil || c.Value == "" {
		return nil, ErrUnauthenticated
	}
	ctx := r.Context()
	hashID := HashSessionID(c.Value)
	sess, err := d.Store.GetSession(ctx, hashID)
	if err != nil {
		return nil, ErrUnauthenticated
	}
	now := time.Now().Unix()
	if sess.RevokedAt != nil || sess.ExpiresAt < now {
		return nil, ErrUnauthenticated
	}
	su, err := d.Store.GetUserByID(ctx, sess.UserID)
	if err != nil || !su.IsActive {
		return nil, ErrUnauthenticated
	}
	roles, err := d.Store.EffectiveRolesForUser(ctx, su.ID)
	if err != nil {
		return nil, ErrInternal
	}

	// Sliding TTL: extend expiry by the configured sliding window, capped by the
	// configured absolute cap (created_at + absolute). Both come from config /
	// the persisted setting — see slidingTTL/absoluteTTL — so the Settings UI and
	// CASTOR_SESSION_* env vars actually govern when a session expires.
	sliding := d.slidingTTL(ctx)
	newExpiry := now + int64(sliding.Seconds())
	if cap := sess.CreatedAt + int64(d.absoluteTTL().Seconds()); newExpiry > cap {
		newExpiry = cap
	}
	if newExpiry > sess.ExpiresAt {
		_ = d.Store.TouchSession(ctx, hashID, newExpiry)
	}

	return buildUser(su, hashID, sess.AMR, roles), nil
}

// Session-TTL bounds shared by the resolver and the settings write path.
const (
	// minSessionTTL is the floor for the sliding window (also enforced on write
	// in settings.go). A window below this is treated as a misconfiguration.
	minSessionTTL = 300 * time.Second
	// defaultSessionTTL / defaultAbsoluteTTL mirror config.Load's defaults and act
	// as a safety net when Deps is constructed without the durations wired (e.g.
	// some tests) so a zero value never collapses sessions to instant expiry.
	defaultSessionTTL  = 12 * time.Hour
	defaultAbsoluteTTL = 24 * time.Hour
)

// absoluteTTL is the hard cap on a session's total lifetime. It falls back to
// the default when Deps was constructed without it.
func (d *Deps) absoluteTTL() time.Duration {
	if d.SessionAbsoluteTTL > 0 {
		return d.SessionAbsoluteTTL
	}
	return defaultAbsoluteTTL
}

// slidingTTL resolves the effective sliding session lifetime. The persisted
// session.ttl_seconds setting is authoritative (the Settings UI presents it as
// such); it falls back to the env-derived Deps.SessionTTL, then the built-in
// default. The result is clamped to [minSessionTTL, absolute cap] so a stale or
// hostile setting can neither collapse sessions nor exceed the hard cap (which
// keeps the absolute cap from ever being weakened below the sliding TTL).
func (d *Deps) slidingTTL(ctx context.Context) time.Duration {
	ttl := d.SessionTTL
	if ttl <= 0 {
		ttl = defaultSessionTTL
	}
	// Persisted setting overrides the env-derived value when present and valid.
	if d.Store != nil {
		if secs, err := strconv.Atoi(d.Store.GetSettingDefault(ctx, store.SettingSessionTTLSeconds, "")); err == nil && secs > 0 {
			ttl = time.Duration(secs) * time.Second
		}
	}
	if ttl < minSessionTTL {
		ttl = minSessionTTL
	}
	// Never let the sliding window exceed the absolute cap — a window longer than
	// the hard lifetime is meaningless, and clamping here guarantees the cap stays
	// >= the sliding TTL.
	if cap := d.absoluteTTL(); ttl > cap {
		ttl = cap
	}
	return ttl
}

// isMutating reports whether the HTTP method mutates state.
func isMutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// CSRF enforces, on mutating methods, a matching X-Castor-CSRF header and an
// allowed Origin/Referer. Safe methods pass through.
func (d *Deps) CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isMutating(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		if !d.originAllowed(r) {
			WriteError(w, r, Errorf(ErrCSRFFailed, "Origin not allowed."))
			return
		}
		u := UserFrom(r)
		if u == nil {
			WriteError(w, r, ErrUnauthenticated)
			return
		}
		sess, err := d.Store.GetSession(r.Context(), u.SessionHashID)
		if err != nil {
			WriteError(w, r, ErrUnauthenticated)
			return
		}
		header := r.Header.Get(CSRFHeaderName)
		if header == "" || !ConstantTimeEqualString(header, sess.CSRFToken) {
			WriteError(w, r, ErrCSRFFailed)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// originAllowed validates Origin (preferred) or Referer against the allowlist.
// With no configured allowlist, same-origin (Origin host == request Host) is
// required. A missing Origin AND Referer on a mutation is rejected.
func (d *Deps) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Fall back to Referer's origin.
		if ref := r.Header.Get("Referer"); ref != "" {
			if u, err := url.Parse(ref); err == nil {
				origin = u.Scheme + "://" + u.Host
			}
		}
	}
	if origin == "" {
		return false
	}
	if len(d.AllowedOrigins) > 0 {
		for _, a := range d.AllowedOrigins {
			if strings.EqualFold(strings.TrimRight(a, "/"), strings.TrimRight(origin, "/")) {
				return true
			}
		}
		return false
	}
	// Same-origin: compare host part of Origin to the request Host.
	ou, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(ou.Host, r.Host)
}

// CheckOrigin is exported for the WebSocket upgrade handler, which must run the
// same Origin allowlist before websocket.Accept.
func (d *Deps) CheckOrigin(r *http.Request) bool { return d.originAllowed(r) }

// RequireAAL enforces step-up auth on mutating routes: if the user has TOTP
// enabled and the instance requires TOTP for mutations, the session AMR must be
// pwd+totp. Non-mutating methods pass through.
func (d *Deps) RequireAAL(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isMutating(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		u := UserFrom(r)
		if u == nil {
			WriteError(w, r, ErrUnauthenticated)
			return
		}
		required := d.totpRequiredForMutations(r.Context())
		if u.TOTPEnabled && required && u.AMR != AMRPasswordTOTP {
			WriteError(w, r, ErrAALRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (d *Deps) totpRequiredForMutations(ctx context.Context) bool {
	return d.Store.GetSettingDefault(ctx, store.SettingTOTPRequiredForMut, "false") == "true"
}

// StepUpRequired reports whether u must perform TOTP step-up before a mutating /
// privileged action but has NOT (same predicate RequireAAL enforces for REST
// mutations). It is exported so non-HTTP-middleware entry points that open a
// privileged action — notably the exec WebSocket, which spawns a root-capable
// shell — gate on the identical rule instead of silently bypassing step-up.
// A nil user is treated as requiring step-up (fail closed).
func (d *Deps) StepUpRequired(ctx context.Context, u *User) bool {
	if u == nil {
		return true
	}
	return u.TOTPEnabled && d.totpRequiredForMutations(ctx) && u.AMR != AMRPasswordTOTP
}

// AuditWrap attaches a fresh audit record, runs the handler, then persists one
// append-only audit row for the mutating outcome (success/denied/error). It is
// the LAST middleware before the handler so it sees the final status. Apply it
// only to mutating route groups.
func (d *Deps) AuditWrap(action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, rec := withAudit(r.Context())
			rec.Action = action
			r = r.WithContext(ctx)

			sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sr, r)

			d.persistAudit(r, rec, sr.status)
		})
	}
}

func (d *Deps) persistAudit(r *http.Request, rec *auditRecord, status int) {
	rec.mu.Lock()
	defer rec.mu.Unlock()

	result := rec.Result
	if !rec.resultSet {
		switch {
		case status >= 200 && status < 300:
			result = "success"
		case status == http.StatusForbidden || status == http.StatusUnauthorized:
			result = "denied"
		default:
			result = "error"
		}
	}

	actorID, actorName := "", "anonymous"
	if u := UserFrom(r); u != nil {
		actorID = u.ID
		actorName = u.Username
	}

	detail := ""
	if len(rec.Detail) > 0 {
		if b, err := json.Marshal(RedactMap(rec.Detail)); err == nil {
			detail = string(b)
		}
	}

	_ = d.Store.InsertAudit(r.Context(), store.AuditInput{
		TS:         time.Now().Unix(),
		ActorID:    actorID,
		ActorName:  actorName,
		ActorIP:    r.RemoteAddr,
		Action:     rec.Action,
		TargetType: rec.TargetType,
		TargetID:   rec.TargetID,
		TargetName: rec.TargetName,
		ScopeType:  rec.ScopeType,
		ScopeID:    rec.ScopeID,
		Result:     result,
		HTTPStatus: status,
		Detail:     detail,
		RequestID:  RequestIDFromContext(r.Context()),
	})
}

// MapStoreError translates store-layer errors into API errors for handlers.
func MapStoreError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, store.ErrNotFound) {
		return ErrNotFound
	}
	return ErrInternal
}
