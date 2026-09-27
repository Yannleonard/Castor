// ui/src/lib/types.ts
// TypeScript mirrors of the Castor REST + WS contract.
// Field names are EXACT (camelCase) and match ADR-002 struct json tags and the
// locked REST contract. Do not rename fields.

/* ===================== Provider / Workload core (ADR-002) ===================== */

export type OrchestratorKind = "docker" | "swarm" | "kubernetes";

export type WorkloadState =
  | "running"
  | "stopped"
  | "paused"
  | "restarting"
  | "pending"
  | "unknown";

// Capability tokens are Capability.Strings() output from the backend.
export type Capability =
  | "list"
  | "inspect"
  | "logs"
  | "stats"
  | "start"
  | "stop"
  | "restart"
  | "pause"
  | "remove"
  | "exec"
  | "events"
  | "images"
  | "networks"
  | "volumes"
  | "readonly";

export interface Port {
  private: number;
  public?: number;
  protocol: string; // "tcp" | "udp" | "sctp"
}

export interface Workload {
  id: string;
  name: string;
  kind: OrchestratorKind;
  providerId: string;
  node?: string;
  state: WorkloadState;
  stateRaw?: string;
  image: string;
  ports?: Port[];
  // For K8s pods, labels include the synthetic io.castor.qos entry (the
  // kubelet-reported QoS class) — read it via podQosClass(labels) / K8S_QOS_LABEL.
  labels?: Record<string, string>;
  createdAt: string; // RFC3339
  group?: string;
  protected: boolean;
  // Docker only. networkNames lists the networks the container is attached to
  // (sorted); ipAddress is its first IPv4 across them, absent in host/none
  // network mode. The per-network detail is WorkloadDetail.networks.
  networkNames?: string[];
  ipAddress?: string;
}

// WorkloadNetwork is one network a workload is attached to, with the addresses
// that network gave it. aliases are the extra DNS names registered for it on
// that network (compose service names, user-added aliases). Mirrors
// provider.WorkloadNetwork.
export interface WorkloadNetwork {
  name: string;
  networkId?: string;
  ipv4?: string;
  ipv6?: string;
  gateway?: string;
  mac?: string;
  aliases?: string[];
}

export interface WorkloadDetail extends Workload {
  // Per-network attachment detail (inspect only; list rows carry networkNames
  // and ipAddress instead). Docker only.
  networks?: WorkloadNetwork[];
  // engine-specific inspect document, masked for secret env unless caller has
  // docker.container.inspect.secrets. Opaque JSON.
  raw: unknown;
}

/* ===================== Providers / hosts ===================== */

export interface ProviderInfo {
  id: string;
  kind: OrchestratorKind;
  capabilities: Capability[];
}

export type HostStatus = "connected" | "down" | "pending";

// EngineInfo mirrors docker.EngineInfo (server) — host capacity + inventory from
// `docker info`. Present once the first info poll succeeds.
export interface EngineInfo {
  engineVersion: string;
  apiVersion: string;
  os: string;
  osType: string;
  osVersion: string;
  kernelVersion: string;
  architecture: string;
  ncpu: number;
  memTotalBytes: number;
  containers: number;
  containersRunning: number;
  containersPaused: number;
  containersStopped: number;
  images: number;
  name: string;
  swarmActive: boolean;
}

export interface HostSummaryEntry {
  id: string;
  name: string;
  kind: string;
  connection: string;
  status: HostStatus;
  providerIds: string[];
  degraded: boolean;
  engine?: EngineInfo | null;
}

export interface HostSummaryCounts {
  containers: number;
  running: number;
  images: number;
  networks: number;
  volumes: number;
  swarmTasks: number;
  k8sPods: number;
}

export interface HostDetail extends HostSummaryEntry {
  summary: HostSummaryCounts;
}

/* ===================== Dashboard (BI aggregation) ===================== */

// DashboardMetrics mirrors api.dashboardMetrics (server/internal/api/dashboard.go):
// the aggregated numbers powering the BI dashboard for GET
// /hosts/{hostID}/dashboard/metrics. Counts come from the cache snapshot; cpu/
// memory + the top-N rankings come from a bounded live sample of running
// containers (missing samples are silently skipped, so sums are best-effort).

export interface DashboardContainerCounts {
  total: number;
  running: number;
  stopped: number;
  paused: number;
}

export interface DashboardCpu {
  usedPercent: number; // sum of container cpu% (can exceed 100 across cores)
  cores: number; // engine NCPU
}

export interface DashboardMemory {
  usedBytes: number; // sum over running containers
  totalBytes: number; // engine MemTotal (0 if unknown)
  usedPercent: number; // usedBytes / totalBytes * 100 (0 if total unknown)
}

export interface DashboardStateBucket {
  state: string; // WorkloadState value, e.g. "running"
  count: number;
}

// One ranked container in topByCpu / topByMem.
export interface DashboardTopContainer {
  id: string;
  name: string;
  cpuPercent: number;
  memBytes: number;
}

export interface DashboardEngine {
  version: string;
  ncpu: number;
  memTotalBytes: number;
}

export interface DashboardMetrics {
  containers: DashboardContainerCounts;
  images: number;
  networks: number;
  volumes: number;
  swarmServices: number;
  swarmTasks: number;
  k8sPods: number;
  cpu: DashboardCpu;
  memory: DashboardMemory;
  stateBreakdown: DashboardStateBucket[];
  topByCpu: DashboardTopContainer[];
  topByMem: DashboardTopContainer[];
  engine: DashboardEngine;
}

/* ===================== Auth / RBAC ===================== */

// External SSO sessions add "ldap" / "oidc" (no TOTP second factor — the IdP
// owns the authentication strength). Mirrors authz AMR* constants.
export type Amr = "pwd" | "pwd+totp" | "ldap" | "oidc";

export interface SessionUser {
  id: string;
  username: string;
  email?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
  totpEnabled?: boolean;
}

export interface RoleRef {
  name: string;
  scopeType: string;
  scopeId: string | null;
}

export interface MeResponse {
  user: SessionUser;
  amr: Amr;
  csrfToken: string;
  permissions: string[];
  roles: RoleRef[];
}

export interface LoginResponse {
  user?: SessionUser;
  amr: Amr;
  csrfToken: string;
  permissions?: string[];
  requiresTotp: boolean;
}

export interface BootstrapStatus {
  required: boolean;
}

export interface HealthzResponse {
  status: string;
  version: string;
  bootstrap: boolean;
}

export interface BootstrapResponse {
  user: SessionUser;
  totpEnrollOffered: boolean;
}

export interface TotpEnrollResponse {
  secret: string;
  otpauthUrl: string;
  qrPngBase64: string;
}

export interface TotpConfirmResponse {
  recoveryCodes: string[];
}

/* ===================== Stats (one-shot REST + WS) ===================== */

// REST one-shot StatSample shape.
export interface StatSample {
  timestamp: string;
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  blkReadBytes: number;
  blkWriteBytes: number;
}

// WS stats data.payload shape.
export interface WsStatsPayload {
  cpuPct: number;
  memUsed: number;
  memLimit: number;
  memPct: number;
  netRx: number;
  netTx: number;
  blkRead: number;
  blkWrite: number;
}

