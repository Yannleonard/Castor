package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// loginLimited bootstraps an admin (to leave bootstrap mode), then creates a
// "limited" user holding a custom role with exactly the given permissions, logs
// in as that user, and returns its session cookies + CSRF token. The limited
// user always also holds rbac.role.create/update and rbac.binding.create so the
// RBAC endpoints themselves are reachable (the grant-only guard is what's under
// test, not the route permission).
func loginLimited(t *testing.T, e *testEnv, perms []string) ([]*http.Cookie, string, string) {
	t.Helper()
	ctx := context.Background()

	// Out of bootstrap mode.
	e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")

	full := append([]string{
		"rbac.role.create", "rbac.role.update", "rbac.binding.create", "rbac.role.read", "rbac.user.read",
	}, perms...)
	roleID := store.NewUUID()
	if err := e.st.CreateRole(ctx, &store.Role{
		ID: roleID, Name: "limited-" + roleID[:8], Permissions: full,
	}); err != nil {
		t.Fatalf("CreateRole(limited): %v", err)
	}

	hash, err := authz.HashPassword("limitedpassword1")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	uid := store.NewUUID()
	if err := e.st.CreateUser(ctx, &store.User{ID: uid, Username: "limited", PasswordHash: hash, IsActive: true}); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := e.st.CreateBinding(ctx, &store.Binding{
		ID: store.NewUUID(), UserID: uid, RoleID: roleID, ScopeType: "global",
	}); err != nil {
		t.Fatalf("CreateBinding(limited): %v", err)
	}

	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "limited", "password": "limitedpassword1",
	}, nil, "")
	if rec.Code != 200 {
		t.Fatalf("limited login = %d (%s)", rec.Code, rec.Body.String())
	}
	csrf, _ := decodeBody(t, rec)["csrfToken"].(string)
	return rec.Result().Cookies(), csrf, uid
}

// TestCreateRoleRejectsUnheldPermission: a user who holds docker.container.start
// (but not docker.image.delete and not "*") cannot mint a role carrying perms
// they lack — the self-escalation foot-gun. The denial is 403 and audited.
func TestCreateRoleRejectsUnheldPermission(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.start"})

	// (1) Cannot grant "*".
	rec := e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "wannabe-admin", "permissions": []string{"*"},
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("create role with '*' = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
	if decodeBody(t, rec)["error"].(map[string]any)["code"] != "forbidden" {
		t.Errorf("expected forbidden code")
	}

	// (2) Cannot grant a specific perm they don't hold.
	rec = e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "wannabe-deleter", "permissions": []string{"docker.image.delete"},
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("create role with unheld perm = %d want 403 (%s)", rec.Code, rec.Body.String())
	}

	// (3) Cannot grant a broad wildcard while holding only a narrow perm.
	rec = e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "wannabe-docker", "permissions": []string{"docker.*"},
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("create role with docker.* (holding only docker.container.start) = %d want 403 (%s)", rec.Code, rec.Body.String())
	}

	// The audited denial(s) must be recorded as result=denied.
	entries, _, err := e.st.ListAudit(context.Background(), store.AuditFilter{Action: "rbac.role.create"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected audited rbac.role.create denials")
	}
	for _, en := range entries {
		if en.Result != "denied" || en.HTTPStatus != http.StatusForbidden {
			t.Errorf("audit row result=%q status=%d want denied/403", en.Result, en.HTTPStatus)
		}
	}
}

// TestCreateRoleAllowsHeldPermission: the same user CAN create a role carrying
// only permissions they actually hold.
func TestCreateRoleAllowsHeldPermission(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.start", "docker.container.stop"})

	rec := e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "lifecycle-only", "permissions": []string{"docker.container.start", "docker.container.stop"},
	}, cookies, csrf)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create role with held perms = %d want 201 (%s)", rec.Code, rec.Body.String())
	}
}

// TestCreateBindingRejectsRoleWithUnheldPermission: a user with
// rbac.binding.create but only narrow perms cannot bind the built-in admin ("*")
// role to anyone (incl. themselves) — the binding-side escalation vector.
func TestCreateBindingRejectsRoleWithUnheldPermission(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.container.start"})

	// Create a victim user to bind onto (binding onto self would also be denied).
	ctx := context.Background()
	hash, _ := authz.HashPassword("victimpassword1")
	victim := store.NewUUID()
	if err := e.st.CreateUser(ctx, &store.User{ID: victim, Username: "victim", PasswordHash: hash, IsActive: true}); err != nil {
		t.Fatalf("CreateUser(victim): %v", err)
	}

	// Bind the admin role ("*") -> must be denied: actor doesn't hold "*".
	rec := e.do(t, http.MethodPost, "/api/v1/users/"+victim+"/roles", map[string]any{
		"roleId": store.RoleIDAdmin, "scopeType": "global",
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("bind admin role = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
	if decodeBody(t, rec)["error"].(map[string]any)["code"] != "forbidden" {
		t.Errorf("expected forbidden code")
	}

	// Binding the viewer role (only *.read) is ALSO denied here because the actor
	// does not hold those read perms either — proving the check is over the bound
	// role's whole permission set.
	rec = e.do(t, http.MethodPost, "/api/v1/users/"+victim+"/roles", map[string]any{
		"roleId": store.RoleIDViewer, "scopeType": "global",
	}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("bind viewer role (unheld reads) = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
}

// TestAdminCanBindAndGrantFreely: a global superuser ("*") is unaffected by the
// grant-only guard — they may create any role and bind any role.
func TestAdminCanBindAndGrantFreely(t *testing.T) {
	e := newTestEnv(t)

	e.do(t, http.MethodPost, "/api/v1/bootstrap", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")
	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"username": "admin", "password": "supersecretpw1",
	}, nil, "")
	cookies := rec.Result().Cookies()
	csrf, _ := decodeBody(t, rec)["csrfToken"].(string)

	// Admin can create a role carrying "*".
	rec = e.do(t, http.MethodPost, "/api/v1/roles", map[string]any{
		"name": "superrole", "permissions": []string{"*"},
	}, cookies, csrf)
	if rec.Code != http.StatusCreated {
		t.Fatalf("admin create '*' role = %d want 201 (%s)", rec.Code, rec.Body.String())
	}

	// Admin can bind the built-in admin role to a new user.
	ctx := context.Background()
	hash, _ := authz.HashPassword("newadminpass12")
	nu := store.NewUUID()
	if err := e.st.CreateUser(ctx, &store.User{ID: nu, Username: "newadmin", PasswordHash: hash, IsActive: true}); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	rec = e.do(t, http.MethodPost, "/api/v1/users/"+nu+"/roles", map[string]any{
		"roleId": store.RoleIDAdmin, "scopeType": "global",
	}, cookies, csrf)
	if rec.Code != http.StatusCreated {
		t.Fatalf("admin bind admin role = %d want 201 (%s)", rec.Code, rec.Body.String())
	}
}
