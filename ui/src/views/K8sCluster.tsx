// ui/src/views/K8sCluster.tsx
//
// Kubernetes core cluster objects (read + gated HPA/Namespace writes):
//   - HPA          : list + "Create HPA" (target Deployment, min/max, CPU%) + delete
//   - Namespaces   : list + create + delete (cluster-level — admin-gated)
//   - Services     : read-only (name, type, clusterIP, ports)
//   - ConfigMaps   : read-only (name, key NAMES)
//   - Secrets      : read-only (name, type, key NAMES — values are NEVER shown)
//   - Events       : recent (type, reason, object, message, age — warnings colored)
//
// A shared namespace selector scopes the namespaced tabs (HPA / Services /
// ConfigMaps / Secrets / Events); Namespaces is cluster-wide so the selector is
// hidden there. Write affordances are greyed-out before click via CapabilityGate
// (provider capability + RBAC k8s.hpa.write / k8s.namespace.write); the backend
// re-checks. LIGHT BI theme; HPA + event rows carry status colors.

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  useK8sHPAs,
  useK8sNamespaces,
  useK8sServices,
  useK8sConfigMaps,
  useK8sSecrets,
  useK8sEvents,
  useK8sIngresses,
  useK8sNodeMetrics,
  useK8sDeployments,
  useCapabilityLookup,
} from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { gateK8sCluster } from "../lib/rbac";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { HelpButton } from "../components/HelpButton";
import { Modal } from "../components/Modal";
import { IconKube, IconRefresh, IconPlus, IconTrash } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo, formatBytes } from "../lib/format";
import { useT } from "../i18n";
import { k8sClusterDict } from "../i18n/locales/k8sCluster";
import type {
  HPAInfo,
  NamespaceInfo,
  ServiceInfoK8s,
  ConfigMapInfo,
  SecretInfo,
  EventInfo,
  IngressInfo,
  NodeMetric,
} from "../lib/types";

type Tab = "hpa" | "namespaces" | "services" | "ingresses" | "configmaps" | "secrets" | "events";

// Namespaced tabs share the namespace selector; "namespaces" is cluster-scoped.
const NAMESPACED: Record<Tab, boolean> = {
  hpa: true,
  namespaces: false,
  services: true,
  ingresses: true,
  configmaps: true,
  secrets: true,
  events: true,
};

// Render CPU millicores as cores ("250m" -> "0.25", "1500m" -> "1.5").
function milliToCores(milli: number): string {
  if (milli <= 0) return "0";
  return (milli / 1000).toFixed(milli % 1000 === 0 ? 0 : 2);
}

// Event type -> token color. Warning is amber; anything that reads as an error
// (rare, some controllers emit it) is danger; Normal is muted.
function eventColor(type: string): string {
  if (type === "Warning") return "var(--warning)";
  if (type === "Error" || type === "Failed") return "var(--danger)";
  return "var(--text-secondary)";
}

function KeysCell({ keys }: { keys: string[] }) {
  if (!keys.length) return <span className="muted">—</span>;
  const shown = keys.slice(0, 4);
  const extra = keys.length - shown.length;
  return (
    <span className="row-wrap" style={{ gap: 4 }} title={keys.join(", ")}>
      {shown.map((k) => (
        <span key={k} className="chip text-xs mono">
          {k}
        </span>
      ))}
      {extra > 0 ? <span className="text-xs muted">+{extra}</span> : null}
    </span>
  );
}

