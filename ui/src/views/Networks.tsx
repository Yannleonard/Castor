// ui/src/views/Networks.tsx
//
// Docker networks: read + admin-gated delete (docker.network.delete, CapNetworks).

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useNetworks, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { IconNetworks, IconTrash, IconRefresh, IconSearch } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { shortId } from "../lib/format";
import type { DockerNetwork } from "../lib/types";

const SYSTEM_NETWORKS = new Set(["bridge", "host", "none"]);
const EMPTY_NETWORKS: DockerNetwork[] = [];

export function Networks() {
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useNetworks(hostId);
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DockerNetwork | null>(null);

  const canDelete = caps?.includes("networks") && can("docker.network.delete");
  const networks = query.data ?? EMPTY_NETWORKS;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return networks;
    return networks.filter((n) => `${n.name} ${n.driver} ${n.id}`.toLowerCase().includes(s));
  }, [networks, search]);

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await api.networkDelete(hostId, removeTarget.id);
      toast.success("Network removed", removeTarget.name);
      queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
    } catch (err) {
      toastError("Remove failed", err);
      throw err;
    }
  };

  const columns: Column<DockerNetwork>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (n) => n.name,
      cell: (n) => (
        <div className="row" style={{ gap: "var(--sp-2)" }}>
          <span style={{ fontWeight: 600 }}>{n.name}</span>
          {SYSTEM_NETWORKS.has(n.name) ? <span className="chip text-xs">system</span> : null}
        </div>
      ),
    },
    { key: "id", header: "ID", sortValue: (n) => n.id, cell: (n) => <span className="mono text-xs muted">{shortId(n.id)}</span> },
    { key: "driver", header: "Driver", sortValue: (n) => n.driver, cell: (n) => <span className="chip">{n.driver}</span> },
    { key: "scope", header: "Scope", sortValue: (n) => n.scope, cell: (n) => <span className="text-sm secondary">{n.scope}</span> },
    {
      key: "internal",
      header: "Internal",
      sortValue: (n) => (n.internal ? 1 : 0),
      cell: (n) => (n.internal ? <span className="pill" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>internal</span> : <span className="muted">—</span>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "60px",
      cell: (n) => {
        const isSystem = SYSTEM_NETWORKS.has(n.name);
        const reason = !caps?.includes("networks")
          ? "Provider does not manage networks"
          : isSystem
            ? "System networks cannot be removed"
            : "Requires docker.network.delete (admin)";
        return (
          <CapabilityGate allowed={!!canDelete && !isSystem} reason={reason}>
            {(allowed, why) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? "Remove network" : why}
                aria-label="Remove network"
                onClick={() => setRemoveTarget(n)}
                style={allowed ? { color: "var(--danger)" } : undefined}
              >
                <IconTrash size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Networks"
        subtitle="Docker networks on this host."
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
          <input className="input" placeholder="Search networks…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
          <span className="spacer" />
          <span className="text-sm muted">
            {filtered.length} of {networks.length}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label="Loading networks…" />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(n) => n.id}
          defaultSortKey="name"
          emptyIcon={<IconNetworks size={40} />}
          emptyTitle="No networks"
        />
      )}

      <ConfirmDestructiveDialog
        open={!!removeTarget}
        title="Remove network"
        variant="danger"
        confirmLabel="Remove"
        description={
          <>
            Remove network <strong className="mono">{removeTarget?.name}</strong>? Containers must be detached first.
          </>
        }
        onConfirm={doRemove}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
