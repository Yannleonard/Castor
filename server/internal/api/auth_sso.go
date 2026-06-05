package api

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/auth/ldap"
	"github.com/gtek-it/castor/server/internal/auth/oidc"
	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// auth_sso.go holds the PUBLIC (pre-auth) SSO surface: enumerating enabled
// providers for the login screen, the OIDC Authorization-Code+PKCE redirect
// start/callback, and the LDAP credential login. JIT provisioning, group->role
// resync, session minting and cookie issuance are shared by both the OIDC and
// LDAP paths via finishExternalLogin.
//
// ───────────────────────── STORE CONTRACT (Task A) ─────────────────────────
// These handlers call the following store surface, OWNED by Task A
// (authproviders.go) and the extended users.go. Task B does NOT define them:
//
//   type store.AuthProvider struct { /* one field per 0003 column */
//       ID, Name, Kind string; Enabled bool; DefaultRoleID string
//       LDAPHost string; LDAPPort int; LDAPTLS string; LDAPSkipVerify bool
//       LDAPBindDN string; LDAPBindPWEnc []byte; LDAPBaseDN, LDAPUserFilter string
//       LDAPAttrUsername, LDAPAttrEmail, LDAPAttrDisplay string
//       LDAPGroupBaseDN, LDAPGroupFilter, LDAPAttrMember string
//       OIDCIssuer, OIDCClientID string; OIDCClientSecretEnc []byte
//       OIDCRedirectURL, OIDCScopes, OIDCGroupsClaim, OIDCUsernameClaim, OIDCEmailClaim string
//       CreatedAt, UpdatedAt int64
//   }
//   func (*store.AuthProvider) HasBindPW() bool
//   func (*store.AuthProvider) HasClientSecret() bool
//   store.ListEnabledAuthProviders(ctx) ([]*store.AuthProvider, error)
//   store.GetAuthProvider(ctx, id) (*store.AuthProvider, error)
//   store.UpsertExternalUser(ctx, *store.User) (*store.User, error)   // by (auth_source, external_id)
//   store.ResolveRolesForGroups(ctx, providerID string, groups []string) ([]string, error) // -> role ids
//
// store.User MUST carry (Task A migration 0003 fields):
//   AuthSource string (local|ldap|oidc); ExternalID string; ExternalProviderID string
//
// OIDC-state persistence + the external-binding rebind helper are owned by
// Task B (store/sso_states.go): CreateOIDCAuthState, ConsumeOIDCAuthState,
// DeleteExpiredOIDCAuthStates, ReplaceExternalRoleBindings.
// ────────────────────────────────────────────────────────────────────────────

// oidcStateTTL bounds how long an in-flight OIDC redirect may take.
const oidcStateTTL = 10 * time.Minute

// providerSummary is the MINIMAL, secret-free projection returned to the
// (unauthenticated) login screen so it can render "Sign in with <name>" or an
// LDAP form. It never exposes any configuration detail.
type providerSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"` // "ldap" | "oidc"
}

// AuthProviders lists the ENABLED external identity providers (public). Used by
// the login page; returns an empty array when none are configured.
func (s *Server) AuthProviders(w http.ResponseWriter, r *http.Request) {
	provs, err := s.store.ListEnabledAuthProviders(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]providerSummary, 0, len(provs))
	for _, p := range provs {
		out = append(out, providerSummary{ID: p.ID, Name: p.Name, Kind: p.Kind})
	}
	ok(w, out)
}

// --- OIDC (Entra ID) ---

