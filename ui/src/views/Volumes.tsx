// ui/src/views/Volumes.tsx
//
// Docker volumes: read + gated writes. Create opens a modal (docker.volume.create);
// remove is admin-gated (docker.volume.remove, CapVolumes); prune (docker.system.prune)
// deletes every unattached volume. The /data volume is self-protected server-side
// (→ 409 protected_resource); the UI also disables it proactively.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVolumes, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { LoadingFill } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { ProtectedTag } from "../components/ProtectedTag";
import { HelpButton } from "../components/HelpButton";
import { TextField } from "../components/Field";
import { IconVolumes, IconPlus, IconPrune, IconTrash, IconRefresh, IconSearch, IconDownload } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { formatBytes, timeAgo } from "../lib/format";
import { useT, t as tr } from "../i18n";
import { volumesDict } from "../i18n/locales/volumes";
import type { DockerVolume } from "../lib/types";

const EMPTY_VOLUMES: DockerVolume[] = [];

// Mirrors the Docker daemon's volume name constraint.
const VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// Heuristic for the self-protected data volume name.
function looksProtected(name: string, mountpoint: string): boolean {
  return name === "castor-data" || /\/data(\/|$)/.test(mountpoint);
}

export function Volumes() {
  const t = useT(volumesDict);
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useVolumes(hostId);
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DockerVolume | null>(null);
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDriver, setCreateDriver] = useState("");
  const [creating, setCreating] = useState(false);
  const [pruneOpen, setPruneOpen] = useState(false);

  const hasVolumesCap = caps?.includes("volumes");
  const canCreate = hasVolumesCap && can("docker.volume.create");
  const canRemove = hasVolumesCap && can("docker.volume.remove");
  const canBackup = hasVolumesCap && can("docker.volume.backup");
  const canPrune = hasVolumesCap && can("docker.system.prune");
  const volumes = query.data ?? EMPTY_VOLUMES;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return volumes;
    return volumes.filter((v) => `${v.name} ${v.driver} ${v.mountpoint}`.toLowerCase().includes(s));
  }, [volumes, search]);

  const nameOk = VOLUME_NAME_RE.test(createName.trim());

  const doCreate = async () => {
    if (!nameOk) return;
    setCreating(true);
    try {
      const name = createName.trim();
      const driver = createDriver.trim();
      await api.volumeCreate(hostId, driver ? { name, driver } : { name });
      toast.success(tr(volumesDict, "toast.createdTitle"), name);
      setCreateOpen(false);
      setCreateName("");
      setCreateDriver("");
      queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
    } catch (err) {
      toastError(tr(volumesDict, "toast.createFailed"), err);
    } finally {
      setCreating(false);
    }
  };

  const doPrune = async () => {
    try {
      const res = await api.prune(hostId, { target: "volumes" });
      toast.success(
        tr(volumesDict, "toast.prunedTitle"),
        tr(volumesDict, "toast.prunedBody", { count: res.removed.length, size: formatBytes(res.spaceReclaimed) }),
      );
      queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
    } catch (err) {
      toastError(tr(volumesDict, "toast.pruneFailed"), err);
      throw err;
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await api.volumeRemove(hostId, removeTarget.name);
      toast.success(tr(volumesDict, "toast.removedTitle"), removeTarget.name);
      queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
    } catch (err) {
      toastError(tr(volumesDict, "toast.removeFailed"), err);
      throw err;
    }
  };

  const doBackup = async (v: DockerVolume) => {
    setBackingUp(v.name);
    toast.info(tr(volumesDict, "toast.backingUpTitle"), tr(volumesDict, "toast.backingUpBody", { name: v.name }));
    try {
      await api.backupCreate(hostId, { target: v.name });
      toast.success(tr(volumesDict, "toast.backupCompleteTitle"), tr(volumesDict, "toast.backupCompleteBody", { name: v.name }));
      queryClient.invalidateQueries({ queryKey: ["backups", hostId] });
    } catch (err) {
      toastError(tr(volumesDict, "toast.backupFailed"), err);
    } finally {
      setBackingUp(null);
    }
  };

  const columns: Column<DockerVolume>[] = [
    {
      key: "name",
      header: t("col.name"),
      sortValue: (v) => v.name,
      cell: (v) => (
        <div className="row" style={{ gap: "var(--sp-2)" }}>
          <span className="mono" style={{ fontWeight: 600 }}>
            {v.name}
          </span>
          {looksProtected(v.name, v.mountpoint) ? <ProtectedTag title={t("badge.protected")} /> : null}
        </div>
      ),
    },
    { key: "driver", header: t("col.driver"), sortValue: (v) => v.driver, cell: (v) => <span className="chip">{v.driver}</span> },
    {
      key: "mountpoint",
      header: t("col.mountpoint"),
      sortValue: (v) => v.mountpoint,
      cell: (v) => (
        <span className="mono text-xs muted truncate" style={{ maxWidth: 360, display: "inline-block" }} title={v.mountpoint}>
          {v.mountpoint}
        </span>
      ),
    },
    { key: "created", header: t("col.created"), sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "96px",
      cell: (v) => {
        const isProtected = looksProtected(v.name, v.mountpoint);
        const removeReason = !hasVolumesCap
          ? t("gate.noVolumes")
          : isProtected
            ? t("gate.removeProtected")
            : t("gate.removeRequires");
        const backupReason = !hasVolumesCap
          ? t("gate.noVolumes")
          : t("gate.backupRequires");
        return (
          <div className="row" style={{ gap: "var(--sp-1)", justifyContent: "flex-end" }}>
            <CapabilityGate allowed={!!canBackup} reason={backupReason}>
              {(allowed, why) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  loading={backingUp === v.name}
                  disabled={!allowed}
                  tooltip={allowed ? t("action.backup") : why}
                  aria-label={t("action.backupLabel")}
                  onClick={() => doBackup(v)}
                >
                  <IconDownload size={15} />
                </ActionButton>
              )}
            </CapabilityGate>
            <CapabilityGate allowed={!!canRemove && !isProtected} reason={removeReason}>
              {(allowed, why) => (
                <ActionButton
                  size="sm"
                  iconOnly
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? t("action.remove") : why}
                  aria-label={t("action.removeLabel")}
                  onClick={() => setRemoveTarget(v)}
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
            <CapabilityGate
              allowed={!!canCreate}
              reason={!hasVolumesCap ? t("gate.noVolumes") : t("gate.createRequires")}
            >
              {(allowed, reason) => (
                <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateOpen(true)}>
                  <IconPlus size={15} />
                  {t("header.create")}
                </ActionButton>
              )}
            </CapabilityGate>
            <CapabilityGate
              allowed={!!canPrune}
              reason={!hasVolumesCap ? t("gate.noVolumes") : t("gate.pruneRequires")}
            >
              {(allowed, reason) => (
                <ActionButton variant="ghost" disabled={!allowed} tooltip={allowed ? t("header.pruneTooltip") : reason} onClick={() => setPruneOpen(true)}>
                  <IconPrune size={15} />
                  {t("header.prune")}
                </ActionButton>
              )}
            </CapabilityGate>
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
          <input className="input" placeholder={t("filter.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
          <span className="spacer" />
          <span className="text-sm muted">
            {t("filter.count", { shown: filtered.length, total: volumes.length })}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : volumes.length === 0 ? (
        // No volumes on the host: open the existing create modal directly
        // (only when the caller may create).
        <div className="card">
          <EmptyState
            icon={<IconVolumes size={40} />}
            title={t("empty.title")}
            message={t("empty.message")}
            action={
              canCreate ? (
                <ActionButton variant="primary" onClick={() => setCreateOpen(true)}>
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
          rowKey={(v) => v.name}
          defaultSortKey="name"
          emptyIcon={<IconVolumes size={40} />}
          emptyTitle={t("empty.title")}
        />
      )}

      <Modal
        open={createOpen}
        title={t("form.title")}
        busy={creating}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setCreateOpen(false)} disabled={creating}>
              {t("form.cancel")}
            </button>
            <ActionButton variant="primary" loading={creating} disabled={!nameOk} onClick={doCreate}>
              {t("form.submit")}
            </ActionButton>
          </>
        }
      >
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <TextField
            label={t("form.nameLabel")}
            mono
            autoFocus
            placeholder={t("form.namePlaceholder")}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            error={createName && !nameOk ? t("form.nameError") : undefined}
          />
          <TextField
            label={t("form.driverLabel")}
            mono
            placeholder={t("form.driverPlaceholder")}
            value={createDriver}
            onChange={(e) => setCreateDriver(e.target.value)}
            hint={t("form.driverHint")}
          />
        </div>
      </Modal>

      <ConfirmDestructiveDialog
        open={pruneOpen}
        title={t("dialog.pruneTitle")}
        variant="danger"
        confirmLabel={t("dialog.pruneConfirm")}
        description={
          <>
            {t("dialog.pruneLead")} <strong>{t("dialog.pruneEvery")}</strong>
            {t("dialog.pruneMid")} <strong>{t("dialog.pruneLost")}</strong>
            {t("dialog.pruneTail")}
          </>
        }
        onConfirm={doPrune}
        onClose={() => setPruneOpen(false)}
      />

      <ConfirmDestructiveDialog
        open={!!removeTarget}
        title={t("dialog.removeTitle")}
        variant="danger"
        confirmLabel={t("dialog.removeConfirm")}
        description={
          <>
            {t("dialog.removeLead")} <strong className="mono">{removeTarget?.name}</strong>
            {t("dialog.removeQuestion")}
          </>
        }
        onConfirm={doRemove}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