/* ===================== Docker resources ===================== */

export interface DockerImage {
  id: string;
  repoTags: string[];
  size: number;
  created: string;
  dangling: boolean;
}

// One IPAM address pool of a network. subnet is CIDR notation; gateway and
// ipRange must fall inside it; auxAddresses are named addresses the IPAM driver
// leaves unallocated. Mirrors docker.IPAMConfig.
export interface IPAMConfig {
  subnet: string;
  gateway?: string;
  ipRange?: string;
  auxAddresses?: Record<string, string>;
}

// A network's IP address management: the IPAM driver and its pools. Mirrors
// docker.IPAMSpec as the inspect view reports it (config is never null).
export interface NetworkIPAM {
  driver: string;
  config: IPAMConfig[];
}

// DockerNetworkInfo mirrors docker.NetworkInfo: the normalized summary the
// create response returns and the list/inspect views build on. subnets
// flattens the IPAM pools so the list can show addressing without an inspect.
export interface DockerNetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
  enableIPv6: boolean;
  created: string; // RFC3339
  subnets: string[];
  labels?: Record<string, string>;
}

// DockerNetwork mirrors api.networkView: one list row. containerCount is the
// number of snapshot containers attached to it (stopped ones included).
export interface DockerNetwork extends DockerNetworkInfo {
  containerCount: number;
}

// One container attached to a network, with the addresses the network gave it
// (plain IPs, no CIDR suffix). running is whether the daemon reports a live
// endpoint for it: a stopped container configured on the network is listed
// with running=false and the address the snapshot knows, if any. state is the
// container's raw state; protected marks Castor itself or a protected-label
// container, which the backend never rewires. Mirrors docker.NetworkEndpoint.
export interface NetworkEndpoint {
  containerId: string;
  name: string;
  ipv4?: string;
  ipv6?: string;
  mac?: string;
  running: boolean;
  state?: string;
  protected: boolean;
}

// DockerNetworkDetail mirrors api.networkDetailView (docker.NetworkDetail +
// containerCount): the live inspect view of GET /hosts/{hostID}/networks/{id}.
// containers lists every container configured on the network, stopped ones
// included, sorted by name (containerCount is its length); options are the
// driver options.
export interface DockerNetworkDetail extends DockerNetwork {
  ipam: NetworkIPAM;
  options: Record<string, string>;
  containers: NetworkEndpoint[];
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt: string;
}

// Body for POST /hosts/{hostID}/networks. Mirrors docker.NetworkSpec. driver
// defaults to "bridge" (bridge | overlay | macvlan | ipvlan); macvlan/ipvlan
// and a "parent" option bind to a host interface and are superuser-only. Omit
// ipam to let the daemon pick a free subnet from its default pools. Returns
// the created DockerNetworkInfo.
export interface CreateNetworkRequest {
  name: string;
  driver?: string;
  internal?: boolean;
  attachable?: boolean;
  enableIPv6?: boolean;
  options?: Record<string, string>;
  ipam?: { driver?: string; config: IPAMConfig[] };
  labels?: Record<string, string>;
}

// Body for POST /hosts/{hostID}/networks/{id}/connect. containerId accepts an
// id or a name. A static ipv4/ipv6 needs a user-defined network with a
// configured subnet (409 static_ip_unsupported on the default bridge); aliases
// are extra DNS names the other containers on that network can resolve.
export interface NetworkConnectRequest {
  containerId: string;
  ipv4?: string;
  ipv6?: string;
  aliases?: string[];
}

// Body for POST /hosts/{hostID}/networks/{id}/disconnect. force also detaches
// an endpoint the daemon still holds for a gone container.
export interface NetworkDisconnectRequest {
  containerId: string;
  force?: boolean;
}

// Body for POST /hosts/{hostID}/volumes.
export interface CreateVolumeRequest {
  name: string;
  driver?: string;
  labels?: Record<string, string>;
}

// Target resource class for POST /hosts/{hostID}/prune.
export type PruneTarget = "images" | "containers" | "volumes" | "networks";

// Response of POST /hosts/{hostID}/prune. spaceReclaimed is bytes.
export interface PruneResult {
  removed: string[];
  spaceReclaimed: number;
}

/* ===================== Swarm (read-only) ===================== */

// Configured per-task CPU/memory limits + reservations on a swarm service.
// Mirrors swarm.ServiceResources. cpu* are CPU cores (NanoCPUs/1e9); memory*
// are bytes. A 0 value means the corresponding knob is not set.
export interface SwarmServiceResources {
  cpuLimit: number;
  memoryLimitBytes: number;
  cpuReservation: number;
  memoryReservationBytes: number;
}

export interface SwarmService {
  id: string;
  name: string;
  mode: string;
  replicas: string;
  image: string;
  createdAt: string;
  resources: SwarmServiceResources;
}

export interface SwarmNode {
  id: string;
  hostname: string;
  role: string;
  availability: string;
  state: string;
  addr: string;
}

/* ----- Swarm secrets & configs ----- */

// Swarm secret summary. Mirrors swarm.SwarmSecretInfo. SECURITY: there is NO
// data field — secret values are write-only and never returned on a read.
export interface SwarmSecretInfo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Swarm config summary. Mirrors swarm.SwarmConfigInfo (list = metadata only).
export interface SwarmConfigInfo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Single swarm config WITH its (non-secret) payload. Mirrors
// swarm.SwarmConfigDetail (returned only by the single-config GET).
export interface SwarmConfigDetail extends SwarmConfigInfo {
  data: string;
}

// Body for POST /hosts/{hostID}/swarm/secrets. The value is a UTF-8 string and
// is the only place a secret's data is ever transmitted (write-only after).
export interface SwarmSecretCreateInput {
  name: string;
  data: string;
}

// Body for POST /hosts/{hostID}/swarm/configs.
export interface SwarmConfigCreateInput {
  name: string;
  data: string;
}

/* ----- Swarm mutations (mirror swarm.ServiceCreateSpec / ServiceUpdateInput) ----- */

// One published port mapping for a service. Mirrors swarm.SwarmPort.
export interface SwarmPort {
  published: number;
  target: number;
  protocol: string; // "tcp" (default) | "udp" | "sctp"
}

// Attach an EXISTING swarm secret to a service as a file under /run/secrets.
// Identify by id (preferred) or name; targetFile defaults to the secret name
// when omitted. Mirrors swarm.SwarmSecretRef. The data is never carried here.
export interface SwarmSecretRef {
  secretId: string;
  secretName: string;
  targetFile: string;
}

// Attach an EXISTING swarm config to a service as a file (default /<configName>).
// Mirrors swarm.SwarmConfigRef.
export interface SwarmConfigRef {
  configId: string;
  configName: string;
  targetFile: string;
}

// Body for POST /hosts/{hostID}/swarm/services. Mirrors swarm.ServiceCreateSpec.
// Resource fields are optional; <=0 / omitted means "unset". cpu* are CPU
// cores, memory* are bytes.
export interface SwarmServiceCreateInput {
  name: string;
  image: string;
  replicas: number;
  env: string[]; // "KEY=VALUE" entries
  ports: SwarmPort[];
  networks: string[];
  restart: string; // "any" (default) | "on-failure" | "none"
  cpuLimit?: number;
  memoryLimitBytes?: number;
  cpuReservation?: number;
  memoryReservationBytes?: number;
  // Optional secret/config attachments (reference existing objects by id/name).
  secrets?: SwarmSecretRef[];
  configs?: SwarmConfigRef[];
}