// OIDCStart begins the Authorization-Code+PKCE flow (public). It discovers the
// provider, persists a single-use state row (state + nonce + PKCE verifier) and
// 302-redirects the browser to the IdP authorize endpoint.
func (s *Server) OIDCStart(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	prov, err := s.enabledProviderOfKind(ctx, r.URL.Query().Get("provider"), "oidc")
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}

	params, perr := s.oidcParams(prov, r)
	if perr != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	provider, _, err := oidc.NewVerifier(ctx, params.Issuer, params.ClientID)
	if err != nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrInternal, "Identity provider is unreachable."))
		return
	}

	state, err := oidc.NewState()
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	nonce, err := oidc.NewNonce()
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	pkce, err := oidc.NewPKCE()
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	now := time.Now().Unix()
	if err := s.store.CreateOIDCAuthState(ctx, &store.OIDCAuthState{
		State:         state,
		ProviderID:    prov.ID,
		Nonce:         nonce,
		PKCEVerifier:  pkce.Verifier,
		RedirectAfter: sanitizeRedirect(r.URL.Query().Get("redirect")),
		CreatedAt:     now,
		ExpiresAt:     now + int64(oidcStateTTL.Seconds()),
	}); err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	// Pin the audit result: this handler is AuditWrapped (auth.oidc.start) and
	// ends in a 302 to the IdP, which AuditWrap would otherwise infer as "error".
	authz.SetAuditTarget(r, "auth_provider", prov.ID, prov.Name)
	authz.AddAuditDetail(r, "authSource", "oidc")
	authz.SetAuditResult(r, "success")

	authURL := oidc.AuthCodeURL(params, provider, state, nonce, pkce.Challenge)
	http.Redirect(w, r, authURL, http.StatusFound)
}

// OIDCCallback completes the flow (public): it consumes the state, exchanges the
// code (PKCE), verifies the id_token (issuer/aud/exp/nonce), JIT-provisions the
// Castor user, resyncs roles, mints a session and 302-redirects to the SPA.
//
// On any failure it redirects to the SPA login with ?sso_error=… rather than
// rendering a bare JSON error, because the user agent is a top-level browser
// navigation (not an XHR).
func (s *Server) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	// Surface IdP-side errors (user denied consent, etc.).
	if e := q.Get("error"); e != "" {
		s.ssoRedirectError(w, r, "/", e)
		return
	}
	code := q.Get("code")
	stateParam := q.Get("state")
	if code == "" || stateParam == "" {
		s.ssoRedirectError(w, r, "/", "invalid_request")
		return
	}

	st, err := s.store.ConsumeOIDCAuthState(ctx, stateParam)
	if err != nil {
		// Unknown/expired/replayed state.
		s.ssoLoginDenied(r, "oidc", "", "invalid_state")
		s.ssoRedirectError(w, r, "/", "invalid_state")
		return
	}

	prov, err := s.store.GetAuthProvider(ctx, st.ProviderID)
	if err != nil || !prov.Enabled || prov.Kind != "oidc" {
		s.ssoLoginDenied(r, "oidc", st.ProviderID, "provider_unavailable")
		s.ssoRedirectError(w, r, st.RedirectAfter, "provider_unavailable")
		return
	}

	params, perr := s.oidcParams(prov, r)
	if perr != nil {
		s.ssoRedirectError(w, r, st.RedirectAfter, "server_error")
		return
	}

	provider, verifier, err := oidc.NewVerifier(ctx, params.Issuer, params.ClientID)
	if err != nil {
		s.ssoLoginDenied(r, "oidc", prov.ID, "idp_unreachable")
		s.ssoRedirectError(w, r, st.RedirectAfter, "idp_unreachable")
		return
	}

	rawIDToken, err := oidc.Exchange(ctx, params, provider, code, st.PKCEVerifier)
	if err != nil {
		s.ssoLoginDenied(r, "oidc", prov.ID, "code_exchange_failed")
		s.ssoRedirectError(w, r, st.RedirectAfter, "code_exchange_failed")
		return
	}

	ident, err := oidc.VerifyAndClaims(ctx, verifier, rawIDToken, st.Nonce, params)
	if err != nil {
		s.ssoLoginDenied(r, "oidc", prov.ID, "token_verification_failed")
		s.ssoRedirectError(w, r, st.RedirectAfter, "token_verification_failed")
		return
	}

	ext := externalIdentity{
		ExternalID:    ident.ExternalID,
		Username:      ident.Username,
		Email:         ident.Email,
		Display:       ident.Display,
		Groups:        ident.Groups,
		GroupsKnown:   !ident.GroupsOverage,
		GroupsOverage: ident.GroupsOverage,
	}
	u, _, err := s.finishExternalLogin(ctx, prov, "oidc", ext)
	if err != nil {
		s.ssoLoginDenied(r, "oidc", prov.ID, "provisioning_failed")
		s.ssoRedirectError(w, r, st.RedirectAfter, "server_error")
		return
	}

	// Issue the session cookies (the redirect to the SPA is same-origin, so the
	// SameSite=Strict session cookie set here is sent on that navigation).
	rawID, csrf, _, err := s.mintSession(ctx, r, u.ID, authz.AMROIDC)
	if err != nil {
		s.ssoRedirectError(w, r, st.RedirectAfter, "server_error")
		return
	}
	s.setAuthCookies(w, r, rawID, csrf)
	s.ssoLoginSuccess(r, "oidc", prov.ID, u)

	http.Redirect(w, r, sanitizeRedirect(st.RedirectAfter), http.StatusFound)
}

