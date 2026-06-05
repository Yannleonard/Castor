package authz

import (
	"testing"

	"github.com/gtek-it/castor/server/internal/store"
)

func userWith(roles ...store.EffectiveRole) *User {
	return buildUser(&store.User{ID: "u1", Username: "u"}, "sess", AMRPassword, roles)
}

func TestCanExactPermission(t *testing.T) {
	u := userWith(store.EffectiveRole{
		Permissions: []string{"docker.container.start", "docker.container.stop"},
		ScopeType:   "global",
	})
	if !u.Can("docker.container.start", Scope{Type: "global"}) {
		t.Errorf("expected start granted")
	}
	if u.Can("docker.container.remove", Scope{Type: "global"}) {
		t.Errorf("did not expect remove granted")
	}
}

func TestCanSuperuserWildcard(t *testing.T) {
	u := userWith(store.EffectiveRole{Permissions: []string{"*"}, ScopeType: "global"})
	if !u.Can("docker.container.remove", Scope{Type: "global"}) {
		t.Errorf("'*' must grant any permission")
	}
	if !u.HasGlobalSuperuser() {
		t.Errorf("HasGlobalSuperuser must be true for '*'")
	}
}

func TestCanHierarchicalWildcard(t *testing.T) {
	u := userWith(store.EffectiveRole{Permissions: []string{"docker.container.*"}, ScopeType: "global"})
	if !u.Can("docker.container.start", Scope{Type: "global"}) {
		t.Errorf("docker.container.* must grant docker.container.start")
	}
	if u.Can("docker.image.delete", Scope{Type: "global"}) {
		t.Errorf("docker.container.* must NOT grant docker.image.delete")
	}
}

func TestCanScopeMatching(t *testing.T) {
	// A host-scoped grant applies only to that host.
	u := userWith(store.EffectiveRole{
		Permissions: []string{"docker.container.start"},
		ScopeType:   "host",
		ScopeID:     "hostA",
	})
	if !u.Can("docker.container.start", Scope{Type: "host", ID: "hostA"}) {
		t.Errorf("host-scoped grant must apply to hostA")
	}
	if u.Can("docker.container.start", Scope{Type: "host", ID: "hostB"}) {
		t.Errorf("host-scoped grant must NOT apply to hostB")
	}
}

func TestCanGlobalAppliesEverywhere(t *testing.T) {
	u := userWith(store.EffectiveRole{
		Permissions: []string{"docker.container.start"},
		ScopeType:   "global",
	})
	if !u.Can("docker.container.start", Scope{Type: "host", ID: "anyhost"}) {
		t.Errorf("global grant must apply to any host scope")
	}
}

func TestAllPermissionsDeduplicates(t *testing.T) {
	u := userWith(
		store.EffectiveRole{Permissions: []string{"audit.read", "settings.read"}, ScopeType: "global"},
		store.EffectiveRole{Permissions: []string{"audit.read"}, ScopeType: "host", ScopeID: "h"},
	)
	perms := u.AllPermissions()
	count := map[string]int{}
	for _, p := range perms {
		count[p]++
	}
	if count["audit.read"] != 1 {
		t.Errorf("audit.read should appear once, got %d", count["audit.read"])
	}
}

func TestNilUserCanIsFalse(t *testing.T) {
	var u *User
	if u.Can("anything", Scope{Type: "global"}) {
		t.Errorf("nil user must never be granted a permission")
	}
}
