// ui/src/lib/api.ts
// Typed fetch wrapper for the Castor REST contract.
// - credentials: 'include' (session cookie castor_session is HttpOnly).
// - mutations (POST/PUT/PATCH/DELETE) send X-Castor-CSRF: <csrfToken>.
// - 401 unauthenticated → redirect to /login (unless already on an auth page).
// - 409 bootstrap_required → redirect to /bootstrap.
// All response/body field names match the locked contract verbatim.

import type {
  ActionResult,
  ApiErrorEnvelope,
  AuditPage,
  AuditQuery,
  AuthProvider,
  AuthProviderInput,
  Backup,
  BootstrapResponse,
  BootstrapStatus,
  BuilderRequest,
  BuilderResponse,
  CreateGroupRoleMappingInput,
  CreateStackRequest,
  CreateBackupRequest,
  DashboardMetrics,
  DeployRequest,
  DeployResponse,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  GroupRoleMapping,
  HealthzResponse,
  HostDetail,
  HostSummaryEntry,
  K8sApplyInput,
  K8sApplyResponse,
  K8sDeployment,
  K8sNode,
  K8sScaleInput,
  K8sSetResourcesInput,
  HPAInfo,
  HPACreateRequest,
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
  PVCCreateRequest,
  StorageClassInfo,
  HelmRepo,
  HelmChart,
  HelmRelease,
  HelmReleaseRevision,
  HelmRepoRequest,
  HelmInstallRequest,
  HelmUpgradeRequest,
  HelmRollbackRequest,
  LoginResponse,
  MeResponse,
  CatalogInput,
  ProviderInfo,
  ProviderTestResult,
  PublicAuthProvider,
  Registry,
  RegistryInput,
  RegistryTestResult,
  RemoteCatalog,
  RestoreBackupRequest,
  RoleRecord,
  SettingsPatch,
  SettingsResponse,
  Stack,
  StackDetail,
  StackValidateResponse,
  StatSample,
  SwarmNode,
  SwarmScaleInput,
  SwarmService,
  SwarmServiceCreateInput,
  SwarmServiceUpdateInput,
  SwarmSecretInfo,
  SwarmSecretCreateInput,
  SwarmConfigInfo,
  SwarmConfigDetail,
  SwarmConfigCreateInput,
  Template,
  TemplateWriteRequest,
  TotpConfirmResponse,
  TotpEnrollResponse,
  UserRecord,
  ValidateStackRequest,
  Workload,
  WorkloadDetail,
} from "./types";

export const API_BASE = "/api/v1";

/** ApiError carries the parsed error envelope plus HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  constructor(status: number, code: string, message: string, requestId: string) {
    super(message || code || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

// --- CSRF token store (the value comes from GET /auth/me / login response) ---
let csrfToken = "";
export function setCsrfToken(token: string): void {
  csrfToken = token || "";
}
export function getCsrfToken(): string {
  return csrfToken;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isAuthRoute(): boolean {
  const p = window.location.pathname;
  return p.startsWith("/login") || p.startsWith("/bootstrap") || p.startsWith("/totp");
}

function redirect(to: string): void {
  if (window.location.pathname !== to) {
    window.location.assign(to);
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  // when true, do NOT auto-redirect on 401/409 (used by bootstrap/login probes)
  noAuthRedirect?: boolean;
  signal?: AbortSignal;
  // override Accept (e.g. text/plain for raw logs)
  accept?: string;
  rawText?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const method = (opts.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: opts.accept || "application/json",
  };

  let bodyInit: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    headers["Content-Type"] = "application/json";
    bodyInit = JSON.stringify(opts.body);
  }

  if (MUTATING.has(method)) {
    headers["X-Castor-CSRF"] = csrfToken;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: bodyInit,
      credentials: "include",
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Network request failed.", "");
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = res.headers.get("content-type") || "";

  if (res.ok) {
    if (opts.rawText || (!contentType.includes("application/json"))) {
      return (await res.text()) as unknown as T;
    }
    return (await res.json()) as T;
  }

  // ---- error path ----
  let code = `http_${res.status}`;
  let message = res.statusText || "Request failed";
  let requestId = res.headers.get("x-request-id") || "";

  if (contentType.includes("application/json")) {
    try {
      const env = (await res.json()) as ApiErrorEnvelope;
      if (env?.error) {
        code = env.error.code || code;
        message = env.error.message || message;
        requestId = env.error.requestId || requestId;
      }
    } catch {
      /* keep defaults */
    }
  }

  if (!opts.noAuthRedirect) {
    if (res.status === 401 && !isAuthRoute()) {
      redirect("/login");
    } else if (res.status === 409 && code === "bootstrap_required" && !isAuthRoute()) {
      redirect("/bootstrap");
    }
  }

  throw new ApiError(res.status, code, message, requestId);
}

