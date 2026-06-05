package authz

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gtek-it/castor/server/internal/store"
)

// ContainerRef is the minimal description of a destructive-action target the
// guard needs. It is populated from the cache snapshot (no live daemon call).
type ContainerRef struct {
	ID        string
	Name      string
	Labels    map[string]string
	Protected bool   // provider already flagged it (self or castor.protected)
	Kind      string // "container" | "volume" | "image" | "network"
	// IsDataVolume marks the volume holding /data (self-protection extends here).
	IsDataVolume bool
}

// Guard holds the self-identity and label policy for destructive actions. It is
// constructed once at startup (self id resolved by the docker provider) and
// consulted by GuardDestructive.
type Guard struct {
	store           *store.Store
	selfContainerID string
	// selfResolved is false if self-identity could not be positively determined;
	// the guard then default-denies destructive actions (anti-foot-gun).
	selfResolved bool
}

// NewGuard builds a Guard. selfContainerID may be empty; selfResolved records
// whether self-identity was positively determined.
func NewGuard(st *store.Store, selfContainerID string, selfResolved bool) *Guard {
	return &Guard{store: st, selfContainerID: selfContainerID, selfResolved: selfResolved}
}

// protectedLabels returns the configured protected label keys (default
// ["io.castor.protected"]).
func (g *Guard) protectedLabels(ctx context.Context) []string {
	raw := g.store.GetSettingDefault(ctx, store.SettingProtectedLabels, `["io.castor.protected"]`)
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil || len(out) == 0 {
		return []string{"io.castor.protected"}
	}
	return out
}

// GuardDestructive runs at the top of every destructive Docker handler, AFTER
// RequirePermission and BEFORE the provider call. Rules (ADR-CASTOR-003 §7):
//
//  1. Self-protection (non-disable-able): hard-deny any destructive action on
//     Castor's own container or the /data volume, for EVERYONE incl. admin.
//  2. Label-based: a container carrying a protected label is denied for
//     non-admins; admins must pass confirm=true + reason (recorded to audit).
//  3. Default-deny on ambiguity: if self-identity is unresolved, deny.
//
// confirm/reason come from the request body (admin override path). The returned
// error is an *APIError (ErrProtected/ErrForbidden) ready for WriteError.
func (g *Guard) GuardDestructive(ctx context.Context, r *http.Request, ref ContainerRef, actor *User, confirm bool, reason string) error {
	// (3) Default-deny on ambiguity for container targets.
	if ref.Kind == "container" && !g.selfResolved {
		markResult(r, "denied", map[string]any{"protected": "self_unresolved"})
		return Errorf(ErrProtected, "Refusing destructive action: Castor cannot positively identify its own container.")
	}

	// (1) Self-protection — Castor's own container or the /data volume.
	if g.isSelf(ref) {
		markResult(r, "denied", map[string]any{"protected": "self"})
		return Errorf(ErrProtected, "This is Castor's own resource and is permanently protected.")
	}

	// (2) Label-based protection.
	if g.hasProtectedLabel(ctx, ref) || ref.Protected {
		if actor == nil || !actor.HasGlobalSuperuser() {
			markResult(r, "denied", map[string]any{"protected": "label"})
			return Errorf(ErrProtected, "This resource is marked protected. Only an administrator may modify it.")
		}
		// Admin override requires explicit confirmation + reason.
		if !confirm || strings.TrimSpace(reason) == "" {
			markResult(r, "denied", map[string]any{"protected": "label_admin_unconfirmed"})
			return Errorf(ErrProtected, "This resource is protected. Provide confirm=true and a reason to override.")
		}
		AddAuditDetail(r, "override", true)
		AddAuditDetail(r, "reason", reason)
		AddAuditDetail(r, "protected", "label_admin_override")
	}
	return nil
}

// isSelf reports whether ref is Castor's own container or its data volume.
func (g *Guard) isSelf(ref ContainerRef) bool {
	if ref.IsDataVolume {
		return true
	}
	if ref.Kind != "container" {
		return false
	}
	if g.selfContainerID == "" {
		return false
	}
	// Container ids may be short or long; compare by prefix in both directions.
	a, b := ref.ID, g.selfContainerID
	if a == b {
		return true
	}
	if len(a) >= 12 && len(b) >= 12 {
		return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
	}
	return false
}

// hasProtectedLabel reports whether ref carries any configured protected label
// set to "true".
func (g *Guard) hasProtectedLabel(ctx context.Context, ref ContainerRef) bool {
	if len(ref.Labels) == 0 {
		return false
	}
	for _, key := range g.protectedLabels(ctx) {
		if v, ok := ref.Labels[key]; ok && strings.EqualFold(strings.TrimSpace(v), "true") {
			return true
		}
	}
	return false
}

// SelfContainerID exposes the resolved self id (for the provider's Protected flag).
func (g *Guard) SelfContainerID() string { return g.selfContainerID }
