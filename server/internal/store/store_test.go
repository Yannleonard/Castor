package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/config"
)

// newTestStore creates a migrated + seeded store on a temp DB file.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{DBPath: filepath.Join(dir, "test.db")}
	st, err := Connect(cfg)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if err := st.Seed(ctx); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return st
}

func TestMigrateIsIdempotent(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	// Running migrate again must be a no-op (no error, no duplicate version).
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	applied, err := st.appliedVersions(ctx)
	if err != nil {
		t.Fatalf("appliedVersions: %v", err)
	}
	if !applied[1] {
		t.Fatalf("migration 1 not recorded")
	}
}

func TestSeedRolesAndHost(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	for _, id := range []string{RoleIDAdmin, RoleIDOperator, RoleIDViewer} {
		role, err := st.GetRole(ctx, id)
		if err != nil {
			t.Fatalf("GetRole(%s): %v", id, err)
		}
		if !role.IsBuiltin {
			t.Errorf("role %s should be builtin", id)
		}
	}

	admin, _ := st.GetRole(ctx, RoleIDAdmin)
	if len(admin.Permissions) != 1 || admin.Permissions[0] != "*" {
		t.Errorf("admin perms = %v want [*]", admin.Permissions)
	}

	// Operator must NOT include destructive perms.
	op, _ := st.GetRole(ctx, RoleIDOperator)
	for _, p := range op.Permissions {
		switch p {
		case "docker.container.remove", "docker.image.delete", "docker.volume.remove":
			t.Errorf("operator must not include %s", p)
		}
		if p == "*" || p == "rbac.user.create" {
			t.Errorf("operator must not include %s", p)
		}
	}

	host, err := st.GetHost(ctx, "local")
	if err != nil {
		t.Fatalf("GetHost(local): %v", err)
	}
	if host.Connection != "local-socket" {
		t.Errorf("local host connection = %q", host.Connection)
	}
}

func TestAgentHostEnrollmentPersistsOnlyDigestAndRevokesSafely(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	token := []byte("raw-enrollment-token-that-must-not-be-stored")
	digest := sha256.Sum256(token)
	hostID := NewUUID()
	if err := st.CreateAgentHostEnrollment(ctx, hostID, "edge-linux", digest[:], time.Now().Add(15*time.Minute).Unix(), ""); err != nil {
		t.Fatalf("CreateAgentHostEnrollment: %v", err)
	}
	var stored []byte
	if err := st.DB().QueryRowContext(ctx, `SELECT token_hash FROM agent_enrollments WHERE host_id = ?`, hostID).Scan(&stored); err != nil {
		t.Fatalf("read stored token hash: %v", err)
	}
	if string(stored) == string(token) || len(stored) != sha256.Size {
		t.Fatal("raw token was persisted instead of a fixed-length digest")
	}
	redeemedHost, err := st.ConsumeAgentEnrollment(ctx, digest[:])
	if err != nil || redeemedHost != hostID {
		t.Fatalf("ConsumeAgentEnrollment = %q, %v", redeemedHost, err)
	}
	if _, err := st.ConsumeAgentEnrollment(ctx, digest[:]); err != ErrNotFound {
		t.Fatalf("second credential redemption error = %v, want ErrNotFound", err)
	}
	host, err := st.GetHost(ctx, hostID)
	if err != nil || host.Connection != "remote-agent" || host.Status != "pending" {
		t.Fatalf("new host = %#v, err=%v", host, err)
	}
	if err := st.RevokeAgentHost(ctx, "local"); err != ErrLocalHost {
		t.Fatalf("revoking local host error = %v, want ErrLocalHost", err)
	}
	if err := st.RevokeAgentHost(ctx, hostID); err != nil {
		t.Fatalf("RevokeAgentHost: %v", err)
	}
	host, err = st.GetHost(ctx, hostID)
	if err != nil || host.Status != "revoked" {
		t.Fatalf("revoked host = %#v, err=%v", host, err)
	}
	var revoked sql.NullInt64
	if err := st.DB().QueryRowContext(ctx, `SELECT revoked_at FROM agent_enrollments WHERE host_id = ?`, hostID).Scan(&revoked); err != nil || !revoked.Valid {
		t.Fatalf("enrollment revocation timestamp valid=%v err=%v", revoked.Valid, err)
	}
}