// Convenience verb helpers.
const get = <T>(p: string, o?: RequestOpts) => request<T>(p, { ...o, method: "GET" });
const post = <T>(p: string, body?: unknown, o?: RequestOpts) =>
  request<T>(p, { ...o, method: "POST", body });
const patch = <T>(p: string, body?: unknown, o?: RequestOpts) =>
  request<T>(p, { ...o, method: "PATCH", body });
const put = <T>(p: string, body?: unknown, o?: RequestOpts) =>
  request<T>(p, { ...o, method: "PUT", body });
const del = <T>(p: string, o?: RequestOpts) => request<T>(p, { ...o, method: "DELETE" });

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// Workload ids may contain '/', encode the final path segment.
const encId = (id: string) => encodeURIComponent(id);

// Parse a "filename=..." out of a Content-Disposition header (best effort).
function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m?.[1] ? decodeURIComponent(m[1]) : fallback;
}

// downloadFile fetches an attachment endpoint with the session cookie, then
// triggers a browser save via a transient object-URL anchor. Used for binary
// responses (e.g. backup archives) that bypass the JSON request() path. On a
// non-2xx it parses the JSON error envelope and throws an ApiError so callers
// can toast it.
async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/gzip, application/octet-stream" },
      credentials: "include",
      cache: "no-store",
    });
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Network request failed.", "");
  }

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText || "Download failed";
    let requestId = res.headers.get("x-request-id") || "";
    if ((res.headers.get("content-type") || "").includes("application/json")) {
      try {
        const env = (await res.json()) as ApiErrorEnvelope;
        if (env?.error) {
          code = env.error.code || code;
          message = env.error.message || message;
          requestId = env.error.requestId || requestId;
        }
      } catch {
        /* keep defaults */
      }
    }
    if (res.status === 401 && !isAuthRoute()) redirect("/login");
    throw new ApiError(res.status, code, message, requestId);
  }

  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get("content-disposition"), fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================ API surface ============================ */

