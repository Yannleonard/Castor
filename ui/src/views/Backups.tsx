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
import type { Backup, BackupStatus } from "../lib/types";

const EMPTY_BACKUPS: Backup[] = [];

// Pill tint per backup status (mirrors StateBadge token usage).
const STATUS_TINT: Record<BackupStatus, { bg: string; fg: string }> = {
  completed: { bg: "var(--success-bg)", fg: "var(--state-running)" },
  pending: { bg: "rgba(142,124,195,0.18)", fg: "var(--state-pending)" },
  failed: { bg: "var(--danger-bg)", fg: "var(--danger)" },
};

function StatusPill({ status, error }: { status: BackupStatus; error?: string }) {
  const tint = STATUS_TINT[status] ?? STATUS_TINT.pending;
  return (
    <span
      className="pill"
      style={{ background: tint.bg, color: tint.fg, borderColor: "transparent" }}
      title={status === "failed" && error ? error : status}
    >
      <StatusDot state={status === "completed" ? "running" : status === "failed" ? "stopped" : "pending"} pulse={status === "pending"} />
      {status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Pending"}
    </span>
  );
}

export function Backups() {
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
      toast.success("Restore complete", `Volume ${target} was restored from the archive.`);
      setRestoreTarget(null);
      queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
    } catch (err) {
      toastError("Restore failed", err);
    } finally {
      setRestoring(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.backupDelete(hostId, deleteTarget.id);
      toast.success("Backup deleted", deleteTarget.targetName);
      invalidate();
    } catch (err) {
      toastError("Delete failed", err);
      throw err;
    }
  };

  const doDownload = async (b: Backup) => {
    setDownloadingId(b.id);
    try {
      await api.backupDownload(hostId, b.id, `${b.targetName}-${b.id}.tar.gz`);
    } catch (err) {
      toastError("Download failed", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const columns: Column<Backup>[] = [
    {
      key: "target",
      header: "Volume",
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
      header: "Size",
      align: "right",
      sortValue: (b) => b.sizeBytes,
      cell: (b) => <span className="mono">{b.status === "completed" ? formatBytes(b.sizeBytes) : "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (b) => b.status,
      cell: (b) => <StatusPill status={b.status} error={b.error} />,
    },
    {
      key: "created",
      header: "Created",
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
              tooltip={ready ? "Download archive" : "Archive is not available"}
              aria-label="Download backup"
              onClick={() => doDownload(b)}
            >
              <IconDownload size={15} />
            </ActionButton>

            <CapabilityGate
              allowed={!!canRestore && ready}
              reason={
                !hasVolumesCap
                  ? "Provider does not manage volumes"
                  : !ready
                    ? "Archive is not available"
                    : "Requires docker.volume.restore (admin)"
              }
            >
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? "Restore into a volume" : reason}
                  aria-label="Restore backup"
                  onClick={() => openRestore(b)}
                >
                  <IconRestart size={15} />
                </ActionButton>
              )}
            </CapabilityGate>

            <CapabilityGate
              allowed={!!canDelete}
              reason={!hasVolumesCap ? "Provider does not manage volumes" : "Requires docker.volume.backup"}
            >
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? "Delete backup" : reason}
                  aria-label="Delete backup"
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
        title="Backups"
        subtitle="Volume tar archives. Create a backup from the Volumes page; restore or download here."
        actions={
          <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => query.refetch()}>
            <IconRefresh size={16} />
          </ActionButton>
        }
      />

      <div className="card card-pad">
        <div className="row">
          <span className="muted">
            <IconSearch size={16} />
          </span>
          <input
            className="input"
            placeholder="Search backups…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 360 }}
          />
          <span className="spacer" />
          <span className="text-sm muted">
            {filtered.length} of {backups.length}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label="Loading backups…" />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(b) => b.id}
          defaultSortKey="created"
          defaultSortDir="desc"
          emptyIcon={<IconVolumes size={40} />}
          emptyTitle="No backups"
          emptyMessage="Back up a volume from the Volumes page to create an archive."
        />
      )}

      {/* Restore */}
      <Modal
        open={!!restoreTarget}
        title="Restore backup"
        busy={restoring}
        onClose={() => setRestoreTarget(null)}
        footer={
          <>
            <button className="btn" onClick={() => setRestoreTarget(null)} disabled={restoring}>
              Cancel
            </button>
            <ActionButton variant="primary" loading={restoring} disabled={!restoreVolume.trim()} onClick={doRestore}>
              Restore
            </ActionButton>
          </>
        }
      >
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <div className="text-sm secondary">
            Restore the archive of{" "}
            <strong className="mono">{restoreTarget?.targetName}</strong> into the destination volume below. Existing
            contents of the destination are overwritten.
          </div>
          <SelectField
            label="Destination volume"
            value={restoreVolume}
            onChange={(e) => setRestoreVolume(e.target.value)}
            hint="Defaults to the original volume. Pick another existing volume to restore elsewhere."
          >
            {/* Ensure the original target is always selectable even if absent from the live list. */}
            {restoreTarget && !volumes.some((v) => v.name === restoreTarget.targetName) ? (
              <option value={restoreTarget.targetName}>{restoreTarget.targetName} (original)</option>
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
        title="Delete backup"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete the backup archive of <strong className="mono">{deleteTarget?.targetName}</strong>? The tar file is
            removed from the server permanently.
          </>
        }
        onConfirm={doDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