export function K8sCluster() {
  const t = useT(k8sClusterDict);
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("kubernetes");

  const [tab, setTab] = useState<Tab>("hpa");
  const [namespace, setNamespace] = useState("");

  const hpasQ = useK8sHPAs(hostId, namespace, tab === "hpa");
  const nsQ = useK8sNamespaces(hostId, true); // also feeds the selector
  const svcQ = useK8sServices(hostId, namespace, tab === "services");
  const ingQ = useK8sIngresses(hostId, namespace, tab === "ingresses");
  const cmQ = useK8sConfigMaps(hostId, namespace, tab === "configmaps");
  const secQ = useK8sSecrets(hostId, namespace, tab === "secrets");
  const evQ = useK8sEvents(hostId, namespace, tab === "events");
  // Deployments populate the "Create HPA" target dropdown (scoped to the chosen
  // namespace, or all when none picked).
  const deploysQ = useK8sDeployments(hostId, namespace, tab === "hpa");
  // Live node usage (metrics-server) — surfaced as a summary on the HPA tab so the
  // operator sees real cluster CPU/memory next to the autoscalers. available:false
  // when metrics-server is not installed.
  const nodeMetricsQ = useK8sNodeMetrics(hostId, tab === "hpa");

  const hpaGate = gateK8sCluster("hpa", caps, permissions);
  const nsGate = gateK8sCluster("namespace", caps, permissions);
  const ingressGate = gateK8sCluster("ingress", caps, permissions);

  const [createHpaOpen, setCreateHpaOpen] = useState(false);
  const [createNsOpen, setCreateNsOpen] = useState(false);
  const [applyIngressOpen, setApplyIngressOpen] = useState(false);
  const [hpaDeleteTarget, setHpaDeleteTarget] = useState<HPAInfo | null>(null);
  const [nsDeleteTarget, setNsDeleteTarget] = useState<NamespaceInfo | null>(null);
  const [ingressDeleteTarget, setIngressDeleteTarget] = useState<IngressInfo | null>(null);

  const namespaces = useMemo(() => (nsQ.data ?? []).map((n) => n.name).sort(), [nsQ.data]);

  const refetch = () => {
    switch (tab) {
      case "hpa":
        hpasQ.refetch();
        break;
      case "namespaces":
        nsQ.refetch();
        break;
      case "services":
        svcQ.refetch();
        break;
      case "ingresses":
        ingQ.refetch();
        break;
      case "configmaps":
        cmQ.refetch();
        break;
      case "secrets":
        secQ.refetch();
        break;
      case "events":
        evQ.refetch();
        break;
    }
  };

  const invalidateHPAs = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "hpas", hostId], exact: false });
  const invalidateNamespaces = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "namespaces", hostId], exact: false });
  const invalidateIngresses = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "ingresses", hostId], exact: false });

  /* ---- columns ---- */

  const hpaCols: Column<HPAInfo>[] = [
    { key: "name", header: t("col.name"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "target", header: t("col.target"), sortValue: (v) => v.target, cell: (v) => <span className="mono text-xs">{v.target || "—"}</span> },
    {
      key: "replicas",
      header: t("col.replicas"),
      sortValue: (v) => v.currentReplicas,
      cell: (v) => (
        <span className="mono">
          {v.currentReplicas} <span className="muted">({v.minReplicas}–{v.maxReplicas})</span>
        </span>
      ),
    },
    {
      key: "cpu",
      header: t("col.cpu"),
      sortValue: (v) => v.currentCpuPercent,
      cell: (v) => {
        const over = v.targetCpuPercent > 0 && v.currentCpuPercent > v.targetCpuPercent;
        return (
          <span className="mono" style={{ color: over ? "var(--warning)" : "var(--text-primary)" }}>
            {v.currentCpuPercent >= 0 ? `${v.currentCpuPercent}%` : "—"}
            <span className="muted"> / {v.targetCpuPercent > 0 ? `${v.targetCpuPercent}%` : "—"}</span>
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "56px",
      cell: (v) => (
        <CapabilityGate gate={hpaGate}>
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? t("row.deleteHpa") : reason}
              aria-label={t("row.deleteHpa")}
              onClick={() => setHpaDeleteTarget(v)}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  const nsCols: Column<NamespaceInfo>[] = [
    { key: "name", header: t("col.name"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    {
      key: "status",
      header: t("col.status"),
      sortValue: (v) => v.status,
      cell: (v) => (
        <span
          className="pill"
          style={{
            color: v.status === "Active" ? "var(--success)" : "var(--warning)",
            background: "transparent",
            borderColor: "var(--border-strong)",
          }}
        >
          {v.status}
        </span>
      ),
    },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "56px",
      cell: (v) => (
        <CapabilityGate gate={nsGate}>
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? t("row.deleteNamespace") : reason}
              aria-label={t("row.deleteNamespace")}
              onClick={() => setNsDeleteTarget(v)}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  const svcCols: Column<ServiceInfoK8s>[] = [
    { key: "name", header: t("col.name"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "type", header: t("col.type"), sortValue: (v) => v.type, cell: (v) => <span className="pill" style={{ background: "transparent", borderColor: "var(--border-strong)" }}>{v.type}</span> },
    { key: "clusterIP", header: t("col.clusterIp"), sortValue: (v) => v.clusterIP, cell: (v) => <span className="mono text-xs">{v.clusterIP || "—"}</span> },
    {
      key: "ports",
      header: t("col.ports"),
      cell: (v) => (
        <span className="row-wrap" style={{ gap: 4 }}>
          {v.ports.length ? v.ports.map((p) => <span key={p} className="chip text-xs mono">{p}</span>) : <span className="muted">—</span>}
        </span>
      ),
    },
    { key: "externalIP", header: t("col.externalIp"), sortValue: (v) => v.externalIP, cell: (v) => <span className="mono text-xs muted">{v.externalIP || "—"}</span> },
  ];

  const ingCols: Column<IngressInfo>[] = [
    { key: "name", header: t("col.name"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "class", header: t("col.class"), sortValue: (v) => v.class, cell: (v) => (v.class ? <span className="pill" style={{ background: "transparent", borderColor: "var(--border-strong)" }}>{v.class}</span> : <span className="muted">—</span>) },
    {
      key: "hosts",
      header: t("col.hosts"),
      cell: (v) => (
        <span className="row-wrap" style={{ gap: 4 }} title={v.hosts.join(", ")}>
          {v.hosts.length ? v.hosts.map((h) => <span key={h} className="chip text-xs mono">{h}</span>) : <span className="muted">—</span>}
        </span>
      ),
    },
    {
      key: "paths",
      header: t("col.routes"),
      cell: (v) => {
        if (!v.paths.length) return <span className="muted">—</span>;
        const shown = v.paths.slice(0, 3);
        const extra = v.paths.length - shown.length;
        return (
          <span className="col" style={{ gap: 2 }} title={v.paths.join("\n")}>
            {shown.map((p, i) => (
              <span key={i} className="mono text-xs secondary truncate" style={{ maxWidth: 320, display: "inline-block" }}>
                {p}
              </span>
            ))}
            {extra > 0 ? <span className="text-xs muted">{t("cell.moreRoutes", { count: extra })}</span> : null}
          </span>
        );
      },
    },
    { key: "address", header: t("col.address"), sortValue: (v) => v.address, cell: (v) => <span className="mono text-xs muted">{v.address || "—"}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "56px",
      cell: (v) => (
        <CapabilityGate gate={ingressGate}>
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? t("row.deleteIngress") : reason}
              aria-label={t("row.deleteIngress")}
              onClick={() => setIngressDeleteTarget(v)}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  const cmCols: Column<ConfigMapInfo>[] = [
    { key: "name", header: t("col.name"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "keys", header: t("col.keys"), sortValue: (v) => v.keys.length, cell: (v) => <KeysCell keys={v.keys} /> },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
  ];

  const secCols: Column<SecretInfo>[] = [
    { key: "name", header: t("col.name"), sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: t("col.namespace"), sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "type", header: t("col.type"), sortValue: (v) => v.type, cell: (v) => <span className="mono text-xs">{v.type || "—"}</span> },
    { key: "keys", header: t("col.keys"), sortValue: (v) => v.keys.length, cell: (v) => <KeysCell keys={v.keys} /> },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
  ];

  const evCols: Column<EventInfo>[] = [
    {
      key: "type",
      header: t("col.type"),
      sortValue: (v) => v.type,
      cell: (v) => (
        <span className="pill" style={{ color: eventColor(v.type), background: "transparent", borderColor: "var(--border-strong)" }}>
          {v.type}
        </span>
      ),
    },
    { key: "reason", header: t("col.reason"), sortValue: (v) => v.reason, cell: (v) => <span className="text-sm" style={{ fontWeight: 600 }}>{v.reason || "—"}</span> },
    { key: "object", header: t("col.object"), sortValue: (v) => v.object, cell: (v) => <span className="mono text-xs">{v.object || "—"}</span> },
    {
      key: "message",
      header: t("col.message"),
      cell: (v) => (
        <span className="text-sm secondary truncate" style={{ maxWidth: 360, display: "inline-block" }} title={v.message}>
          {v.message || "—"}
        </span>
      ),
    },
    { key: "count", header: t("col.count"), align: "right", sortValue: (v) => v.count, cell: (v) => <span className="mono text-xs">{v.count > 1 ? `×${v.count}` : ""}</span> },
    { key: "age", header: t("col.age"), sortValue: (v) => v.lastSeen, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.lastSeen)}</span> },
  ];

  const loading =
    (tab === "hpa" && hpasQ.isLoading) ||
    (tab === "namespaces" && nsQ.isLoading) ||
    (tab === "services" && svcQ.isLoading) ||
    (tab === "ingresses" && ingQ.isLoading) ||
    (tab === "configmaps" && cmQ.isLoading) ||
    (tab === "secrets" && secQ.isLoading) ||
    (tab === "events" && evQ.isLoading);

  /* ---- write handlers ---- */
  const doDeleteHPA = async () => {
    if (!hpaDeleteTarget) return;
    try {
      await api.k8sDeleteHPA(hostId, hpaDeleteTarget.namespace, hpaDeleteTarget.name);
      toast.success(t("toast.hpaDeleted"), `${hpaDeleteTarget.namespace}/${hpaDeleteTarget.name}`);
      invalidateHPAs();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doDeleteNs = async () => {
    if (!nsDeleteTarget) return;
    try {
      await api.k8sDeleteNamespace(hostId, nsDeleteTarget.name);
      toast.success(t("toast.namespaceDeleted"), nsDeleteTarget.name);
      invalidateNamespaces();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doDeleteIngress = async () => {
    if (!ingressDeleteTarget) return;
    try {
      await api.k8sDeleteIngress(hostId, ingressDeleteTarget.namespace, ingressDeleteTarget.name);
      toast.success(t("toast.ingressDeleted"), `${ingressDeleteTarget.namespace}/${ingressDeleteTarget.name}`);
      invalidateIngresses();
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
            {t("header.title")}
            <OrchestratorBadge kind="kubernetes" />
          </span>
        }
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            {NAMESPACED[tab] ? (
              <select className="select" style={{ width: 200 }} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
                <option value="">{t("header.allNamespaces")}</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </select>
            ) : null}
            {tab === "hpa" ? (
              <CapabilityGate gate={hpaGate}>
                {(allowed, reason) => (
                  <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateHpaOpen(true)}>
                    <IconPlus size={15} />
                    {t("header.createHpa")}
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : tab === "namespaces" ? (
              <CapabilityGate gate={nsGate}>
                {(allowed, reason) => (
                  <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateNsOpen(true)}>
                    <IconPlus size={15} />
                    {t("header.createNamespace")}
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : tab === "ingresses" ? (
              // Ingress create/update is the manifest-apply path (there is no
              // structured ingress form); the button is gated on the same
              // ingress.write permission used for delete.
              <CapabilityGate gate={ingressGate}>
                {(allowed, reason) => (
                  <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? t("header.applyYamlTooltip") : reason} onClick={() => setApplyIngressOpen(true)}>
                    <IconPlus size={15} />
                    {t("header.applyYaml")}
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : null}
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="kubernetes" />
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${tab === "hpa" ? " active" : ""}`} onClick={() => setTab("hpa")}>
          {t("tab.hpa")}
        </button>
        <button className={`tab${tab === "namespaces" ? " active" : ""}`} onClick={() => setTab("namespaces")}>
          {t("tab.namespaces")}
        </button>
        <button className={`tab${tab === "services" ? " active" : ""}`} onClick={() => setTab("services")}>
          {t("tab.services")}
        </button>
        <button className={`tab${tab === "ingresses" ? " active" : ""}`} onClick={() => setTab("ingresses")}>
          {t("tab.ingresses")}
        </button>
        <button className={`tab${tab === "configmaps" ? " active" : ""}`} onClick={() => setTab("configmaps")}>
          {t("tab.configmaps")}
        </button>
        <button className={`tab${tab === "secrets" ? " active" : ""}`} onClick={() => setTab("secrets")}>
          {t("tab.secrets")}
        </button>
        <button className={`tab${tab === "events" ? " active" : ""}`} onClick={() => setTab("events")}>
          {t("tab.events")}
        </button>
      </div>

      {loading ? (
        <LoadingFill label={t("list.loading")} />
      ) : tab === "hpa" ? (
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <NodeMetricsSummary metrics={nodeMetricsQ.data} />
          <DataTable
            columns={hpaCols}
            rows={hpasQ.data ?? []}
            rowKey={(v) => `${v.namespace}/${v.name}`}
            defaultSortKey="name"
            emptyIcon={<IconKube size={40} />}
            emptyTitle={t("empty.hpaTitle")}
            emptyMessage={t("empty.hpaMessage")}
          />
        </div>
      ) : tab === "namespaces" ? (
        <DataTable
          columns={nsCols}
          rows={nsQ.data ?? []}
          rowKey={(v) => v.name}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.namespacesTitle")}
        />
      ) : tab === "services" ? (
        <DataTable
          columns={svcCols}
          rows={svcQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.servicesTitle")}
        />
      ) : tab === "ingresses" ? (
        <DataTable
          columns={ingCols}
          rows={ingQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.ingressesTitle")}
          emptyMessage={t("empty.ingressesMessage")}
        />
      ) : tab === "configmaps" ? (
        <DataTable
          columns={cmCols}
          rows={cmQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.configmapsTitle")}
        />
      ) : tab === "secrets" ? (
        <DataTable
          columns={secCols}
          rows={secQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.secretsTitle")}
          emptyMessage={t("empty.secretsMessage")}
        />
      ) : (
        <DataTable
          columns={evCols}
          rows={evQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.object}/${v.reason}/${v.lastSeen}`}
          defaultSortKey="age"
          emptyIcon={<IconKube size={40} />}
          emptyTitle={t("empty.eventsTitle")}
        />
      )}

      {/* ---- Create HPA ---- */}
      <CreateHPAModal
        open={createHpaOpen}
        hostId={hostId}
        namespaces={namespaces}
        deployments={(deploysQ.data ?? []).map((d) => ({ namespace: d.namespace, name: d.name }))}
        defaultNamespace={namespace}
        onClose={() => setCreateHpaOpen(false)}
        onCreated={() => {
          setCreateHpaOpen(false);
          invalidateHPAs();
        }}
      />

      {/* ---- Create namespace ---- */}
      <CreateNamespaceModal
        open={createNsOpen}
        hostId={hostId}
        existing={namespaces}
        onClose={() => setCreateNsOpen(false)}
        onCreated={() => {
          setCreateNsOpen(false);
          invalidateNamespaces();
        }}
      />

      {/* ---- Delete HPA (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!hpaDeleteTarget}
        title={t("dialog.deleteHpaTitle")}
        variant="danger"
        confirmLabel={t("dialog.confirmDelete")}
        description={
          <>
            {t("dialog.deleteHpaBefore")}{" "}
            <strong className="mono">
              {hpaDeleteTarget?.namespace}/{hpaDeleteTarget?.name}
            </strong>
            {t("dialog.deleteHpaAfter")}
          </>
        }
        onConfirm={doDeleteHPA}
        onClose={() => setHpaDeleteTarget(null)}
      />

      {/* ---- Delete namespace (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!nsDeleteTarget}
        title={t("dialog.deleteNamespaceTitle")}
        variant="danger"
        confirmLabel={t("dialog.confirmDelete")}
        description={
          <>
            {t("dialog.deleteNamespaceBefore")} <strong className="mono">{nsDeleteTarget?.name}</strong>
            {t("dialog.deleteNamespaceAfter")}
          </>
        }
        onConfirm={doDeleteNs}
        onClose={() => setNsDeleteTarget(null)}
      />

      {/* ---- Apply ingress YAML (create/update) ---- */}
      <ApplyIngressModal
        open={applyIngressOpen}
        hostId={hostId}
        defaultNamespace={namespace}
        onClose={() => setApplyIngressOpen(false)}
        onApplied={() => {
          setApplyIngressOpen(false);
          invalidateIngresses();
        }}
      />

      {/* ---- Delete ingress (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!ingressDeleteTarget}
        title={t("dialog.deleteIngressTitle")}
        variant="danger"
        confirmLabel={t("dialog.confirmDelete")}
        description={
          <>
            {t("dialog.deleteIngressBefore")}{" "}
            <strong className="mono">
              {ingressDeleteTarget?.namespace}/{ingressDeleteTarget?.name}
            </strong>
            {t("dialog.deleteIngressAfter")}
          </>
        }
        onConfirm={doDeleteIngress}
        onClose={() => setIngressDeleteTarget(null)}
      />
    </div>
  );
}

/* ============================ Node metrics summary ============================ */

// Compact live cluster-usage strip rendered above the autoscalers. When metrics-
// server is absent the API returns available:false; we show an actionable hint
// rather than an empty/zero panel.
function NodeMetricsSummary({ metrics }: { metrics: { available: boolean; items: NodeMetric[] } | undefined }) {
  const t = useT(k8sClusterDict);
  if (!metrics) return null;
  if (!metrics.available) {
    return (
      <div className="card card-pad text-sm muted" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
        <IconKube size={16} />
        {t("metrics.unavailablePrefix")} <span className="mono">metrics-server</span> {t("metrics.unavailableSuffix")}
      </div>
    );
  }
  if (metrics.items.length === 0) return null;
  const totalCpu = metrics.items.reduce((a, n) => a + n.cpuMilli, 0);
  const totalMem = metrics.items.reduce((a, n) => a + n.memoryBytes, 0);
  return (
    <div className="card card-pad row-wrap" style={{ gap: "var(--sp-5)", alignItems: "center" }}>
      <span className="text-xs muted">{t("metrics.liveUsage", { count: metrics.items.length })}</span>
      <span className="text-sm">
        {t("metrics.cpu")} <strong className="mono">{milliToCores(totalCpu)}</strong> {t("metrics.cpuUnit")}
      </span>
      <span className="text-sm">
        {t("metrics.memory")} <strong className="mono">{formatBytes(totalMem)}</strong>
      </span>
    </div>
  );
}

/* ============================ Apply ingress modal ============================ */

// Ingress create/update reuses the server-side apply path (api.k8sApply): there
// is no structured ingress form. The modal seeds a minimal networking/v1 skeleton
// scoped to the selected namespace so the operator has a starting point.
function ApplyIngressModal({
  open,
  hostId,
  defaultNamespace,
  onClose,
  onApplied,
}: {
  open: boolean;
  hostId: string;
  defaultNamespace: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const t = useT(k8sClusterDict);
  const skeleton = useMemo(
    () =>
      [
        "apiVersion: networking.k8s.io/v1",
        "kind: Ingress",
        "metadata:",
        "  name: example",
        `  namespace: ${defaultNamespace || "default"}`,
        "spec:",
        "  ingressClassName: nginx",
        "  rules:",
        "    - host: app.example.com",
        "      http:",
        "        paths:",
        "          - path: /",
        "            pathType: Prefix",
        "            backend:",
        "              service:",
        "                name: my-service",
        "                port:",
        "                  number: 80",
        "",
      ].join("\n"),
    [defaultNamespace],
  );

  const [yaml, setYaml] = useState(skeleton);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setYaml(skeleton);
      setBusy(false);
    }
  }, [open, skeleton]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (!yaml.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.k8sApply(hostId, { yaml });
      const errors = res.results.filter((r) => r.action === "error");
      if (errors.length === 0) {
        toast.success(t("toast.ingressApplied"), t("toast.ingressAppliedBody", { count: res.results.length }));
        onApplied();
      } else {
        toast.warning(t("toast.appliedWithErrors"), errors[0]?.error || t("toast.appliedWithErrorsBody", { count: errors.length }));
      }
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
      title={t("ingress.modalTitle")}
      busy={busy}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close} disabled={busy}>
            {t("ingress.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!yaml.trim() || busy} onClick={submit}>
            {t("ingress.apply")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="text-sm secondary">
          {t("ingress.introBefore")} <span className="mono">networking.k8s.io/v1</span>{" "}
          {t("ingress.introMiddle")} <span className="mono">castor</span>{t("ingress.introAfter")}
        </div>
        <textarea
          className="textarea input-mono"
          spellCheck={false}
          wrap="off"
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          style={{ minHeight: 320, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre", tabSize: 2 }}
          aria-label={t("ingress.yamlLabel")}
        />
      </div>
    </Modal>
  );
}

/* ============================ Create HPA modal ============================ */

function CreateHPAModal({
  open,
  hostId,
  namespaces,
  deployments,
  defaultNamespace,
  onClose,
  onCreated,
}: {
  open: boolean;
  hostId: string;
  namespaces: string[];
  deployments: { namespace: string; name: string }[];
  defaultNamespace: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT(k8sClusterDict);
  const [name, setName] = useState("");
  const [ns, setNs] = useState(defaultNamespace || "default");
  const [targetDeployment, setTargetDeployment] = useState("");
  const [minReplicas, setMinReplicas] = useState("1");
  const [maxReplicas, setMaxReplicas] = useState("5");
  const [cpuPercent, setCpuPercent] = useState("80");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setNs(defaultNamespace || "default");
      setTargetDeployment("");
      setMinReplicas("1");
      setMaxReplicas("5");
      setCpuPercent("80");
      setBusy(false);
    }
  }, [open, defaultNamespace]);

  // Deployments available in the chosen namespace (or all when target ns absent).
  const nsDeployments = useMemo(
    () => deployments.filter((d) => d.namespace === ns).map((d) => d.name).sort(),
    [deployments, ns],
  );

  const minN = Number(minReplicas);
  const maxN = Number(maxReplicas);
  const cpuN = Number(cpuPercent);
  const nameValid = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
  const replicasValid =
    Number.isInteger(minN) && minN >= 1 && Number.isInteger(maxN) && maxN >= minN;
  const cpuValid = Number.isInteger(cpuN) && cpuN >= 1 && cpuN <= 100;
  const targetValid = targetDeployment.trim().length > 0;
  const valid = nameValid && targetValid && replicasValid && cpuValid && !busy;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.k8sCreateHPA(hostId, ns.trim(), {
        name: name.trim(),
        targetDeployment: targetDeployment.trim(),
        minReplicas: minN,
        maxReplicas: maxN,
        cpuPercent: cpuN,
      });
      toast.success(t("toast.hpaCreated"), `${ns.trim()}/${name.trim()} → ${targetDeployment.trim()}`);
      onCreated();
    } catch (err) {
      toastError(t("toast.createFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  const nsOptions = namespaces.length ? namespaces : ["default"];

  return (
    <Modal
      open={open}
      title={t("hpa.modalTitle")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("hpa.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("hpa.create")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("hpa.intro")}
        </div>

        <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap" }}>
          <div className="field" style={{ minWidth: 200, flex: 1 }}>
            <label className="field-label" htmlFor="hpa-name">
              {t("hpa.name")}
            </label>
            <input id="hpa-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("hpa.namePlaceholder")} />
            {name !== "" && !nameValid ? <span className="field-error">{t("hpa.nameError")}</span> : null}
          </div>

          <div className="field" style={{ minWidth: 200, flex: 1 }}>
            <label className="field-label" htmlFor="hpa-ns">
              {t("hpa.namespace")}
            </label>
            <select id="hpa-ns" className="select" value={ns} onChange={(e) => setNs(e.target.value)}>
              {!nsOptions.includes(ns) ? <option value={ns}>{ns}</option> : null}
              {nsOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="hpa-target">
            {t("hpa.targetDeployment")}
          </label>
          {nsDeployments.length ? (
            <select id="hpa-target" className="select" value={targetDeployment} onChange={(e) => setTargetDeployment(e.target.value)}>
              <option value="">{t("hpa.selectDeployment")}</option>
              {nsDeployments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="hpa-target"
              className="input"
              value={targetDeployment}
              onChange={(e) => setTargetDeployment(e.target.value)}
              placeholder={t("hpa.targetPlaceholder")}
            />
          )}
          {nsDeployments.length === 0 ? (
            <span className="field-hint">{t("hpa.noDeployments")}</span>
          ) : null}
        </div>

        <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div className="field" style={{ width: 110 }}>
            <label className="field-label" htmlFor="hpa-min">
              {t("hpa.minReplicas")}
            </label>
            <input id="hpa-min" className="input" type="number" min={1} value={minReplicas} onChange={(e) => setMinReplicas(e.target.value)} />
          </div>
          <div className="field" style={{ width: 110 }}>
            <label className="field-label" htmlFor="hpa-max">
              {t("hpa.maxReplicas")}
            </label>
            <input id="hpa-max" className="input" type="number" min={1} value={maxReplicas} onChange={(e) => setMaxReplicas(e.target.value)} />
          </div>
          <div className="field" style={{ width: 130 }}>
            <label className="field-label" htmlFor="hpa-cpu">
              {t("hpa.targetCpu")}
            </label>
            <input id="hpa-cpu" className="input" type="number" min={1} max={100} value={cpuPercent} onChange={(e) => setCpuPercent(e.target.value)} />
          </div>
        </div>

        {minReplicas !== "" && maxReplicas !== "" && !replicasValid ? (
          <span className="field-error">{t("hpa.replicasError")}</span>
        ) : null}
        {cpuPercent !== "" && !cpuValid ? <span className="field-error">{t("hpa.cpuError")}</span> : null}
      </div>
    </Modal>
  );
}

/* ============================ Create namespace modal ============================ */

function CreateNamespaceModal({
  open,
  hostId,
  existing,
  onClose,
  onCreated,
}: {
  open: boolean;
  hostId: string;
  existing: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT(k8sClusterDict);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setBusy(false);
    }
  }, [open]);

  const nameValid = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
  const duplicate = existing.includes(name);
  const valid = nameValid && !duplicate && !busy;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.k8sCreateNamespace(hostId, name.trim());
      toast.success(t("toast.namespaceCreated"), name.trim());
      onCreated();
    } catch (err) {
      toastError(t("toast.createFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("ns.modalTitle")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("ns.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("ns.create")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="field">
          <label className="field-label" htmlFor="ns-name">
            {t("ns.name")}
          </label>
          <input id="ns-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ns.namePlaceholder")} />
          {name !== "" && !nameValid ? (
            <span className="field-error">{t("ns.nameError")}</span>
          ) : duplicate ? (
            <span className="field-error">{t("ns.duplicateError")}</span>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
