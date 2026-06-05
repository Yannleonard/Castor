// ui/src/views/K8sWorkloads.tsx
//
// Kubernetes (read + gated writes): pods, deployments, nodes with a namespace
// selector. Deployments can be scaled, rollout-restarted and deleted; pods can
// be deleted; an "Apply YAML" action server-side-applies a (multi-document)
// manifest and reports a per-resource result. Affordances are greyed-out before
// click via CapabilityGate (provider capability + RBAC permission); the backend
// re-checks. Pod rows remain click-through to the detail view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useK8sPods, useK8sDeployments, useK8sNodes, useK8sPodMetrics, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { gateK8s, gateExec, gateLogs } from "../lib/rbac";
import { subscribeExec, subscribeLogs } from "../lib/ws";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { StateBadge } from "../components/StateBadge";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { Modal } from "../components/Modal";
import { HelpPanel } from "../components/HelpPanel";
import { EmptyState } from "../components/EmptyState";
import { QosBadge } from "../components/QosBadge";
import { Terminal } from "../components/Terminal";
import { LogViewer, type LogLine } from "../components/LogViewer";
import {
  K8sResourcePairFields,
  k8sPairDraftFromQuantities,
  k8sPairFromDraft,
  bytesToQuantity,
  type K8sPairDraft,
} from "../components/ResourceFields";
import { IconKube, IconRefresh, IconPlus, IconTrash, IconRestart, IconScale, IconEdit, IconHelp, IconCopy, IconCheck, IconTerminal, IconLogs } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { cleanName, timeAgo, formatBytes } from "../lib/format";
import { podQosClass, type K8sApplyResult, type K8sContainerResources, type K8sDeployment, type K8sNode, type PodMetric, type Workload } from "../lib/types";

type Section = "pods" | "deployments" | "nodes";

// Split a pod id "<ns>/<pod>" into its parts (ns may be empty when not encoded).
function splitPodId(id: string): { ns: string; name: string } {
  const i = id.indexOf("/");
  if (i < 0) return { ns: "", name: id };
  return { ns: id.slice(0, i), name: id.slice(i + 1) };
}

// CPU millicores -> compact cores label ("250m" -> "0.25").
function milliToCores(milli: number): string {
  if (milli <= 0) return "0";
  return (milli / 1000).toFixed(milli % 1000 === 0 ? 0 : 2);
}

