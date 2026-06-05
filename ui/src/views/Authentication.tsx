// ui/src/views/Authentication.tsx
//
// Enterprise SSO admin (superuser-gated): manage external identity providers —
// LDAP/LDAPS directories and OpenID Connect (Microsoft Entra ID). List, add,
// edit, enable/disable, test connectivity, delete; and manage each provider's
// group -> role mappings. Secrets (LDAP bind password, OIDC client secret) are
// sealed server-side and NEVER rendered — the API only reports whether one is
// stored (hasBindPassword / hasClientSecret); the UI shows a "•••• set" pill and
// a three-state password input (type to replace, tick to clear, blank to keep).
//
// Gated by auth.provider.read (view) + auth.provider.write (create/update/
// test/delete + mappings). The backend re-checks every call (admin "*" only).

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAuthProviders, useProviderMappings, useRoles } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { TextField, SelectField } from "../components/Field";
import { StatusDot } from "../components/StatusDot";
import { IconShield, IconPlus, IconTrash, IconRefresh, IconRoles } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import type {
  AuthProvider,
  AuthProviderInput,
  AuthProviderKind,
  LDAPTLSMode,
  RoleRecord,
} from "../lib/types";

const EMPTY: AuthProvider[] = [];
const EMPTY_ROLES: RoleRecord[] = [];

const KIND_LABEL: Record<AuthProviderKind, string> = {
  ldap: "LDAP / LDAPS",
  oidc: "OpenID Connect",
};

const TLS_OPTIONS: { value: LDAPTLSMode; label: string }[] = [
  { value: "ldaps", label: "LDAPS (implicit TLS, port 636)" },
  { value: "starttls", label: "STARTTLS (upgrade on 389)" },
  { value: "none", label: "None (plaintext — lab only)" },
];

