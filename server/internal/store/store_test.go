package store

import (
	"context"
	"path/filepath"
	"testing"

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