// Body for PUT /hosts/{hostID}/swarm/services/{id}. Mirrors
// swarm.ServiceUpdateInput: omitted fields are left unchanged; a non-empty env
// array replaces the env entirely. Resource fields are always re-applied by the
// server: a positive value sets that knob, 0 clears it (so omitting them clears
// any previously-set limit — send the current values to preserve them).
export interface SwarmServiceUpdateInput {
  image?: string;
  env?: string[];
  replicas?: number;
  cpuLimit?: number;
  memoryLimitBytes?: number;
  cpuReservation?: number;
  memoryReservationBytes?: number;
  // Omit to leave attachments unchanged; send an array (including []) to REPLACE
  // the full set ([] detaches all). Mirrors swarm.ServiceUpdateInput's
  // pointer-to-slice semantics.
  secrets?: SwarmSecretRef[];
  configs?: SwarmConfigRef[];
}

// Body for POST /hosts/{hostID}/swarm/services/{id}/scale.
export interface SwarmScaleInput {
  replicas: number;
}

// Body for POST /hosts/{hostID}/swarm/nodes/{id}/availability.
export interface NodeAvailabilityInput {
  availability: "active" | "pause" | "drain";
}

/* ===================== Kubernetes (read-only) ===================== */

// Kubernetes QoS class (kubelet rules). Drives the QoS badge color.
export type K8sQosClass = "Guaranteed" | "Burstable" | "BestEffort";

// Per-container CPU/memory requests+limits as declared on a Deployment's pod
// template. Each string is the Quantity form ("100m", "128Mi", …) and is ""
// when that entry is unset. Mirrors kube.K8sContainerResources.
export interface K8sContainerResources {
  name: string;
  cpuRequest: string;
  cpuLimit: string;
  memRequest: string;
  memLimit: string;
}

export interface K8sDeployment {
  namespace: string;
  name: string;
  replicas: number;
  ready: number;
  available: number;
  image: string;
  createdAt: string;
  // Per-container requests/limits from the pod template.
  containers: K8sContainerResources[];
  // QoS class implied by those resources (Guaranteed / Burstable / BestEffort).
  qosClass: K8sQosClass | "";
}

// Synthetic Workload label carrying a pod's kubelet-reported QoS class. K8s pods
// are returned as Workloads; rather than widen the shared Workload schema the
// server surfaces QoS in labels under this key (mirrors kube.LabelQoS). Read it
// from a pod Workload via `workload.labels?.[K8S_QOS_LABEL]`.
export const K8S_QOS_LABEL = "io.castor.qos";

// podQosClass extracts the QoS class label off a pod Workload (undefined when
// the kubelet has not yet reported one).
export function podQosClass(labels: Record<string, string> | undefined): K8sQosClass | undefined {
  const v = labels?.[K8S_QOS_LABEL];
  return v === "Guaranteed" || v === "Burstable" || v === "BestEffort" ? v : undefined;
}

// podContainerNames extracts the container names from a pod WorkloadDetail.raw
// (a marshaled corev1.Pod, so spec.containers[].name in standard Kubernetes
// JSON). Init and ephemeral containers are appended after the regular ones so a
// multi-container pod's full exec/log target set is selectable. Returns [] for
// anything that isn't a pod-shaped object (Docker/Swarm raw, or a not-yet-loaded
// detail).
export function podContainerNames(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const spec = (raw as { spec?: unknown }).spec;
  if (!spec || typeof spec !== "object") return [];
  const names: string[] = [];
  const collect = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      const name = (c as { name?: unknown })?.name;
      if (typeof name === "string" && name && !names.includes(name)) names.push(name);
    }
  };
  const s = spec as { containers?: unknown; initContainers?: unknown; ephemeralContainers?: unknown };
  collect(s.containers);
  collect(s.initContainers);
  collect(s.ephemeralContainers);
  return names;
}

export interface K8sNode {
  name: string;
  status: string;
  roles: string[];
  version: string;
  internalIP: string;
}

/* ----- Kubernetes workload controllers (StatefulSet / DaemonSet / Job / CronJob) ----- */

// StatefulSet summary. Mirrors kube.StatefulSetInfo.
export interface K8sStatefulSet {
  namespace: string;
  name: string;
  replicas: number;
  ready: number;
  available: number;
  image: string;
  createdAt: string; // RFC3339
}

// DaemonSet summary. Mirrors kube.DaemonSetInfo.
export interface K8sDaemonSet {
  namespace: string;
  name: string;
  desired: number;
  ready: number;
  available: number;
  image: string;
  createdAt: string; // RFC3339
}

// Job summary. completions is spec.completions (0 when unset); startedAt /
// completedAt are absent until the controller stamps them. Mirrors kube.JobInfo.
export interface K8sJob {
  namespace: string;
  name: string;
  completions: number;
  succeeded: number;
  failed: number;
  active: number;
  startedAt?: string; // RFC3339
  completedAt?: string; // RFC3339
  createdAt: string; // RFC3339
}

// CronJob summary. activeCount is the number of currently running Jobs the
// controller tracks; lastScheduleAt is absent until the first scheduled run.
// Mirrors kube.CronJobInfo.
export interface K8sCronJob {
  namespace: string;
  name: string;
  schedule: string;
  suspend: boolean;
  activeCount: number;
  lastScheduleAt?: string; // RFC3339
  createdAt: string; // RFC3339
}

/* ----- Kubernetes autoscaling + core cluster objects (Wave 3) ----- */

// HorizontalPodAutoscaler summary. target is the scale-target ref ("Deployment/
// web"); the cpu fields are the configured target and last-observed utilization
// (0 when absent). Mirrors kube.HPAInfo.
export interface HPAInfo {
  namespace: string;
  name: string;
  target: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  targetCpuPercent: number;
  currentCpuPercent: number;
}

// Body for POST /hosts/{hostID}/k8s/hpas?namespace=<ns>. Creates a CPU-
// utilization HPA targeting a Deployment. Mirrors api.hpaCreateRequest /
// kube.HPACreateSpec.
export interface HPACreateRequest {
  name: string;
  targetDeployment: string;
  minReplicas: number;
  maxReplicas: number;
  cpuPercent: number;
}

// Namespace summary. status is the phase ("Active" / "Terminating"). Mirrors
// kube.NamespaceInfo.
export interface NamespaceInfo {
  name: string;
  status: string;
  createdAt: string; // RFC3339
}

// Service summary. ports are rendered "<port>/<proto>" (or "<port>:<nodePort>/
// <proto>"); externalIP is the first LB ingress / declared external IP ("" when
// none). Mirrors kube.ServiceInfoK8s.
export interface ServiceInfoK8s {
  namespace: string;
  name: string;
  type: string;
  clusterIP: string;
  ports: string[];
  externalIP: string;
}