// oidcParams builds the oidc.Params from a provider row, decrypting the client
// secret and resolving the redirect URL (provider override -> CASTOR_PUBLIC_URL
// -> derived from the request).
func (s *Server) oidcParams(prov *store.AuthProvider, r *http.Request) (oidc.Params, error) {
	secret := ""
	if len(prov.OIDCClientSecretEnc) > 0 {
		dec, err := authz.OpenSecret(s.cfg.SecretKey, prov.OIDCClientSecretEnc)
		if err != nil {
			return oidc.Params{}, err
		}
		secret = string(dec)
	}
	return oidc.Params{
		Issuer:        prov.OIDCIssuer,
		ClientID:      prov.OIDCClientID,
		ClientSecret:  secret,
		RedirectURL:   s.oidcRedirectURL(prov, r),
		Scopes:        strings.Fields(prov.OIDCScopes),
		GroupsClaim:   prov.OIDCGroupsClaim,
		UsernameClaim: prov.OIDCUsernameClaim,
		EmailClaim:    prov.OIDCEmailClaim,
	}, nil
}

// oidcRedirectURL resolves the absolute callback URL the IdP must redirect to.
// Precedence: the provider's pinned oidc_redirect_url, else CASTOR_PUBLIC_URL +
// the callback path, else scheme+host derived from the request. It MUST equal a
// redirect URI registered with the IdP.
func (s *Server) oidcRedirectURL(prov *store.AuthProvider, r *http.Request) string {
	const callbackPath = "/api/v1/auth/oidc/callback"
	if u := strings.TrimSpace(prov.OIDCRedirectURL); u != "" {
		return u
	}
	if base := strings.TrimRight(s.cfg.PublicURL, "/"); base != "" {
		return base + callbackPath
	}
	scheme := "http"
	if authz.IsHTTPS(r, s.cfg.TrustProxy) {
		scheme = "https"
	}
	return scheme + "://" + r.Host + callbackPath
}

// --- LDAP ---

type ldapLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Provider string `json:"provider"` // optional: provider id (else the single enabled LDAP one)
}

// LDAPLogin authenticates a username/password against a configured LDAP/LDAPS
// directory (public). On success it JIT-provisions the user, resyncs roles,
// mints a session and returns the SAME JSON shape as the local Login handler.
func (s *Server) LDAPLogin(w http.ResponseWriter, r *http.Request) {
	var req ldapLoginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	ctx := r.Context()

	prov, err := s.enabledProviderOfKind(ctx, req.Provider, "ldap")
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}

	cfg, cerr := s.ldapConfig(prov)
	if cerr != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	// The ldap package connects (ldaps/starttls/plain per cfg), binds with the
	// service account, searches with the username (ldap.EscapeFilter applied
	// inside the pkg), then binds AS the user DN with their password to verify
	// the credential. A bad credential / no entry yields ErrInvalidCredentials.
	ident, lerr := ldap.Authenticate(cfg, req.Username, req.Password)
	if lerr != nil {
		s.ssoLoginDenied(r, "ldap", prov.ID, "invalid_credentials")
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}

	ext := externalIdentity{
		ExternalID:  firstNonEmptyStr(ident.ExternalID, ident.Username),
		Username:    firstNonEmptyStr(ident.Username, req.Username),
		Email:       ident.Email,
		Display:     ident.Display,
		Groups:      ident.Groups,
		GroupsKnown: true,
	}
	u, perms, err := s.finishExternalLogin(ctx, prov, "ldap", ext)
	if err != nil {
		s.ssoLoginDenied(r, "ldap", prov.ID, "provisioning_failed")
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	rawID, csrf, sess, err := s.mintSession(ctx, r, u.ID, authz.AMRLDAP)
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	s.setAuthCookies(w, r, rawID, csrf)
	s.ssoLoginSuccess(r, "ldap", prov.ID, u)

	// Same response contract as local Login (LoginResponse in ui/src/lib/types.ts).
	// External identities never carry a TOTP second factor: requiresTotp is false.
	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"user":         toUserView(u),
		"amr":          authz.AMRLDAP,
		"csrfToken":    sess.CSRFToken,
		"permissions":  perms,
		"requiresTotp": false,
	})
}

