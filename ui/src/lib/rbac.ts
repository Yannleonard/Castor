// ui/src/lib/rbac.ts
// Client-side permission + capability gating helpers.
// The permission vocabulary here MUST mirror the backend authz vocabulary
// (the single source of truth in the contract). Wildcard "*" = superuser.
//
// IMPORTANT: this is a UX affordance only (grey-out-before-click). The backend
// re-checks every permission; the UI never relies on this for security.

import type { Capability, OrchestratorKind } from "./types";

/** Returns true if the permission set grants `perm`. */
export function can(permissions: string[] | undefined, perm: string): boolean {
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes("*")) return true;
  if (permissions.includes(perm)) return true;
  // domain wildcards (e.g. "docker.container.*") are NOT in the seeded vocabulary,
  // but support them defensively if a custom role uses one.
  const parts = perm.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join(".") + ".*";
    if (permissions.includes(prefix)) return true;
  }
  return false;
}

/** True if ANY of the listed permissions is granted. */
export function canAny(permissions: string[] | undefined, perms: string[]): boolean {
  return perms.some((p) => can(permissions, p));
}

/** Capability check against a provider's capability list. */
export function hasCap(caps: Capability[] | undefined, want: Capability): boolean {
  return !!caps && caps.includes(want);
}

/** Read-only marker. */
export function isReadOnly(caps: Capability[] | undefined): boolean {
  return hasCap(caps, "readonly");
}

/* ---- Map a workload lifecycle action to its (capability, permission) pair. ---- */

export type WorkloadAction = "start" | "stop" | "restart" | "remove";

const ACTION_CAP: Record<WorkloadAction, Capability> = {
  start: "start",
  stop: "stop",
  restart: "restart",
  remove: "remove",
};

const ACTION_PERM: Record<WorkloadAction, string> = {
  start: "docker.container.start",
  stop: "docker.container.stop",
  restart: "docker.container.restart",
  remove: "docker.container.remove",
};

export interface GateResult {
  allowed: boolean;
  reason: string; // empty when allowed; tooltip text otherwise
}

/**
 * Decide whether a workload lifecycle action should be enabled.
 * Combines provider capability (grey-out per ADR-002) and user permission.
 */
export function gateWorkloadAction(
  action: WorkloadAction,
  kind: OrchestratorKind,
  caps: Capability[] | undefined,
  permissions: string[] | undefined,
): GateResult {
  // Swarm / Kubernetes are read-only in V1: no lifecycle buttons at all.
  if (kind !== "docker" || isReadOnly(caps)) {
    return { allowed: false, reason: `${labelKind(kind)} is read-only in this version` };
  }
  if (!hasCap(caps, ACTION_CAP[action])) {
    return { allowed: false, reason: `Provider does not support ${action}` };
  }
  if (!can(permissions, ACTION_PERM[action])) {
    return { allowed: false, reason: `You lack the ${ACTION_PERM[action]} permission` };
  }
  return { allowed: true, reason: "" };
}

/** Logs gate (docker.container.logs + CapLogs). */
export function gateLogs(caps: Capability[] | undefined, permissions: string[] | undefined): GateResult {
  if (!hasCap(caps, "logs")) return { allowed: false, reason: "Provider does not support logs" };
  if (!can(permissions, "docker.container.logs"))
    return { allowed: false, reason: "You lack the docker.container.logs permission" };
  return { allowed: true, reason: "" };
}

/** Stats gate (docker.container.stats + CapStats). k8s has no CapStats. */
export function gateStats(caps: Capability[] | undefined, permissions: string[] | undefined): GateResult {
  if (!hasCap(caps, "stats")) return { allowed: false, reason: "Stats not available for this orchestrator" };
  if (!can(permissions, "docker.container.stats"))
    return { allowed: false, reason: "You lack the docker.container.stats permission" };
  return { allowed: true, reason: "" };
}

/** Exec gate (docker.container.exec + CapExec). */
export function gateExec(caps: Capability[] | undefined, permissions: string[] | undefined): GateResult {
  if (!hasCap(caps, "exec")) return { allowed: false, reason: "Exec not supported by this orchestrator" };
  if (!can(permissions, "docker.container.exec"))
    return { allowed: false, reason: "You lack the docker.container.exec permission" };
  return { allowed: true, reason: "" };
}

/* ===================== Swarm + Kubernetes write gates ===================== */
//
// Swarm services and Kubernetes deployments/pods are mutated through dedicated
// endpoints (not the generic container Provider interface). The provider drops
// CapReadOnly once writable, so the gate opens when the user holds the matching
// permission and the orchestrator is no longer read-only. We still grey-out when
// CapReadOnly is present (e.g. an engine that only advertises a read-only swarm).

/** Swarm service lifecycle permissions, keyed by action. */
export const SWARM_SERVICE_PERM = {
  create: "swarm.service.create",
  scale: "swarm.service.scale",
  update: "swarm.service.update",
  restart: "swarm.service.update", // forced no-op spec update reuses update
  remove: "swarm.service.remove",
} as const;

export type SwarmServiceAction = keyof typeof SWARM_SERVICE_PERM;

