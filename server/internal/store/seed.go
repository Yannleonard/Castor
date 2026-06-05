package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"
)

// Built-in role ids are deterministic so the rest of the system (e.g.
// last-admin protection) can reference the admin role without a name lookup.
const (
	RoleIDAdmin    = "role-admin"
	RoleIDOperator = "role-operator"
	RoleIDViewer   = "role-viewer"
)

// AllReadPermissions is every *.read permission, granted to viewer (and folded
// into operator). Single source of truth shared with the permission catalog.
var AllReadPermissions = []string{
	"docker.container.read",
	"docker.image.read",
	"docker.network.read",
	"docker.volume.read",
	"swarm.service.read",
	"swarm.task.read",
	"swarm.node.read",
	"swarm.secret.read",
	"swarm.config.read",
	"k8s.pod.read",
	"k8s.deployment.read",
	"k8s.node.read",
	"k8s.hpa.read",
	"k8s.namespace.read",
	"k8s.service.read",
	"k8s.config.read",
	"k8s.ingress.read",
	"k8s.metrics.read",
	"k8s.storage.read",
	"helm.repo.read",
	"helm.release.read",
	"audit.read",
	"settings.read",
}

// operatorExtraPermissions are operator's grants beyond *.read (EXCLUDES
// container.remove, image.delete, volume.remove, volume.restore, all rbac.*).
// volume.backup IS granted (a non-destructive export); volume.restore is NOT
// (it overwrites a volume's contents, like a delete) — admin only.
var operatorExtraPermissions = []string{
	"docker.container.start",
	"docker.container.stop",
	"docker.container.restart",
	"docker.container.pause",
	"docker.container.unpause",
	"docker.container.logs",
	"docker.container.stats",
	"docker.container.exec",
	// NB: docker.container.create is intentionally NOT granted to operator by
	// default. Creating a container is the host-mount / privilege escalation
	// vector (it is the only verb that can request a bind mount), so it is
	// admin-only via the "*" grant — though it remains a real, assignable
	// permission (an admin can grant it to a custom role). Start/stop/restart/
	// remove operate on EXISTING containers and stay with operator.
	"docker.image.pull",
	"docker.volume.backup",
	// Swarm service day-to-day ops: scale + update (rolling restart reuses the
	// update permission). Create/remove and node availability are destructive/
	// infra-level and stay admin-only (like container.remove).
	"swarm.service.scale",
	"swarm.service.update",
	// Swarm secrets + configs: create+delete. Granted to operators because a
	// swarm secret is write-only after creation (no value is ever readable), so
	// creating one cannot leak data, and managing configs/secrets is part of
	// day-to-day service operation. Reads come from AllReadPermissions.
	"swarm.secret.write",
	"swarm.config.write",
	// Kubernetes Deployment day-to-day ops: scale + rollout restart + set
	// resource requests/limits. Deleting workloads (k8s.workload.delete) and
	// applying manifests (k8s.manifest.apply) are destructive/cluster-level and
	// stay admin-only.
	"k8s.deployment.scale",
	"k8s.deployment.restart",
	"k8s.deployment.resources",
	// Kubernetes autoscaling: create/delete HorizontalPodAutoscalers (day-to-day
	// scaling policy). Creating/deleting Namespaces (k8s.namespace.write) is a
	// cluster-level action and stays admin-only.
	"k8s.hpa.write",
	// Kubernetes ingresses: delete an Ingress (create/update is the manifest-apply
	// path). Routing changes are day-to-day ops, so operators get the write; the
	// read comes from AllReadPermissions.
	"k8s.ingress.write",
	// Kubernetes storage: provision (create) + delete PVCs. PVC create is a
	// provisioning request (non-destructive); delete reclaims per the volume's
	// reclaim policy. Granted to operators alongside the day-to-day workload ops.
	"k8s.storage.write",
	// Helm day-to-day ops: manage chart repositories and install/upgrade/rollback
	// releases. Uninstalling a release (helm.release.uninstall) tears down its
	// Kubernetes objects, so like k8s.workload.delete it stays admin-only.
	"helm.repo.write",
	"helm.release.install",
	"helm.release.upgrade",
	"helm.release.rollback",
}

