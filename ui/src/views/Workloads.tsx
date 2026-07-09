// ui/src/views/Workloads.tsx
//
// Unified workload table across all orchestrators (Docker + Swarm tasks + K8s
// pods served via the workloads endpoint with kind filter). Filters: kind, state,
// group, search; row actions gated by capability + permission. Rows are
// click-through to the detail view.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useWorkloads, useUpdates, useCapabilityLookup, qk } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { useWorkloadActions } from "./useWorkloadActions";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { StateBadge } from "../components/StateBadge";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ProtectedTag } from "../components/ProtectedTag";
import { WorkloadActionButtons } from "../components/WorkloadActionButtons";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { HelpButton } from "../components/HelpButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { IconDownload, IconPlay, IconPrune, IconRefresh, IconSearch, IconStop, IconTrash, IconWorkloads } from "../components/icons";
import { gatePrune, gateWorkloadAction, type WorkloadAction } from "../lib/rbac";
import { toast, toastError } from "../lib/toast";
import { cleanName, formatBytes, shortId, timeAgo } from "../lib/format";
import { useT, t as tr } from "../i18n";
import { workloadsDict } from "../i18n/locales/workloads";
import type { OrchestratorKind, UpdateStatus, Workload, WorkloadState } from "../lib/types";

// Orchestrator kind filter options: technical `value` (sent to the API / used by
// gates, never translated) paired with the workloadsDict key for its label.
// `docker`, `swarm`, `kubernetes` labels are proper names, rendered verbatim.
const KINDS: { value: "" | OrchestratorKind; labelKey?: string; label?: string }[] = [
  { value: "", labelKey: "filter.kindAll" },
  { value: "docker", label: "Docker" },
  { value: "swarm", label: "Swarm" },
  { value: "kubernetes", label: "Kubernetes" },
];

// Stable empty reference so memo deps don't change identity every render.
const EMPTY_WORKLOADS: Workload[] = [];

// Row / selection key: unique per provider so ids that collide across
// orchestrators stay distinct. Must match the DataTable rowKey exactly.
const wKey = (w: Workload) => `${w.providerId}:${w.id}`;

// State filter options: technical `value` (workload state, never translated)
// paired with the workloadsDict key for its display label.
const STATES: { value: "" | WorkloadState; labelKey: string }[] = [
  { value: "", labelKey: "filter.stateAll" },
  { value: "running", labelKey: "filter.stateRunning" },
  { value: "stopped", labelKey: "filter.stateStopped" },
  { value: "paused", labelKey: "filter.statePaused" },
  { value: "restarting", labelKey: "filter.stateRestarting" },
  { value: "pending", labelKey: "filter.statePending" },
  { value: "unknown", labelKey: "filter.stateUnknown" },
];

