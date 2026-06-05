// Package oidc wraps github.com/coreos/go-oidc/v3 + golang.org/x/oauth2 into the
// small surface Castor's SSO layer needs: OIDC discovery, building the
// Authorization-Code+PKCE redirect URL, exchanging the code, and verifying the
// returned id_token (signature + issuer + audience + expiry + nonce) before
// extracting the identity claims.
//
// It is deliberately decoupled from the store: callers pass primitive provider
// parameters (a Params value) rather than a *store.AuthProvider, so this package
// imports neither store nor authz (no import cycles, easy to unit-test).
//
// Microsoft Entra ID is the reference IdP: issuer is
// https://login.microsoftonline.com/<tenant>/v2.0 and it supports OIDC
// discovery. Entra's "groups overage" (when a user is in too many groups the
// token carries _claim_names/_claim_sources instead of the groups array) is
// detected and surfaced via ExternalIdentity.GroupsOverage so the caller can
// degrade to the provider's default role (V1 does not call Microsoft Graph).
package oidc

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	goidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// netTimeout bounds OIDC discovery / token-exchange / JWKS network calls so a
// slow or unreachable IdP cannot hang a request indefinitely.
const netTimeout = 15 * time.Second

// Default claim names (Entra defaults). The store seeds the same defaults.
const (
	DefaultGroupsClaim   = "groups"
	DefaultUsernameClaim = "preferred_username"
	DefaultEmailClaim    = "email"
)

// Params is the minimal provider configuration this package operates on. The API
// layer builds it from a store.AuthProvider row (decrypting the client secret).
type Params struct {
	Issuer        string   // e.g. https://login.microsoftonline.com/<tenant>/v2.0
	ClientID      string   // application (client) id
	ClientSecret  string   // confidential-client secret (decrypted by the caller)
	RedirectURL   string   // absolute callback URL registered with the IdP
	Scopes        []string // e.g. ["openid","profile","email"]; "openid" is forced
	GroupsClaim   string   // claim holding the group list (default "groups")
	UsernameClaim string   // claim holding the username (default "preferred_username")
	EmailClaim    string   // claim holding the email (default "email")
}

// ExternalIdentity is the normalized identity extracted from a verified
// id_token. ExternalID is the stable IdP subject used for JIT mapping (Entra's
// "oid" is preferred over "sub" because it is immutable across app
// registrations; we fall back to "sub").
type ExternalIdentity struct {
	ExternalID string
	Username   string
	Email      string
	Display    string
	Groups     []string
	// GroupsOverage is true when the IdP signalled a groups overage
	// (_claim_names/_claim_sources present, no inline groups array). The caller
	// MUST treat Groups as unknown (nil) and fall back to the default role.
	GroupsOverage bool
}

// NewVerifier performs OIDC discovery against the issuer and returns the
// provider plus an id_token verifier bound to clientID. The context bounds the
// discovery HTTP call.
func NewVerifier(ctx context.Context, issuer, clientID string) (*goidc.Provider, *goidc.IDTokenVerifier, error) {
	issuer = strings.TrimSpace(issuer)
	if issuer == "" {
		return nil, nil, errors.New("oidc: issuer is empty")
	}
	if strings.TrimSpace(clientID) == "" {
		return nil, nil, errors.New("oidc: client id is empty")
	}
	dctx, cancel := context.WithTimeout(ctx, netTimeout)
	defer cancel()

	provider, err := goidc.NewProvider(dctx, issuer)
	if err != nil {
		return nil, nil, fmt.Errorf("oidc: discovery failed: %w", err)
	}
	verifier := provider.Verifier(&goidc.Config{ClientID: clientID})
	return provider, verifier, nil
}

// oauthConfig builds an oauth2.Config from params + a discovered provider. The
// "openid" scope is always present; duplicates are de-duplicated.
func oauthConfig(p Params, provider *goidc.Provider) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     p.ClientID,
		ClientSecret: p.ClientSecret,
		RedirectURL:  p.RedirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       normalizeScopes(p.Scopes),
	}
}

