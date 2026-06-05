// ui/src/lib/hooks.ts
// TanStack Query hooks wrapping the API client + small shared lookups.
// Centralizes query keys and stale times so views stay declarative.

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";
import type {
  AuthProvider,
  Backup,
  Capability,
  DashboardMetrics,
  GroupRoleMapping,
  K8sDeployment,
  K8sNode,
  HPAInfo,
  NamespaceInfo,
  ServiceInfoK8s,
  ConfigMapInfo,
  SecretInfo,
  EventInfo,
  IngressInfo,
  NodeMetricsResponse,
  PodMetricsResponse,
  PVInfo,
  PVCInfo,
  StorageClassInfo,
  HelmRepo,
  HelmChart,
  HelmRelease,
  HelmReleaseRevision,
  ProviderInfo,
  Registry,
  RemoteCatalog,
  RoleRecord,
  SettingsResponse,
  SwarmNode,
  SwarmService,
  SwarmSecretInfo,
  SwarmConfigInfo,
  Stack,
  StackDetail,
  Template,
  UserRecord,
  Workload,
  WorkloadDetail,
} from "./types";

export const DEFAULT_HOST = "local";

export const qk = {
  providers: ["providers"] as const,
  hosts: ["hosts"] as const,
  host: (id: string) => ["host", id] as const,
  dashboardMetrics: (id: string) => ["dashboard", "metrics", id] as const,
  workloads: (host: string, params: Record<string, unknown>) =>
    ["workloads", host, params] as const,
  workload: (host: string, id: string) => ["workload", host, id] as const,
  images: (host: string) => ["images", host] as const,
  networks: (host: string) => ["networks", host] as const,
  volumes: (host: string) => ["volumes", host] as const,
  swarmServices: (host: string) => ["swarm", "services", host] as const,
  swarmTasks: (host: string) => ["swarm", "tasks", host] as const,
  swarmNodes: (host: string) => ["swarm", "nodes", host] as const,
  swarmSecrets: (host: string) => ["swarm", "secrets", host] as const,
  swarmConfigs: (host: string) => ["swarm", "configs", host] as const,
  k8sPods: (host: string, ns: string) => ["k8s", "pods", host, ns] as const,
  k8sDeployments: (host: string, ns: string) => ["k8s", "deployments", host, ns] as const,
  k8sNodes: (host: string) => ["k8s", "nodes", host] as const,
  k8sHPAs: (host: string, ns: string) => ["k8s", "hpas", host, ns] as const,
  k8sNamespaces: (host: string) => ["k8s", "namespaces", host] as const,
  k8sServices: (host: string, ns: string) => ["k8s", "services", host, ns] as const,
  k8sConfigMaps: (host: string, ns: string) => ["k8s", "configmaps", host, ns] as const,
  k8sSecrets: (host: string, ns: string) => ["k8s", "secrets", host, ns] as const,
  k8sEvents: (host: string, ns: string) => ["k8s", "events", host, ns] as const,
  k8sIngresses: (host: string, ns: string) => ["k8s", "ingresses", host, ns] as const,
  k8sNodeMetrics: (host: string) => ["k8s", "metrics", "nodes", host] as const,
  k8sPodMetrics: (host: string, ns: string) => ["k8s", "metrics", "pods", host, ns] as const,
  k8sPVs: (host: string) => ["k8s", "pvs", host] as const,
  k8sPVCs: (host: string, ns: string) => ["k8s", "pvcs", host, ns] as const,
  k8sStorageClasses: (host: string) => ["k8s", "storageclasses", host] as const,
  helmRepos: (host: string) => ["helm", "repos", host] as const,
  helmCharts: (host: string, q: string) => ["helm", "charts", host, q] as const,
  helmReleases: (host: string) => ["helm", "releases", host] as const,
  helmReleaseHistory: (host: string, ns: string, name: string) =>
    ["helm", "release", "history", host, ns, name] as const,
  helmReleaseValues: (host: string, ns: string, name: string) =>
    ["helm", "release", "values", host, ns, name] as const,
  users: ["users"] as const,
  roles: ["roles"] as const,
  permissions: ["permissions"] as const,
  settings: ["settings"] as const,
  templates: ["templates"] as const,
  stacks: (host: string) => ["stacks", host] as const,
  stack: (host: string, id: string) => ["stack", host, id] as const,
  backups: (host: string) => ["backups", host] as const,
  registries: ["registries"] as const,
  catalogs: ["catalogs"] as const,
  authProviders: ["authProviders"] as const,
  authProviderMappings: (id: string) => ["authProviderMappings", id] as const,
};

