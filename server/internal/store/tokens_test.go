// Castor by IT Leonard
package store

import (
	"context"
	"errors"
	"testing"
)

func TestAPITokenLifecycle(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	owner := &User{ID: NewUUID(), Username: "dave", PasswordHash: "h", IsActive: true}
	if err := st.CreateUser(ctx, owner); err != nil {
		t.Fatalf("CreateUser owner: %v", err)
	}
	other := &User{ID: NewUUID(), Username: "eve", PasswordHash: "h", IsActive: true}
	if err := st.CreateUser(ctx, other); err != nil {
		t.Fatalf("CreateUser other: %v", err)
	}

	exp := int64(5000)
	older := &APIToken{ID: "hash-a", UserID: owner.ID, Name: "ci", Prefix: "aaaaaaaa", CreatedAt: 100}
	newer := &APIToken{ID: "hash-b", UserID: owner.ID, Name: "deploy", Prefix: "bbbbbbbb", CreatedAt: 200, ExpiresAt: &exp}
	for _, tok := range []*APIToken{older, newer} {
		if err := st.CreateAPIToken(ctx, tok); err != nil {
			t.Fatalf("CreateAPIToken(%s): %v", tok.Name, err)
		}
	}

	// Get by hashed id round-trips all fields.
	got, err := st.GetAPITokenByID(ctx, "hash-b")
	if err != nil {
		t.Fatalf("GetAPITokenByID: %v", err)
	}
	if got.UserID != owner.ID || got.Name != "deploy" || got.Prefix != "bbbbbbbb" {
		t.Errorf("token fields mismatch: %+v", got)
	}
	if got.ExpiresAt == nil || *got.ExpiresAt != exp {
		t.Errorf("expires_at not round-tripped: %v", got.ExpiresAt)
	}
	if got.LastUsedAt != nil || got.RevokedAt != nil {
		t.Errorf("fresh token must have nil last_used_at/revoked_at: %+v", got)
	}
	if _, err := st.GetAPITokenByID(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown id err = %v want ErrNotFound", err)
	}

	// List is scoped to the user, newest first.
	list, err := st.ListAPITokensForUser(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListAPITokensForUser: %v", err)
	}
	if len(list) != 2 || list[0].ID != "hash-b" || list[1].ID != "hash-a" {
		t.Errorf("list not ordered created_at desc: %+v", list)
	}
	if empty, _ := st.ListAPITokensForUser(ctx, other.ID); len(empty) != 0 {
		t.Errorf("other user must see no tokens, got %d", len(empty))
	}

	// Touch stamps last_used_at.
	if err := st.TouchAPIToken(ctx, "hash-a", 500); err != nil {
		t.Fatalf("TouchAPIToken: %v", err)
	}
	touched, _ := st.GetAPITokenByID(ctx, "hash-a")
	if touched.LastUsedAt == nil || *touched.LastUsedAt != 500 {
		t.Errorf("last_used_at = %v want 500", touched.LastUsedAt)
	}

	// Revoke by a NON-owner must not match (ErrNotFound, row untouched).
	if err := st.RevokeAPIToken(ctx, "hash-a", other.ID, 600); !errors.Is(err, ErrNotFound) {
		t.Errorf("foreign revoke err = %v want ErrNotFound", err)
	}
	still, _ := st.GetAPITokenByID(ctx, "hash-a")
	if still.RevokedAt != nil {
		t.Errorf("foreign revoke must not soft-delete the token")
	}

	// Owner revoke soft-deletes; the row survives for the UI list.
	if err := st.RevokeAPIToken(ctx, "hash-a", owner.ID, 600); err != nil {
		t.Fatalf("RevokeAPIToken: %v", err)
	}
	revoked, _ := st.GetAPITokenByID(ctx, "hash-a")
	if revoked.RevokedAt == nil || *revoked.RevokedAt != 600 {
		t.Errorf("revoked_at = %v want 600", revoked.RevokedAt)
	}

	// Double revoke matches no live row.
	if err := st.RevokeAPIToken(ctx, "hash-a", owner.ID, 700); !errors.Is(err, ErrNotFound) {
		t.Errorf("double revoke err = %v want ErrNotFound", err)
	}

	// Deleting the user cascades its tokens.
	if err := st.DeleteUser(ctx, owner.ID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	if _, err := st.GetAPITokenByID(ctx, "hash-b"); !errors.Is(err, ErrNotFound) {
		t.Errorf("tokens must cascade on user delete, err = %v", err)
	}
}
