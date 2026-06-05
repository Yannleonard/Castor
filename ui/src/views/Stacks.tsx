// ui/src/views/Stacks.tsx
//
// Compose stacks: list the multi-container stacks deployed on the selected host
// (name, status, service count, created), deploy a new one (-> StackEditor), and
// tear an existing one down (DELETE, with a destructive confirm). RBAC mirrors
// the backend: docker.container.read to view, docker.container.create to deploy,
// docker.container.remove to bring a stack down.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStacks, useCapabilityLookup, qk } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { StatusDot } from "../components/StatusDot";
import { IconStacks, IconPlus, IconTrash, IconRefresh, IconSearch } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import type { Stack, StackStatus, WorkloadState } from "../lib/types";

const EMPTY_STACKS: Stack[] = [];

// Map a stack status to the workload-state palette reused by StatusDot, plus a
// human label.
const STATUS_META: Record<StackStatus, { dot: WorkloadState; label: string; fg: string; bg: string }> = {
  running: { dot: "running", label: "Running", fg: "var(--state-running)", bg: "var(--success-bg)" },
  partial: { dot: "paused", label: "Partial", fg: "var(--state-paused)", bg: "var(--warning-bg)" },
  pending: { dot: "pending", label: "Pending", fg: "var(--state-pending)", bg: "rgba(142,124,195,0.18)" },
  stopped: { dot: "stopped", label: "Stopped", fg: "var(--state-stopped)", bg: "rgba(110,138,166,0.16)" },
  error: { dot: "unknown", label: "Error", fg: "var(--danger)", bg: "var(--danger-bg)" },
};

function StackStatusBadge({ status }: { status: StackStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className="pill" style={{ background: meta.bg, color: meta.fg, borderColor: "transparent" }} title={status}>
      <StatusDot state={meta.dot} pulse={status === "running"} />
      {meta.label}
    </span>
  );
}

export function Stacks() {
  const hostId = useSelectedHost();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useStacks(hostId);
  const [search, setSearch] = useState("");
  const [downTarget, setDownTarget] = useState<Stack | null>(null);

  // Stacks deploy via docker containers; gate on the same capability + perms the
  // backend enforces.
  const canDeploy = caps?.includes("start") && can("docker.container.create");
  const canDown = caps?.includes("remove") && can("docker.container.remove");

  const stacks = query.data ?? EMPTY_STACKS;
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return stacks;
    return stacks.filter((st) => `${st.name} ${st.projectName} ${st.status}`.toLowerCase().includes(s));
  }, [stacks, search]);

  const doDown = async () => {
    if (!downTarget) return;
    try {
      await api.stackDelete(hostId, downTarget.id);
      toast.success("Stack removed", downTarget.name);
      queryClient.invalidateQueries({ queryKey: qk.stacks(hostId) });
    } catch (err) {
      toastError("Bring down failed", err);
      throw err;
    }
  };

  const columns: Column<Stack>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (st) => st.name,
      cell: (st) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{st.name}</span>
          <span className="mono text-xs muted">{st.projectName}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (st) => st.status,
      cell: (st) => <StackStatusBadge status={st.status} />,
    },
    {
      key: "services",
      header: "Services",
      align: "right",
      sortValue: (st) => st.serviceCount,
      cell: (st) => <span className="mono">{st.serviceCount}</span>,
    },
    {
      key: "created",
      header: "Created",
      sortValue: (st) => st.createdAt,
      cell: (st) => <span className="text-xs muted nowrap">{timeAgo(st.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "60px",
      cell: (st) => (
        <CapabilityGate
          allowed={!!canDown}
          reason={!caps?.includes("remove") ? "Provider does not support removal" : "Requires docker.container.remove"}
        >
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? "Bring stack down" : reason}
              aria-label="Bring stack down"
              onClick={(e) => {
                e.stopPropagation();
                setDownTarget(st);
              }}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Stacks"
        subtitle="Multi-container compose stacks on this host."
        actions={
          <div className="row">
            <CapabilityGate
              allowed={!!canDeploy}
              reason={!caps?.includes("start") ? "Provider does not support deploy" : "Requires docker.container.create"}
            >
              {(allowed, reason) => (
                <ActionButton
                  variant="primary"
                  disabled={!allowed}
                  tooltip={allowed ? undefined : reason}
                  onClick={() => navigate("/stacks/new")}
                >
                  <IconPlus size={15} />
                  Deploy stack
                </ActionButton>
              )}
            </CapabilityGate>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="card card-pad">
        <div className="row">
          <span className="muted">
            <IconSearch size={16} />
          </span>
          <input
            className="input"
            placeholder="Search stacks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 360 }}
          />
          <span className="spacer" />
          <span className="text-sm muted">
            {filtered.length} of {stacks.length}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label="Loading stacks…" />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(st) => st.id}
          defaultSortKey="name"
          onRowClick={(st) => navigate(`/stacks/${encodeURIComponent(hostId)}/${encodeURIComponent(st.id)}`)}
          emptyIcon={<IconStacks size={40} />}
          emptyTitle="No stacks"
          emptyMessage="Deploy a stack from a compose file to get started."
        />
      )}

      <ConfirmDestructiveDialog
        open={!!downTarget}
        title="Bring stack down"
        variant="danger"
        confirmLabel="Bring down"
        description={
          <>
            Bring down <strong className="mono">{downTarget?.name}</strong>? All{" "}
            {downTarget?.serviceCount ?? 0} container(s) in this stack will be stopped and removed, along with the
            stack's network(s). Named volumes are left intact.
          </>
        }
        onConfirm={doDown}
        onClose={() => setDownTarget(null)}
      />
    </div>
  );
}