func TestExpiredAgentEnrollmentCannotBeConsumed(t *testing.T) {
	st := newTestStore(t)
	digest := sha256.Sum256([]byte("expired enrollment"))
	hostID := NewUUID()
	if err := st.CreateAgentHostEnrollment(context.Background(), hostID, "expired", digest[:], time.Now().Add(-time.Minute).Unix(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConsumeAgentEnrollment(context.Background(), digest[:]); err != ErrNotFound {
		t.Fatalf("expired credential redemption error = %v, want ErrNotFound", err)
	}
}

func TestAgentEnrollmentBindsEd25519IdentityAndAllowsReconnect(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	token := []byte("first use only")
	digest := sha256.Sum256(token)
	pub := make([]byte, 32)
	for i := range pub {
		pub[i] = byte(i + 1)
	}
	hostID := NewUUID()
	if err := st.CreateAgentHostEnrollment(ctx, hostID, "edge", digest[:], time.Now().Add(time.Minute).Unix(), ""); err != nil {
		t.Fatal(err)
	}
	got, err := st.RedeemAgentEnrollment(ctx, digest[:], pub)
	if err != nil || got != hostID {
		t.Fatalf("RedeemAgentEnrollment = %q, %v", got, err)
	}
	if _, err := st.RedeemAgentEnrollment(ctx, digest[:], pub); err != ErrNotFound {
		t.Fatalf("replay redemption error=%v, want ErrNotFound", err)
	}
	bound, err := st.AgentPublicKey(ctx, hostID)
	if err != nil || string(bound) != string(pub) {
		t.Fatalf("AgentPublicKey=%x, %v", bound, err)
	}
	found, err := st.FindAgentHostByPublicKey(ctx, pub)
	if err != nil || found != hostID {
		t.Fatalf("FindAgentHostByPublicKey=%q, %v", found, err)
	}
	if err := st.SetAgentConnectionState(ctx, hostID, "connected"); err != nil {
		t.Fatal(err)
	}
	if err := st.RevokeAgentHost(ctx, hostID); err != nil {
		t.Fatal(err)
	}
	if err := st.SetAgentConnectionState(ctx, hostID, "connected"); err != ErrNotFound {
		t.Fatalf("revoked host reconnect state update error=%v, want ErrNotFound", err)
	}
}

func TestSeedIsIdempotent(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	if err := st.Seed(ctx); err != nil {
		t.Fatalf("second Seed: %v", err)
	}
	roles, _ := st.ListRoles(ctx)
	if len(roles) != 3 {
		t.Fatalf("expected 3 seeded roles, got %d", len(roles))
	}
}

func TestBootstrapFirstAdminSingleShot(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	u, err := st.BootstrapFirstAdmin(ctx, NewUUID(), "admin", "a@example.com", "$argon2id$hash", NewUUID())
	if err != nil {
		t.Fatalf("BootstrapFirstAdmin: %v", err)
	}
	if u.Username != "admin" {
		t.Errorf("username = %q", u.Username)
	}

	// bootstrap.completed must now be true.
	done, _ := st.BootstrapCompleted(ctx)
	if !done {
		t.Errorf("bootstrap.completed should be true")
	}

	// The admin must hold a global admin binding.
	has, _ := st.UserHasGlobalRole(ctx, u.ID, RoleIDAdmin)
	if !has {
		t.Errorf("first user must have global admin binding")
	}

	// A second bootstrap must fail (single-shot).
	if _, err := st.BootstrapFirstAdmin(ctx, NewUUID(), "admin2", "", "$argon2id$hash", NewUUID()); err != ErrBootstrapAlreadyDone {
		t.Fatalf("second bootstrap err = %v want ErrBootstrapAlreadyDone", err)
	}
}

func TestUserCRUDAndLoginThrottle(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	u := &User{ID: NewUUID(), Username: "bob", Email: "b@x.io", PasswordHash: "h", IsActive: true}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	got, err := st.GetUserByUsername(ctx, "bob")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if got.ID != u.ID {
		t.Errorf("user id mismatch")
	}

	// Failures accumulate and lock at threshold.
	for i := 0; i < 3; i++ {
		n, err := st.RecordLoginFailure(ctx, u.ID, 3, 0)
		if err != nil {
			t.Fatalf("RecordLoginFailure: %v", err)
		}
		if i == 2 && n != 3 {
			t.Errorf("failed count = %d want 3", n)
		}
	}
	locked, _ := st.GetUserByID(ctx, u.ID)
	if locked.LockedUntil == nil {
		t.Errorf("user should be locked after threshold")
	}

	// Success resets.
	if err := st.RecordLoginSuccess(ctx, u.ID); err != nil {
		t.Fatalf("RecordLoginSuccess: %v", err)
	}
	reset, _ := st.GetUserByID(ctx, u.ID)
	if reset.FailedLogins != 0 || reset.LockedUntil != nil {
		t.Errorf("login success must reset throttle")
	}
}

func TestAuditAppendAndQuery(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		if err := st.InsertAudit(ctx, AuditInput{
			TS: int64(1000 + i), ActorName: "tester", Action: "docker.container.stop",
			TargetType: "container", Result: "success", HTTPStatus: 200,
		}); err != nil {
			t.Fatalf("InsertAudit: %v", err)
		}
	}
	items, next, err := st.ListAudit(ctx, AuditFilter{Limit: 3})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if next == 0 {
		t.Errorf("expected a next cursor for keyset pagination")
	}
	// Newest first (id desc).
	if items[0].ID < items[1].ID {
		t.Errorf("audit not ordered id desc")
	}
}

func TestSessionLifecycle(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	u := &User{ID: NewUUID(), Username: "carol", PasswordHash: "h", IsActive: true}
	_ = st.CreateUser(ctx, u)

	sess := &Session{ID: "hash1", UserID: u.ID, CSRFToken: "csrf", AMR: "pwd",
		CreatedAt: 100, LastSeenAt: 100, ExpiresAt: 1 << 40}
	if err := st.CreateSession(ctx, sess); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	got, err := st.GetSession(ctx, "hash1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.CSRFToken != "csrf" {
		t.Errorf("csrf mismatch")
	}
	if err := st.UpgradeSessionAMR(ctx, "hash1", "pwd+totp"); err != nil {
		t.Fatalf("UpgradeSessionAMR: %v", err)
	}
	up, _ := st.GetSession(ctx, "hash1")
	if up.AMR != "pwd+totp" {
		t.Errorf("amr not upgraded")
	}
	if err := st.RevokeSession(ctx, "hash1"); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}
	rev, _ := st.GetSession(ctx, "hash1")
	if rev.RevokedAt == nil {
		t.Errorf("session not revoked")
	}
}
