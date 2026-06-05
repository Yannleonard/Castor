package authz

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/store"
)

func guardTestStore(t *testing.T) *store.Store {
	t.Helper()
	cfg := &config.Config{DBPath: filepath.Join(t.TempDir(), "g.db")}
	st, err := store.Connect(cfg)
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

func adminUser() *User {
	return buildUser(&store.User{ID: "admin", Username: "admin"}, "s", AMRPasswordTOTP,
		[]store.EffectiveRole{{Permissions: []string{"*"}, ScopeType: "global"}})
}

func plainUser() *User {
	return buildUser(&store.User{ID: "op", Username: "op"}, "s", AMRPassword,
		[]store.EffectiveRole{{Permissions: []string{"docker.container.remove"}, ScopeType: "global"}})
}

func TestGuardSelfProtectionAlwaysDenies(t *testing.T) {
	st := guardTestStore(t)
	g := NewGuard(st, "selfcontainerid1234", true)
	r := httptest.NewRequest("DELETE", "/x", nil)
	ctx, _ := withAudit(r.Context())
	r = r.WithContext(ctx)

	ref := ContainerRef{ID: "selfcontainerid1234", Kind: "container"}
	// Even an admin cannot remove Castor's own container.
	if err := g.GuardDestructive(r.Context(), r, ref, adminUser(), true, "because"); err == nil {
		t.Fatalf("admin must NOT be able to destroy Castor's own container")
	}
}

func TestGuardDataVolumeProtected(t *testing.T) {
	st := guardTestStore(t)
	g := NewGuard(st, "self", true)
	r := httptest.NewRequest("DELETE", "/x", nil)
	ctx, _ := withAudit(r.Context())
	r = r.WithContext(ctx)

	ref := ContainerRef{ID: "castor-data", Kind: "volume", IsDataVolume: true}
	if err := g.GuardDestructive(r.Context(), r, ref, adminUser(), true, "x"); err == nil {
		t.Fatalf("the /data volume must be self-protected for everyone")
	}
}

func TestGuardDefaultDenyWhenSelfUnresolved(t *testing.T) {
	st := guardTestStore(t)
	g := NewGuard(st, "", false) // self NOT resolved
	r := httptest.NewRequest("DELETE", "/x", nil)
	ctx, _ := withAudit(r.Context())
	r = r.WithContext(ctx)

	ref := ContainerRef{ID: "somecontainer", Kind: "container"}
	if err := g.GuardDestructive(r.Context(), r, ref, adminUser(), true, "x"); err == nil {
		t.Fatalf("ambiguous self-identity must default-deny container destruction")
	}
}

func TestGuardLabelProtectionNonAdminDenied(t *testing.T) {
	st := guardTestStore(t)
	g := NewGuard(st, "self", true)
	r := httptest.NewRequest("DELETE", "/x", nil)
	ctx, _ := withAudit(r.Context())
	r = r.WithContext(ctx)

	ref := ContainerRef{
		ID:     "c1",
		Kind:   "container",
		Labels: map[string]string{"io.castor.protected": "true"},
	}
	if err := g.GuardDestructive(r.Context(), r, ref, plainUser(), false, ""); err == nil {
		t.Fatalf("non-admin must be denied on protected-labelled container")
	}
}

func TestGuardLabelAdminRequiresConfirmReason(t *testing.T) {
	st := guardTestStore(t)
	g := NewGuard(st, "self", true)

	ref := ContainerRef{
		ID:     "c1",
		Kind:   "container",
		Labels: map[string]string{"io.castor.protected": "true"},
	}

	// Without confirm+reason -> denied.
	r1 := httptest.NewRequest("DELETE", "/x", nil)
	ctx1, _ := withAudit(r1.Context())
	r1 = r1.WithContext(ctx1)
	if err := g.GuardDestructive(r1.Context(), r1, ref, adminUser(), false, ""); err == nil {
		t.Fatalf("admin override without confirm+reason must be denied")
	}

	// With confirm+reason -> allowed.
	r2 := httptest.NewRequest("DELETE", "/x", nil)
	ctx2, _ := withAudit(r2.Context())
	r2 = r2.WithContext(ctx2)
	if err := g.GuardDestructive(r2.Context(), r2, ref, adminUser(), true, "decommissioning"); err != nil {
		t.Fatalf("admin override WITH confirm+reason must be allowed, got %v", err)
	}
}

func TestGuardUnprotectedContainerAllowed(t *testing.T) {
	st := guardTestStore(t)
	g := NewGuard(st, "selfid", true)
	r := httptest.NewRequest("DELETE", "/x", nil)
	ctx, _ := withAudit(r.Context())
	r = r.WithContext(ctx)

	ref := ContainerRef{ID: "ordinary", Kind: "container"}
	if err := g.GuardDestructive(r.Context(), r, ref, plainUser(), false, ""); err != nil {
		t.Fatalf("ordinary container removal must be allowed, got %v", err)
	}
}