// Seed inserts the built-in roles, the local host row, and default settings.
// It is idempotent: existing rows are left untouched (INSERT OR IGNORE / upsert
// guards), so repeated startups do not clobber operator changes.
func (s *Store) Seed(ctx context.Context) error {
	now := time.Now().Unix()

	if err := s.seedRole(ctx, RoleIDAdmin, "admin",
		"Full superuser access to every Castor capability.", true,
		[]string{"*"}, now); err != nil {
		return err
	}
	operatorPerms := append(append([]string{}, AllReadPermissions...), operatorExtraPermissions...)
	if err := s.seedRole(ctx, RoleIDOperator, "operator",
		"Day-to-day operations: start/stop/restart, logs, stats, exec, image pull. No deletes, no RBAC.", true,
		operatorPerms, now); err != nil {
		return err
	}
	if err := s.seedRole(ctx, RoleIDViewer, "viewer",
		"Read-only visibility across all orchestrators.", true,
		append([]string{}, AllReadPermissions...), now); err != nil {
		return err
	}

	// Local host (single 'local' row in V1).
	if _, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO registered_hosts
			(id, name, kind, connection, endpoint, status, created_at)
		 VALUES ('local', 'Local Engine', 'docker', 'local-socket', '/var/run/docker.sock', 'connected', ?)`,
		now); err != nil {
		return err
	}

	// Default settings (idempotent: only insert if missing).
	if err := s.seedSettingIfMissing(ctx, SettingBootstrapCompleted, "false"); err != nil {
		return err
	}
	if err := s.seedSettingIfMissing(ctx, SettingInstanceID, newUUID()); err != nil {
		return err
	}
	if err := s.seedSettingIfMissing(ctx, SettingTOTPRequiredForMut, "false"); err != nil {
		return err
	}
	// NB: session.ttl_seconds is deliberately NOT seeded. While the row is absent
	// the sliding TTL is governed by CASTOR_SESSION_TTL (config default 12h); the
	// first save from the Settings UI writes the row, which then takes precedence
	// at runtime (see authz.Deps.slidingTTL). Seeding a value here would shadow the
	// env var permanently. GetSettings falls back to 43200 (12h) for display.
	protectedLabels, _ := json.Marshal([]string{"io.castor.protected"})
	if err := s.seedSettingIfMissing(ctx, SettingProtectedLabels, string(protectedLabels)); err != nil {
		return err
	}
	return nil
}

func (s *Store) seedRole(ctx context.Context, id, name, desc string, builtin bool, perms []string, now int64) error {
	permsJSON, err := json.Marshal(normPerms(perms))
	if err != nil {
		return err
	}
	// Insert if missing; otherwise refresh the permission set of built-in roles
	// so upgrades that add permissions to a built-in role take effect, without
	// touching user-created roles.
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO roles (id, name, description, is_builtin, permissions, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
			permissions = excluded.permissions,
			description = excluded.description,
			updated_at  = excluded.updated_at
		 WHERE roles.is_builtin = 1`,
		id, name, nullStr(desc), boolInt(builtin), string(permsJSON), now, now)
	return err
}

func (s *Store) seedSettingIfMissing(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
		key, value, time.Now().Unix())
	return err
}

// newUUID returns a RFC4122-ish v4 UUID string from crypto/rand.
func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failure is fatal for security; surface a recognizable value.
		return "00000000-0000-0000-0000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	dst := make([]byte, 36)
	hex.Encode(dst[0:8], b[0:4])
	dst[8] = '-'
	hex.Encode(dst[9:13], b[4:6])
	dst[13] = '-'
	hex.Encode(dst[14:18], b[6:8])
	dst[18] = '-'
	hex.Encode(dst[19:23], b[8:10])
	dst[23] = '-'
	hex.Encode(dst[24:36], b[10:16])
	return string(dst)
}

// NewUUID is the exported UUID generator used across the codebase.
func NewUUID() string { return newUUID() }
