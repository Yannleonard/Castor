// ui/src/views/Workloads.tsx
//
// Unified workload table across all orchestrators (Docker + Swarm tasks + K8s
// pods served via the workloads endpoint with kind filter). Filters: kind, state,
// group, search; row actions gated by capability + permission. Rows are
// click-through to the detail view.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useWorkloads, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { useWorkloadActions } from "./useWorkloadActions";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { StateBadge } from "../components/StateBadge";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ProtectedTag } from "../components/ProtectedTag";
import { WorkloadActionButtons } from "../components/WorkloadActionButtons";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { IconRefresh, IconSearch, IconWorkloads } from "../components/icons";
import { cleanName, shortId, timeAgo } from "../lib/format";
import type { OrchestratorKind, Workload, WorkloadState } from "../lib/types";

const KINDS: { value: "" | OrchestratorKind; label: string }[] = [
  { value: "", label: "All orchestrators" },
  { value: "docker", label: "Docker" },
  { value: "swarm", label: "Swarm" },
  { value: "kubernetes", label: "Kubernetes" },
];

// Stable empty reference so memo deps don't change identity every render.
const EMPTY_WORKLOADS: Workload[] = [];

const STATES: { value: "" | WorkloadState; label: string }[] = [
  { value: "", label: "All states" },
  { value: "running", label: "Running" },
  { value: "stopped", label: "Stopped" },
  { value: "paused", label: "Paused" },
  { value: "restarting", label: "Restarting" },
  { value: "pending", label: "Pending" },
  { value: "unknown", label: "Unknown" },
];

export function Workloads() {
  const navigate = useNavigate();
  const hostId = useSelectedHost();
  const { permissions } = useAuth();
  const { capsForKind } = useCapabilityLookup();

  const [showAll, setShowAll] = useState(true);
  const [kind, setKind] = useState<"" | OrchestratorKind>("");
  const [state, setState] = useState<"" | WorkloadState>("");
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");

  const query = useWorkloads(hostId, { all: showAll, kind: kind || undefined });
  const workloads = query.data ?? EMPTY_WORKLOADS;

  const actions = useWorkloadActions(hostId);

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

  const columns: Column<Workload>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (w) => cleanName(w.name),
      cell: (w) => (
        <div className="col" style={{ gap: 2 }}>
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <span style={{ fontWeight: 600 }} className="truncate">
              {cleanName(w.name)}
            </span>
            {w.protected ? <ProtectedTag /> : null}
          </div>
          <span className="text-xs muted mono">{shortId(w.id)}</span>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      sortValue: (w) => w.state,
      cell: (w) => <StateBadge state={w.state} raw={w.stateRaw} />,
    },
    {
      key: "kind",
      header: "Orchestrator",
      sortValue: (w) => w.kind,
      cell: (w) => <OrchestratorBadge kind={w.kind} readonly={capsForKind(w.kind)?.includes("readonly")} />,
    },
    {
      key: "image",
      header: "Image",
      sortValue: (w) => w.image,
      cell: (w) => (
        <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={w.image}>
          {w.image || "—"}
        </span>
      ),
    },
    {
      key: "group",
      header: "Stack / group",
      sortValue: (w) => w.group ?? "",
      cell: (w) => (w.group ? <span className="chip">{w.group}</span> : <span className="muted">—</span>),
    },
    {
      key: "ports",
      header: "Ports",
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
      header: "Created",
      sortValue: (w) => w.createdAt,
      cell: (w) => <span className="text-xs muted nowrap">{timeAgo(w.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "150px",
      cell: (w) => (
        <WorkloadActionButtons
          workload={w}
          caps={capsForKind(w.kind)}
          permissions={permissions}
          busy={actions.busyId === w.id}
          onStart={actions.runStart}
          onStop={actions.triggerStop}
          onRestart={actions.triggerRestart}
          onRemove={actions.triggerRemove}
        />
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Workloads"
        subtitle="Every container, service-task and pod across your orchestrators."
        actions={
          <ActionButton variant="ghost" iconOnly tooltip="Refresh" onClick={() => query.refetch()} aria-label="Refresh">
            <IconRefresh size={16} />
          </ActionButton>
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
              placeholder="Search name, image, id, node…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 180 }} value={kind} onChange={(e) => setKind(e.target.value as OrchestratorKind | "")}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 160 }} value={state} onChange={(e) => setState(e.target.value as WorkloadState | "")}>
            {STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 200 }} value={group} onChange={(e) => setGroup(e.target.value)} disabled={groups.length === 0}>
            <option value="">All stacks</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label className="checkbox-row">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            <span>Include stopped</span>
          </label>
          <span className="spacer" />
          <span className="text-sm muted">
            {filtered.length} of {workloads.length}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label="Loading workloads…" />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(w) => `${w.providerId}:${w.id}`}
          defaultSortKey="name"
          onRowClick={(w) => navigate(`/workloads/${encodeURIComponent(hostId)}/${encodeURIComponent(w.id)}`)}
          emptyIcon={<IconWorkloads size={40} />}
          emptyTitle="No workloads match"
          emptyMessage="Adjust the filters above, or start some containers."
        />
      )}

      {actions.dialogs}
    </div>
  );
}