// ldapConfig builds the ldap.LDAPConfig from a provider row, decrypting the bind
// password.
func (s *Server) ldapConfig(prov *store.AuthProvider) (ldap.LDAPConfig, error) {
	bindPW := ""
	if len(prov.LDAPBindPWEnc) > 0 {
		dec, err := authz.OpenSecret(s.cfg.SecretKey, prov.LDAPBindPWEnc)
		if err != nil {
			return ldap.LDAPConfig{}, err
		}
		bindPW = string(dec)
	}
	return ldap.LDAPConfig{
		Host:         prov.LDAPHost,
		Port:         prov.LDAPPort,
		TLS:          prov.LDAPTLS,
		SkipVerify:   prov.LDAPSkipVerify,
		BindDN:       prov.LDAPBindDN,
		BindPassword: bindPW,
		BaseDN:       prov.LDAPBaseDN,
		UserFilter:   prov.LDAPUserFilter,
		AttrUsername: prov.LDAPAttrUsername,
		AttrEmail:    prov.LDAPAttrEmail,
		AttrDisplay:  prov.LDAPAttrDisplay,
		GroupBaseDN:  prov.LDAPGroupBaseDN,
		GroupFilter:  prov.LDAPGroupFilter,
		AttrMember:   prov.LDAPAttrMember,
	}, nil
}

// --- shared JIT provisioning + role resync ---

// externalIdentity is the SSO-source-agnostic identity passed to
// finishExternalLogin (built from either oidc.ExternalIdentity or
// ldap.ExternalIdentity).
type externalIdentity struct {
	ExternalID    string
	Username      string
	Email         string
	Display       string
	Groups        []string
	GroupsKnown   bool // false when the group list is unknown (e.g. Entra overage)
	GroupsOverage bool
}

// finishExternalLogin upserts the Castor user for an external identity, resyncs
// its global role bindings from the provider's group mappings (or the default
// role), and returns the user plus its effective permission set. It performs NO
// cookie/session work — the caller mints the session (the LDAP and OIDC paths
// differ in how they respond) — so this stays the single JIT/RBAC choke point.
//
// JIT users are created with auth_source != local and a password sentinel so
// they can never password-login, and they receive ONLY the roles their groups
// map to (no implicit admin). A user whose groups match no mapping gets the
// provider default_role_id; if that is also empty they get NO roles (deny by
// default) and can sign in but see nothing until an admin grants access.
func (s *Server) finishExternalLogin(ctx context.Context, prov *store.AuthProvider, source string, ext externalIdentity) (*store.User, []string, error) {
	username := sanitizeUsername(ext.Username)
	if username == "" {
		username = sanitizeUsername(ext.ExternalID)
	}

	u, err := s.store.UpsertExternalUser(ctx, &store.User{
		ID:                 store.NewUUID(),
		Username:           username,
		Email:              ext.Email,
		PasswordHash:       store.ExternalPasswordSentinel,
		IsActive:           true,
		AuthSource:         source,
		ExternalID:         ext.ExternalID,
		ExternalProviderID: prov.ID,
	})
	if err != nil {
		return nil, nil, err
	}

	// Resolve roles: union of group->role mappings when the group list is known,
	// else (overage / no groups) fall back to the provider default role.
	var roleIDs []string
	if ext.GroupsKnown && len(ext.Groups) > 0 {
		roleIDs, err = s.store.ResolveRolesForGroups(ctx, prov.ID, ext.Groups)
		if err != nil {
			return nil, nil, err
		}
	}
	if len(roleIDs) == 0 && strings.TrimSpace(prov.DefaultRoleID) != "" {
		roleIDs = []string{prov.DefaultRoleID}
	}
	if err := s.store.ReplaceExternalRoleBindings(ctx, u.ID, roleIDs); err != nil {
		return nil, nil, err
	}

	perms, _ := s.effectivePermissions(ctx, u.ID)
	return u, perms, nil
}

