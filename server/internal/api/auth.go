package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/version"
)

// Login throttling parameters.
const (
	loginFailThreshold = 5
	loginLockDuration  = 15 * time.Minute
	recoveryCodeCount  = 10
)

// --- request/response bodies ---

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type bootstrapRequest struct {
	Username       string `json:"username"`
	Password       string `json:"password"`
	Email          string `json:"email"`
	BootstrapToken string `json:"bootstrapToken"`
}

type totpVerifyRequest struct {
	Code string `json:"code"`
}

type totpConfirmRequest struct {
	Code string `json:"code"`
}

type totpDisableRequest struct {
	Password string `json:"password"`
}

type passwordChangeRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type userView struct {
	ID                 string `json:"id"`
	Username           string `json:"username"`
	Email              string `json:"email"`
	IsActive           bool   `json:"isActive"`
	MustChangePassword bool   `json:"mustChangePassword"`
	TOTPEnabled        bool   `json:"totpEnabled"`
}

func toUserView(u *store.User) userView {
	return userView{
		ID:                 u.ID,
		Username:           u.Username,
		Email:              u.Email,
		IsActive:           u.IsActive,
		MustChangePassword: u.MustChangePW,
		TOTPEnabled:        u.TOTPEnabled,
	}
}

// --- healthz / bootstrap status ---

// Healthz reports liveness and whether bootstrap is still required.
func (s *Server) Healthz(w http.ResponseWriter, r *http.Request) {
	completed, _ := s.store.BootstrapCompleted(r.Context())
	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"version":   version.Version,
		"bootstrap": !completed,
	})
}

// BootstrapStatus lets the UI route to /bootstrap when required.
func (s *Server) BootstrapStatus(w http.ResponseWriter, r *http.Request) {
	completed, err := s.store.BootstrapCompleted(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.WriteJSON(w, http.StatusOK, map[string]any{"required": !completed})
}

// bootstrapRequired reports whether the instance is still in bootstrap mode
// (bootstrap.completed != true AND no users).
func (s *Server) bootstrapRequired(ctx context.Context) bool {
	completed, err := s.store.BootstrapCompleted(ctx)
	if err != nil {
		return false
	}
	if completed {
		return false
	}
	n, err := s.store.CountUsers(ctx)
	if err != nil {
		return false
	}
	return n == 0
}

// Bootstrap creates the first admin user and flips bootstrap.completed in one
// transaction. Single-shot and race-guarded.
func (s *Server) Bootstrap(w http.ResponseWriter, r *http.Request) {
	if !s.bootstrapRequired(r.Context()) {
		authz.WriteError(w, r, authz.ErrBootstrapRequired)
		return
	}
	var req bootstrapRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if s.cfg.BootstrapToken != "" && !authz.ConstantTimeEqualString(req.BootstrapToken, s.cfg.BootstrapToken) {
		authz.WriteError(w, r, authz.ErrForbidden)
		return
	}
	if err := validateUsername(req.Username); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := validatePassword(req.Password); err != nil {
		authz.WriteError(w, r, err)
		return
	}

	hash, err := authz.HashPassword(req.Password)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	u, err := s.store.BootstrapFirstAdmin(r.Context(), store.NewUUID(), req.Username, req.Email, hash, store.NewUUID())
	if err != nil {
		if errors.Is(err, store.ErrBootstrapAlreadyDone) {
			authz.WriteError(w, r, authz.ErrBootstrapRequired)
			return
		}
		writeMapped(w, r, err)
		return
	}

	authz.WriteJSON(w, http.StatusCreated, map[string]any{
		"user":              toUserView(u),
		"totpEnrollOffered": true,
	})
}

// Login verifies credentials with constant-time compare + lockout. On success
// it mints a fresh session (no fixation) and returns the CSRF token + the
// effective permission set, or signals that a TOTP step is required.
func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()

	u, err := s.store.GetUserByUsername(ctx, req.Username)
	if err != nil {
		// Run a dummy hash to equalize timing and avoid user enumeration.
		_, _ = authz.VerifyPassword(req.Password, dummyHash)
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}

	now := time.Now().Unix()
	if u.LockedUntil != nil && *u.LockedUntil > now {
		authz.WriteError(w, r, authz.ErrAccountLocked)
		return
	}
	if !u.IsActive {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}

	matched, verr := authz.VerifyPassword(req.Password, u.PasswordHash)
	if verr != nil || !matched {
		_, _ = s.store.RecordLoginFailure(ctx, u.ID, loginFailThreshold, loginLockDuration)
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	_ = s.store.RecordLoginSuccess(ctx, u.ID)

	rawID, csrf, sess, err := s.mintSession(ctx, r, u.ID, authz.AMRPassword)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	s.setAuthCookies(w, r, rawID, csrf)

	if u.TOTPEnabled {
		authz.WriteJSON(w, http.StatusOK, map[string]any{
			"requiresTotp": true,
			"amr":          authz.AMRPassword,
			"csrfToken":    sess.CSRFToken,
		})
		return
	}

	perms, _ := s.effectivePermissions(ctx, u.ID)
	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"user":         toUserView(u),
		"amr":          authz.AMRPassword,
		"csrfToken":    sess.CSRFToken,
		"permissions":  perms,
		"requiresTotp": false,
	})
}

