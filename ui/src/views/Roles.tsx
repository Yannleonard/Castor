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
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { PermissionPicker } from "../components/PermissionPicker";
import { TextField, TextAreaField } from "../components/Field";
import { IconRoles, IconPlus, IconTrash, IconRefresh, IconLock } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import type { RoleRecord } from "../lib/types";

export function Roles() {
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

  if (rolesQ.isLoading) return <LoadingFill label="Loading roles…" />;

  const roles = rolesQ.data ?? [];

  const columns: Column<RoleRecord>[] = [
    {
      key: "name",
      header: "Role",
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="col" style={{ gap: 2 }}>
          <span className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{r.name}</span>
            {r.isBuiltin ? (
              <span className="pill" style={{ color: "var(--text-muted)", borderColor: "var(--border-strong)", background: "transparent" }}>
                <IconLock size={11} /> built-in
              </span>
            ) : null}
          </span>
          {r.description ? <span className="text-xs muted">{r.description}</span> : null}
        </div>
      ),
    },
    {
      key: "perms",
      header: "Permissions",
      sortValue: (r) => r.permissions.length,
      cell: (r) =>
        r.permissions.includes("*") ? (
          <span className="pill" style={{ color: "var(--warm)", borderColor: "var(--warm)", background: "transparent" }}>
            superuser (*)
          </span>
        ) : (
          <span className="row-wrap" style={{ gap: 4 }}>
            {r.permissions.slice(0, 4).map((p) => (
              <span key={p} className="chip text-xs mono">
                {p}
              </span>
            ))}
            {r.permissions.length > 4 ? <span className="text-xs muted">+{r.permissions.length - 4} more</span> : null}
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
            {r.isBuiltin || !canUpdate ? "View" : "Edit"}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={r.isBuiltin || !canDelete}
            tooltip={r.isBuiltin ? "Built-in roles cannot be deleted" : canDelete ? "Delete role" : "Requires rbac.role.delete"}
            aria-label="Delete role"
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
        title="Roles"
        subtitle="Permission bundles assigned to users. Built-in roles are immutable."
        actions={
          <div className="row">
            <ActionButton variant="primary" disabled={!canCreate} tooltip={canCreate ? undefined : "Requires rbac.role.create"} onClick={() => setEditTarget("new")}>
              <IconPlus size={15} />
              New role
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => rolesQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <DataTable columns={columns} rows={roles} rowKey={(r) => r.id} defaultSortKey="name" emptyIcon={<IconRoles size={40} />} emptyTitle="No roles" />

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
        title="Delete role"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete role <strong>{deleteTarget?.name}</strong>? Users bound to it lose those permissions.
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.roleDelete(deleteTarget.id);
            toast.success("Role deleted", deleteTarget.name);
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
        toast.success("Role created", name.trim());
      } else if (role) {
        await api.roleUpdate(role.id, { name: name.trim(), description: description.trim() || undefined, permissions });
        toast.success("Role updated", name.trim());
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(isNew ? "Create failed" : "Update failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      busy={busy}
      title={isNew ? "New role" : readOnly ? `Role: ${role?.name}` : `Edit role: ${role?.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly ? (
            <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
              {isNew ? "Create role" : "Save changes"}
            </ActionButton>
          ) : null}
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        {readOnly && role?.isBuiltin ? (
          <div className="banner info">
            <IconLock size={14} />
            <span>This is a built-in role and cannot be modified.</span>
          </div>
        ) : null}
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <div style={{ flex: "1 1 200px" }}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} mono />
          </div>
        </div>
        <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} />
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-sm" style={{ fontWeight: 600 }}>
            Permissions <span className="muted">({selected.has("*") ? "all" : selected.size})</span>
          </span>
          <PermissionPicker catalog={catalog} selected={selected} onToggle={toggle} disabled={readOnly} />
        </div>
      </div>
    </Modal>
  );
}
