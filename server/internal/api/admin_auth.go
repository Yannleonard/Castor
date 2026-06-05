package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/auth/ldap"
	"github.com/gtek-it/castor/server/internal/auth/oidc"
	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// admin_auth.go holds the ADMIN (superuser) SSO configuration surface: CRUD for
// auth providers (LDAP + OIDC), a connectivity/credential test probe, and CRUD
// for group->role mappings. Secrets are sealed (AES-256-GCM) on write via
// authz.SealSecret(s.cfg.SecretKey, …) — mirroring registries.go — and are NEVER
// echoed back: responses expose only hasBindPassword / hasClientSecret booleans.
//
// Store methods used here are OWNED by Task A (authproviders.go); see the STORE
// CONTRACT block in auth_sso.go. Additional methods this file relies on:
//   store.ListAuthProviders(ctx) ([]*store.AuthProvider, error)
//   store.CreateAuthProvider(ctx, *store.AuthProvider) error
//   store.UpdateAuthProvider(ctx, *store.AuthProvider, setBindPW, setClientSecret bool) error
//   store.DeleteAuthProvider(ctx, id string) error
//   store.ListGroupRoleMappings(ctx, providerID string) ([]*store.GroupRoleMapping, error)
//   store.CreateGroupRoleMapping(ctx, *store.GroupRoleMapping) error
//   store.DeleteGroupRoleMapping(ctx, providerID, id string) error
//   type store.GroupRoleMapping struct { ID, ProviderID, ExternalGroup, RoleID string; CreatedAt int64 }

// authProviderView is the SAFE projection of a store.AuthProvider returned to
// admins: every configuration field EXCEPT the sealed secrets, which are
// replaced by hasBindPassword / hasClientSecret booleans. Field names are the
// camelCase mirror of the 0003 columns (UI types live in ui/src/lib/types.ts).
type authProviderView struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	Enabled       bool   `json:"enabled"`
	DefaultRoleID string `json:"defaultRoleId"`

	// LDAP
	LDAPHost        string `json:"ldapHost"`
	LDAPPort        int    `json:"ldapPort"`
	LDAPTLS         string `json:"ldapTls"`
	LDAPSkipVerify  bool   `json:"ldapSkipVerify"`
	LDAPBindDN      string `json:"ldapBindDn"`
	HasBindPassword bool   `json:"hasBindPassword"`
	LDAPBaseDN      string `json:"ldapBaseDn"`
	LDAPUserFilter  string `json:"ldapUserFilter"`
	LDAPAttrUser    string `json:"ldapAttrUsername"`
	LDAPAttrEmail   string `json:"ldapAttrEmail"`
	LDAPAttrDisplay string `json:"ldapAttrDisplay"`
	LDAPGroupBaseDN string `json:"ldapGroupBaseDn"`
	LDAPGroupFilter string `json:"ldapGroupFilter"`
	LDAPAttrMember  string `json:"ldapAttrMember"`

	// OIDC
	OIDCIssuer        string `json:"oidcIssuer"`
	OIDCClientID      string `json:"oidcClientId"`
	HasClientSecret   bool   `json:"hasClientSecret"`
	OIDCRedirectURL   string `json:"oidcRedirectUrl"`
	OIDCScopes        string `json:"oidcScopes"`
	OIDCGroupsClaim   string `json:"oidcGroupsClaim"`
	OIDCUsernameClaim string `json:"oidcUsernameClaim"`
	OIDCEmailClaim    string `json:"oidcEmailClaim"`

	CreatedAt int64 `json:"createdAt"`
	UpdatedAt int64 `json:"updatedAt"`
}