// Logout revokes the current session and clears the cookies.
func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u != nil {
		_ = s.store.RevokeSession(r.Context(), u.SessionHashID)
	}
	authz.ClearSessionCookies(w, authz.IsHTTPS(r, s.cfg.TrustProxy))
	noContent(w)
}

// Me returns the authenticated user's profile, AMR, CSRF token, permissions and
// role bindings.
func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	sess, err := s.store.GetSession(r.Context(), u.SessionHashID)
	if err != nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	roleViews := make([]map[string]any, 0, len(u.Roles()))
	for _, ro := range u.Roles() {
		roleViews = append(roleViews, map[string]any{
			"name":      ro.RoleName,
			"scopeType": ro.ScopeType,
			"scopeId":   ro.ScopeID,
		})
	}
	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"user":        toUserView(&u.User),
		"amr":         u.AMR,
		"csrfToken":   sess.CSRFToken,
		"permissions": u.AllPermissions(),
		"roles":       roleViews,
	})
}

// TOTPVerify validates a TOTP or recovery code, upgrading the session AMR to
// pwd+totp on success.
func (s *Server) TOTPVerify(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	var req totpVerifyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if !u.TOTPEnabled || len(u.TOTPSecretEnc) == 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "TOTP is not enabled for this account."))
		return
	}
	ctx := r.Context()

	if !s.verifyTOTPOrRecovery(ctx, u, req.Code) {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	if err := s.store.UpgradeSessionAMR(ctx, u.SessionHashID, authz.AMRPasswordTOTP); err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	sess, _ := s.store.GetSession(ctx, u.SessionHashID)
	csrf := ""
	if sess != nil {
		csrf = sess.CSRFToken
	}
	perms, _ := s.effectivePermissions(ctx, u.ID)
	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"user":        toUserView(&u.User),
		"amr":         authz.AMRPasswordTOTP,
		"csrfToken":   csrf,
		"permissions": perms,
	})
}

// verifyTOTPOrRecovery checks a code against the user's TOTP secret, then
// against unused recovery codes (consuming one on match).
func (s *Server) verifyTOTPOrRecovery(ctx context.Context, u *authz.User, code string) bool {
	code = strings.TrimSpace(code)
	if code == "" {
		return false
	}
	secret, err := authz.OpenSecret(s.cfg.SecretKey, u.TOTPSecretEnc)
	if err == nil && authz.ValidateTOTP(code, string(secret)) {
		return true
	}
	// Try recovery codes (constant-time-ish; consume on match).
	codes, err := s.store.ListUnusedRecoveryCodes(ctx, u.ID)
	if err != nil {
		return false
	}
	for _, rc := range codes {
		if ok, _ := authz.VerifyPassword(code, rc.CodeHash); ok {
			if cerr := s.store.ConsumeRecoveryCode(ctx, rc.ID); cerr == nil {
				return true
			}
		}
	}
	return false
}

// TOTPEnroll starts TOTP enrollment for the authenticated user, returning the
// secret + provisioning URL + QR. The secret is stored AES-GCM-encrypted as
// pending until confirmed.
func (s *Server) TOTPEnroll(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	enroll, err := authz.GenerateTOTP(u.Username)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	enc, err := authz.SealSecret(s.cfg.SecretKey, []byte(enroll.Secret))
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	if err := s.store.SetTOTPPending(r.Context(), u.ID, enc); err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"secret":      enroll.Secret,
		"otpauthUrl":  enroll.OTPAuthURL,
		"qrPngBase64": enroll.QRPNGBase64,
	})
}