// ConfigMap summary: key NAMES only (never values). Mirrors kube.ConfigMapInfo.
export interface ConfigMapInfo {
  namespace: string;
  name: string;
  keys: string[];
  createdAt: string; // RFC3339
}

// Secret summary: the secret type + key NAMES only — values are NEVER returned.
// Mirrors kube.SecretInfo.
export interface SecretInfo {
  namespace: string;
  name: string;
  type: string;
  keys: string[];
  createdAt: string; // RFC3339
}

// Event summary. object is the involved object ("<kind>/<name>"); lastSeen is
// the last-occurrence timestamp. Newest-first, capped server-side. Mirrors
// kube.EventInfo.
export interface EventInfo {
  namespace: string;
  type: string;
  reason: string;
  object: string;
  message: string;
  count: number;
  lastSeen: string; // RFC3339
}

// Ingress summary (networking/v1). class is the IngressClass (spec
// ingressClassName, falling back to the legacy annotation, "" when neither set).
// hosts are the distinct rule hosts ("*" for a hostless rule); paths render the
// routing table as "<host><path> -> <service>:<port>". address is the first LB
// ingress IP/hostname ("" until provisioned). Mirrors kube.IngressInfo.
export interface IngressInfo {
  namespace: string;
  name: string;
  class: string;
  hosts: string[];
  paths: string[];
  address: string;
  createdAt: string; // RFC3339
}

/* ----- Kubernetes live metrics (metrics-server) ----- */

// NodeMetric is live per-node usage from metrics-server. cpuMilli is CPU usage
// in millicores (1000 = 1 core); memoryBytes is working-set memory in bytes.
// Mirrors kube.NodeMetric.
export interface NodeMetric {
  name: string;
  cpuMilli: number;
  memoryBytes: number;
  timestamp: string; // RFC3339
}

// PodMetric is live per-pod usage (summed over containers) from metrics-server.
// Mirrors kube.PodMetric.
export interface PodMetric {
  namespace: string;
  name: string;
  cpuMilli: number;
  memoryBytes: number;
  timestamp: string; // RFC3339
}

// Response of GET /hosts/{hostID}/k8s/metrics/nodes. available is false (with an
// empty items array) when metrics-server is not installed — not an HTTP error.
// Mirrors api.nodeMetricsResponse.
export interface NodeMetricsResponse {
  available: boolean;
  items: NodeMetric[];
}

// Response of GET /hosts/{hostID}/k8s/metrics/pods. available is false (with an
// empty items array) when metrics-server is not installed. Mirrors
// api.podMetricsResponse.
export interface PodMetricsResponse {
  available: boolean;
  items: PodMetric[];
}

/* ----- Kubernetes storage (PV / PVC / StorageClass) ----- */

// PVInfo mirrors kube.PVInfo: a cluster-scoped PersistentVolume summary.
// capacity is the Quantity string ("10Gi", …), "" when unset; claim is the bound
// PVC as "<namespace>/<name>" ("" when unbound).
export interface PVInfo {
  name: string;
  capacity: string;
  accessModes: string[];
  reclaimPolicy: string;
  status: string;
  storageClass: string;
  claim: string;
}

// PVCInfo mirrors kube.PVCInfo: a PersistentVolumeClaim summary. capacity is the
// bound (status) capacity, "" until bound; volume is the bound PV name ("" while
// Pending).
export interface PVCInfo {
  namespace: string;
  name: string;
  status: string;
  volume: string;
  capacity: string;
  accessModes: string[];
  storageClass: string;
}

// StorageClassInfo mirrors kube.StorageClassInfo. isDefault reflects the
// is-default-class annotation (GA or beta).
export interface StorageClassInfo {
  name: string;
  provisioner: string;
  reclaimPolicy: string;
  volumeBindingMode: string;
  isDefault: boolean;
}

// Body for POST /hosts/{hostID}/k8s/pvcs (mirrors api.pvcCreateRequest). name +
// a positive requestBytes are required; namespace defaults to "default";
// storageClass "" uses the cluster default; accessModes default to
// ["ReadWriteOnce"] when empty. requestBytes is the requested storage in bytes.
export interface PVCCreateRequest {
  name: string;
  namespace?: string;
  storageClass?: string;
  accessModes?: string[];
  requestBytes: number;
}

/* ----- Kubernetes mutations ----- */

// Body for POST /hosts/{hostID}/k8s/deployments/{ns}/{name}/scale.
export interface K8sScaleRequest {
  replicas: number;
}

// Body for POST /hosts/{hostID}/k8s/apply.
export interface K8sApplyRequest {
  yaml: string;
}

// Body for POST /hosts/{hostID}/k8s/cronjobs/{ns}/{name}/suspend. Mirrors
// api.suspendRequest.
export interface K8sSuspendRequest {
  suspend: boolean;
}

// Response of POST /hosts/{hostID}/k8s/cronjobs/{ns}/{name}/trigger: the name of
// the Job created from the CronJob's jobTemplate. Mirrors
// api.triggerCronJobResponse.
export interface K8sTriggerCronJobResponse {
  ok: boolean;
  job: string;
}

// One CPU+memory pair (a request OR a limit) for a Deployment container.
// cpuMilli is millicores (1000 = 1 core); memoryBytes is bytes. A 0 entry is
// "unset" and is left unchanged server-side. Mirrors kube.ResourceSpec.
export interface K8sResourceSpec {
  cpuMilli: number;
  memoryBytes: number;
}

// Body for POST /hosts/{hostID}/k8s/deployments/{ns}/{name}/resources. Sets the
// CPU/memory requests+limits on a Deployment container (containerName omitted =>
// the first container). Mirrors api.setResourcesRequest.
export interface K8sSetResourcesRequest {
  containerName?: string;
  requests: K8sResourceSpec;
  limits: K8sResourceSpec;
}

// One per-document outcome from POST /hosts/{hostID}/k8s/apply. `action` is the
// classification of the server-side apply; `error` is present only when
// action="error". Field names mirror kube.ApplyResult.
export type K8sApplyAction = "created" | "configured" | "unchanged" | "error";

export interface K8sApplyResult {
  group: string;
  version: string;
  kind: string;
  namespace: string;
  name: string;
  action: K8sApplyAction;
  error?: string;
}

// Response of POST /hosts/{hostID}/k8s/apply (mirrors api.applyResponse).
export interface K8sApplyResponse {
  results: K8sApplyResult[];
}

// Friendly aliases used by the UI layer (api.ts / views). Same wire shape as the
// request types above — kept so call sites read as "...Input".
export type K8sScaleInput = K8sScaleRequest;
export type K8sApplyInput = K8sApplyRequest;
export type K8sSetResourcesInput = K8sSetResourcesRequest;
export type K8sSuspendInput = K8sSuspendRequest;

/* ===================== Helm (charts + releases) ===================== */

// One configured chart repository. Mirrors helm.RepoInfo.
export interface HelmRepo {
  name: string;
  url: string;
}

// One chart hit from a repository-index search. version/appVersion are the
// latest version in the cached index. Mirrors helm.ChartInfo.
export interface HelmChart {
  name: string; // chart name, without the "<repo>/" prefix
  repo: string; // owning repo name
  version: string;
  appVersion: string;
  description: string;
}