// enabledProviderOfKind returns the enabled provider with the given id and kind.
// When id is empty it returns the single enabled provider of that kind, erroring
// if there are zero or more than one (the caller must disambiguate).
func (s *Server) enabledProviderOfKind(ctx context.Context, id, kind string) (*store.AuthProvider, error) {
	id = strings.TrimSpace(id)
	if id != "" {
		prov, err := s.store.GetAuthProvider(ctx, id)
		if err != nil {
			return nil, authz.ErrNotFound
		}
		if !prov.Enabled || prov.Kind != kind {
			return nil, authz.Errorf(authz.ErrValidation, "The selected sign-in method is not available.")
		}
		return prov, nil
	}
	provs, err := s.store.ListEnabledAuthProviders(ctx)
	if err != nil {
		return nil, authz.ErrInternal
	}
	var match *store.AuthProvider
	for _, p := range provs {
		if p.Kind == kind {
			if match != nil {
				return nil, authz.Errorf(authz.ErrValidation, "Multiple "+kind+" providers are configured; specify one.")
			}
			match = p
		}
	}
	if match == nil {
		return nil, authz.Errorf(authz.ErrValidation, "No "+kind+" sign-in method is configured.")
	}
	return match, nil
}

// --- audit helpers for external logins ---

func (s *Server) ssoLoginSuccess(r *http.Request, source, providerID string, u *store.User) {
	authz.SetAuditTarget(r, "user", u.ID, u.Username)
	authz.AddAuditDetail(r, "authSource", source)
	authz.AddAuditDetail(r, "providerId", providerID)
	// Pin the result: the OIDC callback ends in a 302 (which AuditWrap would
	// otherwise infer as "error"); the LDAP path is a 200 but pinning is harmless.
	authz.SetAuditResult(r, "success")
}

func (s *Server) ssoLoginDenied(r *http.Request, source, providerID, reason string) {
	authz.AddAuditDetail(r, "authSource", source)
	if providerID != "" {
		authz.AddAuditDetail(r, "providerId", providerID)
	}
	authz.AddAuditDetail(r, "reason", reason)
	// Pin "denied" so a redirect-based (302) OIDC denial is not mis-recorded as
	// "error"; for LDAP (401) this matches the inferred result.
	authz.SetAuditResult(r, "denied")
}

// ssoRedirectError 302-redirects a failed OIDC browser flow back to the SPA with
// a bounded ?sso_error code so the UI can show a friendly message. The redirect
// target is sanitized to a local path.
func (s *Server) ssoRedirectError(w http.ResponseWriter, r *http.Request, dest, code string) {
	dest = sanitizeRedirect(dest)
	sep := "?"
	if strings.Contains(dest, "?") {
		sep = "&"
	}
	http.Redirect(w, r, dest+sep+"sso_error="+url.QueryEscape(code), http.StatusFound)
}

// sanitizeRedirect constrains a post-login redirect to a local absolute path
// (defends against open redirects). Anything not starting with a single "/" — or
// a scheme-relative "//host" — collapses to "/".
func sanitizeRedirect(p string) string {
	p = strings.TrimSpace(p)
	if p == "" || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") {
		return "/"
	}
	return p
}

// sanitizeUsername trims and bounds a username sourced from an IdP so a hostile
// directory cannot inject control characters or absurd lengths into the users
// table. It is intentionally permissive (external usernames are display-ish) but
// strips whitespace/control runes and caps the length.
func sanitizeUsername(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Map(func(rn rune) rune {
		if rn < 0x20 || rn == 0x7f {
			return -1
		}
		return rn
	}, s)
	if len(s) > 128 {
		s = s[:128]
	}
	return s
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
