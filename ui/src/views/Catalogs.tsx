// Castor by IT Leonard
// ui/src/views/Catalogs.tsx
//
// Marketplace admin: remote template catalogs. Register external catalog URLs
// (Castor-native or Portainer-ish JSON); their templates are fetched on demand
// and merged into the Marketplace as source="remote:<name>". List, add, refresh
// (re-fetch + record template count / last error), toggle enabled, and delete.
//
// Gated by marketplace.catalog.read (view) + marketplace.catalog.write
// (create/update/refresh/delete). Backend re-checks every call.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCatalogs } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { HelpButton } from "../components/HelpButton";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { TextField } from "../components/Field";
import { StatusDot } from "../components/StatusDot";
import { IconNetworks, IconPlus, IconTrash, IconRefresh } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import { useT } from "../i18n";
import { catalogsDict } from "../i18n/locales/catalogs";
import { commonDict } from "../i18n/locales/common";
import type { RemoteCatalog } from "../lib/types";

const EMPTY: RemoteCatalog[] = [];

export function Catalogs() {
  const t = useT(catalogsDict);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const catalogsQ = useCatalogs();

  const canWrite = can("marketplace.catalog.write");

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RemoteCatalog | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["catalogs"] });

  const catalogs = catalogsQ.data ?? EMPTY;

  const refresh = async (c: RemoteCatalog) => {
    setRefreshingId(c.id);
    try {
      const fresh = await api.catalogRefresh(c.id);
      if (fresh.lastError) {
        toast.warning(t("toast.refreshFailedTitle", { name: c.name }), fresh.lastError);
      } else {
        const count = fresh.templateCount;
        toast.success(
          t("toast.refreshedTitle", { name: c.name }),
          count === 1 ? t("toast.refreshedOne", { count }) : t("toast.refreshedMany", { count }),
        );
      }
      invalidate();
    } catch (err) {
      toastError(t("toast.refreshFailed"), err);
    } finally {
      setRefreshingId(null);
    }
  };

  const toggleEnabled = async (c: RemoteCatalog) => {
    setTogglingId(c.id);
    try {
      // PUT requires name + url; carry the row values and flip enabled.
      await api.catalogUpdate(c.id, { name: c.name, url: c.url, enabled: !c.enabled });
      toast.success(c.enabled ? t("toast.disabledTitle") : t("toast.enabledTitle"), c.name);
      invalidate();
    } catch (err) {
      toastError(t("toast.updateFailed"), err);
    } finally {
      setTogglingId(null);
    }
  };

  const columns: Column<RemoteCatalog>[] = [
    {
      key: "name",
      header: t("col.name"),
      sortValue: (c) => c.name,
      cell: (c) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{c.name}</span>
          <span className="mono text-xs muted truncate" style={{ maxWidth: 380, display: "inline-block" }} title={c.url}>
            {c.url}
          </span>
        </div>
      ),
    },
    {
      key: "enabled",
      header: t("col.status"),
      sortValue: (c) => (c.enabled ? 1 : 0),
      cell: (c) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusDot color={c.enabled ? "var(--success)" : "var(--state-stopped)"} />
          <span className="text-sm secondary">{c.enabled ? t("badge.enabled") : t("badge.disabled")}</span>
        </span>
      ),
    },
    {
      key: "count",
      header: t("col.templates"),
      align: "right",
      sortValue: (c) => c.templateCount,
      cell: (c) => <span className="mono text-sm">{c.templateCount}</span>,
    },
    {
      key: "fetched",
      header: t("col.lastFetched"),
      sortValue: (c) => c.lastFetchedAt ?? 0,
      cell: (c) =>
        c.lastError ? (
          <span className="pill" style={{ color: "var(--danger)", background: "var(--danger-bg)", borderColor: "transparent" }} title={c.lastError}>
            {t("badge.error")}
          </span>
        ) : (
          <span className="text-xs muted nowrap">{c.lastFetchedAt ? timeAgo(c.lastFetchedAt) : t("badge.never")}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "260px",
      cell: (c) => (
        <div className="dt-actions">
          <ActionButton
            size="sm"
            variant="ghost"
            loading={refreshingId === c.id}
            disabled={!canWrite || refreshingId !== null}
            tooltip={canWrite ? t("action.refreshTip") : t("header.requiresWrite")}
            onClick={() => refresh(c)}
          >
            <IconRefresh size={14} />
            {t("action.refresh")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            loading={togglingId === c.id}
            disabled={!canWrite || togglingId !== null}
            tooltip={canWrite ? (c.enabled ? t("action.disable") : t("action.enable")) : t("header.requiresWrite")}
            onClick={() => toggleEnabled(c)}
          >
            {c.enabled ? t("action.disable") : t("action.enable")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canWrite}
            tooltip={canWrite ? t("action.delete") : t("header.requiresWrite")}
            aria-label={t("action.delete")}
            onClick={() => setDeleteTarget(c)}
            style={canWrite ? { color: "var(--danger)" } : undefined}
          >
            <IconTrash size={15} />
          </ActionButton>
        </div>
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
            <ActionButton
              variant="primary"
              disabled={!canWrite}
              tooltip={canWrite ? undefined : t("header.requiresWrite")}
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus size={15} />
              {t("header.add")}
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => catalogsQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="registries" />
          </div>
        }
      />

      {catalogsQ.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : (
        <DataTable
          columns={columns}
          rows={catalogs}
          rowKey={(c) => c.id}
          defaultSortKey="name"
          emptyIcon={<IconNetworks size={40} />}
          emptyTitle={t("empty.title")}
          emptyMessage={t("empty.message")}
        />
      )}

      {createOpen ? <CatalogModal onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title={t("dialog.deleteTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteLead")} <strong>{deleteTarget?.name}</strong>
            {t("dialog.deleteBody")}
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.catalogDelete(deleteTarget.id);
            toast.success(t("toast.deletedTitle"), deleteTarget.name);
            invalidate();
          } catch (err) {
            toastError(t("toast.deleteFailed"), err);
            throw err;
          }
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CatalogModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT(catalogsDict);
  const tc = useT(commonDict);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0 && /^https?:\/\//i.test(url.trim());

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.catalogCreate({ name: name.trim(), url: url.trim() });
      toast.success(t("toast.addedTitle"), name.trim());
      onDone();
      onClose();
    } catch (err) {
      toastError(t("toast.createFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t("form.addTitle")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {tc("cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("form.add")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <TextField label={t("form.nameLabel")} autoFocus value={name} onChange={(e) => setName(e.target.value)} hint={t("form.nameHint")} />
        <TextField
          label={t("form.urlLabel")}
          value={url}
          mono
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/templates.json"
          hint={t("form.urlHint")}
        />
      </div>
    </Modal>
  );
}