// Helm release status (lower-case, as Helm reports it).
export type HelmReleaseStatus =
  | "unknown"
  | "deployed"
  | "uninstalled"
  | "superseded"
  | "failed"
  | "uninstalling"
  | "pending-install"
  | "pending-upgrade"
  | "pending-rollback";

// One Helm release summary (list + detail). chart is "<chartName>-<version>".
// Mirrors helm.ReleaseInfo.
export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  status: HelmReleaseStatus | string;
  chart: string;
  appVersion: string;
  updated: string; // RFC3339 ("" if unknown)
}

// One entry in a release's revision history. Mirrors helm.ReleaseRevision.
export interface HelmReleaseRevision {
  revision: number;
  status: HelmReleaseStatus | string;
  chart: string;
  appVersion: string;
  updated: string; // RFC3339 ("" if unknown)
  description: string; // Helm's per-revision note
}

// Body for POST .../helm/repos.
export interface HelmRepoRequest {
  name: string;
  url: string;
}

// Body for POST .../helm/releases (install). namespace defaults to "default"
// server-side; version "" => latest; values are optional overrides.
export interface HelmInstallRequest {
  release: string;
  chart: string; // "repo/name"
  namespace?: string;
  version?: string;
  values?: Record<string, unknown>;
}

// Body for POST .../helm/releases/{ns}/{name}/upgrade. The release name +
// namespace come from the path.
export interface HelmUpgradeRequest {
  chart: string;
  version?: string;
  values?: Record<string, unknown>;
}

// Body for POST .../helm/releases/{ns}/{name}/rollback. revision 0 => the
// immediately previous revision.
export interface HelmRollbackRequest {
  revision: number;
}

// HelmUpgradePreview is the body of POST .../helm/releases/{ns}/{name}/preview:
// the rendered-manifest pair for an upgrade (dry-run, nothing applied). current
// is the release's live manifest ("" when the release does not yet exist — the
// UI renders a first-install/pure-addition diff); pending is the manifest the
// upgrade would produce. The UI diffs the two. Mirrors helm.UpgradePreview.
export interface HelmUpgradePreview {
  current: string;
  pending: string;
}

/* ===================== Audit ===================== */

export type AuditResult = "success" | "denied" | "error";

export interface AuditEntry {
  id: string;
  ts: string; // RFC3339
  tsEpoch: number;
  actorId: string;
  actorName: string;
  actorIp: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  scopeType: string;
  scopeId: string | null;
  result: AuditResult;
  httpStatus: number;
  detail: unknown; // sanitized JSON, never secrets
  requestId: string;
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

export interface AuditQuery {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: AuditResult | "";
  from?: number;
  to?: number;
  limit?: number;
  cursor?: string;
}

/* ===================== Users / roles ===================== */

export interface UserRoleBinding {
  bindingId: string;
  roleId: string;
  roleName: string;
  scopeType: string;
  scopeId: string | null;
}

export interface UserRecord {
  id: string;
  username: string;
  email?: string;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: UserRoleBinding[];
}

export interface RoleRecord {
  id: string;
  name: string;
  description?: string;
  isBuiltin: boolean;
  permissions: string[];
  createdAt: string;
}

/* ===================== Settings ===================== */

export interface SettingsResponse {
  "bootstrap.completed": boolean;
  "instance.id": string;
  "security.totp_required_for_mutations": boolean;
  "session.ttl_seconds": number;
  "security.protected_labels": string[];
}

export type SettingsPatch = Partial<
  Pick<
    SettingsResponse,
    "security.totp_required_for_mutations" | "security.protected_labels" | "session.ttl_seconds"
  >
>;

/* ===================== HTTPS / TLS (Settings > HTTPS & certificates) ===================== */

// TlsMode mirrors config.TLSMode*: "self-signed" serves the locally generated
// certificate (the default), "custom" an operator-imported one, "acme" a Let's
// Encrypt certificate, "off" no HTTPS listener at all (plain HTTP, e.g. behind
// a reverse proxy — configured by environment, not from the UI).
export type TlsMode = "self-signed" | "custom" | "acme" | "off";

// TlsCertificateInfo mirrors tlsmgr.CertInfo: the public description of a
// certificate — never any key material. source is the TlsMode that produced
// it; notBefore/notAfter are unix epoch seconds; daysLeft is floored at 0;
// expired is the server's own verdict (its clock is authoritative over the
// browser's); fingerprintSha256 is upper-case colon-separated hex (the
// openssl/browser form); sans lists the DNS names then the IP addresses.
export interface TlsCertificateInfo {
  source: TlsMode;
  subject: string;
  issuer: string;
  notBefore: number;
  notAfter: number;
  expired: boolean;
  sans: string[];
  fingerprintSha256: string;
  daysLeft: number;
  selfSigned: boolean;
}

// TlsAcmeConfig mirrors api.tlsACMEView: the persisted ACME settings plus the
// outcome of the last issuance. ready is true once a certificate was obtained
// for this configuration; lastError is "" when none; lastErrorAt/lastIssued
// are unix epoch seconds, absent until the first attempt.
export interface TlsAcmeConfig {
  domains: string[];
  email: string;
  staging: boolean;
  ready: boolean;
  lastError: string;
  lastErrorAt?: number;
  lastIssued?: number;
}

// TlsStatus mirrors api.tlsSettingsView: the body of GET /settings/tls and of
// every TLS mutation. mode is the configured mode; effectiveMode is what
// handshakes actually use ("self-signed" while the configured source has no
// usable certificate yet, e.g. an ACME issuance still pending). certificate is
// what visitors currently get (null when TLS is off); custom is the imported
// certificate whatever the active mode (null when none is installed).
// restartRequired flips when the configured mode toggles the HTTPS listener
// relative to what was bound at startup (off <-> on).
//
// Mode precedence: CASTOR_TLS_MODE=off forces "off" and the persisted mode is
// ignored — managedByEnv is then true and every mutation answers 409
// tls_managed_by_env. Otherwise the persisted mode wins over the environment
// default; "off" can never be set through the API (422).
//
// serving is whether the HTTPS listener is bound; hsts whether the
// Strict-Transport-Security header (max-age one day) is currently sent, i.e.
// the request is HTTPS, the effective mode is custom or acme and the served
// certificate is not expired; publicHttpsUrl is the HTTPS URL to hand out,
// built with the same rule as the HTTP->HTTPS redirect (request host without
// a port / on port 80 => https://host, otherwise https://host:<https port>).
export interface TlsStatus {
  mode: TlsMode;
  effectiveMode: TlsMode;
  managedByEnv: boolean;
  serving: boolean;
  hsts: boolean;
  publicHttpsUrl: string;
  httpsAddr: string;
  httpAddr: string;
  redirect: boolean;
  restartRequired: boolean;
  certificate: TlsCertificateInfo | null;
  custom: TlsCertificateInfo | null;
  hasCustomCertificate: boolean;
  acme: TlsAcmeConfig;
}

// TlsAcmeRequest is the acme block of PUT /settings/tls: fully-qualified
// hostnames only (no wildcard, no IP), an optional contact e-mail and the
// staging flag (Let's Encrypt staging CA — untrusted certificates, no rate
// limit — for a dry run).
export interface TlsAcmeRequest {
  domains: string[];
  email: string;
  staging: boolean;
}

// UpdateTlsRequest is the PUT /settings/tls body. acme is applied only when
// mode is "acme"; omitted there, the persisted ACME settings are reused.
// "custom" requires an imported certificate (409 tls_no_custom_certificate);
// "off" is refused (422) — it is set by environment only; any mode is refused
// with 409 tls_managed_by_env while CASTOR_TLS_MODE=off.
export interface UpdateTlsRequest {
  mode: TlsMode;
  acme?: TlsAcmeRequest;
}

// ImportCertificateRequest is the POST /settings/tls/certificate body: PEM
// leaf, the unencrypted PEM private key and an optional PEM chain (the
// intermediate CA certificates). keyPem is the only place the private key is
// ever transmitted — it is sealed server-side and never returned, logged or
// audited. Each part is capped at 64 KiB.
export interface ImportCertificateRequest {
  certPem: string;
  keyPem: string;
  chainPem?: string;
}

/* ===================== Backups (volume tar) ===================== */

export type BackupStatus = "pending" | "completed" | "failed";

// Backup mirrors store.Backup. filePath is server-side only and never returned.
export interface Backup {
  id: string;
  kind: string; // "volume" (V1)
  hostId: string;
  targetName: string; // volume name backed up
  sizeBytes: number;
  status: BackupStatus;
  error?: string;
  createdBy?: string;
  createdAt: number; // unix epoch seconds
}

// Body for POST /hosts/{hostID}/backups.
export interface CreateBackupRequest {
  kind?: "volume";
  target: string; // volume name
}

// Body for POST /hosts/{hostID}/backups/{id}/restore.
export interface RestoreBackupRequest {
  target?: string; // defaults to the originally backed-up volume
}

/* ===================== Stacks (compose) ===================== */

export type StackStatus = "pending" | "running" | "partial" | "stopped" | "error";

// Stack mirrors store.Stack / api.stackView: a deployed multi-container compose
// stack. composeYaml is the validated source document; projectName is the
// compose project label (com.docker.compose.project) used to enumerate/teardown.
//
// GitOps fields are populated when the stack tracks a git repository. The git
// PAT and webhook-secret hash are write-only at rest: reads expose only
// hasGitToken (whether a PAT is stored) and lastSyncedCommit (the commit the
// last sync deployed). webhookSecret is NOT on this read shape — it is returned
// exactly once by stackCreate (see StackCreateResponse).
export interface Stack {
  id: string;
  name: string;
  projectName: string;
  hostId: string;
  composeYaml: string;
  status: StackStatus;
  serviceCount: number;
  createdBy: string;
  createdAt: number; // unix epoch seconds
  updatedAt: number; // unix epoch seconds

