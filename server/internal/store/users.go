package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ErrNotFound is returned by store reads when a row does not exist.
var ErrNotFound = errors.New("store: record not found")

// userCols lists the users columns in a FIXED order. scanUser binds to this
// EXACT order, so any change here MUST be mirrored in scanUser (and vice versa)
// or scans will misalign. The trailing auth_source/external_id/
// external_provider_id were added by migration 0003 (SSO).
const userCols = `id, username, email, password_hash, totp_secret_enc, totp_enabled,
	totp_confirmed_at, is_active, must_change_pw, failed_logins, locked_until,
	last_login_at, auth_source, external_id, external_provider_id, created_at, updated_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	var email sql.NullString
	var secret []byte
	var totpEnabled, isActive, mustChange int
	var totpConfirmedAt, lockedUntil, lastLoginAt sql.NullInt64
	var authSource sql.NullString
	var externalID, externalProviderID sql.NullString
	if err := row.Scan(
		&u.ID, &u.Username, &email, &u.PasswordHash, &secret, &totpEnabled,
		&totpConfirmedAt, &isActive, &mustChange, &u.FailedLogins, &lockedUntil,
		&lastLoginAt, &authSource, &externalID, &externalProviderID,
		&u.CreatedAt, &u.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.Email = email.String
	u.TOTPSecretEnc = secret
	u.TOTPEnabled = totpEnabled == 1
	u.IsActive = isActive == 1
	u.MustChangePW = mustChange == 1
	if totpConfirmedAt.Valid {
		v := totpConfirmedAt.Int64
		u.TOTPConfirmedAt = &v
	}
	if lockedUntil.Valid {
		v := lockedUntil.Int64
		u.LockedUntil = &v
	}
	if lastLoginAt.Valid {
		v := lastLoginAt.Int64
		u.LastLoginAt = &v
	}
	// auth_source has a NOT NULL DEFAULT 'local'; normalize NULL just in case.
	if authSource.Valid && authSource.String != "" {
		u.AuthSource = authSource.String
	} else {
		u.AuthSource = "local"
	}
	u.ExternalID = externalID.String
	u.ExternalProviderID = externalProviderID.String
	return &u, nil
}

// CreateUser inserts a new user. Caller supplies a UUID id and argon2id hash.
// For local users leave AuthSource empty/"local". For externally-provisioned
// users prefer UpsertExternalUser, which also handles re-login upserts.
func (s *Store) CreateUser(ctx context.Context, u *User) error {
	now := time.Now().Unix()
	u.CreatedAt, u.UpdatedAt = now, now
	if u.AuthSource == "" {
		u.AuthSource = "local"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, username, email, password_hash, totp_enabled,
			is_active, must_change_pw, failed_logins, auth_source, external_id,
			external_provider_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?)`,
		u.ID, u.Username, nullStr(u.Email), u.PasswordHash,
		boolInt(u.IsActive), boolInt(u.MustChangePW),
		u.AuthSource, nullStr(u.ExternalID), nullStr(u.ExternalProviderID),
		now, now,
	)
	return err
}

// FindUserByExternalID returns the Castor user JIT-provisioned for a given IdP
// subject (source is "ldap"|"oidc"; externalID is the stable IdP subject). It
// returns ErrNotFound when no such user exists yet.
func (s *Store) FindUserByExternalID(ctx context.Context, source, externalID string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userCols+` FROM users WHERE auth_source = ? AND external_id = ?`,
		source, externalID))
}

// UpsertExternalUser find-or-creates the Castor user for an external identity
// (JIT provisioning). Matching is by (AuthSource, ExternalID) — the stable IdP
// subject — so a renamed/re-emailed upstream account still maps to the same
// Castor user.
//
// The caller pre-builds in (typically with ID=NewUUID(), PasswordHash=
// ExternalPasswordSentinel, IsActive=true, AuthSource=source, ExternalID,
// ExternalProviderID). On FIRST login the row is inserted as-is; on subsequent
// logins the existing row's mutable profile (username/email, provider linkage)
// is refreshed and it is re-activated. The PERSISTED row is returned (its ID is
// the original id on re-login, NOT in.ID).
//
// RBAC (role bindings) is the caller's responsibility (resync from group
// mappings via ReplaceExternalRoleBindings); JIT users get NO implicit role here.
func (s *Store) UpsertExternalUser(ctx context.Context, in *User) (*User, error) {
	source := in.AuthSource
	if source == "" {
		source = "local"
	}
	now := time.Now().Unix()

	existing, err := s.FindUserByExternalID(ctx, source, in.ExternalID)
	switch {
	case err == nil:
		// Refresh profile + provider linkage; keep the row active.
		if _, uerr := s.db.ExecContext(ctx,
			`UPDATE users SET username = ?, email = ?, external_provider_id = ?,
				is_active = 1, updated_at = ? WHERE id = ?`,
			in.Username, nullStr(in.Email), nullStr(in.ExternalProviderID), now, existing.ID); uerr != nil {
			return nil, uerr
		}
		return s.GetUserByID(ctx, existing.ID)
	case errors.Is(err, ErrNotFound):
		// First login: create the external user from the supplied struct.
		u := &User{
			ID:                 in.ID,
			Username:           in.Username,
			Email:              in.Email,
			PasswordHash:       in.PasswordHash,
			IsActive:           in.IsActive,
			MustChangePW:       in.MustChangePW,
			AuthSource:         source,
			ExternalID:         in.ExternalID,
			ExternalProviderID: in.ExternalProviderID,
		}
		if u.ID == "" {
			u.ID = newUUID()
		}
		if u.PasswordHash == "" {
			u.PasswordHash = ExternalPasswordSentinel
		}
		if cerr := s.CreateUser(ctx, u); cerr != nil {
			return nil, cerr
		}
		return s.GetUserByID(ctx, u.ID)
	default:
		return nil, err
	}
}