func toAuthProviderView(p *store.AuthProvider) authProviderView {
	return authProviderView{
		ID:                p.ID,
		Name:              p.Name,
		Kind:              p.Kind,
		Enabled:           p.Enabled,
		DefaultRoleID:     p.DefaultRoleID,
		LDAPHost:          p.LDAPHost,
		LDAPPort:          p.LDAPPort,
		LDAPTLS:           p.LDAPTLS,
		LDAPSkipVerify:    p.LDAPSkipVerify,
		LDAPBindDN:        p.LDAPBindDN,
		HasBindPassword:   len(p.LDAPBindPWEnc) > 0,
		LDAPBaseDN:        p.LDAPBaseDN,
		LDAPUserFilter:    p.LDAPUserFilter,
		LDAPAttrUser:      p.LDAPAttrUsername,
		LDAPAttrEmail:     p.LDAPAttrEmail,
		LDAPAttrDisplay:   p.LDAPAttrDisplay,
		LDAPGroupBaseDN:   p.LDAPGroupBaseDN,
		LDAPGroupFilter:   p.LDAPGroupFilter,
		LDAPAttrMember:    p.LDAPAttrMember,
		OIDCIssuer:        p.OIDCIssuer,
		OIDCClientID:      p.OIDCClientID,
		HasClientSecret:   len(p.OIDCClientSecretEnc) > 0,
		OIDCRedirectURL:   p.OIDCRedirectURL,
		OIDCScopes:        p.OIDCScopes,
		OIDCGroupsClaim:   p.OIDCGroupsClaim,
		OIDCUsernameClaim: p.OIDCUsernameClaim,
		OIDCEmailClaim:    p.OIDCEmailClaim,
		CreatedAt:         p.CreatedAt,
		UpdatedAt:         p.UpdatedAt,
	}
}

// authProviderRequest is the write body for create/update. Secrets use pointer
// semantics on update (see UpdateAuthProvider): omit (nil) -> keep stored; ""
// -> clear; value -> replace. On create a non-empty secret is sealed; empty is
// left unset.
type authProviderRequest struct {
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	Enabled       bool   `json:"enabled"`
	DefaultRoleID string `json:"defaultRoleId"`

	// LDAP
	LDAPHost        string  `json:"ldapHost"`
	LDAPPort        int     `json:"ldapPort"`
	LDAPTLS         string  `json:"ldapTls"`
	LDAPSkipVerify  bool    `json:"ldapSkipVerify"`
	LDAPBindDN      string  `json:"ldapBindDn"`
	LDAPBindPW      *string `json:"ldapBindPassword"`
	LDAPBaseDN      string  `json:"ldapBaseDn"`
	LDAPUserFilter  string  `json:"ldapUserFilter"`
	LDAPAttrUser    string  `json:"ldapAttrUsername"`
	LDAPAttrEmail   string  `json:"ldapAttrEmail"`
	LDAPAttrDisplay string  `json:"ldapAttrDisplay"`
	LDAPGroupBaseDN string  `json:"ldapGroupBaseDn"`
	LDAPGroupFilter string  `json:"ldapGroupFilter"`
	LDAPAttrMember  string  `json:"ldapAttrMember"`

	// OIDC
	OIDCIssuer        string  `json:"oidcIssuer"`
	OIDCClientID      string  `json:"oidcClientId"`
	OIDCClientSecret  *string `json:"oidcClientSecret"`
	OIDCRedirectURL   string  `json:"oidcRedirectUrl"`
	OIDCScopes        string  `json:"oidcScopes"`
	OIDCGroupsClaim   string  `json:"oidcGroupsClaim"`
	OIDCUsernameClaim string  `json:"oidcUsernameClaim"`
	OIDCEmailClaim    string  `json:"oidcEmailClaim"`
}

// ListAuthProviders returns all configured providers (admin), secrets redacted.
func (s *Server) ListAuthProviders(w http.ResponseWriter, r *http.Request) {
	provs, err := s.store.ListAuthProviders(r.Context())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]authProviderView, 0, len(provs))
	for _, p := range provs {
		out = append(out, toAuthProviderView(p))
	}
	ok(w, out)
}

// GetAuthProvider returns one provider by id (admin), secrets redacted.
func (s *Server) GetAuthProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetAuthProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, toAuthProviderView(p))
}

