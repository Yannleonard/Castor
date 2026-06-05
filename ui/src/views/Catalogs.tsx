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
import type { RemoteCatalog } from "../lib/types";

const EMPTY: RemoteCatalog[] = [];

export function Catalogs() {
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
        toast.warning(`${c.name}: refresh failed`, fresh.lastError);
      } else {
        toast.success(`${c.name} refreshed`, `${fresh.templateCount} template${fresh.templateCount === 1 ? "" : "s"}`);
      }
      invalidate();
    } catch (err) {
      toastError("Refresh failed", err);
    } finally {
      setRefreshingId(null);
    }
  };

  const toggleEnabled = async (c: RemoteCatalog) => {
    setTogglingId(c.id);
    try {
      // PUT requires name + url; carry the row values and flip enabled.
      await api.catalogUpdate(c.id, { name: c.name, url: c.url, enabled: !c.enabled });
      toast.success(c.enabled ? "Catalog disabled" : "Catalog enabled", c.name);
      invalidate();
    } catch (err) {
      toastError("Update failed", err);
    } finally {
      setTogglingId(null);
    }
  };

  const columns: Column<RemoteCatalog>[] = [
    {
      key: "name",
      header: "Name",
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
      header: "Status",
      sortValue: (c) => (c.enabled ? 1 : 0),
      cell: (c) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusDot color={c.enabled ? "var(--success)" : "var(--state-stopped)"} />
          <span className="text-sm secondary">{c.enabled ? "Enabled" : "Disabled"}</span>
        </span>
      ),
    },
    {
      key: "count",
      header: "Templates",
      align: "right",
      sortValue: (c) => c.templateCount,
      cell: (c) => <span className="mono text-sm">{c.templateCount}</span>,
    },
    {
      key: "fetched",
      header: "Last fetched",
      sortValue: (c) => c.lastFetchedAt ?? 0,
      cell: (c) =>
        c.lastError ? (
          <span className="pill" style={{ color: "var(--danger)", background: "var(--danger-bg)", borderColor: "transparent" }} title={c.lastError}>
            error
          </span>
        ) : (
          <span className="text-xs muted nowrap">{c.lastFetchedAt ? timeAgo(c.lastFetchedAt) : "never"}</span>
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
            tooltip={canWrite ? "Re-fetch templates from this catalog" : "Requires marketplace.catalog.write"}
            onClick={() => refresh(c)}
          >
            <IconRefresh size={14} />
            Refresh
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            loading={togglingId === c.id}
            disabled={!canWrite || togglingId !== null}
            tooltip={canWrite ? (c.enabled ? "Disable" : "Enable") : "Requires marketplace.catalog.write"}
            onClick={() => toggleEnabled(c)}
          >
            {c.enabled ? "Disable" : "Enable"}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canWrite}
            tooltip={canWrite ? "Delete catalog" : "Requires marketplace.catalog.write"}
            aria-label="Delete catalog"
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
        title="Catalogs"
        subtitle="Remote catalog sources that import community templates into the Marketplace."
        actions={
          <div className="row">
            <ActionButton
              variant="primary"
              disabled={!canWrite}
              tooltip={canWrite ? undefined : "Requires marketplace.catalog.write"}
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus size={15} />
              Add catalog
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => catalogsQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      {catalogsQ.isLoading ? (
        <LoadingFill label="Loading catalogs…" />
      ) : (
        <DataTable
          columns={columns}
          rows={catalogs}
          rowKey={(c) => c.id}
          defaultSortKey="name"
          emptyIcon={<IconNetworks size={40} />}
          emptyTitle="No catalogs"
          emptyMessage="Add a catalog URL to import community templates into the Marketplace."
        />
      )}

      {createOpen ? <CatalogModal onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title="Delete catalog"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Remove catalog <strong>{deleteTarget?.name}</strong>? Its templates will no longer appear in the Marketplace. Already-deployed
            containers are unaffected.
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.catalogDelete(deleteTarget.id);
            toast.success("Catalog deleted", deleteTarget.name);
            invalidate();
          } catch (err) {
            toastError("Delete failed", err);
            throw err;
          }
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CatalogModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0 && /^https?:\/\//i.test(url.trim());

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.catalogCreate({ name: name.trim(), url: url.trim() });
      toast.success("Catalog added", name.trim());
      onDone();
      onClose();
    } catch (err) {
      toastError("Create failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Add catalog"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Add
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <TextField label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} hint="A label for this source." />
        <TextField
          label="Catalog URL"
          value={url}
          mono
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/templates.json"
          hint="An http(s) URL serving Castor-native or Portainer-style template JSON."
        />
      </div>
    </Modal>
  );
}