export function Authentication() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const providersQ = useAuthProviders();
  const rolesQ = useRoles();

  const canWrite = can("auth.provider.write");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AuthProvider | null>(null);
  const [mappingsTarget, setMappingsTarget] = useState<AuthProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuthProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["authProviders"] });

  const providers = providersQ.data ?? EMPTY;
  const roles = rolesQ.data ?? EMPTY_ROLES;
  const roleName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roles) m.set(r.id, r.name);
    return (id: string) => m.get(id) ?? id;
  }, [roles]);

  const runTest = async (p: AuthProvider) => {
    setTestingId(p.id);
    try {
      const res = await api.authProviderTest(p.id);
      if (res.ok) {
        toast.success(`${p.name}: test OK`, res.sampleUser ? `${res.message} (e.g. ${res.sampleUser})` : res.message);
      } else {
        toast.warning(`${p.name}: test failed`, res.message);
      }
    } catch (err) {
      toastError("Test failed", err);
    } finally {
      setTestingId(null);
    }
  };

  // Enable/disable carries the existing config back through PUT (which requires
  // the full body) and flips `enabled`. Secrets are omitted so the stored values
  // are preserved (three-state: undefined => keep).
  const toggleEnabled = async (p: AuthProvider) => {
    setTogglingId(p.id);
    try {
      await api.authProviderUpdate(p.id, { ...providerToInput(p), enabled: !p.enabled });
      toast.success(p.enabled ? "Provider disabled" : "Provider enabled", p.name);
      invalidate();
    } catch (err) {
      toastError("Update failed", err);
    } finally {
      setTogglingId(null);
    }
  };

  const columns: Column<AuthProvider>[] = [
    {
      key: "name",
      header: "Provider",
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          <span className="mono text-xs muted truncate" style={{ maxWidth: 340, display: "inline-block" }} title={endpointOf(p)}>
            {endpointOf(p)}
          </span>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Type",
      sortValue: (p) => p.kind,
      cell: (p) => <span className="chip">{KIND_LABEL[p.kind]}</span>,
    },
    {
      key: "enabled",
      header: "Status",
      sortValue: (p) => (p.enabled ? 1 : 0),
      cell: (p) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusDot color={p.enabled ? "var(--success)" : "var(--state-stopped)"} />
          <span className="text-sm secondary">{p.enabled ? "Enabled" : "Disabled"}</span>
        </span>
      ),
    },
    {
      key: "secret",
      header: "Secret",
      sortValue: (p) => (secretSet(p) ? 1 : 0),
      cell: (p) =>
        secretSet(p) ? (
          <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
            •••• set
          </span>
        ) : (
          <span className="text-xs muted">none</span>
        ),
    },
    {
      key: "default",
      header: "Default role",
      cell: (p) => (p.defaultRoleId ? <span className="chip text-xs">{roleName(p.defaultRoleId)}</span> : <span className="muted text-sm">none</span>),
    },
    {
      key: "created",
      header: "Added",
      sortValue: (p) => p.createdAt,
      cell: (p) => <span className="text-xs muted nowrap">{timeAgo(p.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "320px",
      cell: (p) => (
        <div className="dt-actions">
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canWrite}
            tooltip={canWrite ? "Group → role mappings" : "Requires auth.provider.write"}
            aria-label="Group role mappings"
            onClick={() => setMappingsTarget(p)}
          >
            <IconRoles size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            loading={testingId === p.id}
            disabled={!canWrite || testingId !== null}
            tooltip={canWrite ? "Test connection" : "Requires auth.provider.write"}
            onClick={() => runTest(p)}
          >
            Test
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            loading={togglingId === p.id}
            disabled={!canWrite || togglingId !== null}
            tooltip={canWrite ? (p.enabled ? "Disable" : "Enable") : "Requires auth.provider.write"}
            onClick={() => toggleEnabled(p)}
          >
            {p.enabled ? "Disable" : "Enable"}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            disabled={!canWrite}
            tooltip={canWrite ? "Edit" : "Requires auth.provider.write"}
            onClick={() => setEditTarget(p)}
          >
            Edit
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canWrite}
            tooltip={canWrite ? "Delete provider" : "Requires auth.provider.write"}
            aria-label="Delete provider"
            onClick={() => setDeleteTarget(p)}
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
        title="Authentication"
        subtitle="External identity providers (LDAP / LDAPS and Microsoft Entra ID via OpenID Connect) for enterprise single sign-on."
        actions={
          <div className="row">
            <ActionButton
              variant="primary"
              disabled={!canWrite}
              tooltip={canWrite ? undefined : "Requires auth.provider.write"}
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus size={15} />
              Add provider
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => providersQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      {providersQ.isLoading ? (
        <LoadingFill label="Loading providers…" />
      ) : (
        <DataTable
          columns={columns}
          rows={providers}
          rowKey={(p) => p.id}
          defaultSortKey="name"
          emptyIcon={<IconShield size={40} />}
          emptyTitle="No identity providers"
          emptyMessage="Add an LDAP directory or a Microsoft Entra ID (OIDC) app to let your team sign in with their corporate accounts."
        />
      )}

      {createOpen ? <ProviderModal roles={roles} onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}
      {editTarget ? <ProviderModal provider={editTarget} roles={roles} onClose={() => setEditTarget(null)} onDone={invalidate} /> : null}
      {mappingsTarget ? (
        <MappingsModal provider={mappingsTarget} roles={roles} canWrite={canWrite} onClose={() => setMappingsTarget(null)} />
      ) : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title="Delete provider"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete provider <strong>{deleteTarget?.name}</strong>, its stored secret and all its group mappings? Users who signed in through it
            keep their accounts but can no longer authenticate via this provider until it is re-added.
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.authProviderDelete(deleteTarget.id);
            toast.success("Provider deleted", deleteTarget.name);
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

/* ------------------------------- helpers -------------------------------- */

function endpointOf(p: AuthProvider): string {
  if (p.kind === "ldap") {
    const scheme = p.ldapTls === "ldaps" ? "ldaps" : "ldap";
    return `${scheme}://${p.ldapHost}:${p.ldapPort}`;
  }
  return p.oidcIssuer;
}

function secretSet(p: AuthProvider): boolean {
  return p.kind === "ldap" ? p.hasBindPassword : p.hasClientSecret;
}

// providerToInput projects a fetched provider back to the write body WITHOUT any
// secret field, so a PUT preserves the stored secrets (three-state: omit => keep).
function providerToInput(p: AuthProvider): AuthProviderInput {
  return {
    name: p.name,
    kind: p.kind,
    enabled: p.enabled,
    defaultRoleId: p.defaultRoleId,
    ldapHost: p.ldapHost,
    ldapPort: p.ldapPort,
    ldapTls: p.ldapTls,
    ldapSkipVerify: p.ldapSkipVerify,
    ldapBindDn: p.ldapBindDn,
    ldapBaseDn: p.ldapBaseDn,
    ldapUserFilter: p.ldapUserFilter,
    ldapAttrUsername: p.ldapAttrUsername,
    ldapAttrEmail: p.ldapAttrEmail,
    ldapAttrDisplay: p.ldapAttrDisplay,
    ldapGroupBaseDn: p.ldapGroupBaseDn,
    ldapGroupFilter: p.ldapGroupFilter,
    ldapAttrMember: p.ldapAttrMember,
    oidcIssuer: p.oidcIssuer,
    oidcClientId: p.oidcClientId,
    oidcRedirectUrl: p.oidcRedirectUrl,
    oidcScopes: p.oidcScopes,
    oidcGroupsClaim: p.oidcGroupsClaim,
    oidcUsernameClaim: p.oidcUsernameClaim,
    oidcEmailClaim: p.oidcEmailClaim,
  };
}

// publicCallbackURL derives the value the admin must register as the redirect URI
// in Entra (the backend default when oidcRedirectUrl is blank).
function publicCallbackURL(): string {
  return `${window.location.origin}/api/v1/auth/oidc/callback`;
}

/* ----------------------------- create/edit ------------------------------ */

function ProviderModal({
  provider,
  roles,
  onClose,
  onDone,
}: {
  provider?: AuthProvider;
  roles: RoleRecord[];
  onClose: () => void;
  onDone: () => void;
}) {
  const editing = !!provider;
  // Kind is immutable after create; default new providers to OIDC (Entra ID).
  const [kind, setKind] = useState<AuthProviderKind>(provider?.kind ?? "oidc");
  const [name, setName] = useState(provider?.name ?? "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [defaultRoleId, setDefaultRoleId] = useState(provider?.defaultRoleId ?? "");

  // LDAP fields (with the backend's defaults for a fresh provider).
  const [ldapHost, setLdapHost] = useState(provider?.ldapHost ?? "");
  const [ldapPort, setLdapPort] = useState<number>(provider?.ldapPort ?? 636);
  const [ldapTls, setLdapTls] = useState<LDAPTLSMode>(provider?.ldapTls ?? "ldaps");
  const [ldapSkipVerify, setLdapSkipVerify] = useState(provider?.ldapSkipVerify ?? false);
  const [ldapBindDn, setLdapBindDn] = useState(provider?.ldapBindDn ?? "");
  const [ldapBaseDn, setLdapBaseDn] = useState(provider?.ldapBaseDn ?? "");
  const [ldapUserFilter, setLdapUserFilter] = useState(provider?.ldapUserFilter ?? "(&(objectClass=person)(sAMAccountName=%s))");
  const [ldapAttrUsername, setLdapAttrUsername] = useState(provider?.ldapAttrUsername ?? "sAMAccountName");
  const [ldapAttrEmail, setLdapAttrEmail] = useState(provider?.ldapAttrEmail ?? "mail");
  const [ldapAttrDisplay, setLdapAttrDisplay] = useState(provider?.ldapAttrDisplay ?? "displayName");
  const [ldapGroupBaseDn, setLdapGroupBaseDn] = useState(provider?.ldapGroupBaseDn ?? "");
  const [ldapGroupFilter, setLdapGroupFilter] = useState(provider?.ldapGroupFilter ?? "(&(objectClass=group)(member=%s))");
  const [ldapAttrMember, setLdapAttrMember] = useState(provider?.ldapAttrMember ?? "memberOf");

  // OIDC fields.
  const [oidcIssuer, setOidcIssuer] = useState(provider?.oidcIssuer ?? "");
  const [oidcClientId, setOidcClientId] = useState(provider?.oidcClientId ?? "");
  const [oidcRedirectUrl, setOidcRedirectUrl] = useState(provider?.oidcRedirectUrl ?? "");
  const [oidcScopes, setOidcScopes] = useState(provider?.oidcScopes ?? "openid profile email");
  const [oidcGroupsClaim, setOidcGroupsClaim] = useState(provider?.oidcGroupsClaim ?? "groups");
  const [oidcUsernameClaim, setOidcUsernameClaim] = useState(provider?.oidcUsernameClaim ?? "preferred_username");
  const [oidcEmailClaim, setOidcEmailClaim] = useState(provider?.oidcEmailClaim ?? "email");

  // Secret (three-state on edit). `secret` typed => replace; clearSecret => clear;
  // blank => keep.
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasStoredSecret = editing && (provider!.kind === "ldap" ? provider!.hasBindPassword : provider!.hasClientSecret);

  const valid =
    name.trim().length > 0 &&
    (kind === "ldap"
      ? ldapHost.trim().length > 0 && ldapBaseDn.trim().length > 0
      : oidcIssuer.trim().length > 0 && oidcClientId.trim().length > 0);

  // Resolve the three-state secret to the request field (undefined => keep).
  const secretField = (): string | undefined => {
    if (secret) return secret;
    if (editing && clearSecret) return "";
    return undefined;
  };

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: AuthProviderInput = {
        name: name.trim(),
        kind,
        enabled,
        defaultRoleId: defaultRoleId.trim(),
        ldapHost: ldapHost.trim(),
        ldapPort: Number(ldapPort) || 0,
        ldapTls,
        ldapSkipVerify,
        ldapBindDn: ldapBindDn.trim(),
        ldapBaseDn: ldapBaseDn.trim(),
        ldapUserFilter: ldapUserFilter.trim(),
        ldapAttrUsername: ldapAttrUsername.trim(),
        ldapAttrEmail: ldapAttrEmail.trim(),
        ldapAttrDisplay: ldapAttrDisplay.trim(),
        ldapGroupBaseDn: ldapGroupBaseDn.trim(),
        ldapGroupFilter: ldapGroupFilter.trim(),
        ldapAttrMember: ldapAttrMember.trim(),
        oidcIssuer: oidcIssuer.trim(),
        oidcClientId: oidcClientId.trim(),
        oidcRedirectUrl: oidcRedirectUrl.trim(),
        oidcScopes: oidcScopes.trim(),
        oidcGroupsClaim: oidcGroupsClaim.trim(),
        oidcUsernameClaim: oidcUsernameClaim.trim(),
        oidcEmailClaim: oidcEmailClaim.trim(),
      };
      const sv = secretField();
      if (kind === "ldap") body.ldapBindPassword = sv;
      else body.oidcClientSecret = sv;

      if (editing) {
        await api.authProviderUpdate(provider!.id, body);
        toast.success("Provider updated", body.name);
      } else {
        await api.authProviderCreate(body);
        toast.success("Provider added", body.name);
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(editing ? "Update failed" : "Create failed", err);
    } finally {
      setBusy(false);
    }
  };

  const secretLabel = kind === "ldap" ? "Bind password" : "Client secret";

  return (
    <Modal
      open
      wide
      title={editing ? `Edit ${provider!.name}` : "Add identity provider"}
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
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <TextField label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} hint="A label shown on the login screen." />
          <SelectField
            label="Type"
            value={kind}
            disabled={editing}
            onChange={(e) => setKind(e.target.value as AuthProviderKind)}
            hint={editing ? "Type cannot be changed after creation." : "OpenID Connect for Microsoft Entra ID; LDAP for Active Directory / OpenLDAP."}
          >
            <option value="oidc">OpenID Connect (Entra ID)</option>
            <option value="ldap">LDAP / LDAPS</option>
          </SelectField>
        </div>

        {kind === "ldap" ? (
          <LDAPFields
            host={ldapHost}
            setHost={setLdapHost}
            port={ldapPort}
            setPort={setLdapPort}
            tls={ldapTls}
            setTls={setLdapTls}
            skipVerify={ldapSkipVerify}
            setSkipVerify={setLdapSkipVerify}
            bindDn={ldapBindDn}
            setBindDn={setLdapBindDn}
            baseDn={ldapBaseDn}
            setBaseDn={setLdapBaseDn}
            userFilter={ldapUserFilter}
            setUserFilter={setLdapUserFilter}
            attrUsername={ldapAttrUsername}
            setAttrUsername={setLdapAttrUsername}
            attrEmail={ldapAttrEmail}
            setAttrEmail={setLdapAttrEmail}
            attrDisplay={ldapAttrDisplay}
            setAttrDisplay={setLdapAttrDisplay}
            groupBaseDn={ldapGroupBaseDn}
            setGroupBaseDn={setLdapGroupBaseDn}
            groupFilter={ldapGroupFilter}
            setGroupFilter={setLdapGroupFilter}
            attrMember={ldapAttrMember}
            setAttrMember={setLdapAttrMember}
          />
        ) : (
          <OIDCFields
            issuer={oidcIssuer}
            setIssuer={setOidcIssuer}
            clientId={oidcClientId}
            setClientId={setOidcClientId}
            redirectUrl={oidcRedirectUrl}
            setRedirectUrl={setOidcRedirectUrl}
            scopes={oidcScopes}
            setScopes={setOidcScopes}
            groupsClaim={oidcGroupsClaim}
            setGroupsClaim={setOidcGroupsClaim}
            usernameClaim={oidcUsernameClaim}
            setUsernameClaim={setOidcUsernameClaim}
            emailClaim={oidcEmailClaim}
            setEmailClaim={setOidcEmailClaim}
          />
        )}

        {/* Shared secret (three-state). */}
        <TextField
          label={secretLabel}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
          placeholder={hasStoredSecret ? "•••• leave blank to keep current" : ""}
          hint={
            hasStoredSecret
              ? "A secret is already stored. Type a new value to replace it."
              : kind === "ldap"
                ? "Password for the service bind DN. Stored encrypted; never displayed again."
                : "The Entra app registration client secret value. Stored encrypted; never displayed again."
          }
        />
        {hasStoredSecret ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={clearSecret} disabled={secret.length > 0} onChange={(e) => setClearSecret(e.target.checked)} />
            <span>Clear the stored {kind === "ldap" ? "bind password" : "client secret"}</span>
          </label>
        ) : null}

        {/* Shared: default role + enabled. */}
        <SelectField
          label="Default role (fallback)"
          value={defaultRoleId}
          onChange={(e) => setDefaultRoleId(e.target.value)}
          hint="Assigned at sign-in when no group mapping matches. Leave as “No default” to grant nothing until an admin does."
        >
          <option value="">No default (deny by default)</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled (show on the login screen and accept sign-ins)</span>
        </label>
      </div>
    </Modal>
  );
}

/* ------------------------------- LDAP form ------------------------------ */

function LDAPFields(p: {
  host: string;
  setHost: (v: string) => void;
  port: number;
  setPort: (v: number) => void;
  tls: LDAPTLSMode;
  setTls: (v: LDAPTLSMode) => void;
  skipVerify: boolean;
  setSkipVerify: (v: boolean) => void;
  bindDn: string;
  setBindDn: (v: string) => void;
  baseDn: string;
  setBaseDn: (v: string) => void;
  userFilter: string;
  setUserFilter: (v: string) => void;
  attrUsername: string;
  setAttrUsername: (v: string) => void;
  attrEmail: string;
  setAttrEmail: (v: string) => void;
  attrDisplay: string;
  setAttrDisplay: (v: string) => void;
  groupBaseDn: string;
  setGroupBaseDn: (v: string) => void;
  groupFilter: string;
  setGroupFilter: (v: string) => void;
  attrMember: string;
  setAttrMember: (v: string) => void;
}) {
  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      <SectionLabel>Connection</SectionLabel>
      <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
        <TextField label="Host" value={p.host} mono onChange={(e) => p.setHost(e.target.value)} placeholder="dc01.corp.example.com" />
        <TextField
          label="Port"
          type="number"
          value={String(p.port)}
          onChange={(e) => p.setPort(parseInt(e.target.value, 10) || 0)}
          hint="636 for LDAPS, 389 otherwise."
        />
      </div>
      <SelectField label="Transport security" value={p.tls} onChange={(e) => p.setTls(e.target.value as LDAPTLSMode)}>
        {TLS_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>
      <label className="checkbox-row">
        <input type="checkbox" checked={p.skipVerify} onChange={(e) => p.setSkipVerify(e.target.checked)} />
        <span>Skip TLS certificate verification (self-signed — not recommended in production)</span>
      </label>

      <SectionLabel>Service account &amp; search</SectionLabel>
      <TextField
        label="Bind DN"
        value={p.bindDn}
        mono
        onChange={(e) => p.setBindDn(e.target.value)}
        placeholder="CN=castor-svc,OU=Service,DC=corp,DC=example,DC=com"
        hint="A read-only service account used to search for users. Leave blank for anonymous bind."
      />
      <TextField
        label="Base DN"
        value={p.baseDn}
        mono
        onChange={(e) => p.setBaseDn(e.target.value)}
        placeholder="DC=corp,DC=example,DC=com"
        hint="Subtree searched for user entries."
      />
      <TextField
        label="User filter"
        value={p.userFilter}
        mono
        onChange={(e) => p.setUserFilter(e.target.value)}
        hint="LDAP filter for the login lookup. %s is replaced with the (escaped) username."
      />
      <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
        <TextField label="Username attribute" value={p.attrUsername} mono onChange={(e) => p.setAttrUsername(e.target.value)} />
        <TextField label="Email attribute" value={p.attrEmail} mono onChange={(e) => p.setAttrEmail(e.target.value)} />
        <TextField label="Display-name attribute" value={p.attrDisplay} mono onChange={(e) => p.setAttrDisplay(e.target.value)} />
      </div>

      <SectionLabel>Group membership</SectionLabel>
      <TextField
        label="Member attribute"
        value={p.attrMember}
        mono
        onChange={(e) => p.setAttrMember(e.target.value)}
        hint="Attribute on the user entry listing their groups (e.g. memberOf). Used when no group base DN is set."
      />
      <TextField
        label="Group base DN (optional)"
        value={p.groupBaseDn}
        mono
        onChange={(e) => p.setGroupBaseDn(e.target.value)}
        placeholder="OU=Groups,DC=corp,DC=example,DC=com"
        hint="Set to resolve groups via a reverse search instead of the member attribute."
      />
      <TextField
        label="Group filter"
        value={p.groupFilter}
        mono
        onChange={(e) => p.setGroupFilter(e.target.value)}
        hint="Filter for the group search. %s is replaced with the user's DN."
      />
    </div>
  );
}

/* ------------------------------- OIDC form ------------------------------ */

function OIDCFields(p: {
  issuer: string;
  setIssuer: (v: string) => void;
  clientId: string;
  setClientId: (v: string) => void;
  redirectUrl: string;
  setRedirectUrl: (v: string) => void;
  scopes: string;
  setScopes: (v: string) => void;
  groupsClaim: string;
  setGroupsClaim: (v: string) => void;
  usernameClaim: string;
  setUsernameClaim: (v: string) => void;
  emailClaim: string;
  setEmailClaim: (v: string) => void;
}) {
  const defaultRedirect = publicCallbackURL();
  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      <SectionLabel>Microsoft Entra ID (OpenID Connect)</SectionLabel>
      <div className="banner info" role="note" style={{ fontSize: "0.85em" }}>
        In the Entra admin center, register an application, add the redirect URI below as a <strong>Web</strong> platform, enable the{" "}
        <strong>ID token</strong> under Authentication, create a <strong>client secret</strong>, and add an optional{" "}
        <strong>groups claim</strong> (Token configuration → groups) so role mappings work. The issuer is{" "}
        <span className="mono">https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0</span>.
      </div>
      <TextField
        label="Issuer"
        value={p.issuer}
        mono
        onChange={(e) => p.setIssuer(e.target.value)}
        placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
        hint="The OIDC issuer URL. Discovery (/.well-known/openid-configuration) is performed automatically."
      />
      <TextField
        label="Client ID"
        value={p.clientId}
        mono
        onChange={(e) => p.setClientId(e.target.value)}
        placeholder="00000000-0000-0000-0000-000000000000"
        hint="The application (client) ID of the Entra app registration."
      />
      <TextField
        label="Redirect URL"
        value={p.redirectUrl}
        mono
        onChange={(e) => p.setRedirectUrl(e.target.value)}
        placeholder={defaultRedirect}
        hint={`Must exactly match a redirect URI registered in Entra. Leave blank to use ${defaultRedirect}`}
      />
      <TextField
        label="Scopes"
        value={p.scopes}
        mono
        onChange={(e) => p.setScopes(e.target.value)}
        hint="Space-separated OAuth scopes. Keep openid; profile/email populate the username and email."
      />
      <SectionLabel>Claim names</SectionLabel>
      <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
        <TextField label="Username claim" value={p.usernameClaim} mono onChange={(e) => p.setUsernameClaim(e.target.value)} />
        <TextField label="Email claim" value={p.emailClaim} mono onChange={(e) => p.setEmailClaim(e.target.value)} />
        <TextField label="Groups claim" value={p.groupsClaim} mono onChange={(e) => p.setGroupsClaim(e.target.value)} />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sm" style={{ fontWeight: 600, marginTop: "var(--sp-1)" }}>
      {children}
    </span>
  );
}

/* --------------------------- group -> role mappings --------------------- */

function MappingsModal({
  provider,
  roles,
  canWrite,
  onClose,
}: {
  provider: AuthProvider;
  roles: RoleRecord[];
  canWrite: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mappingsQ = useProviderMappings(provider.id);
  const [externalGroup, setExternalGroup] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const mappings = mappingsQ.data ?? [];
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["authProviderMappings", provider.id] });

  const add = async () => {
    if (!externalGroup.trim() || !roleId) return;
    setBusy(true);
    try {
      await api.authProviderMappingCreate(provider.id, { externalGroup: externalGroup.trim(), roleId });
      toast.success("Mapping added");
      setExternalGroup("");
      refresh();
    } catch (err) {
      toastError("Add mapping failed", err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (mappingId: string) => {
    setBusy(true);
    try {
      await api.authProviderMappingDelete(provider.id, mappingId);
      toast.success("Mapping removed");
      refresh();
    } catch (err) {
      toastError("Remove mapping failed", err);
    } finally {
      setBusy(false);
    }
  };

  const groupCaption =
    provider.kind === "ldap"
      ? "Match against the LDAP group DN or its CN (e.g. CN=Castor-Admins,OU=Groups,DC=corp,DC=example,DC=com or Castor-Admins). Matching is case-insensitive."
      : "Match against the Entra group's object id (GUID) or its display name as it appears in the token's groups claim. Matching is case-insensitive.";

  return (
    <Modal open wide title={`Group mappings · ${provider.name}`} busy={busy} onClose={onClose} footer={<button className="btn" onClick={onClose}>Done</button>}>
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          At sign-in, the union of the user's external groups is resolved to Castor roles. A user matching no mapping receives the provider's
          default role.
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-sm muted">Current mappings</span>
          {mappingsQ.isLoading ? (
            <LoadingFill label="Loading mappings…" />
          ) : mappings.length === 0 ? (
            <span className="muted text-sm">No group mappings yet.</span>
          ) : (
            <div className="col" style={{ gap: "var(--sp-1)" }}>
              {mappings.map((m) => (
                <div key={m.id} className="row" style={{ justifyContent: "space-between", padding: "var(--sp-1) 0", gap: "var(--sp-2)" }}>
                  <span className="row" style={{ gap: "var(--sp-2)", minWidth: 0 }}>
                    <span className="mono text-sm truncate" style={{ maxWidth: 360, display: "inline-block" }} title={m.externalGroup}>
                      {m.externalGroup}
                    </span>
                    <span className="muted">→</span>
                    <span className="chip">{roleName(m.roleId)}</span>
                  </span>
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label="Remove mapping"
                    tooltip={canWrite ? "Remove mapping" : "Requires auth.provider.write"}
                    disabled={!canWrite}
                    onClick={() => remove(m.id)}
                    style={canWrite ? { color: "var(--danger)" } : undefined}
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
            Add mapping
          </span>
          <TextField
            label="External group"
            value={externalGroup}
            mono
            onChange={(e) => setExternalGroup(e.target.value)}
            placeholder={provider.kind === "ldap" ? "Castor-Admins" : "Castor-Admins or a group GUID"}
            hint={groupCaption}
          />
          <div className="row-wrap" style={{ gap: "var(--sp-3)", alignItems: "flex-end" }}>
            <SelectField label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </SelectField>
            <ActionButton
              variant="primary"
              loading={busy}
              disabled={!canWrite || !externalGroup.trim() || !roleId}
              tooltip={canWrite ? undefined : "Requires auth.provider.write"}
              onClick={add}
            >
              <IconPlus size={14} />
              Add
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