// AuthCodeURL builds the IdP authorization URL for the Authorization-Code+PKCE
// flow, binding the request to the given state, nonce and PKCE S256 challenge
// (the value returned by NewPKCE / S256Challenge).
func AuthCodeURL(p Params, provider *goidc.Provider, state, nonce, pkceChallenge string) string {
	cfg := oauthConfig(p, provider)
	return cfg.AuthCodeURL(state,
		goidc.Nonce(nonce),
		oauth2.SetAuthURLParam("code_challenge", pkceChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
}

// Exchange swaps the authorization code for tokens (the PKCE verifier proves
// possession) and returns the raw id_token string. The caller verifies it with
// VerifyAndClaims.
func Exchange(ctx context.Context, p Params, provider *goidc.Provider, code, pkceVerifier string) (string, error) {
	cfg := oauthConfig(p, provider)
	xctx, cancel := context.WithTimeout(ctx, netTimeout)
	defer cancel()

	tok, err := cfg.Exchange(xctx, code,
		oauth2.SetAuthURLParam("code_verifier", pkceVerifier),
	)
	if err != nil {
		return "", fmt.Errorf("oidc: token exchange failed: %w", err)
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		return "", errors.New("oidc: token response did not contain an id_token")
	}
	return rawID, nil
}

// VerifyAndClaims verifies the raw id_token (signature via JWKS, issuer,
// audience and expiry are checked by go-oidc; the nonce is checked explicitly
// here) and returns the normalized ExternalIdentity honoring the provider's
// configurable claim names. A nonce mismatch is a hard error (replay / CSRF
// protection). Entra groups-overage is detected and flagged.
func VerifyAndClaims(ctx context.Context, verifier *goidc.IDTokenVerifier, rawIDToken, nonce string, p Params) (*ExternalIdentity, error) {
	vctx, cancel := context.WithTimeout(ctx, netTimeout)
	defer cancel()

	idt, err := verifier.Verify(vctx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("oidc: id_token verification failed: %w", err)
	}
	if nonce == "" || idt.Nonce != nonce {
		return nil, errors.New("oidc: id_token nonce mismatch")
	}

	// Decode every claim into a generic map so both the standard and the
	// provider-configured (possibly non-standard) claim names resolve.
	var claims map[string]any
	if err := idt.Claims(&claims); err != nil {
		return nil, fmt.Errorf("oidc: failed to parse id_token claims: %w", err)
	}

	id := &ExternalIdentity{}
	// Stable subject: prefer Entra's immutable "oid", else standard "sub".
	id.ExternalID = firstNonEmpty(claimString(claims, "oid"), claimString(claims, "sub"))
	if id.ExternalID == "" {
		return nil, errors.New("oidc: id_token has neither oid nor sub")
	}

	usernameClaim := defaultStr(p.UsernameClaim, DefaultUsernameClaim)
	emailClaim := defaultStr(p.EmailClaim, DefaultEmailClaim)
	groupsClaim := defaultStr(p.GroupsClaim, DefaultGroupsClaim)

	id.Username = firstNonEmpty(
		claimString(claims, usernameClaim),
		claimString(claims, "preferred_username"),
		claimString(claims, "upn"),
		claimString(claims, "email"),
		id.ExternalID,
	)
	id.Email = firstNonEmpty(claimString(claims, emailClaim), claimString(claims, "email"))
	id.Display = firstNonEmpty(claimString(claims, "name"), id.Username)

	// Groups: inline array under the configured claim, or a groups-overage signal.
	id.Groups = claimStrings(claims, groupsClaim)
	if len(id.Groups) == 0 {
		if _, hasNames := claims["_claim_names"]; hasNames {
			id.GroupsOverage = true
			id.Groups = nil
		} else if _, hasSrc := claims["_claim_sources"]; hasSrc {
			id.GroupsOverage = true
			id.Groups = nil
		}
	}
	return id, nil
}

// Test validates a provider config without a user present: it performs OIDC
// discovery and asserts the basics (issuer reachable + valid metadata, client id
// set). A client secret is not exchanged (no user round-trip is possible here)
// but its presence is the caller's concern. Returns nil when the config looks
// usable, else a human-readable error.
func Test(ctx context.Context, issuer, clientID, clientSecret string) error {
	if strings.TrimSpace(clientID) == "" {
		return errors.New("client id is required")
	}
	if _, _, err := NewVerifier(ctx, issuer, clientID); err != nil {
		return err
	}
	return nil
}

// --- PKCE / state helpers (RFC 7636, S256) ---

// PKCE bundles a freshly generated verifier and its S256 challenge.
type PKCE struct {
	Verifier  string
	Challenge string
}

// NewPKCE generates a high-entropy code_verifier and its S256 code_challenge.
func NewPKCE() (PKCE, error) {
	v, err := randomURLSafe(32)
	if err != nil {
		return PKCE{}, err
	}
	return PKCE{Verifier: v, Challenge: S256Challenge(v)}, nil
}

// S256Challenge returns base64url(SHA256(verifier)) without padding.
func S256Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// NewState and NewNonce generate URL-safe random tokens for the OIDC state and
// nonce parameters.
func NewState() (string, error) { return randomURLSafe(32) }
func NewNonce() (string, error) { return randomURLSafe(32) }

func randomURLSafe(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// --- small helpers ---

// normalizeScopes forces "openid" first and de-duplicates, accepting either a
// slice of scopes or space-separated strings.
func normalizeScopes(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in)+1)
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	add(goidc.ScopeOpenID)
	for _, s := range in {
		for _, part := range strings.Fields(s) {
			add(part)
		}
	}
	return out
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func defaultStr(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func claimString(m map[string]any, key string) string {
	if m == nil || key == "" {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func claimStrings(m map[string]any, key string) []string {
	if m == nil || key == "" {
		return nil
	}
	v, ok := m[key]
	if !ok {
		return nil
	}
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		if len(out) == 0 {
			return nil
		}
		return out
	case string:
		if t == "" {
			return nil
		}
		return []string{t}
	}
	return nil
}
