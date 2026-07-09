// ui/src/views/K8sWorkloads.tsx
//
// Kubernetes (read + gated writes): pods, deployments, statefulsets, daemonsets,
// jobs, cronjobs and nodes with a namespace selector. Deployments/StatefulSets
// can be scaled, rollout-restarted and deleted; DaemonSets restarted/deleted;
// Jobs deleted; CronJobs triggered, suspended/resumed and deleted; pods can be
// deleted; an "Apply YAML" action server-side-applies a (multi-document)
// manifest and reports a per-resource result. Affordances are greyed-out before
// click via CapabilityGate (provider capability + RBAC permission); the backend
// re-checks. Pod rows remain click-through to the detail view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  useK8sPods,
  useK8sDeployments,
  useK8sStatefulSets,
  useK8sDaemonSets,
  useK8sJobs,
  useK8sCronJobs,
  useK8sNodes,
  useK8sPodMetrics,
  useCapabilityLookup,
} from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { gateK8s, gateK8sController, gateExec, gateLogs } from "../lib/rbac";
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
import { IconKube, IconRefresh, IconPlus, IconTrash, IconRestart, IconScale, IconEdit, IconHelp, IconCopy, IconCheck, IconTerminal, IconLogs, IconPlay, IconPause } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { useT } from "../i18n";
import { k8sWorkloadsDict } from "../i18n/locales/k8sWorkloads";
import { cleanName, timeAgo, formatBytes } from "../lib/format";
import {
  podQosClass,
  type K8sApplyResult,
  type K8sContainerResources,
  type K8sCronJob,
  type K8sDaemonSet,
  type K8sDeployment,
  type K8sJob,
  type K8sNode,
  type K8sStatefulSet,
  type PodMetric,
  type Workload,
} from "../lib/types";

type Section = "pods" | "deployments" | "statefulsets" | "daemonsets" | "jobs" | "cronjobs" | "nodes";

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

// Derived Job phase from the status counters (the summary carries no conditions).
type K8sJobStatus = "Active" | "Succeeded" | "Failed" | "Pending";

function jobStatus(j: K8sJob): K8sJobStatus {
  if (j.active > 0) return "Active";
  if (j.succeeded >= Math.max(j.completions, 1)) return "Succeeded";
  if (j.failed > 0) return "Failed";
  return "Pending";
}

function jobStatusColor(s: K8sJobStatus): string {
  switch (s) {
    case "Succeeded":
      return "var(--success)";
    case "Failed":
      return "var(--danger)";
    case "Active":
      return "var(--accent)";
    default:
      return "var(--text-secondary)";
  }
}

