// ui/src/views/Users.tsx
//
// RBAC user management (admin). List users with roles, create users, toggle
// active / edit email, manage role bindings, delete users. Password hashes and
// TOTP secrets are never present in the API payloads.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUsers, useRoles } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { TextField, SelectField } from "../components/Field";
import { StatusDot } from "../components/StatusDot";
import { IconUsers, IconPlus, IconTrash, IconRefresh, IconRoles, IconShield } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import type { UserRecord } from "../lib/types";

export function Users() {
  const queryClient = useQueryClient();
  const { can, user: me } = useAuth();
  const usersQ = useUsers();
  const rolesQ = useRoles();

  const canCreate = can("rbac.user.create");
  const canUpdate = can("rbac.user.update");
  const canDelete = can("rbac.user.delete");
  const canBind = can("rbac.binding.create");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRecord | null>(null);
  const [rolesTarget, setRolesTarget] = useState<UserRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  if (usersQ.isLoading) return <LoadingFill label="Loading users…" />;

  const users = usersQ.data ?? [];

  const columns: Column<UserRecord>[] = [
    {
      key: "username",
      header: "User",
      sortValue: (u) => u.username,
      cell: (u) => (
        <div className="col" style={{ gap: 2 }}>
          <span className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{u.username}</span>
            {u.id === me?.id ? <span className="chip text-xs">you</span> : null}
          </span>
          {u.email ? <span className="text-xs muted">{u.email}</span> : null}
        </div>
      ),
    },
    {
      key: "active",
      header: "Status",
      sortValue: (u) => (u.isActive ? 1 : 0),
      cell: (u) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusDot color={u.isActive ? "var(--success)" : "var(--state-stopped)"} />
          <span className="text-sm secondary">{u.isActive ? "Active" : "Disabled"}</span>
        </span>
      ),
    },
    {
      key: "totp",
      header: "2FA",
      sortValue: (u) => (u.totpEnabled ? 1 : 0),
      cell: (u) =>
        u.totpEnabled ? (
          <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
            <IconShield size={12} /> enabled
          </span>
        ) : (
          <span className="text-xs muted">off</span>
        ),
    },
    {
      key: "roles",
      header: "Roles",
      cell: (u) => (
        <div className="row-wrap" style={{ gap: 4 }}>
          {u.roles.length ? (
            u.roles.map((r) => (
              <span key={r.roleId + r.scopeType + (r.scopeId ?? "")} className="chip text-xs" title={`${r.scopeType}${r.scopeId ? `:${r.scopeId}` : ""}`}>
                {r.roleName}
                {r.scopeType !== "global" ? <span className="muted"> · {r.scopeType}</span> : null}
              </span>
            ))
          ) : (
            <span className="muted text-sm">none</span>
          )}
        </div>
      ),
    },
    { key: "last", header: "Last login", sortValue: (u) => u.lastLoginAt ?? "", cell: (u) => <span className="text-xs muted nowrap">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "150px",
      cell: (u) => (
        <div className="dt-actions">
          <ActionButton size="sm" variant="ghost" iconOnly tooltip={canBind ? "Manage roles" : "Requires rbac.binding.create"} disabled={!canBind} aria-label="Manage roles" onClick={() => setRolesTarget(u)}>
            <IconRoles size={15} />
          </ActionButton>
          <ActionButton size="sm" variant="ghost" disabled={!canUpdate} tooltip={canUpdate ? "Edit" : "Requires rbac.user.update"} onClick={() => setEditTarget(u)}>
            Edit
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canDelete || u.id === me?.id}
            tooltip={u.id === me?.id ? "You cannot delete yourself" : canDelete ? "Delete user" : "Requires rbac.user.delete"}
            aria-label="Delete user"
            onClick={() => setDeleteTarget(u)}
            style={canDelete && u.id !== me?.id ? { color: "var(--danger)" } : undefined}
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
        title="Users"
        subtitle="Local accounts and their role bindings."
        actions={
          <div className="row">
            <ActionButton variant="primary" disabled={!canCreate} tooltip={canCreate ? undefined : "Requires rbac.user.create"} onClick={() => setCreateOpen(true)}>
              <IconPlus size={15} />
              New user
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => usersQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <DataTable columns={columns} rows={users} rowKey={(u) => u.id} defaultSortKey="username" emptyIcon={<IconUsers size={40} />} emptyTitle="No users" />

      {createOpen ? <CreateUserModal onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}
      {editTarget ? <EditUserModal user={editTarget} onClose={() => setEditTarget(null)} onDone={invalidate} /> : null}
      {rolesTarget ? (
        <RolesModal user={rolesTarget} roleOptions={rolesQ.data ?? []} onClose={() => setRolesTarget(null)} onDone={invalidate} />
      ) : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title="Delete user"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Permanently delete <strong>{deleteTarget?.username}</strong> and revoke all their sessions?
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.userDelete(deleteTarget.id);
            toast.success("User deleted", deleteTarget.username);
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

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);

  const valid = username.trim().length >= 3 && password.length >= 10;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.userCreate({ username: username.trim(), email: email.trim() || undefined, password, mustChangePassword: mustChange });
      toast.success("User created", username.trim());
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
      title="Create user"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Create
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <TextField label="Username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} hint="At least 3 characters." />
        <TextField label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Temporary password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters." />
        <label className="checkbox-row">
          <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
          <span>Require password change at next login</span>
        </label>
      </div>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onDone }: { user: UserRecord; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(user.email ?? "");
  const [isActive, setIsActive] = useState(user.isActive);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.userUpdate(user.id, { email: email.trim(), isActive });
      toast.success("User updated", user.username);
      onDone();
      onClose();
    } catch (err) {
      toastError("Update failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Edit ${user.username}`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} onClick={submit}>
            Save
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Account active</span>
        </label>
      </div>
    </Modal>
  );
}

function RolesModal({
  user,
  roleOptions,
  onClose,
  onDone,
}: {
  user: UserRecord;
  roleOptions: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [roleId, setRoleId] = useState(roleOptions[0]?.id ?? "");
  const [scopeType, setScopeType] = useState<"global" | "host" | "cluster">("global");
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
    onDone();
  };

  const addRole = async () => {
    if (!roleId) return;
    setBusy(true);
    try {
      await api.userAddRole(user.id, { roleId, scopeType, scopeId: null });
      toast.success("Role added");
      refresh();
    } catch (err) {
      toastError("Add role failed", err);
    } finally {
      setBusy(false);
    }
  };

  const removeBinding = async (bindingId: string) => {
    setBusy(true);
    try {
      await api.userRemoveRole(user.id, bindingId);
      toast.success("Role removed");
      refresh();
    } catch (err) {
      toastError("Remove role failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Roles · ${user.username}`} busy={busy} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Done</button>}>
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-sm muted">Current bindings</span>
          {user.roles.length === 0 ? (
            <span className="muted text-sm">No roles assigned.</span>
          ) : (
            <div className="col" style={{ gap: "var(--sp-1)" }}>
              {user.roles.map((r) => (
                <div key={r.roleId + r.scopeType + (r.scopeId ?? "")} className="row" style={{ justifyContent: "space-between", padding: "var(--sp-1) 0" }}>
                  <span className="row" style={{ gap: "var(--sp-2)" }}>
                    <span className="chip">{r.roleName}</span>
                    <span className="text-xs muted">
                      {r.scopeType}
                      {r.scopeId ? `:${r.scopeId}` : ""}
                    </span>
                  </span>
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label="Remove role"
                    tooltip="Remove binding"
                    onClick={() => removeBinding(r.bindingId)}
                    style={{ color: "var(--danger)" }}
                  >
                    <IconTrash size={14} />
                  </ActionButton>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad col" style={{ gap: "var(--sp-3)" }}>
          <span className="text-sm" style={{ fontWeight: 600 }}>
            Add role
          </span>
          <div className="row-wrap" style={{ gap: "var(--sp-3)", alignItems: "flex-end" }}>
            <SelectField label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roleOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Scope" value={scopeType} onChange={(e) => setScopeType(e.target.value as "global" | "host" | "cluster")}>
              <option value="global">Global</option>
              <option value="host">Host</option>
              <option value="cluster">Cluster</option>
            </SelectField>
            <ActionButton variant="primary" loading={busy} disabled={!roleId} onClick={addRole}>
              <IconPlus size={14} />
              Add
            </ActionButton>
          </div>
          <span className="field-hint">Scope id targeting is reserved for V2 multi-host; V1 scopes apply to the local instance.</span>
        </div>
      </div>
    </Modal>
  );
}