// CreateAuthProvider creates a provider (perm auth.provider.write -> admin only).
func (s *Server) CreateAuthProvider(w http.ResponseWriter, r *http.Request) {
	var req authProviderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	kind, err := normalizeProviderKind(req.Kind)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Provider name is required."))
		return
	}
	if err := validateProviderRequest(kind, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}

	p := &store.AuthProvider{ID: store.NewUUID(), Kind: kind}
	applyProviderRequest(p, &req)

	// Seal secrets in the API layer (the store never imports the crypto package).
	if req.LDAPBindPW != nil && *req.LDAPBindPW != "" {
		sealed, serr := authz.SealSecret(s.cfg.SecretKey, []byte(*req.LDAPBindPW))
		if serr != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		p.LDAPBindPWEnc = sealed
	}
	if req.OIDCClientSecret != nil && *req.OIDCClientSecret != "" {
		sealed, serr := authz.SealSecret(s.cfg.SecretKey, []byte(*req.OIDCClientSecret))
		if serr != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		p.OIDCClientSecretEnc = sealed
	}

	if err := s.store.CreateAuthProvider(r.Context(), p); err != nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A provider with that name already exists."))
		return
	}
	authz.SetAuditTarget(r, "auth_provider", p.ID, p.Name)
	authz.AddAuditDetail(r, "kind", p.Kind)
	created(w, toAuthProviderView(p))
}

// UpdateAuthProvider updates a provider (perm auth.provider.write). Omitting a
// secret field preserves the stored value; "" clears it; a value replaces it.
func (s *Server) UpdateAuthProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req authProviderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	existing, err := s.store.GetAuthProvider(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	// Kind is immutable once created (it selects the column subset + flow).
	kind := existing.Kind
	if strings.TrimSpace(req.Name) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Provider name is required."))
		return
	}
	if err := validateProviderRequest(kind, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "auth_provider", id, existing.Name)

	p := &store.AuthProvider{ID: id, Kind: kind}
	applyProviderRequest(p, &req)

	setBindPW := req.LDAPBindPW != nil
	if setBindPW && *req.LDAPBindPW != "" {
		sealed, serr := authz.SealSecret(s.cfg.SecretKey, []byte(*req.LDAPBindPW))
		if serr != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		p.LDAPBindPWEnc = sealed
	}
	setClientSecret := req.OIDCClientSecret != nil
	if setClientSecret && *req.OIDCClientSecret != "" {
		sealed, serr := authz.SealSecret(s.cfg.SecretKey, []byte(*req.OIDCClientSecret))
		if serr != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		p.OIDCClientSecretEnc = sealed
	}

	if err := s.store.UpdateAuthProvider(ctx, p, setBindPW, setClientSecret); err != nil {
		if err == store.ErrNotFound {
			writeMapped(w, r, err)
			return
		}
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "A provider with that name already exists."))
		return
	}
	fresh, _ := s.store.GetAuthProvider(ctx, id)
	ok(w, toAuthProviderView(fresh))
}

// DeleteAuthProvider removes a provider (perm auth.provider.write). Cascades its
// group mappings + oidc states (ON DELETE CASCADE in 0003).
func (s *Server) DeleteAuthProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "auth_provider", id, "")
	if err := s.store.DeleteAuthProvider(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// authTestResult is the body of POST /admin/auth/providers/{id}/test.
type authTestResult struct {
	OK         bool   `json:"ok"`
	Message    string `json:"message"`
	SampleUser string `json:"sampleUser,omitempty"`
}

// TestAuthProvider probes a provider's configuration (perm auth.provider.write):
// LDAP -> connect + service bind + a sample search; OIDC -> OIDC discovery +
// basic client validation. A configuration problem is reported as ok:false (not
// a 5xx) so the admin can fix it. Secrets are used internally, never echoed.
func (s *Server) TestAuthProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	prov, err := s.store.GetAuthProvider(ctx, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "auth_provider", id, prov.Name)
	authz.AddAuditDetail(r, "kind", prov.Kind)

	tctx, cancel := contextWithTimeout(r, registryTestTimeout)
	defer cancel()

	switch prov.Kind {
	case "ldap":
		cfg, cerr := s.ldapConfig(prov)
		if cerr != nil {
			authz.WriteError(w, r, authz.ErrInternal)
			return
		}
		// ldap.Test performs its own dial/bind/search with internal timeouts; it
		// takes no context (the network ops are individually deadline-bounded in
		// the ldap pkg). It returns a sample user DN on success.
		sampleUser, terr := ldap.Test(cfg)
		if terr != nil {
			ok(w, authTestResult{OK: false, Message: sanitizeRegistryError(terr.Error())})
			return
		}
		var msg string
		if sampleUser != "" {
			msg = "LDAP connection, bind and sample search succeeded."
		} else {
			msg = "LDAP connection and service bind succeeded, but the base DN / user filter matched no users."
		}
		ok(w, authTestResult{OK: true, Message: msg, SampleUser: sampleUser})
	case "oidc":
		secret := ""
		if len(prov.OIDCClientSecretEnc) > 0 {
			if dec, derr := authz.OpenSecret(s.cfg.SecretKey, prov.OIDCClientSecretEnc); derr == nil {
				secret = string(dec)
			}
		}
		if terr := oidc.Test(tctx, prov.OIDCIssuer, prov.OIDCClientID, secret); terr != nil {
			ok(w, authTestResult{OK: false, Message: sanitizeRegistryError(terr.Error())})
			return
		}
		ok(w, authTestResult{OK: true, Message: "OIDC discovery succeeded and the client configuration is valid."})
	default:
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Unknown provider kind."))
	}
}