export const api = {
  raw: request,
  setCsrfToken,
  getCsrfToken,

  /* ---- public ---- */
  healthz: () => get<HealthzResponse>("/healthz", { noAuthRedirect: true }),
  bootstrapStatus: () => get<BootstrapStatus>("/bootstrap/status", { noAuthRedirect: true }),
  bootstrap: (body: { username: string; password: string; email?: string; bootstrapToken?: string }) =>
    post<BootstrapResponse>("/bootstrap", body, { noAuthRedirect: true }),

  /* ---- auth ---- */
  login: (body: { username: string; password: string }) =>
    post<LoginResponse>("/auth/login", body, { noAuthRedirect: true }),
  // LDAP/LDAPS directory login (PUBLIC). Returns the SAME shape as local login
  // (requiresTotp is always false for external identities). `provider` is the
  // provider id; omit it when a single LDAP provider is configured.
  ldapLogin: (body: { username: string; password: string; provider?: string }) =>
    post<LoginResponse>("/auth/ldap/login", body, { noAuthRedirect: true }),
  logout: () => post<void>("/auth/logout"),
  me: (o?: RequestOpts) => get<MeResponse>("/auth/me", o),
  totpVerify: (code: string) => post<MeResponse>("/auth/totp/verify", { code }, { noAuthRedirect: true }),
  totpEnroll: () => post<TotpEnrollResponse>("/auth/totp/enroll"),
  totpConfirm: (code: string) => post<TotpConfirmResponse>("/auth/totp/confirm", { code }),
  totpDisable: (password: string) => post<void>("/auth/totp/disable", { password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<void>("/auth/password", { currentPassword, newPassword }),

  /* ---- enterprise SSO: enabled providers for the login screen (PUBLIC) ---- */
  // Lists ENABLED external providers ({id,name,kind}) so the login page can
  // render "Sign in with <name>" / a directory form. Pre-auth, never errors on
  // 401; returns [] when none are configured.
  authProviders: () => get<PublicAuthProvider[]>("/auth/providers", { noAuthRedirect: true }),

  /* ---- providers / hosts ---- */
  providers: () => get<ProviderInfo[]>("/providers"),
  hosts: () => get<HostSummaryEntry[]>("/hosts"),
  host: (hostId: string) => get<HostDetail>(`/hosts/${encId(hostId)}`),
  // Aggregated BI-dashboard metrics for a host (snapshot counts + a bounded live
  // CPU/RAM sample of running containers).
  dashboardMetrics: (hostId: string) =>
    get<DashboardMetrics>(`/hosts/${encId(hostId)}/dashboard/metrics`),

  /* ---- workloads ---- */
  workloads: (
    hostId: string,
    params: { all?: boolean; kind?: string; group?: string; namespace?: string; labelSelector?: string } = {},
  ) => get<Workload[]>(`/hosts/${encId(hostId)}/workloads${qs(params)}`),
  workload: (hostId: string, id: string) =>
    get<WorkloadDetail>(`/hosts/${encId(hostId)}/workloads/${encId(id)}`),
  workloadStart: (hostId: string, id: string) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/workloads/${encId(id)}/start`),
  workloadStop: (hostId: string, id: string, timeoutSeconds?: number) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/workloads/${encId(id)}/stop`, { timeoutSeconds }),
  workloadRestart: (hostId: string, id: string, timeoutSeconds?: number) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/workloads/${encId(id)}/restart`, { timeoutSeconds }),
  workloadRemove: (
    hostId: string,
    id: string,
    opts: { force?: boolean; volumes?: boolean; confirm?: boolean; reason?: string } = {},
  ) => {
    const { force, volumes, confirm, reason } = opts;
    const body = confirm ? { confirm, reason } : undefined;
    return request<ActionResult | void>(
      `/hosts/${encId(hostId)}/workloads/${encId(id)}${qs({ force, volumes })}`,
      { method: "DELETE", body },
    );
  },

  /* ---- logs / stats (one-shot REST) ---- */
  logsOnce: (
    hostId: string,
    id: string,
    params: { tail?: number; since?: string; timestamps?: boolean; container?: string } = {},
  ) =>
    get<string>(`/hosts/${encId(hostId)}/workloads/${encId(id)}/logs${qs({ ...params, follow: false })}`, {
      accept: "text/plain",
      rawText: true,
    }),
  statsOnce: (hostId: string, id: string) =>
    get<StatSample>(`/hosts/${encId(hostId)}/workloads/${encId(id)}/stats`),

  /* ---- docker resources ---- */
  images: (hostId: string) => get<DockerImage[]>(`/hosts/${encId(hostId)}/images`),
  imagePull: (hostId: string, ref: string) =>
    post<{ ok?: boolean }>(`/hosts/${encId(hostId)}/images/pull`, { ref }),
  imageDelete: (hostId: string, id: string, force = false) =>
    del<void>(`/hosts/${encId(hostId)}/images/${encId(id)}${qs({ force })}`),
  networks: (hostId: string) => get<DockerNetwork[]>(`/hosts/${encId(hostId)}/networks`),
  networkDelete: (hostId: string, id: string) =>
    del<void>(`/hosts/${encId(hostId)}/networks/${encId(id)}`),
  volumes: (hostId: string) => get<DockerVolume[]>(`/hosts/${encId(hostId)}/volumes`),
  volumeRemove: (hostId: string, name: string) =>
    del<void>(`/hosts/${encId(hostId)}/volumes/${encId(name)}`),

  /* ---- backups (volume tar archives) ---- */
  backups: (hostId: string) => get<Backup[]>(`/hosts/${encId(hostId)}/backups`),
  backupCreate: (hostId: string, body: CreateBackupRequest) =>
    post<Backup>(`/hosts/${encId(hostId)}/backups`, { kind: "volume", ...body }),
  backupRestore: (hostId: string, id: string, body: RestoreBackupRequest = {}) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/backups/${encId(id)}/restore`, body),
  backupDelete: (hostId: string, id: string) =>
    del<void>(`/hosts/${encId(hostId)}/backups/${encId(id)}`),
  // Streams the archive to a browser download (cookie-authenticated fetch → blob).
  backupDownload: (hostId: string, id: string, fallbackName: string) =>
    downloadFile(`/hosts/${encId(hostId)}/backups/${encId(id)}/download`, fallbackName),

  /* ---- marketplace: app templates + one-click deploy ---- */
  templates: () => get<Template[]>("/templates"),
  templateCreate: (body: TemplateWriteRequest) => post<Template>("/templates", body),
  templateUpdate: (id: string, body: TemplateWriteRequest) => put<Template>(`/templates/${encId(id)}`, body),
  templateDelete: (id: string) => del<void>(`/templates/${encId(id)}`),
  templateDeploy: (hostId: string, body: DeployRequest) =>
    post<DeployResponse>(`/hosts/${encId(hostId)}/templates/deploy`, body),

  /* ---- marketplace config: image registries (admin) ---- */
  registries: () => get<Registry[]>("/registries"),
  registryCreate: (body: RegistryInput) => post<Registry>("/registries", body),
  registryUpdate: (id: string, body: RegistryInput) => put<Registry>(`/registries/${encId(id)}`, body),
  registryDelete: (id: string) => del<void>(`/registries/${encId(id)}`),
  registryTest: (id: string) => post<RegistryTestResult>(`/registries/${encId(id)}/test`),

  /* ---- marketplace config: remote template catalogs (admin) ---- */
  catalogs: () => get<RemoteCatalog[]>("/catalogs"),
  catalogCreate: (body: CatalogInput) => post<RemoteCatalog>("/catalogs", body),
  catalogUpdate: (id: string, body: CatalogInput) => put<RemoteCatalog>(`/catalogs/${encId(id)}`, body),
  catalogDelete: (id: string) => del<void>(`/catalogs/${encId(id)}`),
  catalogRefresh: (id: string) => post<RemoteCatalog>(`/catalogs/${encId(id)}/refresh`),
  catalogTemplates: (id: string) => get<Template[]>(`/catalogs/${encId(id)}/templates`),

  /* ---- enterprise SSO config: auth providers (admin, superuser) ---- */
  // CRUD over LDAP/OIDC providers. Secrets are sealed server-side on write and
  // never returned (only hasBindPassword / hasClientSecret). The /test probe runs
  // a live connect+bind (LDAP) or discovery (OIDC) and reports ok:false on a
  // config problem rather than throwing.
  authProvidersAdmin: () => get<AuthProvider[]>("/admin/auth/providers"),
  authProvider: (id: string) => get<AuthProvider>(`/admin/auth/providers/${encId(id)}`),
  authProviderCreate: (body: AuthProviderInput) => post<AuthProvider>("/admin/auth/providers", body),
  authProviderUpdate: (id: string, body: AuthProviderInput) =>
    put<AuthProvider>(`/admin/auth/providers/${encId(id)}`, body),
  authProviderDelete: (id: string) => del<void>(`/admin/auth/providers/${encId(id)}`),
  authProviderTest: (id: string) => post<ProviderTestResult>(`/admin/auth/providers/${encId(id)}/test`),

  /* ---- enterprise SSO config: group -> role mappings (admin, superuser) ---- */
  authProviderMappings: (id: string) =>
    get<GroupRoleMapping[]>(`/admin/auth/providers/${encId(id)}/mappings`),
  authProviderMappingCreate: (id: string, body: CreateGroupRoleMappingInput) =>
    post<GroupRoleMapping>(`/admin/auth/providers/${encId(id)}/mappings`, body),
  authProviderMappingDelete: (id: string, mappingId: string) =>
    del<void>(`/admin/auth/providers/${encId(id)}/mappings/${encId(mappingId)}`),

  /* ---- swarm (read + gated service/node lifecycle) ---- */
  swarmServices: (hostId: string) => get<SwarmService[]>(`/hosts/${encId(hostId)}/swarm/services`),
  swarmTasks: (hostId: string) => get<Workload[]>(`/hosts/${encId(hostId)}/swarm/tasks`),
  swarmNodes: (hostId: string) => get<SwarmNode[]>(`/hosts/${encId(hostId)}/swarm/nodes`),
  // Create returns {ok, id}; the remaining writes return a {ok:true} envelope.
  swarmServiceCreate: (hostId: string, body: SwarmServiceCreateInput) =>
    post<{ ok: boolean; id: string }>(`/hosts/${encId(hostId)}/swarm/services`, body),
  swarmServiceScale: (hostId: string, id: string, body: SwarmScaleInput) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/swarm/services/${encId(id)}/scale`, body),
  swarmServiceUpdate: (hostId: string, id: string, body: SwarmServiceUpdateInput) =>
    put<ActionResult | void>(`/hosts/${encId(hostId)}/swarm/services/${encId(id)}`, body),
  swarmServiceRestart: (hostId: string, id: string) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/swarm/services/${encId(id)}/restart`),
  swarmServiceRemove: (hostId: string, id: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/swarm/services/${encId(id)}`),
  swarmNodeAvailability: (hostId: string, id: string, availability: "active" | "pause" | "drain") =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/swarm/nodes/${encId(id)}/availability`, { availability }),

  /* ---- swarm secrets & configs (read metadata / write = create+delete) ---- */
  // SECURITY: secrets list returns id/name/timestamps only (values are write-only).
  swarmSecrets: (hostId: string) => get<SwarmSecretInfo[]>(`/hosts/${encId(hostId)}/swarm/secrets`),
  swarmSecretCreate: (hostId: string, body: SwarmSecretCreateInput) =>
    post<{ ok: boolean; id: string }>(`/hosts/${encId(hostId)}/swarm/secrets`, body),
  swarmSecretRemove: (hostId: string, id: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/swarm/secrets/${encId(id)}`),
  // Configs list = metadata; a single config GET also returns its (non-secret) data.
  swarmConfigs: (hostId: string) => get<SwarmConfigInfo[]>(`/hosts/${encId(hostId)}/swarm/configs`),
  swarmConfig: (hostId: string, id: string) =>
    get<SwarmConfigDetail>(`/hosts/${encId(hostId)}/swarm/configs/${encId(id)}`),
  swarmConfigCreate: (hostId: string, body: SwarmConfigCreateInput) =>
    post<{ ok: boolean; id: string }>(`/hosts/${encId(hostId)}/swarm/configs`, body),
  swarmConfigRemove: (hostId: string, id: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/swarm/configs/${encId(id)}`),

  /* ---- kubernetes (read + gated deployment/pod/manifest writes) ---- */
  k8sPods: (hostId: string, namespace?: string) =>
    get<Workload[]>(`/hosts/${encId(hostId)}/k8s/pods${qs({ namespace })}`),
  k8sDeployments: (hostId: string, namespace?: string) =>
    get<K8sDeployment[]>(`/hosts/${encId(hostId)}/k8s/deployments${qs({ namespace })}`),
  k8sNodes: (hostId: string) => get<K8sNode[]>(`/hosts/${encId(hostId)}/k8s/nodes`),
  // {ns}/{name} are distinct path segments (a Deployment/Pod name is a DNS label).
  k8sScaleDeployment: (hostId: string, ns: string, name: string, body: K8sScaleInput) =>
    post<ActionResult | void>(
      `/hosts/${encId(hostId)}/k8s/deployments/${encId(ns)}/${encId(name)}/scale`,
      body,
    ),
  k8sRestartDeployment: (hostId: string, ns: string, name: string) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/deployments/${encId(ns)}/${encId(name)}/restart`),
  k8sSetDeploymentResources: (hostId: string, ns: string, name: string, body: K8sSetResourcesInput) =>
    post<ActionResult | void>(
      `/hosts/${encId(hostId)}/k8s/deployments/${encId(ns)}/${encId(name)}/resources`,
      body,
    ),
  k8sDeleteDeployment: (hostId: string, ns: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/deployments/${encId(ns)}/${encId(name)}`),
  k8sDeletePod: (hostId: string, ns: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/pods/${encId(ns)}/${encId(name)}`),
  k8sApply: (hostId: string, body: K8sApplyInput) =>
    post<K8sApplyResponse>(`/hosts/${encId(hostId)}/k8s/apply`, body),

  /* ---- kubernetes autoscaling + core cluster objects (Wave 3) ---- */
  // HPAs (list optionally by namespace; create scopes the target ns via the
  // ?namespace= query, matching the read filter).
  k8sHPAs: (hostId: string, namespace?: string) =>
    get<HPAInfo[]>(`/hosts/${encId(hostId)}/k8s/hpas${qs({ namespace })}`),
  k8sCreateHPA: (hostId: string, namespace: string, body: HPACreateRequest) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/hpas${qs({ namespace })}`, body),
  // {ns}/{name} are distinct path segments (an HPA namespace + name are DNS labels).
  k8sDeleteHPA: (hostId: string, ns: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/hpas/${encId(ns)}/${encId(name)}`),
  // Namespaces (create/delete are admin-only server-side).
  k8sNamespaces: (hostId: string) =>
    get<NamespaceInfo[]>(`/hosts/${encId(hostId)}/k8s/namespaces`),
  k8sCreateNamespace: (hostId: string, name: string) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/namespaces`, { name }),
  k8sDeleteNamespace: (hostId: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/namespaces/${encId(name)}`),
  // Read-only cluster objects (optionally filtered by namespace).
  k8sServices: (hostId: string, namespace?: string) =>
    get<ServiceInfoK8s[]>(`/hosts/${encId(hostId)}/k8s/services${qs({ namespace })}`),
  k8sConfigMaps: (hostId: string, namespace?: string) =>
    get<ConfigMapInfo[]>(`/hosts/${encId(hostId)}/k8s/configmaps${qs({ namespace })}`),
  k8sSecrets: (hostId: string, namespace?: string) =>
    get<SecretInfo[]>(`/hosts/${encId(hostId)}/k8s/secrets${qs({ namespace })}`),
  k8sEvents: (hostId: string, namespace?: string) =>
    get<EventInfo[]>(`/hosts/${encId(hostId)}/k8s/events${qs({ namespace })}`),
  // Ingresses (list optionally by namespace + delete). Create/update is the
  // manifest-apply path (api.k8sApply). {ns}/{name} are distinct path segments.
  k8sIngresses: (hostId: string, namespace?: string) =>
    get<IngressInfo[]>(`/hosts/${encId(hostId)}/k8s/ingresses${qs({ namespace })}`),
  k8sDeleteIngress: (hostId: string, ns: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/ingresses/${encId(ns)}/${encId(name)}`),

  /* ---- kubernetes live metrics (metrics-server) ---- */
  // available:false (items:[]) when metrics-server is not installed — callers
  // render a hint rather than treating it as an error.
  k8sNodeMetrics: (hostId: string) =>
    get<NodeMetricsResponse>(`/hosts/${encId(hostId)}/k8s/metrics/nodes`),
  k8sPodMetrics: (hostId: string, namespace?: string) =>
    get<PodMetricsResponse>(`/hosts/${encId(hostId)}/k8s/metrics/pods${qs({ namespace })}`),

  /* ---- kubernetes storage (read PV/PVC/StorageClass + PVC create/delete) ---- */
  k8sPVs: (hostId: string) => get<PVInfo[]>(`/hosts/${encId(hostId)}/k8s/pvs`),
  k8sPVCs: (hostId: string, namespace?: string) =>
    get<PVCInfo[]>(`/hosts/${encId(hostId)}/k8s/pvcs${qs({ namespace })}`),
  k8sStorageClasses: (hostId: string) =>
    get<StorageClassInfo[]>(`/hosts/${encId(hostId)}/k8s/storageclasses`),
  k8sCreatePVC: (hostId: string, body: PVCCreateRequest) =>
    post<PVCInfo>(`/hosts/${encId(hostId)}/k8s/pvcs`, body),
  // {ns}/{name} are distinct path segments (a PVC namespace + name are DNS labels).
  k8sDeletePVC: (hostId: string, ns: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/k8s/pvcs/${encId(ns)}/${encId(name)}`),

  /* ---- helm (chart repositories + release lifecycle) ---- */
  // Repositories: list / add (downloads index) / refresh all indexes / remove.
  helmRepos: (hostId: string) => get<HelmRepo[]>(`/hosts/${encId(hostId)}/helm/repos`),
  helmAddRepo: (hostId: string, body: HelmRepoRequest) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/helm/repos`, body),
  helmUpdateRepos: (hostId: string) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/helm/repos/update`),
  helmRemoveRepo: (hostId: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/helm/repos/${encId(name)}`),
  // Chart search across cached repo indexes (empty q lists every chart's latest).
  helmCharts: (hostId: string, q?: string) =>
    get<HelmChart[]>(`/hosts/${encId(hostId)}/helm/charts${qs({ q })}`),
  // Releases: list (all namespaces) + install. install returns the new release.
  helmReleases: (hostId: string) => get<HelmRelease[]>(`/hosts/${encId(hostId)}/helm/releases`),
  helmInstall: (hostId: string, body: HelmInstallRequest) =>
    post<HelmRelease>(`/hosts/${encId(hostId)}/helm/releases`, body),
  // {ns}/{name} are distinct path segments (a release name + namespace are DNS labels).
  helmUpgrade: (hostId: string, ns: string, name: string, body: HelmUpgradeRequest) =>
    post<HelmRelease>(`/hosts/${encId(hostId)}/helm/releases/${encId(ns)}/${encId(name)}/upgrade`, body),
  helmRollback: (hostId: string, ns: string, name: string, body: HelmRollbackRequest) =>
    post<ActionResult | void>(`/hosts/${encId(hostId)}/helm/releases/${encId(ns)}/${encId(name)}/rollback`, body),
  helmUninstall: (hostId: string, ns: string, name: string) =>
    del<ActionResult | void>(`/hosts/${encId(hostId)}/helm/releases/${encId(ns)}/${encId(name)}`),
  helmReleaseHistory: (hostId: string, ns: string, name: string) =>
    get<HelmReleaseRevision[]>(`/hosts/${encId(hostId)}/helm/releases/${encId(ns)}/${encId(name)}/history`),
  // Release user-supplied values (overrides only). Opaque object.
  helmReleaseValues: (hostId: string, ns: string, name: string) =>
    get<Record<string, unknown>>(`/hosts/${encId(hostId)}/helm/releases/${encId(ns)}/${encId(name)}/values`),

  /* ---- audit ---- */
  audit: (q: AuditQuery = {}) => get<AuditPage>(`/audit${qs({ ...q })}`),

  /* ---- rbac: users ---- */
  users: () => get<UserRecord[]>("/users"),
  userCreate: (body: { username: string; password: string; email?: string; mustChangePassword?: boolean }) =>
    post<UserRecord>("/users", body),
  userUpdate: (id: string, body: { email?: string; isActive?: boolean }) =>
    patch<UserRecord>(`/users/${encId(id)}`, body),
  userDelete: (id: string) => del<void>(`/users/${encId(id)}`),
  userAddRole: (id: string, body: { roleId: string; scopeType: string; scopeId: string | null }) =>
    post<UserRecord>(`/users/${encId(id)}/roles`, body),
  userRemoveRole: (id: string, bindingId: string) =>
    del<void>(`/users/${encId(id)}/roles/${encId(bindingId)}`),

  /* ---- rbac: roles ---- */
  roles: () => get<RoleRecord[]>("/roles"),
  roleCreate: (body: { name: string; description?: string; permissions: string[] }) =>
    post<RoleRecord>("/roles", body),
  roleUpdate: (id: string, body: { name?: string; description?: string; permissions?: string[] }) =>
    patch<RoleRecord>(`/roles/${encId(id)}`, body),
  roleDelete: (id: string) => del<void>(`/roles/${encId(id)}`),
  permissions: () => get<string[]>("/permissions"),

  /* ---- compose stacks ---- */
  stacks: (hostId: string) => get<Stack[]>(`/hosts/${encId(hostId)}/stacks`),
  stackDetail: (hostId: string, id: string) =>
    get<StackDetail>(`/hosts/${encId(hostId)}/stacks/${encId(id)}`),
  stackValidate: (hostId: string, body: ValidateStackRequest) =>
    post<StackValidateResponse>(`/hosts/${encId(hostId)}/stacks/validate`, body),
  stackCreate: (hostId: string, body: CreateStackRequest) =>
    post<Stack>(`/hosts/${encId(hostId)}/stacks`, body),
  stackDelete: (hostId: string, id: string) =>
    del<void>(`/hosts/${encId(hostId)}/stacks/${encId(id)}`),
  stackBuilderGenerate: (body: BuilderRequest) =>
    post<BuilderResponse>("/stacks/builder/generate", body),
  /* ---- settings ---- */
  settings: () => get<SettingsResponse>("/settings"),
  settingsUpdate: (body: SettingsPatch) => put<SettingsResponse>("/settings", body),
};

export type Api = typeof api;