  // GitOps (mirrors api.stackView git fields).
  gitRepoUrl: string;
  gitRef: string;
  gitPath: string;
  hasGitToken: boolean;
  autoDeploy: boolean;
  lastSyncedCommit: string;
}

// StackCreateResponse is the POST /hosts/{hostID}/stacks body: a Stack plus,
// exactly once, the generated redeploy webhook secret when the stack was created
// git-backed AND with autoDeploy. Absent on every other response (only its hash
// is persisted). Mirrors api.stackCreateView (stackView + webhookSecret,omitempty).
export interface StackCreateResponse extends Stack {
  webhookSecret?: string;
}

// One live container of a stack (StackDetail.containers), enumerated by the
// compose project label.
export interface StackContainer {
  id: string;
  name: string;
  service: string;
  state: string;
}

export interface StackDetail extends Stack {
  containers: StackContainer[];
}

// StackDiff is the body of GET /hosts/{hostID}/stacks/{id}/diff (GitOps): the
// compose document currently stored on the stack vs the one at HEAD of the
// repo's pinned ref, and whether they differ. commit is the resolved incoming
// commit. The textual diff is rendered by the UI. Mirrors api.stackDiffView.
export interface StackDiff {
  current: string;
  incoming: string;
  changed: boolean;
  commit: string;
}

// One normalized service in a validate/summary response. environment is the
// "KEY=VALUE" list form; ports/volumes are the raw compose strings.
export interface StackServiceView {
  name: string;
  image: string;
  containerName: string;
  ports: string[];
  environment: string[];
  volumes: string[];
  networks: string[];
  restart: string;
  command: string[];
  dependsOn: string[];
}

// Response of POST /hosts/{hostID}/stacks/validate (200 on success; a 422
// validation_failed envelope on a bad document).
export interface StackValidateResponse {
  valid: boolean;
  serviceCount: number;
  services: StackServiceView[];
  deployOrder: string[]; // service names in topological deploy order
}

// Body for POST /hosts/{hostID}/stacks/validate.
export interface ValidateStackRequest {
  composeYaml: string;
}

// Body for POST /hosts/{hostID}/stacks (create + up). Mirrors
// api.createStackRequest.
//
// A stack needs a source: an inline composeYaml, a gitRepoUrl, or both. When
// gitRepoUrl is set the stack is created from that repo — composeYaml may be
// omitted (it is pulled on the first sync) and no containers are deployed at
// create. gitToken is a plaintext git PAT for a private repo, sent write-only
// (never returned; requires gitRepoUrl). When gitRepoUrl AND autoDeploy are both
// set, the create response carries the generated webhookSecret exactly once
// (StackCreateResponse.webhookSecret).
export interface CreateStackRequest {
  name: string;
  composeYaml: string;
  // Admin-only opt-in to permit host bind mounts declared in the compose volumes.
  // Non-admins are rejected with 403 if any service declares a host bind; the
  // always-blocked host paths stay rejected for everyone. Omit for named volumes.
  allowHostMounts?: boolean;