const POLL = 8000; // background refresh cadence for live-ish lists

export function useProviders(opts?: Partial<UseQueryOptions<ProviderInfo[]>>) {
  return useQuery({
    queryKey: qk.providers,
    queryFn: () => api.providers(),
    staleTime: 60_000,
    ...opts,
  });
}

/** Build a lookup providerId -> capabilities, plus kind -> capabilities. */
export function useCapabilityLookup() {
  const { data } = useProviders();
  const byProvider = new Map<string, Capability[]>();
  const byKind = new Map<string, Capability[]>();
  for (const p of data ?? []) {
    byProvider.set(p.id, p.capabilities);
    byKind.set(p.kind, p.capabilities);
  }
  return {
    providers: data ?? [],
    capsForProvider: (id: string | undefined): Capability[] | undefined =>
      id ? byProvider.get(id) : undefined,
    capsForKind: (kind: string | undefined): Capability[] | undefined =>
      kind ? byKind.get(kind) : undefined,
  };
}

export function useHosts() {
  return useQuery({
    queryKey: qk.hosts,
    queryFn: () => api.hosts(),
    refetchInterval: POLL,
  });
}

export function useHost(hostId: string) {
  return useQuery({
    queryKey: qk.host(hostId),
    queryFn: () => api.host(hostId),
    refetchInterval: POLL,
  });
}

/** Aggregated BI-dashboard metrics for a host (live-ish; refetches every 5s). */
export function useDashboardMetrics(
  hostId: string,
  opts?: Partial<UseQueryOptions<DashboardMetrics>>,
) {
  return useQuery<DashboardMetrics>({
    queryKey: qk.dashboardMetrics(hostId),
    queryFn: () => api.dashboardMetrics(hostId),
    refetchInterval: 5000,
    ...opts,
  });
}

export function useWorkloads(
  hostId: string,
  params: { all?: boolean; kind?: string; group?: string; namespace?: string; labelSelector?: string } = {},
  opts?: Partial<UseQueryOptions<Workload[]>>,
) {
  return useQuery({
    queryKey: qk.workloads(hostId, params),
    queryFn: () => api.workloads(hostId, params),
    refetchInterval: POLL,
    ...opts,
  });
}

export function useWorkload(hostId: string, id: string, opts?: Partial<UseQueryOptions<WorkloadDetail>>) {
  return useQuery({
    queryKey: qk.workload(hostId, id),
    queryFn: () => api.workload(hostId, id),
    ...opts,
  });
}

export function useImages(hostId: string) {
  return useQuery({ queryKey: qk.images(hostId), queryFn: () => api.images(hostId), refetchInterval: POLL });
}
export function useNetworks(hostId: string) {
  return useQuery({ queryKey: qk.networks(hostId), queryFn: () => api.networks(hostId), refetchInterval: POLL });
}
export function useVolumes(hostId: string) {
  return useQuery({ queryKey: qk.volumes(hostId), queryFn: () => api.volumes(hostId), refetchInterval: POLL });
}
export function useBackups(hostId: string) {
  return useQuery<Backup[]>({ queryKey: qk.backups(hostId), queryFn: () => api.backups(hostId), refetchInterval: POLL });
}

export function useSwarmServices(hostId: string, enabled = true) {
  return useQuery<SwarmService[]>({
    queryKey: qk.swarmServices(hostId),
    queryFn: () => api.swarmServices(hostId),
    enabled,
    refetchInterval: POLL,
  });
}
export function useSwarmTasks(hostId: string, enabled = true) {
  return useQuery<Workload[]>({
    queryKey: qk.swarmTasks(hostId),
    queryFn: () => api.swarmTasks(hostId),
    enabled,
    refetchInterval: POLL,
  });
}
export function useSwarmNodes(hostId: string, enabled = true) {
  return useQuery<SwarmNode[]>({
    queryKey: qk.swarmNodes(hostId),
    queryFn: () => api.swarmNodes(hostId),
    enabled,
    refetchInterval: POLL,
  });
}
export function useSwarmSecrets(hostId: string, enabled = true) {
  return useQuery<SwarmSecretInfo[]>({
    queryKey: qk.swarmSecrets(hostId),
    queryFn: () => api.swarmSecrets(hostId),
    enabled,
    refetchInterval: POLL,
  });
}
export function useSwarmConfigs(hostId: string, enabled = true) {
  return useQuery<SwarmConfigInfo[]>({
    queryKey: qk.swarmConfigs(hostId),
    queryFn: () => api.swarmConfigs(hostId),
    enabled,
    refetchInterval: POLL,
  });
}

