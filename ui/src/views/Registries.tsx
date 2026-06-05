// ui/src/views/Registries.tsx
//
// Marketplace admin: image registry credentials (private/public pull auth).
// List registries, add/edit (with a password-input secret), test the login via
// the Docker daemon, and delete. Secrets are NEVER rendered — the API only
// reports whether one is set (hasSecret); the UI shows a "•••• set" pill.
//
// Gated by marketplace.registry.read (view) + marketplace.registry.write
// (create/update/delete/test). Backend re-checks every call.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRegistries } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { TextField, SelectField } from "../components/Field";
import { IconImages, IconPlus, IconTrash, IconRefresh } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import type { Registry, RegistryInput, RegistryType } from "../lib/types";

const EMPTY: Registry[] = [];

const TYPE_OPTIONS: { value: RegistryType; label: string }[] = [
  { value: "dockerhub", label: "Docker Hub" },
  { value: "ghcr", label: "GitHub (ghcr.io)" },
  { value: "gitlab", label: "GitLab" },
  { value: "quay", label: "Quay (quay.io)" },
  { value: "ecr", label: "Amazon ECR" },
  { value: "custom", label: "Custom" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]));

export function Registries() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const registriesQ = useRegistries();

  const canWrite = can("marketplace.registry.write");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Registry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Registry | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["registries"] });

  const registries = registriesQ.data ?? EMPTY;

  const runTest = async (rg: Registry) => {
    setTestingId(rg.id);
    try {
      const res = await api.registryTest(rg.id);
      if (res.ok) {
        toast.success(`${rg.name}: login OK`, res.message);
      } else {
        toast.warning(`${rg.name}: login failed`, res.message);
      }
    } catch (err) {
      toastError("Test failed", err);
    } finally {
      setTestingId(null);
    }
  };

  const columns: Column<Registry>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (rg) => rg.name,
      cell: (rg) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{rg.name}</span>
          {rg.url ? (
            <span className="mono text-xs muted truncate" style={{ maxWidth: 320, display: "inline-block" }} title={rg.url}>
              {rg.url}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (rg) => rg.type,
      cell: (rg) => <span className="chip">{TYPE_LABEL[rg.type] ?? rg.type}</span>,
    },
    {
      key: "username",
      header: "Username",
      sortValue: (rg) => rg.username,
      cell: (rg) => (rg.username ? <span className="mono text-sm">{rg.username}</span> : <span className="muted text-sm">—</span>),
    },
    {
      key: "secret",
      header: "Credential",
      sortValue: (rg) => (rg.hasSecret ? 1 : 0),
      cell: (rg) =>
        rg.hasSecret ? (
          <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
            •••• set
          </span>
        ) : (
          <span className="text-xs muted">none</span>
        ),
    },
    {
      key: "created",
      header: "Added",
      sortValue: (rg) => rg.createdAt,
      cell: (rg) => <span className="text-xs muted nowrap">{timeAgo(rg.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "210px",
      cell: (rg) => (
        <div className="dt-actions">
          <ActionButton
            size="sm"
            variant="ghost"
            loading={testingId === rg.id}
            disabled={!canWrite || testingId !== null}
            tooltip={canWrite ? "Test login against the registry" : "Requires marketplace.registry.write"}
            onClick={() => runTest(rg)}
          >
            Test
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            disabled={!canWrite}
            tooltip={canWrite ? "Edit" : "Requires marketplace.registry.write"}
            onClick={() => setEditTarget(rg)}
          >
            Edit
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canWrite}
            tooltip={canWrite ? "Delete registry" : "Requires marketplace.registry.write"}
            aria-label="Delete registry"
            onClick={() => setDeleteTarget(rg)}
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
        title="Registries"
        subtitle="Image registry credentials used to pull private (and rate-limited public) images."
        actions={
          <div className="row">
            <ActionButton
              variant="primary"
              disabled={!canWrite}
              tooltip={canWrite ? undefined : "Requires marketplace.registry.write"}
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus size={15} />
              Add registry
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => registriesQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      {registriesQ.isLoading ? (
        <LoadingFill label="Loading registries…" />
      ) : (
        <DataTable
          columns={columns}
          rows={registries}
          rowKey={(rg) => rg.id}
          defaultSortKey="name"
          emptyIcon={<IconImages size={40} />}
          emptyTitle="No registries"
          emptyMessage="Add a registry to pull images that need authentication."
        />
      )}

      {createOpen ? <RegistryModal onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}
      {editTarget ? <RegistryModal registry={editTarget} onClose={() => setEditTarget(null)} onDone={invalidate} /> : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title="Delete registry"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete registry <strong>{deleteTarget?.name}</strong> and its stored credential? Pulls that rely on it will fail until re-added.
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.registryDelete(deleteTarget.id);
            toast.success("Registry deleted", deleteTarget.name);
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

function RegistryModal({
  registry,
  onClose,
  onDone,
}: {
  registry?: Registry;
  onClose: () => void;
  onDone: () => void;
}) {
  const editing = !!registry;
  const [name, setName] = useState(registry?.name ?? "");
  const [type, setType] = useState<RegistryType>(registry?.type ?? "dockerhub");
  const [url, setUrl] = useState(registry?.url ?? "");
  const [username, setUsername] = useState(registry?.username ?? "");
  const [email, setEmail] = useState(registry?.email ?? "");
  const [secret, setSecret] = useState("");
  // When editing a registry that already has a secret, the blank field means
  // "keep". Operators can tick this to clear the stored credential instead.
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const base: RegistryInput = {
        name: name.trim(),
        type,
        url: url.trim(),
        username: username.trim(),
        email: email.trim(),
      };
      if (editing) {
        // Three-state secret on update: a typed value replaces it; "clear" sends
        // ""; otherwise omit the field to preserve the stored credential.
        if (secret) base.secret = secret;
        else if (clearSecret) base.secret = "";
        await api.registryUpdate(registry!.id, base);
        toast.success("Registry updated", base.name);
      } else {
        if (secret) base.secret = secret;
        await api.registryCreate(base);
        toast.success("Registry added", base.name);
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(editing ? "Update failed" : "Create failed", err);
    } finally {
      setBusy(false);
    }
  };

  const urlHint =
    type === "ghcr"
      ? "Defaults to ghcr.io when blank."
      : type === "quay"
        ? "Defaults to quay.io when blank."
        : type === "dockerhub"
          ? "Leave blank for Docker Hub (the daemon default)."
          : "Registry host, e.g. registry.gitlab.com or registry.example.com.";

  return (
    <Modal
      open
      title={editing ? `Edit ${registry!.name}` : "Add registry"}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {editing ? "Save" : "Add"}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <TextField label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} hint="A label for this credential." />
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as RegistryType)}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextField label="URL (optional)" value={url} mono onChange={(e) => setUrl(e.target.value)} hint={urlHint} placeholder="registry.example.com" />
        <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        <TextField
          label="Password / token"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
          placeholder={editing && registry?.hasSecret ? "•••• leave blank to keep current" : ""}
          hint={editing && registry?.hasSecret ? "A credential is already stored. Type a new value to replace it." : "Stored encrypted; never displayed again."}
        />
        {editing && registry?.hasSecret ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={clearSecret} disabled={secret.length > 0} onChange={(e) => setClearSecret(e.target.checked)} />
            <span>Clear the stored credential</span>
          </label>
        ) : null}
        <TextField label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
    </Modal>
  );
}