// --- group -> role mappings ---

type groupMappingView struct {
	ID            string `json:"id"`
	ProviderID    string `json:"providerId"`
	ExternalGroup string `json:"externalGroup"`
	RoleID        string `json:"roleId"`
	CreatedAt     int64  `json:"createdAt"`
}

func toGroupMappingView(m *store.GroupRoleMapping) groupMappingView {
	return groupMappingView{
		ID:            m.ID,
		ProviderID:    m.ProviderID,
		ExternalGroup: m.ExternalGroup,
		RoleID:        m.RoleID,
		CreatedAt:     m.CreatedAt,
	}
}

type createMappingRequest struct {
	ExternalGroup string `json:"externalGroup"`
	RoleID        string `json:"roleId"`
}

// ListGroupMappings lists a provider's group->role mappings (admin).
func (s *Server) ListGroupMappings(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	ctx := r.Context()
	if _, err := s.store.GetAuthProvider(ctx, providerID); err != nil {
		writeMapped(w, r, err)
		return
	}
	maps, err := s.store.ListGroupRoleMappings(ctx, providerID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	out := make([]groupMappingView, 0, len(maps))
	for _, m := range maps {
		out = append(out, toGroupMappingView(m))
	}
	ok(w, out)
}

// CreateGroupMapping adds a group->role mapping (perm auth.provider.write).
func (s *Server) CreateGroupMapping(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	var req createMappingRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	req.ExternalGroup = strings.TrimSpace(req.ExternalGroup)
	if req.ExternalGroup == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "externalGroup is required."))
		return
	}
	if strings.TrimSpace(req.RoleID) == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "roleId is required."))
		return
	}
	ctx := r.Context()
	prov, err := s.store.GetAuthProvider(ctx, providerID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "auth_provider", providerID, prov.Name)

	m := &store.GroupRoleMapping{
		ID:            store.NewUUID(),
		ProviderID:    providerID,
		ExternalGroup: req.ExternalGroup,
		RoleID:        strings.TrimSpace(req.RoleID),
	}
	if err := s.store.CreateGroupRoleMapping(ctx, m); err != nil {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "That group mapping already exists, or the role is invalid."))
		return
	}
	authz.AddAuditDetail(r, "externalGroup", m.ExternalGroup)
	authz.AddAuditDetail(r, "roleId", m.RoleID)
	created(w, toGroupMappingView(m))
}

// DeleteGroupMapping removes a group->role mapping (perm auth.provider.write).
func (s *Server) DeleteGroupMapping(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	mappingID := chi.URLParam(r, "mappingId")
	authz.SetAuditTarget(r, "auth_provider", providerID, "")
	authz.AddAuditDetail(r, "mappingId", mappingID)
	if err := s.store.DeleteGroupRoleMapping(r.Context(), providerID, mappingID); err != nil {
		writeMapped(w, r, err)
		return
	}
	noContent(w)
}

// --- validation / mapping helpers ---

// normalizeProviderKind validates the provider kind (immutable after create).
func normalizeProviderKind(k string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(k)) {
	case "ldap":
		return "ldap", nil
	case "oidc":
		return "oidc", nil
	default:
		return "", authz.Errorf(authz.ErrValidation, "kind must be 'ldap' or 'oidc'.")
	}
}

