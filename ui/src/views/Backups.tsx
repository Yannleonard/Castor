// ui/src/views/Backups.tsx
//
// Volume backups: list the host's tar.gz archives (target / size / created /
// status) with per-row Download, Restore and Delete.
//   - Listing + downloading reuse docker.volume.read (CapVolumes).
//   - Creating a backup lives on the Volumes page (per-volume "Backup" action).
//   - Restore requires docker.volume.restore (admin); it opens a modal to pick
//     the destination volume (defaults to the originally backed-up volume).
//   - Delete requires docker.volume.backup.
// All affordances grey-out-before-click per ADR-002 (capability + permission).

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBackups, useVolumes, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { HelpButton } from "../components/HelpButton";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { SelectField } from "../components/Field";
import { StatusDot } from "../components/StatusDot";
import { IconVolumes, IconTrash, IconRefresh, IconSearch, IconDownload, IconRestart } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { formatBytes, timeAgo } from "../lib/format";
import { useT } from "../i18n";
import { backupsDict } from "../i18n/locales/backups";
import type { Backup, BackupStatus } from "../lib/types";

const EMPTY_BACKUPS: Backup[] = [];

// Pill tint per backup status (mirrors StateBadge token usage).
const STATUS_TINT: Record<BackupStatus, { bg: string; fg: string }> = {
  completed: { bg: "var(--success-bg)", fg: "var(--state-running)" },
  pending: { bg: "rgba(142,124,195,0.18)", fg: "var(--state-pending)" },
  failed: { bg: "var(--danger-bg)", fg: "var(--danger)" },
};

function StatusPill({ status, error }: { status: BackupStatus; error?: string }) {
  const t = useT(backupsDict);
  const tint = STATUS_TINT[status] ?? STATUS_TINT.pending;
  const label = status === "completed" ? t("status.completed") : status === "failed" ? t("status.failed") : t("status.pending");
  return (
    <span
      className="pill"
      style={{ background: tint.bg, color: tint.fg, borderColor: "transparent" }}
      title={status === "failed" && error ? error : label}
    >
      <StatusDot state={status === "completed" ? "running" : status === "failed" ? "stopped" : "pending"} pulse={status === "pending"} />
      {label}
    </span>
  );
}