// TOTPConfirm confirms enrollment with a valid code, enabling TOTP and returning
// 10 one-time recovery codes (shown once).
func (s *Server) TOTPConfirm(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	var req totpConfirmRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()

	// Reload the user to pick up the pending secret stored by enroll.
	fresh, err := s.store.GetUserByID(ctx, u.ID)
	if err != nil || len(fresh.TOTPSecretEnc) == 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "No pending TOTP enrollment. Start enrollment first."))
		return
	}
	secret, err := authz.OpenSecret(s.cfg.SecretKey, fresh.TOTPSecretEnc)
	if err != nil || !authz.ValidateTOTP(strings.TrimSpace(req.Code), string(secret)) {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	if err := s.store.ConfirmTOTP(ctx, u.ID); err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	plain, hashes, err := authz.GenerateRecoveryCodes(recoveryCodeCount)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	ids := make([]string, len(hashes))
	for i := range ids {
		ids[i] = store.NewUUID()
	}
	if err := s.store.ReplaceRecoveryCodes(ctx, u.ID, ids, hashes); err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	// Upgrade the current session so the just-enrolled user is immediately AAL2.
	_ = s.store.UpgradeSessionAMR(ctx, u.SessionHashID, authz.AMRPasswordTOTP)

	authz.WriteJSON(w, http.StatusOK, map[string]any{"recoveryCodes": plain})
}

// TOTPDisable disables TOTP after re-checking the password (requires AAL2 via
// the middleware chain). Clears secret + recovery codes.
func (s *Server) TOTPDisable(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	var req totpDisableRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	matched, _ := authz.VerifyPassword(req.Password, u.PasswordHash)
	if !matched {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	ctx := r.Context()
	if err := s.store.DisableTOTP(ctx, u.ID); err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	_ = s.store.ReplaceRecoveryCodes(ctx, u.ID, nil, nil)
	_ = s.store.UpgradeSessionAMR(ctx, u.SessionHashID, authz.AMRPassword)
	noContent(w)
}

// PasswordChange rehashes the password and revokes all OTHER sessions.
func (s *Server) PasswordChange(w http.ResponseWriter, r *http.Request) {
	u := authz.UserFrom(r)
	if u == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	var req passwordChangeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	matched, _ := authz.VerifyPassword(req.CurrentPassword, u.PasswordHash)
	if !matched {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	if err := validatePassword(req.NewPassword); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	hash, err := authz.HashPassword(req.NewPassword)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	ctx := r.Context()
	if err := s.store.SetPasswordHash(ctx, u.ID, hash); err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	_ = s.store.RevokeOtherUserSessions(ctx, u.ID, u.SessionHashID)
	noContent(w)
}

// --- session helpers ---

// mintSession creates a fresh session and returns the raw id, csrf token and
// the stored session row.
func (s *Server) mintSession(ctx context.Context, r *http.Request, userID, amr string) (rawID, csrf string, sess *store.Session, err error) {
	rawID, err = authz.RandomToken(authz.SessionIDBytes)
	if err != nil {
		return "", "", nil, err
	}
	csrf, err = authz.RandomToken(authz.CSRFTokenBytes)
	if err != nil {
		return "", "", nil, err
	}
	now := time.Now().Unix()
	sess = &store.Session{
		ID:         authz.HashSessionID(rawID),
		UserID:     userID,
		CSRFToken:  csrf,
		UserAgent:  r.UserAgent(),
		IP:         r.RemoteAddr,
		AMR:        amr,
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  now + int64(s.cfg.SessionTTL.Seconds()),
	}
	if err = s.store.CreateSession(ctx, sess); err != nil {
		return "", "", nil, err
	}
	return rawID, csrf, sess, nil
}

func (s *Server) setAuthCookies(w http.ResponseWriter, r *http.Request, rawID, csrf string) {
	secure := authz.IsHTTPS(r, s.cfg.TrustProxy)
	authz.SetSessionCookie(w, rawID, secure, s.cfg.SessionAbsoluteTTL)
	authz.SetCSRFCookie(w, csrf, secure, s.cfg.SessionAbsoluteTTL)
}

func (s *Server) effectivePermissions(ctx context.Context, userID string) ([]string, error) {
	roles, err := s.store.EffectiveRolesForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	var out []string
	for _, ro := range roles {
		for _, p := range ro.Permissions {
			if _, ok := seen[p]; !ok {
				seen[p] = struct{}{}
				out = append(out, p)
			}
		}
	}
	if out == nil {
		out = []string{}
	}
	return out, nil
}

// dummyHash is a precomputed argon2id hash used to equalize login timing for
// unknown usernames (anti-enumeration). Its plaintext is irrelevant.
const dummyHash = "$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$Wm9sYW5kb3JmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmM"