  // GitOps configuration (all optional; require gitRepoUrl to be set).
  gitRepoUrl?: string;
  gitRef?: string;
  gitPath?: string;
  gitToken?: string; // plaintext PAT, sent once, never returned
  autoDeploy?: boolean;
}

/* ----- compose builder (POST /stacks/builder/generate) ----- */

export interface BuilderPort {
  host: number; // 0 => ephemeral host port
  container: number;
  proto: string; // "tcp" | "udp" | "sctp" ("" treated as tcp)
}

export interface BuilderEnv {
  key: string;
  value: string;
}

export interface BuilderVolume {
  source: string; // "" => anonymous volume; abs path => bind; else named volume
  target: string;
}

export interface BuilderService {
  name: string;
  image: string;
  containerName?: string;
  ports?: BuilderPort[];
  env?: BuilderEnv[];
  volumes?: BuilderVolume[];
  networks?: string[];
  restart?: string;
  command?: string[];
  dependsOn?: string[];
}

// Body for POST /stacks/builder/generate.
export interface BuilderRequest {
  projectName: string;
  services: BuilderService[];
}

// Response of POST /stacks/builder/generate: the generated compose YAML.
export interface BuilderResponse {
  yaml: string;
}

/* ===================== Personal access tokens (PATs) ===================== */

// APIToken mirrors api.tokenView (server/internal/api/tokens.go): metadata
// only. The id is the hex SHA-256 of the raw token — it cannot be inverted and
// doubles as the revocation handle. The raw token itself is returned exactly
// once, at creation (CreateTokenResponse.token), and is never listed.
export interface APIToken {
  id: string;
  name: string;
  prefix: string; // display prefix of the raw token
  createdAt: number; // unix epoch seconds
  expiresAt?: number; // unix epoch seconds; absent => never expires
  lastUsedAt?: number; // unix epoch seconds; absent => never used
  revokedAt?: number; // unix epoch seconds; present => revoked
}

// Response of POST /auth/tokens: the ONE-TIME raw token alongside the metadata
// (the server embeds tokenView, so its fields are flattened at the top level).
export interface CreateTokenResponse extends APIToken {
  token: string;
}

/* ===================== Notification channels ===================== */

// Accepted channel transports (mirrors validChannelTypes server-side).
export type NotificationChannelType = "discord" | "slack" | "ntfy" | "webhook";

// Subscribable event kinds (mirrors validNotificationEvents server-side).
export type NotificationEvent = "container.down" | "update.available";

// NotificationChannel mirrors api.notificationChannelView — the SAFE projection.
// The webhook URL embeds a secret token, so it is NEVER returned; reads carry
// only urlSet (always true once stored).
export interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  events: NotificationEvent[];
  enabled: boolean;
  urlSet: boolean;
  createdAt: number; // unix epoch seconds
  updatedAt: number; // unix epoch seconds
}

// Body for POST /notifications/channels and PUT /notifications/channels/{id}.
// On create, url is required (an absolute http(s) URL). On update, omit url
// (or send "") to KEEP the stored URL — it can never be cleared, only
// replaced. enabled omitted => true.
export interface NotificationChannelInput {
  name: string;
  type: NotificationChannelType;
  url?: string;
  events: NotificationEvent[];
  enabled?: boolean;
}

/* ===================== Image updates ===================== */

// UpdateStatus mirrors updates.UpdateStatus (server/internal/updates/checker.go):
// the result of one container's image-update digest check. error is set when
// the registry check failed for that container (e.g. auth, network).
export interface UpdateStatus {
  containerId: string;
  containerName: string;
  image: string;
  localDigest?: string;
  remoteDigest?: string;
  updateAvailable: boolean;
  checkedAt: number; // unix epoch seconds
  error?: string;
}

/* ===================== Error envelope ===================== */

export type ApiErrorCode =
  | "bootstrap_required"
  | "unauthenticated"
  | "aal_required"
  | "forbidden"
  | "csrf_failed"
  | "not_found"
  | "method_not_allowed"
  | "protected_resource"
  | "conflict"
  | "validation_failed"
  | "rate_limited"
  | "internal"
  | "account_locked";

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode | string;
    message: string;
    requestId: string;
  };
}

/* ===================== Generic action result ===================== */

export interface ActionResult {
  ok: boolean;
}

/* ===================== WS envelope (ADR-001) ===================== */

export type WsType = "subscribe" | "unsubscribe" | "data" | "ack" | "error" | "end";
export type WsChannel = "stats" | "logs" | "events" | "exec";
export type WsRefKind = "container" | "service" | "node" | "task" | "pod";

export interface WsRef {
  kind: WsRefKind;
  id: string;
}

export interface WsExecSubscribePayload {
  cmd: string[];
  tty: boolean;
  env?: string[];
  workingDir?: string;
  // K8s pods: which container in a multi-container pod to exec into ("" / omitted
  // => the pod's default/first container). Ignored by the Docker provider.
  container?: string;
}

// Optional payload for a logs subscribe frame. tail bounds the initial backlog;
// container selects which container's logs to stream for a K8s multi-container
// pod ("" / omitted => first/default container; Docker ignores it).
export interface WsLogsSubscribePayload {
  tail?: number;
  container?: string;
}

export interface WsLogsPayload {
  stream: "stdout" | "stderr";
  line: string;
}

export interface WsEventsPayload {
  action: string;
  kind: "container" | "network" | "volume";
  id: string;
  snapshotDelta?: unknown;
}

export interface WsExecOutPayload {
  stream?: "stdout" | "stderr";
  data?: string;
  exitCode?: number;
}

export interface WsErrorPayload {
  code: string;
  message: string;
}

export interface WsEnvelope<P = unknown> {
  v: 1;
  type: WsType;
  channel?: WsChannel;
  subId?: string;
  hostId?: string;
  ref?: WsRef;
  ts?: string;
  payload?: P | null;
}

/* ===================== Marketplace: app templates + deploy ===================== */

// TemplateEnvVar is one environment variable in a marketplace template.
export interface TemplateEnvVar {
  key: string;
  value: string;
  required: boolean;
}

// TemplateSource marks where a marketplace template comes from.
export type TemplateSource = "builtin" | "custom";

// Template is a unified marketplace catalog entry from GET /templates. Built-in
// entries have an empty `id` and carry their UI logo path in `logo`; custom
// entries carry the row id and the operator-supplied logo URL in `logo`.
// `logo` is "" when there is no logo (UI renders an initials fallback).
export interface Template {
  id: string;
  source: TemplateSource;
  name: string;
  slug: string;
  category: string;
  image: string;
  description: string;
  ports: number[];
  env: TemplateEnvVar[];
  volumes: string[];
  logo: string;
  createdAt?: number; // unix epoch seconds; present for custom only
}

// TemplateWriteRequest is the POST /templates and PUT /templates/{id} body for
// a custom template (admin).
export interface TemplateWriteRequest {
  name: string;
  slug: string;
  category: string;
  image: string;
  description: string;
  ports: number[];
  env: TemplateEnvVar[];
  volumes: string[];
  logoUrl: string;
}

// DeployPortMap is a single host:container port publication. host=0 lets the
// daemon pick an ephemeral host port; proto defaults to "tcp".
export interface DeployPortMap {
  host: number;
  container: number;
  proto: string; // "tcp" | "udp"
}

// DeployVolMount is a single mount: source is a named volume or absolute host
// path (bind); target is the absolute in-container path.
export interface DeployVolMount {
  source: string;
  target: string;
}

// DeployNetworkAttach is one network the deployed container joins: the network
// (name or id), an optional static IPv4 (user-defined networks with a subnet
// only) and extra DNS aliases. Mirrors docker.NetworkAttach.
export interface DeployNetworkAttach {
  name: string;
  ipv4?: string;
  aliases?: string[];
}

// DeployRequest is the POST /hosts/{hostID}/templates/deploy body. Supply either
// templateSlug (resolved against built-in + custom catalogs) or an inline image.
// ports/env/volumes override the template defaults when provided.
export interface DeployRequest {
  templateSlug?: string;
  image?: string;
  name?: string;
  env?: Record<string, string>;
  ports?: DeployPortMap[];
  volumes?: DeployVolMount[];
  labels?: Record<string, string>;
  restartPolicy?: string; // "" | "no" | "always" | "on-failure" | "unless-stopped"

  // Existing networks the container joins, in order: the first is its primary
  // network (default gateway), the rest are connected before start. Omit or
  // send [] to leave the container on the default bridge.
  networks?: DeployNetworkAttach[];