export function Backups() {
  const t = useT(backupsDict);
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useBackups(hostId);
  const volumesQ = useVolumes(hostId);

  const [search, setSearch] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [restoreVolume, setRestoreVolume] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const hasVolumesCap = caps?.includes("volumes");
  const canRestore = hasVolumesCap && can("docker.volume.restore");
  const canDelete = hasVolumesCap && can("docker.volume.backup");

  const backups = query.data ?? EMPTY_BACKUPS;
  const volumes = volumesQ.data ?? [];

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return backups;
    return backups.filter((b) => `${b.targetName} ${b.kind} ${b.status}`.toLowerCase().includes(s));
  }, [backups, search]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["backups", hostId] });

  const openRestore = (b: Backup) => {
    setRestoreTarget(b);
    setRestoreVolume(b.targetName);
  };

  const doRestore = async () => {
    if (!restoreTarget) return;
    const target = restoreVolume.trim() || restoreTarget.targetName;
    setRestoring(true);
    try {
      await api.backupRestore(hostId, restoreTarget.id, { target });
      toast.success(t("toast.restoreOkTitle"), t("toast.restoreOkBody", { target }));
      setRestoreTarget(null);
      queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
    } catch (err) {
      toastError(t("toast.restoreFailed"), err);
    } finally {
      setRestoring(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.backupDelete(hostId, deleteTarget.id);
      toast.success(t("toast.deletedTitle"), deleteTarget.targetName);
      invalidate();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doDownload = async (b: Backup) => {
    setDownloadingId(b.id);
    try {
      await api.backupDownload(hostId, b.id, `${b.targetName}-${b.id}.tar.gz`);
    } catch (err) {
      toastError(t("toast.downloadFailed"), err);
    } finally {
      setDownloadingId(null);
    }
  };

  const columns: Column<Backup>[] = [
    {
      key: "target",
      header: t("col.volume"),
      sortValue: (b) => b.targetName,
      cell: (b) => (
        <div className="col" style={{ gap: 2 }}>
          <span className="mono" style={{ fontWeight: 600 }}>
            {b.targetName}
          </span>
          <span className="text-xs muted">{b.kind}</span>
        </div>
      ),
    },
    {
      key: "size",
      header: t("col.size"),
      align: "right",
      sortValue: (b) => b.sizeBytes,
      cell: (b) => <span className="mono">{b.status === "completed" ? formatBytes(b.sizeBytes) : "—"}</span>,
    },
    {
      key: "status",
      header: t("col.status"),
      sortValue: (b) => b.status,
      cell: (b) => <StatusPill status={b.status} error={b.error} />,
    },
    {
      key: "created",
      header: t("col.created"),
      sortValue: (b) => b.createdAt,
      cell: (b) => <span className="text-xs muted nowrap">{timeAgo(b.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "132px",
      cell: (b) => {
        const ready = b.status === "completed";
        return (
          <div className="row" style={{ gap: "var(--sp-1)", justifyContent: "flex-end" }}>
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              loading={downloadingId === b.id}
              disabled={!ready}
              tooltip={ready ? t("row.download") : t("row.archiveUnavailable")}
              aria-label={t("row.downloadAria")}
              onClick={() => doDownload(b)}
            >
              <IconDownload size={15} />
            </ActionButton>

            <CapabilityGate
              allowed={!!canRestore && ready}
              reason={
                !hasVolumesCap
                  ? t("gate.noVolumes")
                  : !ready
                    ? t("row.archiveUnavailable")
                    : t("gate.needRestore")
              }
            >
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? t("row.restore") : reason}
                  aria-label={t("row.restoreAria")}
                  onClick={() => openRestore(b)}
                >
                  <IconRestart size={15} />
                </ActionButton>
              )}
            </CapabilityGate>

            <CapabilityGate
              allowed={!!canDelete}
              reason={!hasVolumesCap ? t("gate.noVolumes") : t("gate.needBackup")}
            >
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? t("row.delete") : reason}
                  aria-label={t("row.deleteAria")}
                  onClick={() => setDeleteTarget(b)}
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

  return (
    <div className="page">
      <PageHeader
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="volumes" />
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
            {t("filter.count", { shown: filtered.length, total: backups.length })}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(b) => b.id}
          defaultSortKey="created"
          defaultSortDir="desc"
          emptyIcon={<IconVolumes size={40} />}
          emptyTitle={t("empty.title")}
          emptyMessage={t("empty.message")}
        />
      )}

      {/* Restore */}
      <Modal
        open={!!restoreTarget}
        title={t("restore.title")}
        busy={restoring}
        onClose={() => setRestoreTarget(null)}
        footer={
          <>
            <button className="btn" onClick={() => setRestoreTarget(null)} disabled={restoring}>
              {t("restore.cancel")}
            </button>
            <ActionButton variant="primary" loading={restoring} disabled={!restoreVolume.trim()} onClick={doRestore}>
              {t("restore.confirm")}
            </ActionButton>
          </>
        }
      >
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <div className="text-sm secondary">
            {t("restore.descPrefix")}
            <strong className="mono">{restoreTarget?.targetName}</strong>
            {t("restore.descSuffix")}
          </div>
          <SelectField
            label={t("restore.volumeLabel")}
            value={restoreVolume}
            onChange={(e) => setRestoreVolume(e.target.value)}
            hint={t("restore.volumeHint")}
          >
            {/* Ensure the original target is always selectable even if absent from the live list. */}
            {restoreTarget && !volumes.some((v) => v.name === restoreTarget.targetName) ? (
              <option value={restoreTarget.targetName}>{t("restore.original", { name: restoreTarget.targetName })}</option>
            ) : null}
            {volumes.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </SelectField>
        </div>
      </Modal>

      {/* Delete */}
      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title={t("delete.title")}
        variant="danger"
        confirmLabel={t("delete.confirm")}
        description={
          <>
            {t("delete.descPrefix")}
            <strong className="mono">{deleteTarget?.targetName}</strong>
            {t("delete.descSuffix")}
          </>
        }
        onConfirm={doDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
