// ui/src/views/Networks.tsx
//
// Docker networks: read + gated writes. Create opens a modal (name validated
// client-side; backend re-validates). Delete is admin-gated
// (docker.network.delete, CapNetworks); prune is gated by docker.system.prune.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useNetworks, useCapabilityLookup } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { LoadingFill } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { HelpButton } from "../components/HelpButton";
import { TextField, SelectField } from "../components/Field";
import { IconNetworks, IconPlus, IconPrune, IconTrash, IconRefresh, IconSearch } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { formatBytes, shortId } from "../lib/format";
import { useT, t as tr } from "../i18n";
import { networksDict } from "../i18n/locales/networks";
import { commonDict } from "../i18n/locales/common";
import type { DockerNetwork } from "../lib/types";

const SYSTEM_NETWORKS = new Set(["bridge", "host", "none"]);
const EMPTY_NETWORKS: DockerNetwork[] = [];

const NETWORK_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const NETWORK_DRIVERS = ["bridge", "overlay", "macvlan", "ipvlan"];

export function Networks() {
  const t = useT(networksDict);
  const tc = useT(commonDict);
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("docker");

  const query = useNetworks(hostId);
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DockerNetwork | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDriver, setCreateDriver] = useState("bridge");
  const [createInternal, setCreateInternal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pruneOpen, setPruneOpen] = useState(false);

  const canCreate = caps?.includes("networks") && can("docker.network.create");
  const canDelete = caps?.includes("networks") && can("docker.network.delete");
  const canPrune = can("docker.system.prune");
  const networks = query.data ?? EMPTY_NETWORKS;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return networks;
    return networks.filter((n) => `${n.name} ${n.driver} ${n.id}`.toLowerCase().includes(s));
  }, [networks, search]);

  const nameOk = NETWORK_NAME_RE.test(createName.trim());

  const doCreate = async () => {
    if (!nameOk) return;
    const name = createName.trim();
    setCreating(true);
    try {
      await api.networkCreate(hostId, { name, driver: createDriver, internal: createInternal });
      toast.success(tr(networksDict, "toast.createdTitle"), name);
      setCreateOpen(false);
      setCreateName("");
      setCreateDriver("bridge");
      setCreateInternal(false);
      queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
    } catch (err) {
      toastError(tr(networksDict, "toast.createFailed"), err);
    } finally {
      setCreating(false);
    }
  };

  const doPrune = async () => {
    try {
      const res = await api.prune(hostId, { target: "networks" });
      toast.success(
        tr(networksDict, "toast.prunedTitle", { count: res.removed.length }),
        tr(networksDict, "toast.prunedBody", { size: formatBytes(res.spaceReclaimed) }),
      );
      queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
    } catch (err) {
      toastError(tr(networksDict, "toast.pruneFailed"), err);
      throw err;
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await api.networkDelete(hostId, removeTarget.id);
      toast.success(tr(networksDict, "toast.removedTitle"), removeTarget.name);
      queryClient.invalidateQueries({ queryKey: ["networks", hostId] });
    } catch (err) {
      toastError(tr(networksDict, "toast.removeFailed"), err);
      throw err;
    }
  };

  const columns: Column<DockerNetwork>[] = [
    {
      key: "name",
      header: t("col.name"),
      sortValue: (n) => n.name,
      cell: (n) => (
        <div className="row" style={{ gap: "var(--sp-2)" }}>
          <span style={{ fontWeight: 600 }}>{n.name}</span>
          {SYSTEM_NETWORKS.has(n.name) ? <span className="chip text-xs">{t("badge.system")}</span> : null}
        </div>
      ),
    },
    { key: "id", header: t("col.id"), sortValue: (n) => n.id, cell: (n) => <span className="mono text-xs muted">{shortId(n.id)}</span> },
    { key: "driver", header: t("col.driver"), sortValue: (n) => n.driver, cell: (n) => <span className="chip">{n.driver}</span> },
    { key: "scope", header: t("col.scope"), sortValue: (n) => n.scope, cell: (n) => <span className="text-sm secondary">{n.scope}</span> },
    {
      key: "internal",
      header: t("col.internal"),
      sortValue: (n) => (n.internal ? 1 : 0),
      cell: (n) => (n.internal ? <span className="pill" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>{t("badge.internal")}</span> : <span className="muted">—</span>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "60px",
      cell: (n) => {
        const isSystem = SYSTEM_NETWORKS.has(n.name);
        const reason = !caps?.includes("networks")
          ? t("gate.noNetworks")
          : isSystem
            ? t("gate.systemNetwork")
            : t("gate.needDelete");
        return (
          <CapabilityGate allowed={!!canDelete && !isSystem} reason={reason}>
            {(allowed, why) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.remove") : why}
                aria-label={t("action.remove")}
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
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <CapabilityGate
              allowed={!!canCreate}
              reason={!caps?.includes("networks") ? t("gate.noNetworks") : t("gate.needCreate")}
            >
              {(allowed, reason) => (
                <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateOpen(true)}>
                  <IconPlus size={15} />
                  {t("header.create")}
                </ActionButton>
              )}
            </CapabilityGate>
            <CapabilityGate allowed={!!canPrune} reason={t("gate.needPrune")}>
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
            <HelpButton topic="networks" />
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
            {t("filter.count", { shown: filtered.length, total: networks.length })}
          </span>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : networks.length === 0 ? (
        // No networks visible on the host: open the existing create modal
        // directly (only when the caller may create).
        <div className="card">
          <EmptyState
            icon={<IconNetworks size={40} />}
            title={t("empty.title")}
            message={t("empty.message")}
            action={
              canCreate ? (
                <ActionButton variant="primary" onClick={() => setCreateOpen(true)}>
                  <IconPlus size={15} />
                  {t("empty.create")}
                </ActionButton>
              ) : undefined
            }
          />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(n) => n.id}
          defaultSortKey="name"
          emptyIcon={<IconNetworks size={40} />}
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
              {tc("cancel")}
            </button>
            <ActionButton variant="primary" loading={creating} disabled={!nameOk} onClick={doCreate}>
              {t("form.create")}
            </ActionButton>
          </>
        }
      >
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <TextField
            label={t("form.name")}
            mono
            autoFocus
            placeholder={t("form.namePlaceholder")}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            error={createName && !nameOk ? t("form.nameError") : undefined}
          />
          <SelectField label={t("form.driver")} value={createDriver} onChange={(e) => setCreateDriver(e.target.value)}>
            {NETWORK_DRIVERS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectField>
          <label className="checkbox-row">
            <input type="checkbox" checked={createInternal} onChange={(e) => setCreateInternal(e.target.checked)} />
            <span>{t("form.internal")}</span>
          </label>
        </div>
      </Modal>

      <ConfirmDestructiveDialog
        open={pruneOpen}
        title={t("dialog.pruneTitle")}
        variant="danger"
        confirmLabel={t("dialog.pruneConfirm")}
        description={<>{t("dialog.pruneDescription")}</>}
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
            {t("dialog.removeQuestion")} <strong className="mono">{removeTarget?.name}</strong>{t("dialog.removeHint")}
          </>
        }
        onConfirm={doRemove}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
