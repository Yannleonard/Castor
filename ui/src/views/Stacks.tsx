// Castor by IT Leonard
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
import { EmptyState } from "../components/EmptyState";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { HelpButton } from "../components/HelpButton";
import { StatusDot } from "../components/StatusDot";
import { IconStacks, IconPlus, IconTrash, IconRefresh, IconSearch, IconExternal } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import { useT } from "../i18n";
import { t as tr } from "../i18n";
import { stacksDict } from "../i18n/locales/stacks";
import type { Stack, StackStatus, WorkloadState } from "../lib/types";

const EMPTY_STACKS: Stack[] = [];

// Map a stack status to the workload-state palette reused by StatusDot, plus the
// stacksDict key for its human label.
const STATUS_META: Record<StackStatus, { dot: WorkloadState; labelKey: string; fg: string; bg: string }> = {
  running: { dot: "running", labelKey: "badge.running", fg: "var(--state-running)", bg: "var(--success-bg)" },
  partial: { dot: "paused", labelKey: "badge.partial", fg: "var(--state-paused)", bg: "var(--warning-bg)" },
  pending: { dot: "pending", labelKey: "badge.pending", fg: "var(--state-pending)", bg: "rgba(142,124,195,0.18)" },
  stopped: { dot: "stopped", labelKey: "badge.stopped", fg: "var(--state-stopped)", bg: "rgba(110,138,166,0.16)" },
  error: { dot: "unknown", labelKey: "badge.error", fg: "var(--danger)", bg: "var(--danger-bg)" },
};

function StackStatusBadge({ status }: { status: StackStatus }) {
  const t = useT(stacksDict);
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className="pill" style={{ background: meta.bg, color: meta.fg, borderColor: "transparent" }} title={status}>
      <StatusDot state={meta.dot} pulse={status === "running"} />
      {t(meta.labelKey)}
    </span>
  );
}

export function Stacks() {
  const t = useT(stacksDict);
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
      toast.success(tr(stacksDict, "toast.removedTitle"), downTarget.name);
      queryClient.invalidateQueries({ queryKey: qk.stacks(hostId) });
    } catch (err) {
      toastError(tr(stacksDict, "toast.downFailed"), err);
      throw err;
    }
  };

  const columns: Column<Stack>[] = [
    {
      key: "name",
      header: t("col.name"),
      sortValue: (st) => st.name,
      cell: (st) => (
        <div className="col" style={{ gap: 2 }}>
          <span className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>{st.name}</span>
            {st.gitRepoUrl ? (
              <span
                className="pill"
                title={
                  st.gitRef
                    ? t("row.gitTrackedRef", { url: st.gitRepoUrl, ref: st.gitRef })
                    : t("row.gitTracked", { url: st.gitRepoUrl })
                }
                style={{ color: "var(--accent)", borderColor: "var(--accent)", background: "transparent" }}
              >
                <IconExternal size={11} /> {t("row.gitBadge")}
              </span>
            ) : null}
          </span>
          <span className="mono text-xs muted">{st.projectName}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: t("col.status"),
      sortValue: (st) => st.status,
      cell: (st) => <StackStatusBadge status={st.status} />,
    },
    {
      key: "services",
      header: t("col.services"),
      align: "right",
      sortValue: (st) => st.serviceCount,
      cell: (st) => <span className="mono">{st.serviceCount}</span>,
    },
    {
      key: "created",
      header: t("col.created"),
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
          reason={!caps?.includes("remove") ? t("row.noRemoveSupport") : t("row.needRemovePerm")}
        >
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? t("row.bringDown") : reason}
              aria-label={t("row.bringDown")}
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
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <CapabilityGate
              allowed={!!canDeploy}
              reason={!caps?.includes("start") ? t("row.noDeploySupport") : t("row.needCreatePerm")}
            >
              {(allowed, reason) => (
                <ActionButton
                  variant="primary"
                  disabled={!allowed}
                  tooltip={allowed ? undefined : reason}
                  onClick={() => navigate("/stacks/new")}
                >
                  <IconPlus size={15} />
                  {t("header.deploy")}
                </ActionButton>
              )}
            </CapabilityGate>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="stacks" />
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
            placeholder={t("filter.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 360 }}
          />
          <span className="spacer" />
          <span className="text-sm muted">
            {t("filter.count", { shown: filtered.length, total: stacks.length })}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : stacks.length === 0 ? (
        // No stacks on the host: springboard into the compose editor (the same
        // flow as the header "Deploy stack" button), shown only when allowed.
        <div className="card">
          <EmptyState
            icon={<IconStacks size={40} />}
            title={t("empty.title")}
            message={t("empty.message")}
            action={
              canDeploy ? (
                <ActionButton variant="primary" onClick={() => navigate("/stacks/new")}>
                  <IconPlus size={15} />
                  {t("empty.action")}
                </ActionButton>
              ) : undefined
            }
          />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(st) => st.id}
          defaultSortKey="name"
          onRowClick={(st) => navigate(`/stacks/${encodeURIComponent(hostId)}/${encodeURIComponent(st.id)}`)}
          emptyIcon={<IconStacks size={40} />}
          emptyTitle={t("list.emptyTitle")}
          emptyMessage={t("list.emptyMessage")}
        />
      )}

      <ConfirmDestructiveDialog
        open={!!downTarget}
        title={t("dialog.title")}
        variant="danger"
        confirmLabel={t("dialog.confirm")}
        description={
          <>
            {t("dialog.descPrefix")} <strong className="mono">{downTarget?.name}</strong>
            {t("dialog.descSuffix", { count: downTarget?.serviceCount ?? 0 })}
          </>
        }
        onConfirm={doDown}
        onClose={() => setDownTarget(null)}
      />
    </div>
  );
}