// GetUserByID returns one user by id.
func (s *Store) GetUserByID(ctx context.Context, id string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userCols+` FROM users WHERE id = ?`, id))
}

// GetUserByUsername returns one user by username.
func (s *Store) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userCols+` FROM users WHERE username = ?`, username))
}

// ListUsers returns all users ordered by created_at.
func (s *Store) ListUsers(ctx context.Context) ([]*User, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+userCols+` FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CountUsers returns the number of users (used by bootstrap detection).
func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// UpdateUserProfile updates the mutable profile fields (email, is_active).
func (s *Store) UpdateUserProfile(ctx context.Context, id string, email *string, isActive *bool) error {
	now := time.Now().Unix()
	if email != nil {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE users SET email = ?, updated_at = ? WHERE id = ?`,
			nullStr(*email), now, id); err != nil {
			return err
		}
	}
	if isActive != nil {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?`,
			boolInt(*isActive), now, id); err != nil {
			return err
		}
	}
	return nil
}

// SetPasswordHash rehashes the user's password and clears must_change_pw.
func (s *Store) SetPasswordHash(ctx context.Context, id, hash string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET password_hash = ?, must_change_pw = 0, updated_at = ? WHERE id = ?`,
		hash, time.Now().Unix(), id)
	return err
}

// DeleteUser removes a user (cascades sessions, bindings, recovery codes).
func (s *Store) DeleteUser(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RecordLoginSuccess resets failed_logins/locked_until and stamps last_login_at.
func (s *Store) RecordLoginSuccess(ctx context.Context, id string) error {
	now := time.Now().Unix()
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET failed_logins = 0, locked_until = NULL,
			last_login_at = ?, updated_at = ? WHERE id = ?`,
		now, now, id)
	return err
}

// RecordLoginFailure increments failed_logins and, past the threshold, sets a
// lockout window. Returns the new failed count.
func (s *Store) RecordLoginFailure(ctx context.Context, id string, threshold int, lockFor time.Duration) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var failed int
	if err := tx.QueryRowContext(ctx,
		`SELECT failed_logins FROM users WHERE id = ?`, id).Scan(&failed); err != nil {
		return 0, err
	}
	failed++
	now := time.Now().Unix()
	var locked *int64
	if failed >= threshold {
		v := now + int64(lockFor.Seconds())
		locked = &v
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?`,
		failed, nullInt(locked), now, id); err != nil {
		return 0, err
	}
	return failed, tx.Commit()
}

// SetTOTPPending stores an encrypted (not-yet-confirmed) TOTP secret.
func (s *Store) SetTOTPPending(ctx context.Context, id string, secretEnc []byte) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET totp_secret_enc = ?, totp_enabled = 0,
			totp_confirmed_at = NULL, updated_at = ? WHERE id = ?`,
		secretEnc, time.Now().Unix(), id)
	return err
}

// ConfirmTOTP flips totp_enabled on and stamps totp_confirmed_at.
func (s *Store) ConfirmTOTP(ctx context.Context, id string) error {
	now := time.Now().Unix()
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET totp_enabled = 1, totp_confirmed_at = ?, updated_at = ? WHERE id = ?`,
		now, now, id)
	return err
}

// DisableTOTP clears the secret and disables TOTP.
func (s *Store) DisableTOTP(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET totp_secret_enc = NULL, totp_enabled = 0,
			totp_confirmed_at = NULL, updated_at = ? WHERE id = ?`,
		time.Now().Unix(), id)
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}
