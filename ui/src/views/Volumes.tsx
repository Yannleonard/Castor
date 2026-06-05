// ui/src/views/Volumes.tsx
//
// Docker volumes: read + admin-gated remove (docker.volume.remove, CapVolumes).
// The /data volume is self-protected server-side (→ 409 protected_resource); the
// UI also disables it proactively.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVolumes, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { ProtectedTag } from "../components/ProtectedTag";
import { IconVolumes, IconTrash, IconRefresh, IconSearch, IconDownload } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import type { DockerVolume } from "../lib/types";

const EMPTY_VOLUMES: DockerVolume[] = [];

// Heuristic for the self-protected data volume name.
function looksProtected(name: string, mountpoint: string): boolean {
  return name === "castor-data" || /\/data(\/|$)/.test(mountpoint);
}

export function Volumes() {
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useVolumes(hostId);
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DockerVolume | null>(null);
  const [backingUp, setBackingUp] = useState<string | null>(null);

  const hasVolumesCap = caps?.includes("volumes");
  const canRemove = hasVolumesCap && can("docker.volume.remove");
  const canBackup = hasVolumesCap && can("docker.volume.backup");
  const volumes = query.data ?? EMPTY_VOLUMES;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return volumes;
    return volumes.filter((v) => `${v.name} ${v.driver} ${v.mountpoint}`.toLowerCase().includes(s));
  }, [volumes, search]);

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await api.volumeRemove(hostId, removeTarget.name);
      toast.success("Volume removed", removeTarget.name);
      queryClient.invalidateQueries({ queryKey: ["volumes", hostId] });
    } catch (err) {
      toastError("Remove failed", err);
      throw err;
    }
  };

  const doBackup = async (v: DockerVolume) => {
    setBackingUp(v.name);
    toast.info("Backing up volume", `${v.name} — this may take a few seconds (a helper container streams the data).`);
    try {
      await api.backupCreate(hostId, { target: v.name });
      toast.success("Backup complete", `${v.name} — available on the Backups page.`);
      queryClient.invalidateQueries({ queryKey: ["backups", hostId] });
    } catch (err) {
      toastError("Backup failed", err);
    } finally {
      setBackingUp(null);
    }
  };

  const columns: Column<DockerVolume>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (v) => v.name,
      cell: (v) => (
        <div className="row" style={{ gap: "var(--sp-2)" }}>
          <span className="mono" style={{ fontWeight: 600 }}>
            {v.name}
          </span>
          {looksProtected(v.name, v.mountpoint) ? <ProtectedTag title="Castor data volume — removal is blocked" /> : null}
        </div>
      ),
    },
    { key: "driver", header: "Driver", sortValue: (v) => v.driver, cell: (v) => <span className="chip">{v.driver}</span> },
    {
      key: "mountpoint",
      header: "Mountpoint",
      sortValue: (v) => v.mountpoint,
      cell: (v) => (
        <span className="mono text-xs muted truncate" style={{ maxWidth: 360, display: "inline-block" }} title={v.mountpoint}>
          {v.mountpoint}
        </span>
      ),
    },
    { key: "created", header: "Created", sortValue: (v) => v.createdAt, cell: (v) => <span className="text-xs muted nowrap">{timeAgo(v.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "96px",
      cell: (v) => {
        const isProtected = looksProtected(v.name, v.mountpoint);
        const removeReason = !hasVolumesCap
          ? "Provider does not manage volumes"
          : isProtected
            ? "Castor data volume is protected"
            : "Requires docker.volume.remove (admin)";
        const backupReason = !hasVolumesCap
          ? "Provider does not manage volumes"
          : "Requires docker.volume.backup";
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
                  tooltip={allowed ? "Back up this volume" : why}
                  aria-label="Back up volume"
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
                  tooltip={allowed ? "Remove volume" : why}
                  aria-label="Remove volume"
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
        title="Volumes"
        subtitle="Docker volumes on this host."
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
          <input className="input" placeholder="Search volumes…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
          <span className="spacer" />
          <span className="text-sm muted">
            {filtered.length} of {volumes.length}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label="Loading volumes…" />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(v) => v.name}
          defaultSortKey="name"
          emptyIcon={<IconVolumes size={40} />}
          emptyTitle="No volumes"
        />
      )}

      <ConfirmDestructiveDialog
        open={!!removeTarget}
        title="Remove volume"
        variant="danger"
        confirmLabel="Remove"
        description={
          <>
            Remove volume <strong className="mono">{removeTarget?.name}</strong>? Data in this volume will be lost permanently.
          </>
        }
        onConfirm={doRemove}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