// Small copy-able shell command used in the guided empty state.
function InlineCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copied to clipboard", command);
    }
  };
  return (
    <div className="help-cmd">
      <code className="help-cmd-text">{command}</code>
      <button type="button" className="btn btn-ghost btn-sm btn-icon help-cmd-copy" onClick={copy} aria-label="Copy command" title="Copy command">
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

export function K8sWorkloads() {
  const hostId = useSelectedHost();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("kubernetes");

  const [section, setSection] = useState<Section>("pods");
  const [namespace, setNamespace] = useState("");

  const podsQ = useK8sPods(hostId, namespace, section === "pods");
  const deploysQ = useK8sDeployments(hostId, namespace, section === "deployments");
  const nodesQ = useK8sNodes(hostId, section === "nodes");
  // Live per-pod usage (metrics-server) — keyed by "<ns>/<name>" for the columns.
  // available:false when metrics-server is not installed (columns then show "—").
  const podMetricsQ = useK8sPodMetrics(hostId, namespace, section === "pods");
  const podMetrics = useMemo(() => {
    const m = new Map<string, PodMetric>();
    if (podMetricsQ.data?.available) {
      for (const p of podMetricsQ.data.items) m.set(`${p.namespace}/${p.name}`, p);
    }
    return m;
  }, [podMetricsQ.data]);
  const metricsAvailable = !!podMetricsQ.data?.available;

  // Write affordance gates.
  const scaleGate = gateK8s("scale", caps, permissions);
  const restartGate = gateK8s("restart", caps, permissions);
  const resourcesGate = gateK8s("resources", caps, permissions);
  const deleteGate = gateK8s("delete", caps, permissions);
  const applyGate = gateK8s("apply", caps, permissions);
  // Pod exec / logs reuse the generic capability gates (CapExec / CapLogs +
  // docker.container.exec / .logs — the same permissions the WS server enforces
  // for pod targets).
  const execGate = gateExec(caps, permissions);
  const logsGate = gateLogs(caps, permissions);

  // Modal / dialog state.
  const [helpOpen, setHelpOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [scaleTarget, setScaleTarget] = useState<K8sDeployment | null>(null);
  const [restartTarget, setRestartTarget] = useState<K8sDeployment | null>(null);
  const [resourcesTarget, setResourcesTarget] = useState<K8sDeployment | null>(null);
  const [deployDeleteTarget, setDeployDeleteTarget] = useState<K8sDeployment | null>(null);
  const [podDeleteTarget, setPodDeleteTarget] = useState<Workload | null>(null);
  const [podTermTarget, setPodTermTarget] = useState<Workload | null>(null);
  const [podLogsTarget, setPodLogsTarget] = useState<Workload | null>(null);

  // Namespace options derived from whatever we've loaded.
  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const p of podsQ.data ?? []) {
      const ns = p.id.includes("/") ? p.id.split("/")[0]! : "";
      if (ns) set.add(ns);
    }
    for (const d of deploysQ.data ?? []) if (d.namespace) set.add(d.namespace);
    return Array.from(set).sort();
  }, [podsQ.data, deploysQ.data]);

  const refetch = () => {
    if (section === "pods") podsQ.refetch();
    else if (section === "deployments") deploysQ.refetch();
    else nodesQ.refetch();
  };

  const invalidatePods = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "pods", hostId], exact: false });
  const invalidateDeploys = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "deployments", hostId], exact: false });

  const podCols: Column<Workload>[] = [
    {
      key: "name",
      header: "Pod",
      sortValue: (p) => cleanName(p.name),
      cell: (p) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }} className="truncate">
            {cleanName(p.name)}
          </span>
          <span className="text-xs muted mono">{p.id.includes("/") ? p.id.split("/")[0] : "—"}</span>
        </div>
      ),
    },
    { key: "state", header: "State", sortValue: (p) => p.state, cell: (p) => <StateBadge state={p.state} raw={p.stateRaw} /> },
    {
      key: "qos",
      header: "QoS",
      sortValue: (p) => podQosClass(p.labels) ?? "",
      cell: (p) => {
        const qos = podQosClass(p.labels);
        return qos ? <QosBadge qos={qos} subtle /> : <span className="muted">—</span>;
      },
    },
    { key: "node", header: "Node", sortValue: (p) => p.node ?? "", cell: (p) => <span className="text-sm secondary">{p.node || "—"}</span> },
    {
      key: "cpu",
      header: "CPU",
      sortValue: (p) => podMetrics.get(p.id)?.cpuMilli ?? -1,
      cell: (p) => {
        const m = podMetrics.get(p.id);
        if (!m) return <span className="muted">—</span>;
        return <span className="mono text-xs">{milliToCores(m.cpuMilli)} <span className="muted">cores</span></span>;
      },
    },
    {
      key: "mem",
      header: "Memory",
      sortValue: (p) => podMetrics.get(p.id)?.memoryBytes ?? -1,
      cell: (p) => {
        const m = podMetrics.get(p.id);
        if (!m) return <span className="muted">—</span>;
        return <span className="mono text-xs">{formatBytes(m.memoryBytes)}</span>;
      },
    },
    { key: "image", header: "Image", sortValue: (p) => p.image, cell: (p) => <span className="mono text-xs truncate" style={{ maxWidth: 200, display: "inline-block" }} title={p.image}>{p.image}</span> },
    { key: "group", header: "Owner", sortValue: (p) => p.group ?? "", cell: (p) => (p.group ? <span className="chip">{p.group}</span> : <span className="muted">—</span>) },
    { key: "created", header: "Created", sortValue: (p) => p.createdAt, cell: (p) => <span className="text-xs muted nowrap">{timeAgo(p.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "120px",
      cell: (p) => {
        const running = p.state === "running";
        return (
          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
            <CapabilityGate gate={logsGate}>
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? "Logs" : reason}
                  aria-label="Pod logs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPodLogsTarget(p);
                  }}
                >
                  <IconLogs size={15} />
                </ActionButton>
              )}
            </CapabilityGate>
            <CapabilityGate gate={execGate}>
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed || !running}
                  tooltip={!running ? "Pod is not running" : allowed ? "Terminal" : reason}
                  aria-label="Pod terminal"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPodTermTarget(p);
                  }}
                >
                  <IconTerminal size={15} />
                </ActionButton>
              )}
            </CapabilityGate>
            <CapabilityGate gate={deleteGate}>
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? "Delete pod" : reason}
                  aria-label="Delete pod"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPodDeleteTarget(p);
                  }}
                  style={allowed ? { color: "var(--danger)" } : undefined}
                >
                  <IconTrash size={15} />
                </ActionButton>
              )}
            </CapabilityGate>
          </div>
        );
      },
    },
  ];

  const deployCols: Column<K8sDeployment>[] = [
    { key: "name", header: "Deployment", sortValue: (d) => d.name, cell: (d) => <span style={{ fontWeight: 600 }}>{d.name}</span> },
    { key: "namespace", header: "Namespace", sortValue: (d) => d.namespace, cell: (d) => <span className="chip">{d.namespace}</span> },
    {
      key: "ready",
      header: "Ready",
      sortValue: (d) => d.ready,
      cell: (d) => (
        <span className="mono" style={{ color: d.ready >= d.replicas ? "var(--success)" : "var(--warning)" }}>
          {d.ready}/{d.replicas}
        </span>
      ),
    },
    { key: "available", header: "Available", sortValue: (d) => d.available, cell: (d) => <span className="mono">{d.available}</span> },
    {
      key: "qos",
      header: "QoS",
      sortValue: (d) => d.qosClass,
      cell: (d) => (d.qosClass ? <QosBadge qos={d.qosClass} subtle /> : <span className="muted">—</span>),
    },
    { key: "image", header: "Image", sortValue: (d) => d.image, cell: (d) => <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={d.image}>{d.image}</span> },
    { key: "created", header: "Created", sortValue: (d) => d.createdAt, cell: (d) => <span className="text-xs muted nowrap">{timeAgo(d.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "164px",
      cell: (d) => (
        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
          <CapabilityGate gate={scaleGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? "Scale" : reason}
                aria-label="Scale deployment"
                onClick={() => setScaleTarget(d)}
              >
                <IconScale size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={resourcesGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? "Resources" : reason}
                aria-label="Edit resources"
                onClick={() => setResourcesTarget(d)}
              >
                <IconEdit size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={restartGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? "Rollout restart" : reason}
                aria-label="Restart deployment"
                onClick={() => setRestartTarget(d)}
              >
                <IconRestart size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={deleteGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? "Delete" : reason}
                aria-label="Delete deployment"
                onClick={() => setDeployDeleteTarget(d)}
                style={allowed ? { color: "var(--danger)" } : undefined}
              >
                <IconTrash size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
        </div>
      ),
    },
  ];

  const nodeCols: Column<K8sNode>[] = [
    { key: "name", header: "Node", sortValue: (n) => n.name, cell: (n) => <span style={{ fontWeight: 600 }}>{n.name}</span> },
    {
      key: "status",
      header: "Status",
      sortValue: (n) => n.status,
      cell: (n) => (
        <span className="pill" style={{ color: n.status === "Ready" ? "var(--success)" : "var(--warning)", background: "transparent", borderColor: "var(--border-strong)" }}>
          {n.status}
        </span>
      ),
    },
    { key: "roles", header: "Roles", cell: (n) => <span className="row-wrap" style={{ gap: 4 }}>{n.roles.length ? n.roles.map((r) => <span key={r} className="chip text-xs">{r}</span>) : <span className="muted">—</span>}</span> },
    { key: "version", header: "Version", sortValue: (n) => n.version, cell: (n) => <span className="mono text-xs">{n.version}</span> },
    { key: "ip", header: "Internal IP", cell: (n) => <span className="mono text-xs muted">{n.internalIP || "—"}</span> },
  ];

  const loading =
    (section === "pods" && podsQ.isLoading) ||
    (section === "deployments" && deploysQ.isLoading) ||
    (section === "nodes" && nodesQ.isLoading);

  // --- deployment write handlers ---
  const doRestart = async () => {
    if (!restartTarget) return;
    try {
      await api.k8sRestartDeployment(hostId, restartTarget.namespace, restartTarget.name);
      toast.success("Rollout restarted", `${restartTarget.namespace}/${restartTarget.name}`);
      invalidateDeploys();
    } catch (err) {
      toastError("Restart failed", err);
      throw err;
    }
  };

  const doDeleteDeploy = async () => {
    if (!deployDeleteTarget) return;
    try {
      await api.k8sDeleteDeployment(hostId, deployDeleteTarget.namespace, deployDeleteTarget.name);
      toast.success("Deployment deleted", `${deployDeleteTarget.namespace}/${deployDeleteTarget.name}`);
      invalidateDeploys();
    } catch (err) {
      toastError("Delete failed", err);
      throw err;
    }
  };

  const doDeletePod = async () => {
    if (!podDeleteTarget) return;
    const { ns, name } = splitPodId(podDeleteTarget.id);
    try {
      await api.k8sDeletePod(hostId, ns, name);
      toast.success("Pod deleted", `${ns}/${name}`);
      invalidatePods();
    } catch (err) {
      toastError("Delete failed", err);
      throw err;
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="row" style={{ gap: "var(--sp-3)" }}>
            Kubernetes
            <OrchestratorBadge kind="kubernetes" />
          </span>
        }
        subtitle="Manage pods and deployments, or apply a manifest."
        actions={
          <div className="row">
            {section !== "nodes" ? (
              <select className="select" style={{ width: 200 }} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
                <option value="">All namespaces</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </select>
            ) : null}
            <CapabilityGate gate={applyGate}>
              {(allowed, reason) => (
                <ActionButton
                  variant="primary"
                  disabled={!allowed}
                  tooltip={allowed ? undefined : reason}
                  onClick={() => setApplyOpen(true)}
                >
                  <IconPlus size={15} />
                  Apply YAML
                </ActionButton>
              )}
            </CapabilityGate>
            <ActionButton variant="ghost" iconOnly tooltip="Setup guide" aria-label="Setup guide" onClick={() => setHelpOpen(true)}>
              <IconHelp size={16} />
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${section === "pods" ? " active" : ""}`} onClick={() => setSection("pods")}>
          Pods
        </button>
        <button className={`tab${section === "deployments" ? " active" : ""}`} onClick={() => setSection("deployments")}>
          Deployments
        </button>
        <button className={`tab${section === "nodes" ? " active" : ""}`} onClick={() => setSection("nodes")}>
          Nodes
        </button>
      </div>

      {loading ? (
        <LoadingFill label="Loading Kubernetes data…" />
      ) : section === "pods" ? (
        (podsQ.isError || (podsQ.data ?? []).length === 0) && !namespace ? (
          <div className="card">
            <EmptyState
              icon={<IconKube size={40} />}
              title="No Kubernetes cluster reachable"
              message="Castor connects to an existing cluster through a mounted kubeconfig. Mount your kubeconfig into the container and point CASTOR_KUBECONFIG at it, then make sure its server address is reachable from inside the container."
              action={
                <div className="help-guide">
                  <ActionButton variant="primary" onClick={() => setHelpOpen(true)}>
                    <IconHelp size={15} />
                    Show setup guide
                  </ActionButton>
                  <div className="help-guide-cmd">
                    <InlineCommand command="-v $HOME/.kube/config:/home/nonroot/.kube/config:ro -e CASTOR_KUBECONFIG=/home/nonroot/.kube/config" />
                  </div>
                </div>
              }
            />
          </div>
        ) : (
          <div className="col" style={{ gap: "var(--sp-3)" }}>
            {!metricsAvailable && (podsQ.data ?? []).length > 0 ? (
              <div className="text-xs muted" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
                <IconKube size={14} />
                CPU / memory columns are blank — install <span className="mono">metrics-server</span> for live pod usage.
              </div>
            ) : null}
            <DataTable
              columns={podCols}
              rows={podsQ.data ?? []}
              rowKey={(p) => p.id}
              defaultSortKey="name"
              onRowClick={(p) => navigate(`/workloads/${encodeURIComponent(hostId)}/${encodeURIComponent(p.id)}`)}
              emptyIcon={<IconKube size={40} />}
              emptyTitle="No pods"
              emptyMessage="No Kubernetes cluster is reachable, or the namespace is empty."
            />
          </div>
        )
      ) : section === "deployments" ? (
        <DataTable
          columns={deployCols}
          rows={deploysQ.data ?? []}
          rowKey={(d) => `${d.namespace}/${d.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle="No deployments"
        />
      ) : (
        <DataTable
          columns={nodeCols}
          rows={nodesQ.data ?? []}
          rowKey={(n) => n.name}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle="No nodes"
        />
      )}

      {/* ---- Setup guide ---- */}
      <HelpPanel topic="kubernetes" open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ---- Apply YAML ---- */}
      <ApplyManifestModal open={applyOpen} hostId={hostId} onClose={() => setApplyOpen(false)} onApplied={() => {
        invalidatePods();
        invalidateDeploys();
      }} />

      {/* ---- Scale deployment ---- */}
      <ScaleDeploymentModal
        hostId={hostId}
        target={scaleTarget}
        onClose={() => setScaleTarget(null)}
        onDone={() => {
          setScaleTarget(null);
          invalidateDeploys();
        }}
      />

      {/* ---- Edit resources (requests/limits) ---- */}
      <ResourcesDeploymentModal
        hostId={hostId}
        target={resourcesTarget}
        onClose={() => setResourcesTarget(null)}
        onDone={() => {
          setResourcesTarget(null);
          invalidateDeploys();
        }}
      />

      {/* ---- Restart deployment (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!restartTarget}
        title="Rollout restart"
        variant="primary"
        confirmLabel="Restart"
        description={
          <>
            Trigger a rolling restart of{" "}
            <strong className="mono">
              {restartTarget?.namespace}/{restartTarget?.name}
            </strong>
            ? Pods are recreated one batch at a time.
          </>
        }
        onConfirm={doRestart}
        onClose={() => setRestartTarget(null)}
      />

      {/* ---- Delete deployment (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!deployDeleteTarget}
        title="Delete deployment"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete{" "}
            <strong className="mono">
              {deployDeleteTarget?.namespace}/{deployDeleteTarget?.name}
            </strong>
            ? Its pods are terminated. This cannot be undone.
          </>
        }
        onConfirm={doDeleteDeploy}
        onClose={() => setDeployDeleteTarget(null)}
      />

      {/* ---- Delete pod (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!podDeleteTarget}
        title="Delete pod"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete pod <strong className="mono">{podDeleteTarget ? cleanName(podDeleteTarget.name) : ""}</strong>? If it
            is managed by a controller it will be recreated.
          </>
        }
        onConfirm={doDeletePod}
        onClose={() => setPodDeleteTarget(null)}
      />

      {/* ---- Pod terminal (WS exec) ---- */}
      <PodTerminalModal hostId={hostId} pod={podTermTarget} onClose={() => setPodTermTarget(null)} />

      {/* ---- Pod logs (WS logs, container-selectable) ---- */}
      <PodLogsModal hostId={hostId} pod={podLogsTarget} onClose={() => setPodLogsTarget(null)} />
    </div>
  );
}

