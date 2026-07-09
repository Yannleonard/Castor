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
import { HelpButton } from "../components/HelpButton";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { TextField, SelectField } from "../components/Field";
import { IconImages, IconPlus, IconTrash, IconRefresh } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import { useT } from "../i18n";
import { registriesDict } from "../i18n/locales/registries";
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
  const t = useT(registriesDict);
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
        toast.success(t("toast.loginOkTitle", { name: rg.name }), res.message);
      } else {
        toast.warning(t("toast.loginFailedTitle", { name: rg.name }), res.message);
      }
    } catch (err) {
      toastError(t("toast.testFailed"), err);
    } finally {
      setTestingId(null);
    }
  };

  const columns: Column<Registry>[] = [
    {
      key: "name",
      header: t("col.name"),
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
      header: t("col.type"),
      sortValue: (rg) => rg.type,
      cell: (rg) => <span className="chip">{TYPE_LABEL[rg.type] ?? rg.type}</span>,
    },
    {
      key: "username",
      header: t("col.username"),
      sortValue: (rg) => rg.username,
      cell: (rg) => (rg.username ? <span className="mono text-sm">{rg.username}</span> : <span className="muted text-sm">—</span>),
    },
    {
      key: "secret",
      header: t("col.credential"),
      sortValue: (rg) => (rg.hasSecret ? 1 : 0),
      cell: (rg) =>
        rg.hasSecret ? (
          <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
            {t("badge.secretSet")}
          </span>
        ) : (
          <span className="text-xs muted">{t("badge.secretNone")}</span>
        ),
    },
    {
      key: "created",
      header: t("col.added"),
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
            tooltip={canWrite ? t("action.testTooltip") : t("action.requiresWrite")}
            onClick={() => runTest(rg)}
          >
            {t("action.test")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            disabled={!canWrite}
            tooltip={canWrite ? t("action.editTooltip") : t("action.requiresWrite")}
            onClick={() => setEditTarget(rg)}
          >
            {t("action.edit")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canWrite}
            tooltip={canWrite ? t("action.delete") : t("action.requiresWrite")}
            aria-label={t("action.delete")}
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
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <ActionButton
              variant="primary"
              disabled={!canWrite}
              tooltip={canWrite ? undefined : t("action.requiresWrite")}
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus size={15} />
              {t("header.add")}
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => registriesQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="registries" />
          </div>
        }
      />

      {registriesQ.isLoading ? (
        <LoadingFill label={t("list.loading")} />
      ) : (
        <DataTable
          columns={columns}
          rows={registries}
          rowKey={(rg) => rg.id}
          defaultSortKey="name"
          emptyIcon={<IconImages size={40} />}
          emptyTitle={t("empty.title")}
          emptyMessage={t("empty.message")}
        />
      )}

      {createOpen ? <RegistryModal onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}
      {editTarget ? <RegistryModal registry={editTarget} onClose={() => setEditTarget(null)} onDone={invalidate} /> : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title={t("dialog.deleteTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deletePrefix")}
            <strong>{deleteTarget?.name}</strong>
            {t("dialog.deleteSuffix")}
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.registryDelete(deleteTarget.id);
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

function RegistryModal({
  registry,
  onClose,
  onDone,
}: {
  registry?: Registry;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT(registriesDict);
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
        toast.success(t("toast.updatedTitle"), base.name);
      } else {
        if (secret) base.secret = secret;
        await api.registryCreate(base);
        toast.success(t("toast.addedTitle"), base.name);
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(editing ? t("toast.updateFailed") : t("toast.createFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  const urlHint =
    type === "ghcr"
      ? t("form.urlHintGhcr")
      : type === "quay"
        ? t("form.urlHintQuay")
        : type === "dockerhub"
          ? t("form.urlHintDockerhub")
          : t("form.urlHintCustom");

  return (
    <Modal
      open
      title={editing ? t("form.editTitle", { name: registry!.name }) : t("form.addTitle")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("form.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {editing ? t("form.save") : t("form.add")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <TextField label={t("form.nameLabel")} autoFocus value={name} onChange={(e) => setName(e.target.value)} hint={t("form.nameHint")} />
        <SelectField label={t("form.typeLabel")} value={type} onChange={(e) => setType(e.target.value as RegistryType)}>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </SelectField>
        <TextField label={t("form.urlLabel")} value={url} mono onChange={(e) => setUrl(e.target.value)} hint={urlHint} placeholder={t("form.urlPlaceholder")} />
        <TextField label={t("form.usernameLabel")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        <TextField
          label={t("form.secretLabel")}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
          placeholder={editing && registry?.hasSecret ? t("form.secretPlaceholderKeep") : ""}
          hint={editing && registry?.hasSecret ? t("form.secretHintReplace") : t("form.secretHintNew")}
        />
        {editing && registry?.hasSecret ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={clearSecret} disabled={secret.length > 0} onChange={(e) => setClearSecret(e.target.checked)} />
            <span>{t("form.clearSecret")}</span>
          </label>
        ) : null}
        <TextField label={t("form.emailLabel")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
    </Modal>
  );
}