// validateProviderRequest enforces the minimal per-kind required fields so an
// enabled provider is actually usable.
func validateProviderRequest(kind string, req *authProviderRequest) error {
	switch kind {
	case "ldap":
		if strings.TrimSpace(req.LDAPHost) == "" {
			return authz.Errorf(authz.ErrValidation, "ldapHost is required for an LDAP provider.")
		}
		if req.LDAPPort < 0 || req.LDAPPort > 65535 {
			return authz.Errorf(authz.ErrValidation, "ldapPort must be between 0 and 65535.")
		}
		if t := strings.TrimSpace(req.LDAPTLS); t != "" && t != "none" && t != "starttls" && t != "ldaps" {
			return authz.Errorf(authz.ErrValidation, "ldapTls must be one of none, starttls, ldaps.")
		}
		if strings.TrimSpace(req.LDAPBaseDN) == "" {
			return authz.Errorf(authz.ErrValidation, "ldapBaseDn is required for an LDAP provider.")
		}
	case "oidc":
		if strings.TrimSpace(req.OIDCIssuer) == "" {
			return authz.Errorf(authz.ErrValidation, "oidcIssuer is required for an OIDC provider.")
		}
		if strings.TrimSpace(req.OIDCClientID) == "" {
			return authz.Errorf(authz.ErrValidation, "oidcClientId is required for an OIDC provider.")
		}
	}
	return nil
}

// applyProviderRequest copies the non-secret request fields onto a provider row,
// applying sane defaults for the directory attribute names / OIDC claims so the
// row is usable even if the admin left them blank.
func applyProviderRequest(p *store.AuthProvider, req *authProviderRequest) {
	p.Name = strings.TrimSpace(req.Name)
	p.Enabled = req.Enabled
	p.DefaultRoleID = strings.TrimSpace(req.DefaultRoleID)

	// LDAP
	p.LDAPHost = strings.TrimSpace(req.LDAPHost)
	p.LDAPPort = req.LDAPPort
	if p.LDAPPort == 0 {
		p.LDAPPort = 389
	}
	p.LDAPTLS = defaultStr(strings.TrimSpace(req.LDAPTLS), "starttls")
	p.LDAPSkipVerify = req.LDAPSkipVerify
	p.LDAPBindDN = strings.TrimSpace(req.LDAPBindDN)
	p.LDAPBaseDN = strings.TrimSpace(req.LDAPBaseDN)
	p.LDAPUserFilter = defaultStr(strings.TrimSpace(req.LDAPUserFilter), "(&(objectClass=person)(sAMAccountName=%s))")
	p.LDAPAttrUsername = defaultStr(strings.TrimSpace(req.LDAPAttrUser), "sAMAccountName")
	p.LDAPAttrEmail = defaultStr(strings.TrimSpace(req.LDAPAttrEmail), "mail")
	p.LDAPAttrDisplay = defaultStr(strings.TrimSpace(req.LDAPAttrDisplay), "displayName")
	p.LDAPGroupBaseDN = strings.TrimSpace(req.LDAPGroupBaseDN)
	p.LDAPGroupFilter = defaultStr(strings.TrimSpace(req.LDAPGroupFilter), "(&(objectClass=group)(member=%s))")
	p.LDAPAttrMember = defaultStr(strings.TrimSpace(req.LDAPAttrMember), "memberOf")

	// OIDC
	p.OIDCIssuer = strings.TrimSpace(req.OIDCIssuer)
	p.OIDCClientID = strings.TrimSpace(req.OIDCClientID)
	p.OIDCRedirectURL = strings.TrimSpace(req.OIDCRedirectURL)
	p.OIDCScopes = defaultStr(strings.TrimSpace(req.OIDCScopes), "openid profile email")
	p.OIDCGroupsClaim = defaultStr(strings.TrimSpace(req.OIDCGroupsClaim), "groups")
	p.OIDCUsernameClaim = defaultStr(strings.TrimSpace(req.OIDCUsernameClaim), "preferred_username")
	p.OIDCEmailClaim = defaultStr(strings.TrimSpace(req.OIDCEmailClaim), "email")
}

// defaultStr returns def when s is empty (after trim).
func defaultStr(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
