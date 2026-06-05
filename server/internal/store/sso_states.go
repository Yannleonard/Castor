package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// sso_states.go holds the short-lived OIDC authorization-state persistence and
// the JIT external-role-binding rebind helper used by the SSO login flow
// (migration 0003: oidc_auth_states + role_bindings). Provider/mapping CRUD and
// the external-user upsert live alongside the auth_providers schema (see
// authproviders.go); this file is intentionally limited to the state machine of
// the OIDC redirect and the resync of an external user's role bindings.

// OIDCAuthState is one row of oidc_auth_states: the CSRF/PKCE state created at
// /auth/oidc/start and consumed (single-use) at the callback. All columns are
// required except redirect_after (defaults to "/"). Timestamps are unix seconds.
type OIDCAuthState struct {
	State         string // PRIMARY KEY (opaque random)
	ProviderID    string // -> auth_providers.id
	Nonce         string // binds the id_token
	PKCEVerifier  string // RFC 7636 code_verifier
	RedirectAfter string // SPA path to land on after login (default "/")
	CreatedAt     int64
	ExpiresAt     int64
}

// CreateOIDCAuthState inserts a new pending OIDC state. The caller sets State,
// ProviderID, Nonce, PKCEVerifier, RedirectAfter and ExpiresAt; CreatedAt is
// stamped here when zero.
func (s *Store) CreateOIDCAuthState(ctx context.Context, st *OIDCAuthState) error {
	if st.CreatedAt == 0 {
		st.CreatedAt = time.Now().Unix()
	}
	redirect := st.RedirectAfter
	if redirect == "" {
		redirect = "/"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO oidc_auth_states
			(state, provider_id, nonce, pkce_verifier, redirect_after, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		st.State, st.ProviderID, st.Nonce, st.PKCEVerifier, redirect, st.CreatedAt, st.ExpiresAt)
	return err
}

// ConsumeOIDCAuthState atomically fetches and deletes the state row (single
// use), returning it only when it exists AND has not expired. A missing,
// already-consumed, or expired state yields ErrNotFound. Deleting unconditionally
// (even when expired) prevents a replay window.
func (s *Store) ConsumeOIDCAuthState(ctx context.Context, state string) (*OIDCAuthState, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var st OIDCAuthState
	err = tx.QueryRowContext(ctx,
		`SELECT state, provider_id, nonce, pkce_verifier, redirect_after, created_at, expires_at
		 FROM oidc_auth_states WHERE state = ?`, state).
		Scan(&st.State, &st.ProviderID, &st.Nonce, &st.PKCEVerifier, &st.RedirectAfter, &st.CreatedAt, &st.ExpiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	// Single-use: remove it regardless of expiry so it can never be replayed.
	if _, err := tx.ExecContext(ctx, `DELETE FROM oidc_auth_states WHERE state = ?`, state); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if st.ExpiresAt < time.Now().Unix() {
		return nil, ErrNotFound
	}
	return &st, nil
}

// DeleteExpiredOIDCAuthStates prunes expired OIDC states (housekeeping, called by
// the background GC). Returns the number of rows removed.
func (s *Store) DeleteExpiredOIDCAuthStates(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM oidc_auth_states WHERE expires_at < ?`, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ReplaceExternalRoleBindings resyncs a JIT-provisioned external user's global
// role bindings to exactly roleIDs, in one transaction: it deletes the user's
// existing GLOBAL-scope bindings and inserts one global binding per role id. It
// deliberately leaves any host/cluster-scoped bindings untouched (those are not
// derived from IdP groups) and is idempotent. Duplicate role ids are collapsed.
//
// Callers pass the union of roles resolved from the provider's
// group_role_mappings (or the provider default role) at each login, so group
// changes at the IdP are reflected on the next sign-in.
func (s *Store) ReplaceExternalRoleBindings(ctx context.Context, userID string, roleIDs []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM role_bindings WHERE user_id = ? AND scope_type = 'global'`, userID); err != nil {
		return err
	}

	now := time.Now().Unix()
	seen := make(map[string]struct{}, len(roleIDs))
	for _, rid := range roleIDs {
		if rid == "" {
			continue
		}
		if _, dup := seen[rid]; dup {
			continue
		}
		seen[rid] = struct{}{}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO role_bindings (id, user_id, role_id, scope_type, scope_id, created_at)
			 VALUES (?, ?, ?, 'global', NULL, ?)`,
			newUUID(), userID, rid, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}
