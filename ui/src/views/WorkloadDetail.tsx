// ui/src/views/WorkloadDetail.tsx
//
// Tabbed workload detail: Overview | Logs(WS) | Stats(WS) | Terminal(WS exec) |
// Inspect. Tab availability follows ADR-002 capability gating:
//   - Logs tab needs CapLogs + docker.container.logs.
//   - Stats tab is hidden when the provider lacks CapStats (k8s) or perm missing.
//   - Terminal tab is hidden for non-Docker / no CapExec / no exec permission.
// Header carries the lifecycle action buttons (gated identically to the list).

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useWorkload, useCapabilityLookup } from "../lib/hooks";
import { useWorkloadActions } from "./useWorkloadActions";
import { PageHeader } from "../components/PageHeader";
import { LoadingFill } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { StateBadge } from "../components/StateBadge";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ProtectedTag } from "../components/ProtectedTag";
import { WorkloadActionButtons } from "../components/WorkloadActionButtons";
import { ActionButton } from "../components/ActionButton";
import {
  IconRefresh,
  IconWorkloads,
  IconLogs,
  IconStats,
  IconTerminal,
  IconInspect,
  IconDashboard,
} from "../components/icons";
import { gateExec, gateLogs, gateStats } from "../lib/rbac";
import { cleanName, shortId } from "../lib/format";
import { OverviewTab } from "./workload/OverviewTab";
import { LogsTab } from "./workload/LogsTab";
import { StatsTab } from "./workload/StatsTab";
import { TerminalTab } from "./workload/TerminalTab";
import { InspectTab } from "./workload/InspectTab";
import { podContainerNames, type WsRefKind, type OrchestratorKind } from "../lib/types";

type TabKey = "overview" | "logs" | "stats" | "terminal" | "inspect";

function refKindFor(kind: OrchestratorKind): WsRefKind {
  switch (kind) {
    case "kubernetes":
      return "pod";
    case "swarm":
      return "task";
    default:
      return "container";
  }
}

export function WorkloadDetail() {
  const params = useParams<{ hostId: string; id: string }>();
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const { capsForKind } = useCapabilityLookup();

  const hostId = decodeURIComponent(params.hostId ?? "local");
  const workloadId = decodeURIComponent(params.id ?? "");

  const query = useWorkload(hostId, workloadId);
  const detail = query.data;
  const caps = detail ? capsForKind(detail.kind) : undefined;

  const actions = useWorkloadActions(hostId);

  const [tab, setTab] = useState<TabKey>("overview");

  const tabs = useMemo(() => {
    if (!detail) return [] as { key: TabKey; label: string; icon: JSX.Element; enabled: boolean; reason: string }[];
    const logs = gateLogs(caps, permissions);
    const stats = gateStats(caps, permissions);
    const exec = gateExec(caps, permissions);
    const list: { key: TabKey; label: string; icon: JSX.Element; enabled: boolean; reason: string }[] = [
      { key: "overview", label: "Overview", icon: <IconDashboard size={15} />, enabled: true, reason: "" },
      { key: "logs", label: "Logs", icon: <IconLogs size={15} />, enabled: logs.allowed, reason: logs.reason },
    ];
    // Stats tab hidden entirely when the provider has no CapStats (e.g. k8s).
    if (caps?.includes("stats")) {
      list.push({ key: "stats", label: "Stats", icon: <IconStats size={15} />, enabled: stats.allowed, reason: stats.reason });
    }
    // Terminal hidden entirely for non-Docker / no CapExec.
    if (caps?.includes("exec")) {
      list.push({
        key: "terminal",
        label: "Terminal",
        icon: <IconTerminal size={15} />,
        enabled: exec.allowed,
        reason: exec.reason,
      });
    }
    list.push({ key: "inspect", label: "Inspect", icon: <IconInspect size={15} />, enabled: true, reason: "" });
    return list;
  }, [detail, caps, permissions]);

  // If the selected tab becomes unavailable (e.g. nav to a k8s pod), fall back.
  useEffect(() => {
    if (tabs.length && !tabs.find((t) => t.key === tab && t.enabled)) {
      setTab("overview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map((t) => `${t.key}:${t.enabled}`).join(",")]);

  if (query.isLoading) return <LoadingFill label="Loading workload…" />;

  if (query.isError || !detail) {
    return (
      <div className="page">
        <PageHeader title="Workload" />
        <EmptyState
          icon={<IconWorkloads size={40} />}
          title="Workload not found"
          message="It may have been removed, or you may not have access."
          action={
            <ActionButton variant="ghost" onClick={() => navigate("/workloads")}>
              Back to workloads
            </ActionButton>
          }
        />
      </div>
    );
  }

  const refKind = refKindFor(detail.kind);
  // K8s pods can hold several containers; the Logs/Terminal tabs offer a picker
  // to target a specific one. Empty for Docker/Swarm (single container) and for
  // single-container pods, where the default container is used.
  const containers = refKind === "pod" ? podContainerNames(detail.raw) : [];

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="row" style={{ gap: "var(--sp-3)" }}>
            <span className="truncate" style={{ maxWidth: 520 }}>
              {cleanName(detail.name)}
            </span>
            <StateBadge state={detail.state} raw={detail.stateRaw} />
          </span>
        }
        subtitle={
          <span className="row" style={{ gap: "var(--sp-2)" }}>
            <OrchestratorBadge kind={detail.kind} readonly={caps?.includes("readonly")} />
            <span className="mono text-xs">{shortId(detail.id)}</span>
            {detail.node ? <span className="text-xs muted">· {detail.node}</span> : null}
            {detail.protected ? <ProtectedTag /> : null}
          </span>
        }
        actions={
          <div className="row">
            <WorkloadActionButtons
              workload={detail}
              caps={caps}
              permissions={permissions}
              busy={actions.busyId === detail.id}
              size="md"
              onStart={actions.runStart}
              onStop={actions.triggerStop}
              onRestart={actions.triggerRestart}
              onRemove={actions.triggerRemove}
            />
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? " active" : ""}`}
            onClick={() => t.enabled && setTab(t.key)}
            disabled={!t.enabled}
            title={t.enabled ? undefined : t.reason}
          >
            <span className="row" style={{ gap: 6 }}>
              {t.icon}
              {t.label}
            </span>
          </button>
        ))}
      </div>

      <div>
        {tab === "overview" && (
          <OverviewTab hostId={hostId} detail={detail} caps={caps} permissions={permissions} />
        )}
        {tab === "logs" && (
          <LogsTab hostId={hostId} workloadId={detail.id} refKind={refKind} containers={containers} />
        )}
        {tab === "stats" && <StatsTab hostId={hostId} workloadId={detail.id} refKind={refKind} />}
        {tab === "terminal" && (
          <TerminalTab hostId={hostId} workloadId={detail.id} refKind={refKind} containers={containers} />
        )}
        {tab === "inspect" && <InspectTab raw={detail.raw} />}
      </div>

      {actions.dialogs}
    </div>
  );
}