  // Optional resource limits/reservations (<=0 / omitted means "unset"). cpu*
  // are CPU cores (like `docker run --cpus`); memory* are bytes. cpuReservation
  // maps to CPUShares (relative weight), not a hard floor.
  cpuLimit?: number;
  memoryLimitBytes?: number;
  cpuReservation?: number;
  memoryReservationBytes?: number;

  // Admin-only opt-in to permit host bind mounts. Ignored (and rejected with 403)
  // for non-admins; the always-blocked host paths (docker.sock, /, /etc, ...) are
  // rejected even for admins. Omit it for the normal named-volume path.
  allowHostMounts?: boolean;
}

// DeployResponse is returned on a successful one-click deploy.
export interface DeployResponse {
  ok: boolean;
  containerId: string;
  name: string;
  image: string;
}

// DeployTemplateRequest is an alias of DeployRequest — the body for the
// one-click template deploy (POST /hosts/{hostID}/templates/deploy).
export type DeployTemplateRequest = DeployRequest;

/* ===================== Marketplace: registries + remote catalogs (admin) ===================== */

// RegistryType is the accepted set for a registry credential.
export type RegistryType = "dockerhub" | "ghcr" | "gitlab" | "quay" | "ecr" | "custom";

// Registry is the SAFE projection from GET /registries: it carries hasSecret
// (whether a credential is stored) but NEVER the secret itself. Field names match
// the api registryView json tags.
export interface Registry {
  id: string;
  name: string;
  type: RegistryType;
  url: string;
  username: string;
  email: string;
  hasSecret: boolean;
  createdAt: number; // unix epoch seconds
}

// RegistryInput is the POST /registries body. On create, omit/empty `secret`
// stores no credential. On PUT /registries/{id} the same shape is used, but
// `secret` is optional with three-state semantics: undefined => keep the stored
// credential, "" => clear it, a value => replace it.
export interface RegistryInput {
  name: string;
  type: RegistryType;
  url: string;
  username: string;
  secret?: string;
  email: string;
}

// RegistryTestResult is the body of POST /registries/{id}/test (a failed login is
// a normal ok:false result, not an HTTP error).
export interface RegistryTestResult {
  ok: boolean;
  message: string;
}

// RemoteCatalog mirrors store.RemoteCatalog: an external template catalog served
// as JSON at `url`, whose templates are merged into the marketplace as
// source="remote:<name>". lastFetchedAt/lastError are null until the first
// refresh.
export interface RemoteCatalog {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: number | null; // unix epoch seconds
  templateCount: number;
  lastError: string | null;
  createdAt: number; // unix epoch seconds
}

// CatalogInput is the POST /catalogs and PUT /catalogs/{id} body. `enabled`
// defaults to true on create when omitted.
export interface CatalogInput {
  name: string;
  url: string;
  enabled?: boolean;
}

/* ===================== Enterprise SSO: LDAP + OIDC (Entra ID) ===================== */

// AuthProviderKind selects which subset of fields is meaningful: an LDAP/LDAPS
// directory or an OIDC (Microsoft Entra ID) provider.
export type AuthProviderKind = "ldap" | "oidc";

// LDAPTLSMode is the transport security for an LDAP provider.
export type LDAPTLSMode = "none" | "starttls" | "ldaps";

// PublicAuthProvider is the secret-free projection from GET /auth/providers
// (PUBLIC, pre-auth) used by the login screen to render "Sign in with <name>"
// buttons / an LDAP form. It exposes the bare minimum and never any config.
export interface PublicAuthProvider {
  id: string;
  name: string;
  kind: AuthProviderKind;
}

// AuthProvider is the SAFE admin projection from GET /admin/auth/providers — the
// full configuration EXCEPT the sealed secrets, which are reported only as the
// hasBindPassword / hasClientSecret booleans. Field names mirror authProviderView
// (server/internal/api/admin_auth.go) verbatim.
export interface AuthProvider {
  id: string;
  name: string;
  kind: AuthProviderKind;
  enabled: boolean;
  defaultRoleId: string;

  // LDAP
  ldapHost: string;
  ldapPort: number;
  ldapTls: LDAPTLSMode;
  ldapSkipVerify: boolean;
  ldapBindDn: string;
  hasBindPassword: boolean;
  ldapBaseDn: string;
  ldapUserFilter: string;
  ldapAttrUsername: string;
  ldapAttrEmail: string;
  ldapAttrDisplay: string;
  ldapGroupBaseDn: string;
  ldapGroupFilter: string;
  ldapAttrMember: string;

  // OIDC (Entra ID)
  oidcIssuer: string;
  oidcClientId: string;
  hasClientSecret: boolean;
  oidcRedirectUrl: string;
  oidcScopes: string;
  oidcGroupsClaim: string;
  oidcUsernameClaim: string;
  oidcEmailClaim: string;

  createdAt: number; // unix epoch seconds
  updatedAt: number; // unix epoch seconds
}

// AuthProviderInput is the POST /admin/auth/providers (create) and PUT
// /admin/auth/providers/{id} (update) body. Mirrors authProviderRequest. Secrets
// (ldapBindPassword / oidcClientSecret) use three-state pointer semantics on
// update: undefined => keep the stored secret, "" => clear it, a value => replace
// it. On create a non-empty value is sealed; omit/empty stores none. `kind` is
// immutable after create (the server ignores it on update).
export interface AuthProviderInput {
  name: string;
  kind: AuthProviderKind;
  enabled: boolean;
  defaultRoleId: string;

  // LDAP
  ldapHost: string;
  ldapPort: number;
  ldapTls: LDAPTLSMode;
  ldapSkipVerify: boolean;
  ldapBindDn: string;
  ldapBindPassword?: string;
  ldapBaseDn: string;
  ldapUserFilter: string;
  ldapAttrUsername: string;
  ldapAttrEmail: string;
  ldapAttrDisplay: string;
  ldapGroupBaseDn: string;
  ldapGroupFilter: string;
  ldapAttrMember: string;

  // OIDC (Entra ID)
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret?: string;
  oidcRedirectUrl: string;
  oidcScopes: string;
  oidcGroupsClaim: string;
  oidcUsernameClaim: string;
  oidcEmailClaim: string;
}

// GroupRoleMapping maps an external group (LDAP group DN/CN, or an Entra group
// object-id/name from the token's groups claim) to a Castor role. Mirrors
// groupMappingView. At login the union of a user's groups resolves to roles.
export interface GroupRoleMapping {
  id: string;
  providerId: string;
  externalGroup: string;
  roleId: string;
  createdAt: number; // unix epoch seconds
}

// CreateGroupRoleMappingInput is the POST /admin/auth/providers/{id}/mappings
// body (mirrors createMappingRequest).
export interface CreateGroupRoleMappingInput {
  externalGroup: string;
  roleId: string;
}

// ProviderTestResult is the body of POST /admin/auth/providers/{id}/test. A
// configuration/connectivity problem is a normal ok:false result (not an HTTP
// error). sampleUser is an LDAP sample entry DN when the search matched one.
export interface ProviderTestResult {
  ok: boolean;
  message: string;
  sampleUser?: string;
}