export function useK8sPods(hostId: string, namespace: string, enabled = true) {
  return useQuery<Workload[]>({
    queryKey: qk.k8sPods(hostId, namespace),
    queryFn: () => api.k8sPods(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sDeployments(hostId: string, namespace: string, enabled = true) {
  return useQuery<K8sDeployment[]>({
    queryKey: qk.k8sDeployments(hostId, namespace),
    queryFn: () => api.k8sDeployments(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sNodes(hostId: string, enabled = true) {
  return useQuery<K8sNode[]>({
    queryKey: qk.k8sNodes(hostId),
    queryFn: () => api.k8sNodes(hostId),
    enabled,
    refetchInterval: POLL,
  });
}

/* ----- Kubernetes autoscaling + core cluster objects (Wave 3) ----- */

export function useK8sHPAs(hostId: string, namespace: string, enabled = true) {
  return useQuery<HPAInfo[]>({
    queryKey: qk.k8sHPAs(hostId, namespace),
    queryFn: () => api.k8sHPAs(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sNamespaces(hostId: string, enabled = true) {
  return useQuery<NamespaceInfo[]>({
    queryKey: qk.k8sNamespaces(hostId),
    queryFn: () => api.k8sNamespaces(hostId),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sServices(hostId: string, namespace: string, enabled = true) {
  return useQuery<ServiceInfoK8s[]>({
    queryKey: qk.k8sServices(hostId, namespace),
    queryFn: () => api.k8sServices(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sConfigMaps(hostId: string, namespace: string, enabled = true) {
  return useQuery<ConfigMapInfo[]>({
    queryKey: qk.k8sConfigMaps(hostId, namespace),
    queryFn: () => api.k8sConfigMaps(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sSecrets(hostId: string, namespace: string, enabled = true) {
  return useQuery<SecretInfo[]>({
    queryKey: qk.k8sSecrets(hostId, namespace),
    queryFn: () => api.k8sSecrets(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sEvents(hostId: string, namespace: string, enabled = true) {
  return useQuery<EventInfo[]>({
    queryKey: qk.k8sEvents(hostId, namespace),
    queryFn: () => api.k8sEvents(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sIngresses(hostId: string, namespace: string, enabled = true) {
  return useQuery<IngressInfo[]>({
    queryKey: qk.k8sIngresses(hostId, namespace),
    queryFn: () => api.k8sIngresses(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}

/* ----- Kubernetes live metrics (metrics-server) ----- */
// Refetch a touch faster than the lists (usage is the volatile signal); the
// response carries available:false when metrics-server is not installed.

export function useK8sNodeMetrics(hostId: string, enabled = true) {
  return useQuery<NodeMetricsResponse>({
    queryKey: qk.k8sNodeMetrics(hostId),
    queryFn: () => api.k8sNodeMetrics(hostId),
    enabled,
    refetchInterval: 5000,
  });
}
export function useK8sPodMetrics(hostId: string, namespace: string, enabled = true) {
  return useQuery<PodMetricsResponse>({
    queryKey: qk.k8sPodMetrics(hostId, namespace),
    queryFn: () => api.k8sPodMetrics(hostId, namespace || undefined),
    enabled,
    refetchInterval: 5000,
  });
}

export function useK8sPVs(hostId: string, enabled = true) {
  return useQuery<PVInfo[]>({
    queryKey: qk.k8sPVs(hostId),
    queryFn: () => api.k8sPVs(hostId),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sPVCs(hostId: string, namespace: string, enabled = true) {
  return useQuery<PVCInfo[]>({
    queryKey: qk.k8sPVCs(hostId, namespace),
    queryFn: () => api.k8sPVCs(hostId, namespace || undefined),
    enabled,
    refetchInterval: POLL,
  });
}
export function useK8sStorageClasses(hostId: string, enabled = true) {
  return useQuery<StorageClassInfo[]>({
    queryKey: qk.k8sStorageClasses(hostId),
    queryFn: () => api.k8sStorageClasses(hostId),
    enabled,
    refetchInterval: POLL,
  });
}

/* ---- helm (chart repositories + release lifecycle) ---- */

export function useHelmRepos(hostId: string, enabled = true) {
  return useQuery<HelmRepo[]>({
    queryKey: qk.helmRepos(hostId),
    queryFn: () => api.helmRepos(hostId),
    enabled,
    refetchInterval: POLL,
  });
}

/** Chart search over cached repo indexes (empty query lists every chart). */
export function useHelmCharts(hostId: string, query: string, enabled = true) {
  return useQuery<HelmChart[]>({
    queryKey: qk.helmCharts(hostId, query),
    queryFn: () => api.helmCharts(hostId, query || undefined),
    enabled,
    staleTime: 30_000,
  });
}

export function useHelmReleases(hostId: string, enabled = true) {
  return useQuery<HelmRelease[]>({
    queryKey: qk.helmReleases(hostId),
    queryFn: () => api.helmReleases(hostId),
    enabled,
    refetchInterval: POLL,
  });
}

export function useHelmReleaseHistory(hostId: string, ns: string, name: string, enabled = true) {
  return useQuery<HelmReleaseRevision[]>({
    queryKey: qk.helmReleaseHistory(hostId, ns, name),
    queryFn: () => api.helmReleaseHistory(hostId, ns, name),
    enabled: enabled && !!ns && !!name,
  });
}

/** A release's user-supplied values (overrides only). Opaque object. */
export function useHelmReleaseValues(hostId: string, ns: string, name: string, enabled = true) {
  return useQuery<Record<string, unknown>>({
    queryKey: qk.helmReleaseValues(hostId, ns, name),
    queryFn: () => api.helmReleaseValues(hostId, ns, name),
    enabled: enabled && !!ns && !!name,
  });
}

export function useUsers() {
  return useQuery<UserRecord[]>({ queryKey: qk.users, queryFn: () => api.users() });
}
export function useRoles() {
  return useQuery<RoleRecord[]>({ queryKey: qk.roles, queryFn: () => api.roles() });
}
export function usePermissions() {
  return useQuery<string[]>({ queryKey: qk.permissions, queryFn: () => api.permissions(), staleTime: 300_000 });
}
export function useSettings() {
  return useQuery<SettingsResponse>({ queryKey: qk.settings, queryFn: () => api.settings() });
}

/** Marketplace catalog (built-in + custom templates), merged + source-tagged. */
export function useTemplates(opts?: Partial<UseQueryOptions<Template[]>>) {
  return useQuery<Template[]>({
    queryKey: qk.templates,
    queryFn: () => api.templates(),
    staleTime: 60_000,
    ...opts,
  });
}

/** Compose stacks registered for a host (list). */
export function useStacks(hostId: string, opts?: Partial<UseQueryOptions<Stack[]>>) {
  return useQuery<Stack[]>({
    queryKey: qk.stacks(hostId),
    queryFn: () => api.stacks(hostId),
    refetchInterval: POLL,
    ...opts,
  });
}

/** One stack plus its live containers (detail). */
export function useStackDetail(hostId: string, id: string, opts?: Partial<UseQueryOptions<StackDetail>>) {
  return useQuery<StackDetail>({
    queryKey: qk.stack(hostId, id),
    queryFn: () => api.stackDetail(hostId, id),
    ...opts,
  });
}

/** Image registry credentials (admin; secrets never present). */
export function useRegistries(opts?: Partial<UseQueryOptions<Registry[]>>) {
  return useQuery<Registry[]>({ queryKey: qk.registries, queryFn: () => api.registries(), ...opts });
}

/** Remote template catalog sources (admin). */
export function useCatalogs(opts?: Partial<UseQueryOptions<RemoteCatalog[]>>) {
  return useQuery<RemoteCatalog[]>({ queryKey: qk.catalogs, queryFn: () => api.catalogs(), ...opts });
}

/** External auth providers (admin, superuser; secrets never present). */
export function useAuthProviders(opts?: Partial<UseQueryOptions<AuthProvider[]>>) {
  return useQuery<AuthProvider[]>({
    queryKey: qk.authProviders,
    queryFn: () => api.authProvidersAdmin(),
    ...opts,
  });
}

/** A provider's group->role mappings (admin, superuser). */
export function useProviderMappings(providerId: string, opts?: Partial<UseQueryOptions<GroupRoleMapping[]>>) {
  return useQuery<GroupRoleMapping[]>({
    queryKey: qk.authProviderMappings(providerId),
    queryFn: () => api.authProviderMappings(providerId),
    ...opts,
  });
}
