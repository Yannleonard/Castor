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
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useWorkload, useUpdates, useCapabilityLookup, qk } from "../lib/hooks";
import { useWorkloadActions } from "./useWorkloadActions";
import { PageHeader } from "../components/PageHeader";
import { LoadingFill } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { StateBadge } from "../components/StateBadge";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ProtectedTag } from "../components/ProtectedTag";
import { WorkloadActionButtons } from "../components/WorkloadActionButtons";
import { ActionButton } from "../components/ActionButton";
import { HelpButton } from "../components/HelpButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
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
import { toast, toastError } from "../lib/toast";
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
  const queryClient = useQueryClient();
  const { permissions, can } = useAuth();
  const { capsForKind } = useCapabilityLookup();

  const hostId = decodeURIComponent(params.hostId ?? "local");
  const workloadId = decodeURIComponent(params.id ?? "");

  const query = useWorkload(hostId, workloadId);
  const detail = query.data;
  const caps = detail ? capsForKind(detail.kind) : undefined;

  const actions = useWorkloadActions(hostId);

  // Image-update status for this workload (shared cached query with the list).
  const updatesQuery = useUpdates(hostId);
  const [updateOpen, setUpdateOpen] = useState(false);

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

  // Only standalone Docker containers can be updated in place.
  const updateInfo =
    detail.kind === "docker"
      ? updatesQuery.data?.find((u) => u.containerId === detail.id && u.updateAvailable)
      : undefined;

  const confirmUpdate = async () => {
    try {
      await api.workloadUpdate(hostId, detail.id);
      toast.success("Updated", `${cleanName(detail.name)} recreated on the newest image`);
      queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
      queryClient.invalidateQueries({ queryKey: qk.updates(hostId) });
      // The recreate gives the container a NEW id, so this detail route is now
      // stale — return to the list instead of refetching into a 404.
      navigate("/workloads");
    } catch (err) {
      toastError("Update failed", err);
      throw err;
    }
  };

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
              onPause={actions.runPause}
              onUnpause={actions.runUnpause}
              onStop={actions.triggerStop}
              onRestart={actions.triggerRestart}
              onRemove={actions.triggerRemove}
            />
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="terminal" />
          </div>
        }
      />

      {updateInfo ? (
        <div
          className="banner info row"
          style={{ justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}
        >
          <span className="text-sm">
            A newer image is available for <strong className="mono">{updateInfo.image}</strong>.
          </span>
          <CapabilityGate
            allowed={can("docker.container.update") && !detail.protected}
            reason={
              detail.protected
                ? "Protected — cannot be recreated"
                : "You lack the docker.container.update permission"
            }
          >
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                variant="primary"
                disabled={!allowed}
                tooltip={allowed ? undefined : reason}
                onClick={() => setUpdateOpen(true)}
              >
                Update now
              </ActionButton>
            )}
          </CapabilityGate>
        </div>
      ) : null}

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

      <ConfirmDestructiveDialog
        open={updateOpen}
        title="Update container"
        variant="primary"
        confirmLabel="Update"
        description={
          <>
            Pull the newest image for <strong className="mono">{detail.image}</strong> and recreate{" "}
            <strong className="mono">{cleanName(detail.name)}</strong> with the same configuration.
            The container restarts on the new image — expect a brief downtime.
          </>
        }
        onConfirm={confirmUpdate}
        onClose={() => setUpdateOpen(false)}
      />

      {actions.dialogs}
    </div>
  );
}