export function Workloads() {
  const t = useT(workloadsDict);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hostId = useSelectedHost();
  const { permissions, can } = useAuth();
  const { capsForKind } = useCapabilityLookup();

  const [showAll, setShowAll] = useState(true);
  const [kind, setKind] = useState<"" | OrchestratorKind>("");
  const [state, setState] = useState<"" | WorkloadState>("");
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [pruneOpen, setPruneOpen] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<Workload | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const query = useWorkloads(hostId, { all: showAll, kind: kind || undefined });
  const workloads = query.data ?? EMPTY_WORKLOADS;

  // Cached image-update statuses (server-side periodic checks), keyed by
  // container id for O(1) badge lookups per row.
  const updatesQuery = useUpdates(hostId);
  const updatesById = useMemo(() => {
    const map = new Map<string, UpdateStatus>();
    for (const u of updatesQuery.data ?? []) map.set(u.containerId, u);
    return map;
  }, [updatesQuery.data]);

  const actions = useWorkloadActions(hostId);

  const confirmPrune = async () => {
    try {
      const res = await api.prune(hostId, { target: "containers" });
      toast.success(
        tr(workloadsDict, "toast.prunedTitle"),
        tr(workloadsDict, "toast.prunedBody", { count: res.removed.length, size: formatBytes(res.spaceReclaimed) }),
      );
      queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
    } catch (err) {
      toastError(tr(workloadsDict, "toast.pruneFailed"), err);
      throw err;
    }
  };

  // On-demand registry sweep: the POST blocks until the server has re-checked
  // every image, so fresh statuses are ready as soon as it resolves.
  const runCheckUpdates = async () => {
    setCheckingUpdates(true);
    toast.success(tr(workloadsDict, "toast.updateCheckStartedTitle"), tr(workloadsDict, "toast.updateCheckStartedBody"));
    try {
      await api.updatesCheck(hostId);
      queryClient.invalidateQueries({ queryKey: qk.updates(hostId) });
    } catch (err) {
      toastError(tr(workloadsDict, "toast.updateCheckFailed"), err);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const confirmUpdate = async () => {
    if (!updateTarget) return;
    try {
      await api.workloadUpdate(hostId, updateTarget.id);
      toast.success(tr(workloadsDict, "toast.updatedTitle"), tr(workloadsDict, "toast.updatedBody", { name: cleanName(updateTarget.name) }));
      queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
      queryClient.invalidateQueries({ queryKey: qk.updates(hostId) });
    } catch (err) {
      toastError(tr(workloadsDict, "toast.updateFailed"), err);
      throw err;
    }
  };

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const w of workloads) if (w.group) set.add(w.group);
    return Array.from(set).sort();
  }, [workloads]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return workloads.filter((w) => {
      if (state && w.state !== state) return false;
      if (group && w.group !== group) return false;
      if (s) {
        const hay = `${w.name} ${w.image} ${w.id} ${w.group ?? ""} ${w.node ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [workloads, state, group, search]);

  // ---- Selection + bulk actions -------------------------------------------
  // Rows are keyed by "providerId:id" (same key DataTable uses) so selection is
  // unambiguous across providers. Bulk lifecycle actions only apply to docker,
  // non-protected targets; the rest are ignored (swarm/k8s are read-only,
  // protected need the per-row admin-override flow).
  const filteredByKey = useMemo(() => {
    const map = new Map<string, Workload>();
    for (const w of filtered) map.set(wKey(w), w);
    return map;
  }, [filtered]);

  const selectedWorkloads = useMemo(
    () => filtered.filter((w) => selected.has(wKey(w))),
    [filtered, selected],
  );
  const bulkTargets = useMemo(
    () => selectedWorkloads.filter((w) => w.kind === "docker" && !w.protected),
    [selectedWorkloads],
  );

  const toggleRow = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // onToggleAll receives the full sorted key set from DataTable. Clearing when
  // everything is already selected, selecting all otherwise.
  const toggleAll = (keys: string[]) =>
    setSelected((prev) => {
      const allOn = keys.length > 0 && keys.every((k) => prev.has(k));
      return allOn ? new Set() : new Set(keys);
    });

  const clearSelection = () => setSelected(new Set());

  // Prune keys that dropped out of the current view (filter change, successful
  // remove, host switch) so the selection never carries stale entries. Runs
  // after render as a reconciliation effect; the equality guard avoids a loop.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const k of prev) if (filteredByKey.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [filteredByKey]);

  // A bulk button is enabled when at least one target passes the per-action gate.
  const bulkGate = (action: WorkloadAction): boolean =>
    bulkTargets.some((w) => gateWorkloadAction(action, w.kind, capsForKind(w.kind), permissions).allowed);

  const runBulkAction = (action: "start" | "stop" | "remove") => {
    const eligible = bulkTargets.filter(
      (w) => gateWorkloadAction(action, w.kind, capsForKind(w.kind), permissions).allowed,
    );
    actions.runBulk(action, eligible);
  };

  const columns: Column<Workload>[] = [
    {
      key: "name",
      header: t("col.name"),
      sortValue: (w) => cleanName(w.name),
      cell: (w) => {
        const upd = updatesById.get(w.id);
        return (
          <div className="col" style={{ gap: 2 }}>
            <div className="row" style={{ gap: "var(--sp-2)" }}>
              <span style={{ fontWeight: 600 }} className="truncate">
                {cleanName(w.name)}
              </span>
              {w.protected ? <ProtectedTag /> : null}
              {upd?.updateAvailable ? (
                <span
                  className="pill"
                  style={{ background: "var(--info-bg)", color: "var(--accent)" }}
                  title={t("col.updateAvailableTitle", { image: upd.image })}
                >
                  {t("col.updatePill")}
                </span>
              ) : null}
            </div>
            <span className="text-xs muted mono">{shortId(w.id)}</span>
          </div>
        );
      },
    },
    {
      key: "state",
      header: t("col.state"),
      sortValue: (w) => w.state,
      cell: (w) => <StateBadge state={w.state} raw={w.stateRaw} />,
    },
    {
      key: "kind",
      header: t("col.orchestrator"),
      sortValue: (w) => w.kind,
      cell: (w) => <OrchestratorBadge kind={w.kind} readonly={capsForKind(w.kind)?.includes("readonly")} />,
    },
    {
      key: "image",
      header: t("col.image"),
      sortValue: (w) => w.image,
      cell: (w) => (
        <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={w.image}>
          {w.image || "—"}
        </span>
      ),
    },
    {
      key: "group",
      header: t("col.group"),
      sortValue: (w) => w.group ?? "",
      cell: (w) => (w.group ? <span className="chip">{w.group}</span> : <span className="muted">—</span>),
    },
    {
      key: "ports",
      header: t("col.ports"),
      cell: (w) =>
        w.ports && w.ports.length ? (
          <div className="row-wrap" style={{ gap: 4 }}>
            {w.ports.slice(0, 3).map((p, i) => (
              <span key={i} className="chip chip-mono text-xs">
                {p.public ? `${p.public}→` : ""}
                {p.private}/{p.protocol}
              </span>
            ))}
            {w.ports.length > 3 ? <span className="text-xs muted">+{w.ports.length - 3}</span> : null}
          </div>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: "created",
      header: t("col.created"),
      sortValue: (w) => w.createdAt,
      cell: (w) => <span className="text-xs muted nowrap">{timeAgo(w.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "150px",
      cell: (w) => {
        const upd = updatesById.get(w.id);
        // Update action only surfaces when it can actually run: an update is
        // known, the workload is standalone Docker, and the user holds the perm.
        const showUpdate = w.kind === "docker" && !!upd?.updateAvailable && can("docker.container.update");
        return (
          <div className="dt-actions" onClick={(e) => e.stopPropagation()}>
            {showUpdate ? (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={w.protected}
                tooltip={w.protected ? t("row.protectedTooltip") : t("row.updateTooltip")}
                aria-label={t("row.updateLabel")}
                onClick={() => setUpdateTarget(w)}
                style={w.protected ? undefined : { color: "var(--accent)" }}
              >
                <IconDownload size={15} />
              </ActionButton>
            ) : null}
            <WorkloadActionButtons
              workload={w}
              caps={capsForKind(w.kind)}
              permissions={permissions}
              busy={actions.busyId === w.id}
              onStart={actions.runStart}
              onPause={actions.runPause}
              onUnpause={actions.runUnpause}
              onStop={actions.triggerStop}
              onRestart={actions.triggerRestart}
              onRemove={actions.triggerRemove}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <CapabilityGate gate={gatePrune("docker", capsForKind("docker"), permissions)}>
              {(allowed, reason) => (
                <ActionButton
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? undefined : reason}
                  onClick={() => setPruneOpen(true)}
                >
                  <IconPrune size={15} />
                  {t("header.pruneStopped")}
                </ActionButton>
              )}
            </CapabilityGate>
            <CapabilityGate
              allowed={can("docker.image.pull")}
              reason={t("gate.needImagePull")}
            >
              {(allowed, reason) => (
                <ActionButton
                  variant="ghost"
                  disabled={!allowed}
                  loading={checkingUpdates}
                  tooltip={allowed ? undefined : reason}
                  onClick={runCheckUpdates}
                >
                  <IconDownload size={15} />
                  {t("header.checkUpdates")}
                </ActionButton>
              )}
            </CapabilityGate>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} onClick={() => query.refetch()} aria-label={t("header.refresh")}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="workloads" />
          </div>
        }
      />

      {/* filter toolbar */}
      <div className="card card-pad">
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <div className="row" style={{ flex: "1 1 260px", minWidth: 220 }}>
            <span className="muted">
              <IconSearch size={16} />
            </span>
            <input
              className="input"
              placeholder={t("filter.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 180 }} value={kind} onChange={(e) => setKind(e.target.value as OrchestratorKind | "")}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.labelKey ? t(k.labelKey) : k.label}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 160 }} value={state} onChange={(e) => setState(e.target.value as WorkloadState | "")}>
            {STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.labelKey)}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 200 }} value={group} onChange={(e) => setGroup(e.target.value)} disabled={groups.length === 0}>
            <option value="">{t("filter.stacksAll")}</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label className="checkbox-row">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            <span>{t("filter.includeStopped")}</span>
          </label>
          <span className="spacer" />
          <span className="text-sm muted">
            {t("filter.counter", { shown: filtered.length, total: workloads.length })}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : workloads.length === 0 && !kind && showAll ? (
        // Nothing on the host at all (not a filter miss): springboard to the
        // Marketplace instead of a dead-end empty table.
        <div className="card">
          <EmptyState
            icon={<IconWorkloads size={40} />}
            title={t("empty.noneTitle")}
            message={t("empty.noneMessage")}
            action={
              <ActionButton variant="primary" onClick={() => navigate("/marketplace")}>
                {t("empty.noneAction")}
              </ActionButton>
            }
          />
        </div>
      ) : (
        <>
          {selected.size > 0 ? (
            <div
              className="card card-pad row-wrap"
              style={{ gap: "var(--sp-3)", alignItems: "center", borderColor: "var(--accent)" }}
            >
              <span className="text-sm" style={{ fontWeight: 600 }}>
                {t("bulk.selected", { count: selected.size })}
              </span>
              {bulkTargets.length < selected.size ? (
                <span className="text-xs muted">
                  {t("bulk.actionable", { count: bulkTargets.length })}
                </span>
              ) : null}
              <span className="spacer" />
              <ActionButton
                size="sm"
                variant="ghost"
                disabled={!bulkGate("start")}
                tooltip={bulkGate("start") ? undefined : t("bulk.startDisabled")}
                onClick={() => runBulkAction("start")}
              >
                <IconPlay size={14} />
                {t("bulk.start")}
              </ActionButton>
              <ActionButton
                size="sm"
                variant="ghost"
                disabled={!bulkGate("stop")}
                tooltip={bulkGate("stop") ? undefined : t("bulk.stopDisabled")}
                onClick={() => runBulkAction("stop")}
              >
                <IconStop size={14} />
                {t("bulk.stop")}
              </ActionButton>
              <ActionButton
                size="sm"
                variant="ghost"
                disabled={!bulkGate("remove")}
                tooltip={bulkGate("remove") ? undefined : t("bulk.removeDisabled")}
                onClick={() => runBulkAction("remove")}
                style={bulkGate("remove") ? { color: "var(--danger)" } : undefined}
              >
                <IconTrash size={14} />
                {t("bulk.remove")}
              </ActionButton>
              <ActionButton size="sm" variant="ghost" onClick={clearSelection}>
                {t("bulk.clear")}
              </ActionButton>
            </div>
          ) : null}
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={wKey}
            defaultSortKey="name"
            onRowClick={(w) => navigate(`/workloads/${encodeURIComponent(hostId)}/${encodeURIComponent(w.id)}`)}
            emptyIcon={<IconWorkloads size={40} />}
            emptyTitle={t("empty.noMatchTitle")}
            emptyMessage={t("empty.noMatchMessage")}
            selectable
            selectedKeys={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
          />
        </>
      )}

      <ConfirmDestructiveDialog
        open={pruneOpen}
        title={t("dialog.pruneTitle")}
        variant="danger"
        confirmLabel={t("dialog.pruneConfirm")}
        description={
          <>
            {t("dialog.pruneBody1")}
            <strong>{t("dialog.pruneAllStopped")}</strong>
            {t("dialog.pruneBody2")}
          </>
        }
        onConfirm={confirmPrune}
        onClose={() => setPruneOpen(false)}
      />

      <ConfirmDestructiveDialog
        open={updateTarget !== null}
        title={t("dialog.updateTitle")}
        variant="primary"
        confirmLabel={t("dialog.updateConfirm")}
        description={
          <>
            {t("dialog.updateBody1")}
            <strong className="mono">{updateTarget?.image}</strong>
            {t("dialog.updateBody2")}
            <strong className="mono">{cleanName(updateTarget?.name)}</strong>
            {t("dialog.updateBody3")}
          </>
        }
        onConfirm={confirmUpdate}
        onClose={() => setUpdateTarget(null)}
      />

      {actions.dialogs}
    </div>
  );
}