// Compact run duration ("42s", "3m 12s", "2h 5m"): start -> completion, or
// start -> now while still running; "—" before the controller stamps a start.
function jobDuration(j: K8sJob): string {
  if (!j.startedAt) return "—";
  const start = new Date(j.startedAt).getTime();
  const end = j.completedAt ? new Date(j.completedAt).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Small copy-able shell command used in the guided empty state.
function InlineCommand({ command }: { command: string }) {
  const t = useT(k8sWorkloadsDict);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success(t("toast.copied"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("toast.copied"), command);
    }
  };
  return (
    <div className="help-cmd">
      <code className="help-cmd-text">{command}</code>
      <button type="button" className="btn btn-ghost btn-sm btn-icon help-cmd-copy" onClick={copy} aria-label={t("cmd.copy")} title={t("cmd.copy")}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

export function K8sWorkloads() {
  const t = useT(k8sWorkloadsDict);
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
  const stsQ = useK8sStatefulSets(hostId, namespace, section === "statefulsets");
  const dsQ = useK8sDaemonSets(hostId, namespace, section === "daemonsets");
  const jobsQ = useK8sJobs(hostId, namespace, section === "jobs");
  const cronsQ = useK8sCronJobs(hostId, namespace, section === "cronjobs");
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
  // Controller-kind writes carry per-kind, per-verb permissions; every delete
  // shares the admin-grade k8s.workload.delete (deleteGate above).
  const stsScaleGate = gateK8sController("stsScale", caps, permissions);
  const stsRestartGate = gateK8sController("stsRestart", caps, permissions);
  const dsRestartGate = gateK8sController("dsRestart", caps, permissions);
  const cronTriggerGate = gateK8sController("cronTrigger", caps, permissions);
  const cronSuspendGate = gateK8sController("cronSuspend", caps, permissions);
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
  const [stsScaleTarget, setStsScaleTarget] = useState<K8sStatefulSet | null>(null);
  const [stsRestartTarget, setStsRestartTarget] = useState<K8sStatefulSet | null>(null);
  const [stsDeleteTarget, setStsDeleteTarget] = useState<K8sStatefulSet | null>(null);
  const [dsRestartTarget, setDsRestartTarget] = useState<K8sDaemonSet | null>(null);
  const [dsDeleteTarget, setDsDeleteTarget] = useState<K8sDaemonSet | null>(null);
  const [jobDeleteTarget, setJobDeleteTarget] = useState<K8sJob | null>(null);
  const [cronDeleteTarget, setCronDeleteTarget] = useState<K8sCronJob | null>(null);

  // Namespace options. The section queries are themselves filtered by the
  // selected namespace, so deriving options from the current responses alone
  // would collapse the list to that namespace after the first selection.
  // Instead, accumulate the union of every namespace seen in any response for
  // as long as the view stays mounted; "All namespaces" is always offered.
  const [namespaces, setNamespaces] = useState<string[]>([]);
  useEffect(() => {
    const seen = new Set<string>();
    for (const p of podsQ.data ?? []) {
      const ns = p.id.includes("/") ? p.id.split("/")[0]! : "";
      if (ns) seen.add(ns);
    }
    for (const d of deploysQ.data ?? []) if (d.namespace) seen.add(d.namespace);
    for (const v of stsQ.data ?? []) if (v.namespace) seen.add(v.namespace);
    for (const v of dsQ.data ?? []) if (v.namespace) seen.add(v.namespace);
    for (const v of jobsQ.data ?? []) if (v.namespace) seen.add(v.namespace);
    for (const v of cronsQ.data ?? []) if (v.namespace) seen.add(v.namespace);
    setNamespaces((prev) => {
      const merged = new Set(prev);
      for (const ns of seen) merged.add(ns);
      // Keep the previous array identity when nothing new appeared so React
      // can bail out of the state update.
      return merged.size === prev.length ? prev : Array.from(merged).sort();
    });
  }, [podsQ.data, deploysQ.data, stsQ.data, dsQ.data, jobsQ.data, cronsQ.data]);

  const refetch = () => {
    if (section === "pods") podsQ.refetch();
    else if (section === "deployments") deploysQ.refetch();
    else if (section === "statefulsets") stsQ.refetch();
    else if (section === "daemonsets") dsQ.refetch();
    else if (section === "jobs") jobsQ.refetch();
    else if (section === "cronjobs") cronsQ.refetch();
    else nodesQ.refetch();
  };

  const invalidatePods = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "pods", hostId], exact: false });
  const invalidateDeploys = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "deployments", hostId], exact: false });
  const invalidateSts = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "statefulsets", hostId], exact: false });
  const invalidateDs = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "daemonsets", hostId], exact: false });
  const invalidateJobs = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "jobs", hostId], exact: false });
  const invalidateCrons = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "cronjobs", hostId], exact: false });

  // CronJob trigger + suspend/resume run directly off the row button (no
  // confirm): trigger is constructive (creates a Job) and suspend is a
  // reversible toggle.
  const doTriggerCron = async (c: K8sCronJob) => {
    try {
      const res = await api.k8sTriggerCronJob(hostId, c.namespace, c.name);
      toast.success(t("toast.cronTriggered"), t("toast.cronTriggeredBody", { job: res.job }));
      invalidateJobs();
      invalidateCrons();
    } catch (err) {
      toastError(t("toast.triggerFailed"), err);
    }
  };

  const doSuspendCron = async (c: K8sCronJob) => {
    try {
      await api.k8sSuspendCronJob(hostId, c.namespace, c.name, { suspend: !c.suspend });
      toast.success(c.suspend ? t("toast.cronResumed") : t("toast.cronSuspended"), `${c.namespace}/${c.name}`);
      invalidateCrons();
    } catch (err) {
      toastError(c.suspend ? t("toast.resumeFailed") : t("toast.suspendFailed"), err);
    }
  };

  const podCols: Column<Workload>[] = [
    {
      key: "name",
      header: t("col.pod"),
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
    { key: "state", header: t("col.state"), sortValue: (p) => p.state, cell: (p) => <StateBadge state={p.state} raw={p.stateRaw} /> },
    {
      key: "qos",
      header: t("col.qos"),
      sortValue: (p) => podQosClass(p.labels) ?? "",
      cell: (p) => {
        const qos = podQosClass(p.labels);
        return qos ? <QosBadge qos={qos} subtle /> : <span className="muted">—</span>;
      },
    },
    { key: "node", header: t("col.node"), sortValue: (p) => p.node ?? "", cell: (p) => <span className="text-sm secondary">{p.node || "—"}</span> },
    {
      key: "cpu",
      header: t("col.cpu"),
      sortValue: (p) => podMetrics.get(p.id)?.cpuMilli ?? -1,
      cell: (p) => {
        const m = podMetrics.get(p.id);
        if (!m) return <span className="muted">—</span>;
        return <span className="mono text-xs">{milliToCores(m.cpuMilli)} <span className="muted">{t("unit.cores")}</span></span>;
      },
    },
    {
      key: "mem",
      header: t("col.memory"),
      sortValue: (p) => podMetrics.get(p.id)?.memoryBytes ?? -1,
      cell: (p) => {
        const m = podMetrics.get(p.id);
        if (!m) return <span className="muted">—</span>;
        return <span className="mono text-xs">{formatBytes(m.memoryBytes)}</span>;
      },
    },
    { key: "image", header: t("col.image"), sortValue: (p) => p.image, cell: (p) => <span className="mono text-xs truncate" style={{ maxWidth: 200, display: "inline-block" }} title={p.image}>{p.image}</span> },
    { key: "group", header: t("col.owner"), sortValue: (p) => p.group ?? "", cell: (p) => (p.group ? <span className="chip">{p.group}</span> : <span className="muted">—</span>) },
    { key: "created", header: t("col.created"), sortValue: (p) => p.createdAt, cell: (p) => <span className="text-xs muted nowrap">{timeAgo(p.createdAt)}</span> },
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
                  tooltip={allowed ? t("action.logs") : reason}
                  aria-label={t("action.podLogs")}
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
                  tooltip={!running ? t("action.podNotRunning") : allowed ? t("action.terminal") : reason}
                  aria-label={t("action.podTerminal")}
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
                  tooltip={allowed ? t("action.deletePod") : reason}
                  aria-label={t("action.deletePod")}
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
    { key: "name", header: t("col.deployment"), sortValue: (d) => d.name, cell: (d) => <span style={{ fontWeight: 600 }}>{d.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (d) => d.namespace, cell: (d) => <span className="chip">{d.namespace}</span> },
    {
      key: "ready",
      header: t("col.ready"),
      sortValue: (d) => d.ready,
      cell: (d) => (
        <span className="mono" style={{ color: d.ready >= d.replicas ? "var(--success)" : "var(--warning)" }}>
          {d.ready}/{d.replicas}
        </span>
      ),
    },
    { key: "available", header: t("col.available"), sortValue: (d) => d.available, cell: (d) => <span className="mono">{d.available}</span> },
    {
      key: "qos",
      header: t("col.qos"),
      sortValue: (d) => d.qosClass,
      cell: (d) => (d.qosClass ? <QosBadge qos={d.qosClass} subtle /> : <span className="muted">—</span>),
    },
    { key: "image", header: t("col.image"), sortValue: (d) => d.image, cell: (d) => <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={d.image}>{d.image}</span> },
    { key: "created", header: t("col.created"), sortValue: (d) => d.createdAt, cell: (d) => <span className="text-xs muted nowrap">{timeAgo(d.createdAt)}</span> },
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
                tooltip={allowed ? t("action.scale") : reason}
                aria-label={t("action.scaleDeployment")}
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
                tooltip={allowed ? t("action.resources") : reason}
                aria-label={t("action.editResources")}
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
                tooltip={allowed ? t("action.rolloutRestart") : reason}
                aria-label={t("action.restartDeployment")}
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
                tooltip={allowed ? t("action.delete") : reason}
                aria-label={t("action.deleteDeployment")}
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

  const stsCols: Column<K8sStatefulSet>[] = [
    { key: "name", header: t("col.statefulset"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    {
      key: "ready",
      header: t("col.ready"),
      sortValue: (v) => v.ready,
      cell: (v) => (
        <span className="mono" style={{ color: v.ready >= v.replicas ? "var(--success)" : "var(--warning)" }}>
          {v.ready}/{v.replicas}
        </span>
      ),
    },
    { key: "image", header: t("col.image"), sortValue: (v) => v.image, cell: (v) => <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={v.image}>{v.image}</span> },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "124px",
      cell: (v) => (
        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
          <CapabilityGate gate={stsScaleGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.scale") : reason}
                aria-label={t("action.scaleStatefulset")}
                onClick={() => setStsScaleTarget(v)}
              >
                <IconScale size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={stsRestartGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.rolloutRestart") : reason}
                aria-label={t("action.restartStatefulset")}
                onClick={() => setStsRestartTarget(v)}
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
                tooltip={allowed ? t("action.delete") : reason}
                aria-label={t("action.deleteStatefulset")}
                onClick={() => setStsDeleteTarget(v)}
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

  const dsCols: Column<K8sDaemonSet>[] = [
    { key: "name", header: t("col.daemonset"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "desired", header: t("col.desired"), sortValue: (v) => v.desired, cell: (v) => <span className="mono">{v.desired}</span> },
    {
      key: "ready",
      header: t("col.ready"),
      sortValue: (v) => v.ready,
      cell: (v) => (
        <span className="mono" style={{ color: v.ready >= v.desired ? "var(--success)" : "var(--warning)" }}>
          {v.ready}
        </span>
      ),
    },
    { key: "available", header: t("col.available"), sortValue: (v) => v.available, cell: (v) => <span className="mono">{v.available}</span> },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "84px",
      cell: (v) => (
        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
          <CapabilityGate gate={dsRestartGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.rolloutRestart") : reason}
                aria-label={t("action.restartDaemonset")}
                onClick={() => setDsRestartTarget(v)}
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
                tooltip={allowed ? t("action.delete") : reason}
                aria-label={t("action.deleteDaemonset")}
                onClick={() => setDsDeleteTarget(v)}
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

  const jobCols: Column<K8sJob>[] = [
    { key: "name", header: t("col.job"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    {
      key: "status",
      header: t("col.status"),
      sortValue: (v) => jobStatus(v),
      cell: (v) => {
        const s = jobStatus(v);
        return (
          <span className="pill" style={{ color: jobStatusColor(s), background: "transparent", borderColor: "var(--border-strong)" }}>
            {s}
          </span>
        );
      },
    },
    { key: "duration", header: t("col.duration"), sortValue: (v) => v.startedAt ?? "", cell: (v) => <span className="mono text-xs">{jobDuration(v)}</span> },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "44px",
      cell: (v) => (
        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
          <CapabilityGate gate={deleteGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.delete") : reason}
                aria-label={t("action.deleteJob")}
                onClick={() => setJobDeleteTarget(v)}
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

  const cronCols: Column<K8sCronJob>[] = [
    { key: "name", header: t("col.cronjob"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "schedule", header: t("col.schedule"), sortValue: (v) => v.schedule, cell: (v) => <span className="mono text-xs">{v.schedule}</span> },
    {
      key: "suspend",
      header: t("col.state"),
      sortValue: (v) => (v.suspend ? 1 : 0),
      cell: (v) => (
        <span className="pill" style={{ color: v.suspend ? "var(--warning)" : "var(--success)", background: "transparent", borderColor: "var(--border-strong)" }}>
          {v.suspend ? t("cron.suspended") : t("cron.active")}
        </span>
      ),
    },
    {
      key: "lastRun",
      header: t("col.lastRun"),
      sortValue: (v) => v.lastScheduleAt ?? "",
      cell: (v) => <span className="text-xs muted nowrap">{v.lastScheduleAt ? timeAgo(v.lastScheduleAt) : "—"}</span>,
    },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "124px",
      cell: (v) => (
        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
          <CapabilityGate gate={cronTriggerGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.runNow") : reason}
                aria-label={t("action.runCronjobNow")}
                onClick={() => doTriggerCron(v)}
              >
                <IconPlay size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={cronSuspendGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? (v.suspend ? t("action.resume") : t("action.suspend")) : reason}
                aria-label={v.suspend ? t("action.resumeCronjob") : t("action.suspendCronjob")}
                onClick={() => doSuspendCron(v)}
              >
                {v.suspend ? <IconPlay size={15} /> : <IconPause size={15} />}
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
                tooltip={allowed ? t("action.delete") : reason}
                aria-label={t("action.deleteCronjob")}
                onClick={() => setCronDeleteTarget(v)}
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
    { key: "name", header: t("col.nodeName"), sortValue: (n) => n.name, cell: (n) => <span style={{ fontWeight: 600 }}>{n.name}</span> },
    {
      key: "status",
      header: t("col.status"),
      sortValue: (n) => n.status,
      cell: (n) => (
        <span className="pill" style={{ color: n.status === "Ready" ? "var(--success)" : "var(--warning)", background: "transparent", borderColor: "var(--border-strong)" }}>
          {n.status}
        </span>
      ),
    },
    { key: "roles", header: t("col.roles"), cell: (n) => <span className="row-wrap" style={{ gap: 4 }}>{n.roles.length ? n.roles.map((r) => <span key={r} className="chip text-xs">{r}</span>) : <span className="muted">—</span>}</span> },
    { key: "version", header: t("col.version"), sortValue: (n) => n.version, cell: (n) => <span className="mono text-xs">{n.version}</span> },
    { key: "ip", header: t("col.internalIp"), cell: (n) => <span className="mono text-xs muted">{n.internalIP || "—"}</span> },
  ];

  const loading =
    (section === "pods" && podsQ.isLoading) ||
    (section === "deployments" && deploysQ.isLoading) ||
    (section === "statefulsets" && stsQ.isLoading) ||
    (section === "daemonsets" && dsQ.isLoading) ||
    (section === "jobs" && jobsQ.isLoading) ||
    (section === "cronjobs" && cronsQ.isLoading) ||
    (section === "nodes" && nodesQ.isLoading);

  // --- deployment write handlers ---
  const doRestart = async () => {
    if (!restartTarget) return;
    try {
      await api.k8sRestartDeployment(hostId, restartTarget.namespace, restartTarget.name);
      toast.success(t("toast.rolloutRestarted"), `${restartTarget.namespace}/${restartTarget.name}`);
      invalidateDeploys();
    } catch (err) {
      toastError(t("toast.restartFailed"), err);
      throw err;
    }
  };

  const doDeleteDeploy = async () => {
    if (!deployDeleteTarget) return;
    try {
      await api.k8sDeleteDeployment(hostId, deployDeleteTarget.namespace, deployDeleteTarget.name);
      toast.success(t("toast.deployDeleted"), `${deployDeleteTarget.namespace}/${deployDeleteTarget.name}`);
      invalidateDeploys();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doDeletePod = async () => {
    if (!podDeleteTarget) return;
    const { ns, name } = splitPodId(podDeleteTarget.id);
    try {
      await api.k8sDeletePod(hostId, ns, name);
      toast.success(t("toast.podDeleted"), `${ns}/${name}`);
      invalidatePods();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  // --- statefulset / daemonset / job / cronjob write handlers ---
  const doRestartSts = async () => {
    if (!stsRestartTarget) return;
    try {
      await api.k8sRestartStatefulSet(hostId, stsRestartTarget.namespace, stsRestartTarget.name);
      toast.success(t("toast.rolloutRestarted"), `${stsRestartTarget.namespace}/${stsRestartTarget.name}`);
      invalidateSts();
    } catch (err) {
      toastError(t("toast.restartFailed"), err);
      throw err;
    }
  };

  const doDeleteSts = async () => {
    if (!stsDeleteTarget) return;
    try {
      await api.k8sDeleteStatefulSet(hostId, stsDeleteTarget.namespace, stsDeleteTarget.name);
      toast.success(t("toast.stsDeleted"), `${stsDeleteTarget.namespace}/${stsDeleteTarget.name}`);
      invalidateSts();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doRestartDs = async () => {
    if (!dsRestartTarget) return;
    try {
      await api.k8sRestartDaemonSet(hostId, dsRestartTarget.namespace, dsRestartTarget.name);
      toast.success(t("toast.rolloutRestarted"), `${dsRestartTarget.namespace}/${dsRestartTarget.name}`);
      invalidateDs();
    } catch (err) {
      toastError(t("toast.restartFailed"), err);
      throw err;
    }
  };

  const doDeleteDs = async () => {
    if (!dsDeleteTarget) return;
    try {
      await api.k8sDeleteDaemonSet(hostId, dsDeleteTarget.namespace, dsDeleteTarget.name);
      toast.success(t("toast.dsDeleted"), `${dsDeleteTarget.namespace}/${dsDeleteTarget.name}`);
      invalidateDs();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doDeleteJob = async () => {
    if (!jobDeleteTarget) return;
    try {
      await api.k8sDeleteJob(hostId, jobDeleteTarget.namespace, jobDeleteTarget.name);
      toast.success(t("toast.jobDeleted"), `${jobDeleteTarget.namespace}/${jobDeleteTarget.name}`);
      invalidateJobs();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doDeleteCron = async () => {
    if (!cronDeleteTarget) return;
    try {
      await api.k8sDeleteCronJob(hostId, cronDeleteTarget.namespace, cronDeleteTarget.name);
      toast.success(t("toast.cronDeleted"), `${cronDeleteTarget.namespace}/${cronDeleteTarget.name}`);
      invalidateCrons();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
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
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            {section !== "nodes" ? (
              <select className="select" style={{ width: 200 }} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
                <option value="">{t("header.allNamespaces")}</option>
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
                  {t("header.applyYaml")}
                </ActionButton>
              )}
            </CapabilityGate>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.setupGuide")} aria-label={t("header.setupGuide")} onClick={() => setHelpOpen(true)}>
              <IconHelp size={16} />
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${section === "pods" ? " active" : ""}`} onClick={() => setSection("pods")}>
          {t("tab.pods")}
        </button>
        <button className={`tab${section === "deployments" ? " active" : ""}`} onClick={() => setSection("deployments")}>
          {t("tab.deployments")}
        </button>
        <button className={`tab${section === "statefulsets" ? " active" : ""}`} onClick={() => setSection("statefulsets")}>
          {t("tab.statefulsets")}
        </button>
        <button className={`tab${section === "daemonsets" ? " active" : ""}`} onClick={() => setSection("daemonsets")}>
          {t("tab.daemonsets")}
        </button>
        <button className={`tab${section === "jobs" ? " active" : ""}`} onClick={() => setSection("jobs")}>
          {t("tab.jobs")}
        </button>
        <button className={`tab${section === "cronjobs" ? " active" : ""}`} onClick={() => setSection("cronjobs")}>
          {t("tab.cronjobs")}
        </button>
        <button className={`tab${section === "nodes" ? " active" : ""}`} onClick={() => setSection("nodes")}>
          {t("tab.nodes")}
        </button>
      </div>

      {loading ? (
        <LoadingFill label={t("list.loading")} />
      ) : section === "pods" ? (
        (podsQ.isError || (podsQ.data ?? []).length === 0) && !namespace ? (
          <div className="card">
            <EmptyState
              icon={<IconKube size={40} />}
              title={t("empty.clusterTitle")}
              message={t("empty.clusterMessage")}
              action={
                <div className="help-guide">
                  <ActionButton variant="primary" onClick={() => setHelpOpen(true)}>
                    <IconHelp size={15} />
                    {t("empty.showSetupGuide")}
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
                {t("empty.metricsHint")} <span className="mono">metrics-server</span> {t("empty.metricsHintTail")}
              </div>
            ) : null}
            <DataTable
              columns={podCols}
              rows={podsQ.data ?? []}
              rowKey={(p) => p.id}
              defaultSortKey="name"
              onRowClick={(p) => navigate(`/workloads/${encodeURIComponent(hostId)}/${encodeURIComponent(p.id)}`)}
              emptyIcon={<IconKube size={40} />}
              emptyTitle={t("empty.noPods")}
              emptyMessage={t("empty.noPodsMessage")}
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
          emptyTitle={t("empty.noDeployments")}
        />
      ) : section === "statefulsets" ? (
        <DataTable
          columns={stsCols}
          rows={stsQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.noStatefulsets")}
        />
      ) : section === "daemonsets" ? (
        <DataTable
          columns={dsCols}
          rows={dsQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.noDaemonsets")}
        />
      ) : section === "jobs" ? (
        <DataTable
          columns={jobCols}
          rows={jobsQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.noJobs")}
        />
      ) : section === "cronjobs" ? (
        <DataTable
          columns={cronCols}
          rows={cronsQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.noCronjobs")}
        />
      ) : (
        <DataTable
          columns={nodeCols}
          rows={nodesQ.data ?? []}
          rowKey={(n) => n.name}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.noNodes")}
        />
      )}

      {/* ---- Setup guide ---- */}
      <HelpPanel topic="kubernetes" open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ---- Apply YAML ---- */}
      <ApplyManifestModal open={applyOpen} hostId={hostId} onClose={() => setApplyOpen(false)} onApplied={() => {
        invalidatePods();
        invalidateDeploys();
        invalidateSts();
        invalidateDs();
        invalidateJobs();
        invalidateCrons();
      }} />

      {/* ---- Scale deployment ---- */}
      <ScaleWorkloadModal
        noun="Deployment"
        target={scaleTarget}
        scale={(ns, name, replicas) => api.k8sScaleDeployment(hostId, ns, name, { replicas })}
        onClose={() => setScaleTarget(null)}
        onDone={() => {
          setScaleTarget(null);
          invalidateDeploys();
        }}
      />

      {/* ---- Scale statefulset ---- */}
      <ScaleWorkloadModal
        noun="StatefulSet"
        target={stsScaleTarget}
        scale={(ns, name, replicas) => api.k8sScaleStatefulSet(hostId, ns, name, { replicas })}
        onClose={() => setStsScaleTarget(null)}
        onDone={() => {
          setStsScaleTarget(null);
          invalidateSts();
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
        title={t("dialog.restartTitle")}
        variant="primary"
        confirmLabel={t("dialog.restartConfirm")}
        description={
          <>
            {t("dialog.restartDeployBody1")}{" "}
            <strong className="mono">
              {restartTarget?.namespace}/{restartTarget?.name}
            </strong>
            {t("dialog.restartDeployBody2")}
          </>
        }
        onConfirm={doRestart}
        onClose={() => setRestartTarget(null)}
      />

      {/* ---- Delete deployment (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!deployDeleteTarget}
        title={t("dialog.deleteDeployTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteDeployBody1")}{" "}
            <strong className="mono">
              {deployDeleteTarget?.namespace}/{deployDeleteTarget?.name}
            </strong>
            {t("dialog.deleteDeployBody2")}
          </>
        }
        onConfirm={doDeleteDeploy}
        onClose={() => setDeployDeleteTarget(null)}
      />

      {/* ---- Delete pod (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!podDeleteTarget}
        title={t("dialog.deletePodTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deletePodBody1")} <strong className="mono">{podDeleteTarget ? cleanName(podDeleteTarget.name) : ""}</strong>
            {t("dialog.deletePodBody2")}
          </>
        }
        onConfirm={doDeletePod}
        onClose={() => setPodDeleteTarget(null)}
      />

      {/* ---- Restart statefulset (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!stsRestartTarget}
        title={t("dialog.restartTitle")}
        variant="primary"
        confirmLabel={t("dialog.restartConfirm")}
        description={
          <>
            {t("dialog.restartDeployBody1")}{" "}
            <strong className="mono">
              {stsRestartTarget?.namespace}/{stsRestartTarget?.name}
            </strong>
            {t("dialog.restartStsBody2")}
          </>
        }
        onConfirm={doRestartSts}
        onClose={() => setStsRestartTarget(null)}
      />

      {/* ---- Delete statefulset (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!stsDeleteTarget}
        title={t("dialog.deleteStsTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteDeployBody1")}{" "}
            <strong className="mono">
              {stsDeleteTarget?.namespace}/{stsDeleteTarget?.name}
            </strong>
            {t("dialog.deleteStsBody2")}
          </>
        }
        onConfirm={doDeleteSts}
        onClose={() => setStsDeleteTarget(null)}
      />

      {/* ---- Restart daemonset (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!dsRestartTarget}
        title={t("dialog.restartTitle")}
        variant="primary"
        confirmLabel={t("dialog.restartConfirm")}
        description={
          <>
            {t("dialog.restartDeployBody1")}{" "}
            <strong className="mono">
              {dsRestartTarget?.namespace}/{dsRestartTarget?.name}
            </strong>
            {t("dialog.restartDsBody2")}
          </>
        }
        onConfirm={doRestartDs}
        onClose={() => setDsRestartTarget(null)}
      />

      {/* ---- Delete daemonset (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!dsDeleteTarget}
        title={t("dialog.deleteDsTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteDeployBody1")}{" "}
            <strong className="mono">
              {dsDeleteTarget?.namespace}/{dsDeleteTarget?.name}
            </strong>
            {t("dialog.deleteDsBody2")}
          </>
        }
        onConfirm={doDeleteDs}
        onClose={() => setDsDeleteTarget(null)}
      />

      {/* ---- Delete job (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!jobDeleteTarget}
        title={t("dialog.deleteJobTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteDeployBody1")}{" "}
            <strong className="mono">
              {jobDeleteTarget?.namespace}/{jobDeleteTarget?.name}
            </strong>
            {t("dialog.deleteJobBody2")}
          </>
        }
        onConfirm={doDeleteJob}
        onClose={() => setJobDeleteTarget(null)}
      />

      {/* ---- Delete cronjob (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!cronDeleteTarget}
        title={t("dialog.deleteCronTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteDeployBody1")}{" "}
            <strong className="mono">
              {cronDeleteTarget?.namespace}/{cronDeleteTarget?.name}
            </strong>
            {t("dialog.deleteCronBody2")}
          </>
        }
        onConfirm={doDeleteCron}
        onClose={() => setCronDeleteTarget(null)}
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
  const t = useT(k8sWorkloadsDict);
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
          <span>{t("term.title")}</span>
          <span className="text-xs muted mono">{ns}/{name}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {t("term.close")}
        </button>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="row-wrap" style={{ gap: "var(--sp-2)", alignItems: "flex-end" }}>
          <div className="field" style={{ width: 150 }}>
            <label className="field-label" htmlFor="pod-term-shell">{t("term.shell")}</label>
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
            <label className="field-label" htmlFor="pod-term-container">{t("term.container")}</label>
            <input
              id="pod-term-container"
              className="input input-mono"
              placeholder={t("term.containerPlaceholder")}
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              disabled={started}
              aria-label={t("term.containerAria")}
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
              {t("term.openSession")}
            </ActionButton>
          ) : (
            <ActionButton variant="ghost" onClick={() => setSessionKey((k) => k + 1)}>
              {t("term.restartSession")}
            </ActionButton>
          )}
          <span className="spacer" />
          {exitCode !== undefined ? (
            <span className="text-xs muted">
              {exitCode === null ? t("term.lastExited") : t("term.lastExitedCode", { code: exitCode })}
            </span>
          ) : null}
        </div>
        <span className="text-xs muted">
          {t("term.hint")}
        </span>

        {started || sessionKey > 0 ? (
          term
        ) : (
          <div
            className="center-fill"
            style={{ minHeight: 320, background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}
          >
            <IconTerminal size={36} />
            <span className="text-sm muted">{t("term.placeholderTitle")}</span>
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
  const t = useT(k8sWorkloadsDict);
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
          <span>{t("logs.title")}</span>
          <span className="text-xs muted mono">{ns}/{name}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {t("logs.close")}
        </button>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="row-wrap" style={{ gap: "var(--sp-2)", alignItems: "flex-end" }}>
          <div className="field" style={{ width: 220 }}>
            <label className="field-label" htmlFor="pod-logs-container">{t("logs.container")}</label>
            <input
              id="pod-logs-container"
              className="input input-mono"
              placeholder={t("logs.containerPlaceholder")}
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              aria-label={t("logs.containerAria")}
            />
          </div>
          <span className="text-xs muted" style={{ paddingBottom: 8 }}>
            {t("logs.hint")}
          </span>
        </div>
        {error ? <div className="banner danger">{t("logs.streamError", { error })}</div> : null}
        <LogViewer
          lines={lines}
          follow={follow}
          onToggleFollow={setFollow}
          onClear={() => setLines([])}
          status={connected ? t("logs.streaming") : t("logs.connecting")}
          height={420}
        />
      </div>
    </Modal>
  );
}

/* ============================ Scale workload modal ============================ */

// Shared replica-count dialog for the scalable controller kinds (Deployment /
// StatefulSet): both expose {namespace, name, replicas}, so the caller picks the
// copy noun and supplies the kind-specific API call.
function ScaleWorkloadModal({
  noun,
  target,
  scale,
  onClose,
  onDone,
}: {
  noun: string; // "Deployment" | "StatefulSet" — used in the modal copy
  target: { namespace: string; name: string; replicas: number } | null;
  scale: (ns: string, name: string, replicas: number) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT(k8sWorkloadsDict);
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
      await scale(target.namespace, target.name, n);
      toast.success(t("toast.scaled", { noun }), t("toast.scaledBody", { namespace: target.namespace, name: target.name, count: n }));
      onDone();
    } catch (err) {
      toastError(t("toast.scaleFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      title={t("scale.title", { noun })}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("scale.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("scale.submit")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="text-sm secondary">
          {noun}{" "}
          <strong className="mono">
            {target?.namespace}/{target?.name}
          </strong>{" "}
          {t("scale.currentPrefix")} <span className="mono">{target?.replicas}</span> {t("scale.currentSuffix")}
        </div>
        <div className="field" style={{ width: 160 }}>
          <label className="field-label" htmlFor="k8s-scale-replicas">
            {t("scale.replicas")}
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
            <span className="field-error">{t("scale.wholeNumber")}</span>
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
  const t = useT(k8sWorkloadsDict);
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
      toast.success(t("toast.resourcesUpdated"), `${target.namespace}/${target.name}`);
      onDone();
    } catch (err) {
      toastError(t("toast.updateFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title={t("resources.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("resources.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={busy || containers.length === 0} onClick={submit}>
            {t("resources.apply")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("resources.intro1")}{" "}
          <strong className="mono">
            {target?.namespace}/{target?.name}
          </strong>
          {t("resources.intro2")}
        </div>

        {containers.length === 0 ? (
          <div className="text-sm muted">{t("resources.noContainers")}</div>
        ) : (
          <>
            {containers.length > 1 ? (
              <div className="field" style={{ maxWidth: 280 }}>
                <label className="field-label" htmlFor="k8s-rsc-container">
                  {t("resources.container")}
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
                {t("resources.container")} <span className="mono">{selected?.name}</span>
              </div>
            )}

            {/* current values */}
            <div className="col" style={{ gap: 4 }}>
              <span className="field-label" style={{ margin: 0 }}>
                {t("resources.current")}
              </span>
              <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap" }}>
                <span className="text-xs muted">
                  {t("resources.requestsLabel")}{" "}
                  <span className="mono">{selected?.cpuRequest || "—"} cpu</span> /{" "}
                  <span className="mono">{selected?.memRequest || "—"}</span>
                </span>
                <span className="text-xs muted">
                  {t("resources.limitsLabel")}{" "}
                  <span className="mono">{selected?.cpuLimit || "—"} cpu</span> /{" "}
                  <span className="mono">{selected?.memLimit || "—"}</span>
                </span>
              </div>
            </div>

            <K8sResourcePairFields label={t("resources.requests")} draft={requests} onChange={setRequests} />
            <K8sResourcePairFields label={t("resources.limits")} draft={limits} onChange={setLimits} />
            <span className="text-xs muted">
              {t("resources.millicoresHint1")}{" "}
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
  const t = useT(k8sWorkloadsDict);
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
        toast.success(t("toast.manifestApplied"), t("toast.manifestAppliedBody", { count: res.results.length }));
      } else {
        toast.warning(t("toast.appliedWithErrors"), t("toast.appliedWithErrorsBody", { errors, total: res.results.length }));
      }
      onApplied();
    } catch (err) {
      toastError(t("toast.applyFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={t("apply.title")}
      busy={busy}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close} disabled={busy}>
            {t("apply.close")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!yaml.trim() || busy} onClick={submit}>
            {t("apply.apply")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("apply.intro1")} <span className="mono">---</span>{t("apply.intro2")}{" "}
          <span className="mono">castor</span>{t("apply.intro3")}
        </div>
        <textarea
          className="textarea input-mono"
          spellCheck={false}
          wrap="off"
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          placeholder={"apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: default\nspec:\n  replicas: 2\n  ..."}
          style={{ minHeight: 300, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre", tabSize: 2 }}
          aria-label={t("apply.yamlAria")}
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
  const t = useT(k8sWorkloadsDict);
  if (results.length === 0) {
    return <div className="text-sm muted">{t("apply.noDocuments")}</div>;
  }
  return (
    <div className="col" style={{ gap: "var(--sp-2)" }}>
      <span className="field-label" style={{ margin: 0 }}>
        {t("apply.results", { count: results.length })}
      </span>
      <table className="dt">
        <thead>
          <tr>
            <th>{t("apply.colKind")}</th>
            <th>{t("apply.colName")}</th>
            <th>{t("apply.colNamespace")}</th>
            <th>{t("apply.colAction")}</th>
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