/** Gate a swarm service write (create/scale/update/restart/remove). */
export function gateSwarmService(
  action: SwarmServiceAction,
  caps: Capability[] | undefined,
  permissions: string[] | undefined,
): GateResult {
  if (isReadOnly(caps)) return { allowed: false, reason: "Swarm is read-only on this host" };
  const perm = SWARM_SERVICE_PERM[action];
  if (!can(permissions, perm)) return { allowed: false, reason: `You lack the ${perm} permission` };
  return { allowed: true, reason: "" };
}

/** Gate a swarm node availability change (active/pause/drain). */
export function gateSwarmNode(
  caps: Capability[] | undefined,
  permissions: string[] | undefined,
): GateResult {
  if (isReadOnly(caps)) return { allowed: false, reason: "Swarm is read-only on this host" };
  if (!can(permissions, "swarm.node.update"))
    return { allowed: false, reason: "You lack the swarm.node.update permission" };
  return { allowed: true, reason: "" };
}

/* ----- Swarm secrets & configs ----- */
//
// Secrets and configs are managed through dedicated endpoints. Reads list
// metadata only (values are never returned for secrets); a single write
// permission covers both create AND delete in each domain, mirroring the backend
// router (swarm.secret.write / swarm.config.write). Like the service gates, the
// gate stays closed while the provider advertises read-only.

/** Swarm secret/config write permissions, keyed by domain. */
export const SWARM_SECRET_WRITE_PERM = {
  secret: "swarm.secret.write", // secret create + delete
  config: "swarm.config.write", // config create + delete
} as const;

export type SwarmSecretDomain = keyof typeof SWARM_SECRET_WRITE_PERM;

/** Gate a swarm secret/config write (create + delete share one permission). */
export function gateSwarmSecret(
  domain: SwarmSecretDomain,
  caps: Capability[] | undefined,
  permissions: string[] | undefined,
): GateResult {
  if (isReadOnly(caps)) return { allowed: false, reason: "Swarm is read-only on this host" };
  const perm = SWARM_SECRET_WRITE_PERM[domain];
  if (!can(permissions, perm)) return { allowed: false, reason: `You lack the ${perm} permission` };
  return { allowed: true, reason: "" };
}

/** Kubernetes write permissions, keyed by action. */
export const K8S_PERM = {
  scale: "k8s.deployment.scale",
  restart: "k8s.deployment.restart",
  resources: "k8s.deployment.resources", // set CPU/memory requests+limits
  delete: "k8s.workload.delete", // deployment + pod deletion share this perm
  apply: "k8s.manifest.apply",
} as const;

export type K8sAction = keyof typeof K8S_PERM;

/** Gate a Kubernetes write (scale/restart/delete/apply). */
export function gateK8s(
  action: K8sAction,
  caps: Capability[] | undefined,
  permissions: string[] | undefined,
): GateResult {
  if (isReadOnly(caps)) return { allowed: false, reason: "Kubernetes is read-only on this host" };
  const perm = K8S_PERM[action];
  if (!can(permissions, perm)) return { allowed: false, reason: `You lack the ${perm} permission` };
  return { allowed: true, reason: "" };
}

/* ----- Kubernetes storage / autoscaling / namespaces (Wave 3) ----- */
//
// These mutate dedicated cluster objects (PVCs, HPAs, Namespaces). PVC + HPA
// writes share one "*.write" permission for create AND delete; Namespace
// create/delete is cluster-level (admin-only) but uses the same single write
// permission. Like gateK8s, the gate stays closed while the provider advertises
// read-only.

/** Kubernetes cluster-object write permissions, keyed by domain. */
export const K8S_CLUSTER_WRITE_PERM = {
  storage: "k8s.storage.write", // PVC create + delete
  hpa: "k8s.hpa.write", // HPA create + delete
  namespace: "k8s.namespace.write", // Namespace create + delete (admin-only)
  ingress: "k8s.ingress.write", // Ingress delete (create/update via manifest apply)
} as const;

export type K8sClusterDomain = keyof typeof K8S_CLUSTER_WRITE_PERM;

/**
 * Gate a Kubernetes cluster-object write (PVC / HPA / Namespace create+delete).
 * One permission covers both create and delete in each domain, mirroring the
 * backend router (k8s.storage.write / k8s.hpa.write / k8s.namespace.write).
 */
export function gateK8sCluster(
  domain: K8sClusterDomain,
  caps: Capability[] | undefined,
  permissions: string[] | undefined,
): GateResult {
  if (isReadOnly(caps)) return { allowed: false, reason: "Kubernetes is read-only on this host" };
  const perm = K8S_CLUSTER_WRITE_PERM[domain];
  if (!can(permissions, perm)) return { allowed: false, reason: `You lack the ${perm} permission` };
  return { allowed: true, reason: "" };
}

function labelKind(kind: OrchestratorKind): string {
  switch (kind) {
    case "docker":
      return "Docker";
    case "swarm":
      return "Swarm";
    case "kubernetes":
      return "Kubernetes";
    default:
      return kind;
  }
}