/* ============================ Pod terminal modal ============================ */

const POD_SHELLS = [
  { label: "/bin/sh", cmd: ["/bin/sh"] },
  { label: "/bin/bash", cmd: ["/bin/bash"] },
  { label: "/bin/ash", cmd: ["/bin/ash"] },
];

// Opens the shared xterm Terminal over the WS `exec` channel against a pod target
// ("<ns>/<pod>", refKind "pod"). Mirrors the Docker container TerminalTab; adds an
// optional container field for multi-container pods (the pod list payload does not
// enumerate containers, so it is a free-text override — blank uses the pod's
// default/first container, which the server resolves).
function PodTerminalModal({
  hostId,
  pod,
  onClose,
}: {
  hostId: string;
  pod: Workload | null;
  onClose: () => void;
}) {
  const [shellIdx, setShellIdx] = useState(0);
  const [container, setContainer] = useState("");
  const [sessionKey, setSessionKey] = useState(0);
  const [started, setStarted] = useState(false);
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);

  // Reset whenever a new pod opens the modal.
  useEffect(() => {
    setShellIdx(0);
    setContainer("");
    setSessionKey(0);
    setStarted(false);
    setExitCode(undefined);
  }, [pod]);

  const podId = pod?.id ?? "";
  const shell = POD_SHELLS[shellIdx]!;

  const connect = useCallback(
    (handlers: {
      onData: (p: any) => void;
      onAck: () => void;
      onError: (msg: string) => void;
      onEnd: () => void;
    }) => {
      return subscribeExec(
        hostId,
        { kind: "pod", id: podId },
        { cmd: shell.cmd, tty: true, env: [], workingDir: "", container: container.trim() || undefined },
        {
          onAck: handlers.onAck,
          onData: handlers.onData,
          onError: (err) => handlers.onError(err.message || err.code),
          onEnd: handlers.onEnd,
        },
      );
    },
    // capture the chosen shell/container/session at start time
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId, podId, sessionKey],
  );

  const term = useMemo(
    () => (
      <Terminal
        key={sessionKey}
        connect={connect}
        onExit={(code) => {
          setExitCode(code);
          setStarted(false);
        }}
      />
    ),
    [connect, sessionKey],
  );

  const { ns, name } = pod ? splitPodId(pod.id) : { ns: "", name: "" };

  return (
    <Modal
      open={!!pod}
      wide
      title={
        <span className="col" style={{ gap: 0 }}>
          <span>Pod terminal</span>
          <span className="text-xs muted mono">{ns}/{name}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="row-wrap" style={{ gap: "var(--sp-2)", alignItems: "flex-end" }}>
          <div className="field" style={{ width: 150 }}>
            <label className="field-label" htmlFor="pod-term-shell">Shell</label>
            <select
              id="pod-term-shell"
              className="select"
              value={shellIdx}
              onChange={(e) => setShellIdx(Number(e.target.value))}
              disabled={started}
            >
              {POD_SHELLS.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 200 }}>
            <label className="field-label" htmlFor="pod-term-container">Container</label>
            <input
              id="pod-term-container"
              className="input input-mono"
              placeholder="(default)"
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              disabled={started}
              aria-label="Container name (blank for default)"
            />
          </div>
          {!started ? (
            <ActionButton
              variant="primary"
              onClick={() => {
                setExitCode(undefined);
                setSessionKey((k) => k + 1);
                setStarted(true);
              }}
            >
              <IconTerminal size={15} />
              Open session
            </ActionButton>
          ) : (
            <ActionButton variant="ghost" onClick={() => setSessionKey((k) => k + 1)}>
              Restart session
            </ActionButton>
          )}
          <span className="spacer" />
          {exitCode !== undefined ? (
            <span className="text-xs muted">
              Last session exited{exitCode === null ? "" : ` (code ${exitCode})`}
            </span>
          ) : null}
        </div>
        <span className="text-xs muted">
          For a multi-container pod, name the container to exec into; leave blank for the pod's default container.
        </span>

        {started || sessionKey > 0 ? (
          term
        ) : (
          <div
            className="center-fill"
            style={{ minHeight: 320, background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}
          >
            <IconTerminal size={36} />
            <span className="text-sm muted">Pick a shell and open an interactive session.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ============================ Pod logs modal ============================ */

const POD_LOG_MAX_LINES = 5000;

// Streams a pod's logs over the WS `logs` channel into the shared LogViewer, with
// an optional container override (forwarded as the logs subscribe payload's
// `container`). Blank = the pod's default/first container (server resolves it).
// Changing the container restarts the stream + clears the buffer.
function PodLogsModal({
  hostId,
  pod,
  onClose,
}: {
  hostId: string;
  pod: Workload | null;
  onClose: () => void;
}) {
  const [container, setContainer] = useState("");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  const podId = pod?.id ?? "";

  // Reset everything when a different pod opens the modal.
  useEffect(() => {
    setContainer("");
    setLines([]);
    setError("");
    setConnected(false);
    seqRef.current = 0;
  }, [pod]);

  // Live follow via WS, re-subscribed when the pod or container changes.
  useEffect(() => {
    if (!pod) return;
    setError("");
    setLines([]);
    seqRef.current = 0;
    const sub = subscribeLogs(
      hostId,
      { kind: "pod", id: podId },
      {
        onAck: () => setConnected(true),
        onData: (payload) => {
          setLines((prev) => {
            const next = prev.concat([{ seq: ++seqRef.current, stream: payload.stream, line: payload.line }]);
            return next.length > POD_LOG_MAX_LINES ? next.slice(next.length - POD_LOG_MAX_LINES) : next;
          });
        },
        onError: (err) => {
          setError(err.message || err.code);
          setConnected(false);
        },
        onEnd: () => setConnected(false),
      },
      { tail: 200, container: container.trim() || undefined },
    );
    return () => sub.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, podId, container, pod]);

  const { ns, name } = pod ? splitPodId(pod.id) : { ns: "", name: "" };

  return (
    <Modal
      open={!!pod}
      wide
      title={
        <span className="col" style={{ gap: 0 }}>
          <span>Pod logs</span>
          <span className="text-xs muted mono">{ns}/{name}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="row-wrap" style={{ gap: "var(--sp-2)", alignItems: "flex-end" }}>
          <div className="field" style={{ width: 220 }}>
            <label className="field-label" htmlFor="pod-logs-container">Container</label>
            <input
              id="pod-logs-container"
              className="input input-mono"
              placeholder="(default)"
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              aria-label="Container name (blank for default)"
            />
          </div>
          <span className="text-xs muted" style={{ paddingBottom: 8 }}>
            Name a container for a multi-container pod; blank streams the default container.
          </span>
        </div>
        {error ? <div className="banner danger">Log stream error: {error}</div> : null}
        <LogViewer
          lines={lines}
          follow={follow}
          onToggleFollow={setFollow}
          onClear={() => setLines([])}
          status={connected ? "streaming" : "connecting…"}
          height={420}
        />
      </div>
    </Modal>
  );
}

/* ============================ Scale deployment modal ============================ */

function ScaleDeploymentModal({
  hostId,
  target,
  onClose,
  onDone,
}: {
  hostId: string;
  target: K8sDeployment | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [replicas, setReplicas] = useState("0");
  const [busy, setBusy] = useState(false);

  // Seed from the target each time it changes.
  useEffect(() => {
    if (target) {
      setReplicas(String(target.replicas));
      setBusy(false);
    }
  }, [target]);

  const n = Number(replicas);
  const valid = Number.isInteger(n) && n >= 0 && !busy;

  const submit = async () => {
    if (!target || !valid) return;
    setBusy(true);
    try {
      await api.k8sScaleDeployment(hostId, target.namespace, target.name, { replicas: n });
      toast.success("Deployment scaled", `${target.namespace}/${target.name} → ${n} replica(s).`);
      onDone();
    } catch (err) {
      toastError("Scale failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      title="Scale deployment"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Scale
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="text-sm secondary">
          Deployment{" "}
          <strong className="mono">
            {target?.namespace}/{target?.name}
          </strong>{" "}
          — currently <span className="mono">{target?.replicas}</span> desired.
        </div>
        <div className="field" style={{ width: 160 }}>
          <label className="field-label" htmlFor="k8s-scale-replicas">
            Replicas
          </label>
          <input
            id="k8s-scale-replicas"
            className="input"
            type="number"
            min={0}
            autoFocus
            value={replicas}
            onChange={(e) => setReplicas(e.target.value)}
          />
          {replicas !== "" && !(Number.isInteger(n) && n >= 0) ? (
            <span className="field-error">Whole number ≥ 0.</span>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/* ============================ Resources modal ============================ */

function ResourcesDeploymentModal({
  hostId,
  target,
  onClose,
  onDone,
}: {
  hostId: string;
  target: K8sDeployment | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const containers = target?.containers ?? [];
  const [containerName, setContainerName] = useState("");
  const [requests, setRequests] = useState<K8sPairDraft>(() => k8sPairDraftFromQuantities(undefined, undefined));
  const [limits, setLimits] = useState<K8sPairDraft>(() => k8sPairDraftFromQuantities(undefined, undefined));
  const [busy, setBusy] = useState(false);

  // The currently-selected container's existing resources (default: first).
  const selected: K8sContainerResources | undefined =
    containers.find((c) => c.name === containerName) ?? containers[0];

  // Seed the form whenever the target changes or the user picks a container.
  useEffect(() => {
    if (!target) return;
    const first = target.containers[0];
    setContainerName(first?.name ?? "");
    setBusy(false);
  }, [target]);

  useEffect(() => {
    if (!selected) {
      setRequests(k8sPairDraftFromQuantities(undefined, undefined));
      setLimits(k8sPairDraftFromQuantities(undefined, undefined));
      return;
    }
    setRequests(k8sPairDraftFromQuantities(selected.cpuRequest, selected.memRequest));
    setLimits(k8sPairDraftFromQuantities(selected.cpuLimit, selected.memLimit));
    // selected is derived from containerName + target; re-seed on either change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, containerName]);

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      const req = k8sPairFromDraft(requests);
      const lim = k8sPairFromDraft(limits);
      await api.k8sSetDeploymentResources(hostId, target.namespace, target.name, {
        containerName: selected?.name || undefined,
        requests: req,
        limits: lim,
      });
      toast.success("Resources updated", `${target.namespace}/${target.name}`);
      onDone();
    } catch (err) {
      toastError("Update failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title="Edit resources"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={busy || containers.length === 0} onClick={submit}>
            Apply
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          Set CPU / memory requests and limits on{" "}
          <strong className="mono">
            {target?.namespace}/{target?.name}
          </strong>
          . A blank field leaves that value unchanged on the server.
        </div>

        {containers.length === 0 ? (
          <div className="text-sm muted">This deployment exposes no containers to configure.</div>
        ) : (
          <>
            {containers.length > 1 ? (
              <div className="field" style={{ maxWidth: 280 }}>
                <label className="field-label" htmlFor="k8s-rsc-container">
                  Container
                </label>
                <select
                  id="k8s-rsc-container"
                  className="select"
                  value={selected?.name ?? ""}
                  onChange={(e) => setContainerName(e.target.value)}
                >
                  {containers.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="text-xs muted">
                Container <span className="mono">{selected?.name}</span>
              </div>
            )}

            {/* current values */}
            <div className="col" style={{ gap: 4 }}>
              <span className="field-label" style={{ margin: 0 }}>
                Current
              </span>
              <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap" }}>
                <span className="text-xs muted">
                  requests:{" "}
                  <span className="mono">{selected?.cpuRequest || "—"} cpu</span> /{" "}
                  <span className="mono">{selected?.memRequest || "—"}</span>
                </span>
                <span className="text-xs muted">
                  limits:{" "}
                  <span className="mono">{selected?.cpuLimit || "—"} cpu</span> /{" "}
                  <span className="mono">{selected?.memLimit || "—"}</span>
                </span>
              </div>
            </div>

            <K8sResourcePairFields label="Requests" draft={requests} onChange={setRequests} />
            <K8sResourcePairFields label="Limits" draft={limits} onChange={setLimits} />
            <span className="text-xs muted">
              CPU is millicores (1000m = 1 core); the new values resolve to{" "}
              <span className="mono">
                req {k8sPairFromDraft(requests).cpuMilli || 0}m / {bytesToQuantity(k8sPairFromDraft(requests).memoryBytes)}
              </span>
              ,{" "}
              <span className="mono">
                lim {k8sPairFromDraft(limits).cpuMilli || 0}m / {bytesToQuantity(k8sPairFromDraft(limits).memoryBytes)}
              </span>
              .
            </span>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ============================ Apply manifest modal ============================ */

function ApplyManifestModal({
  open,
  hostId,
  onClose,
  onApplied,
}: {
  open: boolean;
  hostId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [yaml, setYaml] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<K8sApplyResult[] | null>(null);

  const close = () => {
    if (busy) return;
    setYaml("");
    setResults(null);
    onClose();
  };

  const submit = async () => {
    if (!yaml.trim() || busy) return;
    setBusy(true);
    setResults(null);
    try {
      const res = await api.k8sApply(hostId, { yaml });
      setResults(res.results);
      const errors = res.results.filter((r) => r.action === "error").length;
      if (errors === 0) {
        toast.success("Manifest applied", `${res.results.length} resource(s).`);
      } else {
        toast.warning("Applied with errors", `${errors} of ${res.results.length} resource(s) failed.`);
      }
      onApplied();
    } catch (err) {
      toastError("Apply failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title="Apply manifest"
      busy={busy}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close} disabled={busy}>
            Close
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!yaml.trim() || busy} onClick={submit}>
            Apply
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          Paste one or more YAML documents (separated by <span className="mono">---</span>). Each is server-side applied
          (field manager <span className="mono">castor</span>); per-document outcomes are shown below.
        </div>
        <textarea
          className="textarea input-mono"
          spellCheck={false}
          wrap="off"
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          placeholder={"apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: default\nspec:\n  replicas: 2\n  ..."}
          style={{ minHeight: 300, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre", tabSize: 2 }}
          aria-label="Manifest YAML"
        />

        {results ? <ApplyResults results={results} /> : null}
      </div>
    </Modal>
  );
}

function actionColor(action: K8sApplyResult["action"]): string {
  switch (action) {
    case "created":
      return "var(--success)";
    case "configured":
      return "var(--accent)";
    case "unchanged":
      return "var(--text-secondary)";
    case "error":
      return "var(--danger)";
    default:
      return "var(--text-secondary)";
  }
}

function ApplyResults({ results }: { results: K8sApplyResult[] }) {
  if (results.length === 0) {
    return <div className="text-sm muted">No documents found in the manifest.</div>;
  }
  return (
    <div className="col" style={{ gap: "var(--sp-2)" }}>
      <span className="field-label" style={{ margin: 0 }}>
        Results ({results.length})
      </span>
      <table className="dt">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Name</th>
            <th>Namespace</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={`${r.kind}/${r.namespace}/${r.name}/${i}`}>
              <td className="mono text-sm">{r.kind || "—"}</td>
              <td className="mono text-sm">{r.name || "—"}</td>
              <td className="mono text-xs muted">{r.namespace || "—"}</td>
              <td>
                <span className="pill" style={{ color: actionColor(r.action), background: "transparent", borderColor: "var(--border-strong)" }}>
                  {r.action}
                </span>
                {r.action === "error" && r.error ? (
                  <div className="text-xs" style={{ color: "var(--danger)", marginTop: 2 }} title={r.error}>
                    {r.error}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
