// ui/src/views/Roles.tsx
//
// Role editor (admin). Lists roles with permission counts; create/edit/delete
// custom roles using the permission catalog. Built-in roles (admin/operator/
// viewer) are immutable → the editor opens read-only and delete is disabled
// (backend returns 409 conflict otherwise).

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRoles, usePermissions } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { HelpButton } from "../components/HelpButton";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { PermissionPicker } from "../components/PermissionPicker";
import { TextField, TextAreaField } from "../components/Field";
import { IconRoles, IconPlus, IconTrash, IconRefresh, IconLock } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { useT } from "../i18n";
import { rolesDict } from "../i18n/locales/roles";
import type { RoleRecord } from "../lib/types";

export function Roles() {
  const t = useT(rolesDict);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const rolesQ = useRoles();
  const permsQ = usePermissions();

  const canCreate = can("rbac.role.create");
  const canUpdate = can("rbac.role.update");
  const canDelete = can("rbac.role.delete");

  const [editTarget, setEditTarget] = useState<RoleRecord | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRecord | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["roles"] });

  if (rolesQ.isLoading) return <LoadingFill label={t("list.loading")} />;

  const roles = rolesQ.data ?? [];

  const columns: Column<RoleRecord>[] = [
    {
      key: "name",
      header: t("col.role"),
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="col" style={{ gap: 2 }}>
          <span className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{r.name}</span>
            {r.isBuiltin ? (
              <span className="pill" style={{ color: "var(--text-muted)", borderColor: "var(--border-strong)", background: "transparent" }}>
                <IconLock size={11} /> {t("badge.builtin")}
              </span>
            ) : null}
          </span>
          {r.description ? <span className="text-xs muted">{r.description}</span> : null}
        </div>
      ),
    },
    {
      key: "perms",
      header: t("col.permissions"),
      sortValue: (r) => r.permissions.length,
      cell: (r) =>
        r.permissions.includes("*") ? (
          <span className="pill" style={{ color: "var(--warm)", borderColor: "var(--warm)", background: "transparent" }}>
            {t("badge.superuser")}
          </span>
        ) : (
          <span className="row-wrap" style={{ gap: 4 }}>
            {r.permissions.slice(0, 4).map((p) => (
              <span key={p} className="chip text-xs mono">
                {p}
              </span>
            ))}
            {r.permissions.length > 4 ? <span className="text-xs muted">{t("list.morePerms", { count: r.permissions.length - 4 })}</span> : null}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "150px",
      cell: (r) => (
        <div className="dt-actions">
          <ActionButton size="sm" variant="ghost" onClick={() => setEditTarget(r)}>
            {r.isBuiltin || !canUpdate ? t("action.view") : t("action.edit")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={r.isBuiltin || !canDelete}
            tooltip={r.isBuiltin ? t("action.deleteBuiltin") : canDelete ? t("action.delete") : t("action.deleteDenied")}
            aria-label={t("action.deleteAria")}
            onClick={() => setDeleteTarget(r)}
            style={!r.isBuiltin && canDelete ? { color: "var(--danger)" } : undefined}
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
            <ActionButton variant="primary" disabled={!canCreate} tooltip={canCreate ? undefined : t("header.newRoleDenied")} onClick={() => setEditTarget("new")}>
              <IconPlus size={15} />
              {t("header.newRole")}
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => rolesQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="rbac" />
          </div>
        }
      />

      <DataTable columns={columns} rows={roles} rowKey={(r) => r.id} defaultSortKey="name" emptyIcon={<IconRoles size={40} />} emptyTitle={t("empty.title")} />

      {editTarget ? (
        <RoleEditor
          role={editTarget === "new" ? null : editTarget}
          catalog={permsQ.data ?? []}
          canEdit={editTarget === "new" ? canCreate : canUpdate}
          onClose={() => setEditTarget(null)}
          onDone={invalidate}
        />
      ) : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title={t("dialog.deleteTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteDescBefore")}
            <strong>{deleteTarget?.name}</strong>
            {t("dialog.deleteDescAfter")}
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.roleDelete(deleteTarget.id);
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

function RoleEditor({
  role,
  catalog,
  canEdit,
  onClose,
  onDone,
}: {
  role: RoleRecord | null;
  catalog: string[];
  canEdit: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT(rolesDict);
  const isNew = role === null;
  const readOnly = !canEdit || (role?.isBuiltin ?? false);

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(new Set(role?.permissions ?? []));
  }, [role]);

  const toggle = (perm: string) => {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  const valid = name.trim().length >= 2 && selected.size > 0;

  const submit = async () => {
    if (!valid || readOnly) return;
    setBusy(true);
    const permissions = Array.from(selected);
    try {
      if (isNew) {
        await api.roleCreate({ name: name.trim(), description: description.trim() || undefined, permissions });
        toast.success(t("toast.createdTitle"), name.trim());
      } else if (role) {
        await api.roleUpdate(role.id, { name: name.trim(), description: description.trim() || undefined, permissions });
        toast.success(t("toast.updatedTitle"), name.trim());
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(isNew ? t("toast.createFailed") : t("toast.updateFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      busy={busy}
      title={isNew ? t("editor.titleNew") : readOnly ? t("editor.titleView", { name: role?.name ?? "" }) : t("editor.titleEdit", { name: role?.name ?? "" })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {readOnly ? t("editor.close") : t("editor.cancel")}
          </button>
          {!readOnly ? (
            <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
              {isNew ? t("editor.createRole") : t("editor.saveChanges")}
            </ActionButton>
          ) : null}
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        {readOnly && role?.isBuiltin ? (
          <div className="banner info">
            <IconLock size={14} />
            <span>{t("editor.builtinBanner")}</span>
          </div>
        ) : null}
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <div style={{ flex: "1 1 200px" }}>
            <TextField label={t("editor.name")} value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} mono />
          </div>
        </div>
        <TextAreaField label={t("editor.description")} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} />
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-sm" style={{ fontWeight: 600 }}>
            {t("editor.permissions")} <span className="muted">({selected.has("*") ? t("editor.permsAll") : selected.size})</span>
          </span>
          <PermissionPicker catalog={catalog} selected={selected} onToggle={toggle} disabled={readOnly} />
        </div>
      </div>
    </Modal>
  );
}
