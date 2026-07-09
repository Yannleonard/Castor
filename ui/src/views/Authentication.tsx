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
import { HelpButton } from "../components/HelpButton";
import { IconShield, IconPlus, IconTrash, IconRefresh, IconRoles } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo } from "../lib/format";
import { useT } from "../i18n";
import { authenticationDict } from "../i18n/locales/authentication";
import type {
  AuthProvider,
  AuthProviderInput,
  AuthProviderKind,
  LDAPTLSMode,
  RoleRecord,
} from "../lib/types";

const EMPTY: AuthProvider[] = [];
const EMPTY_ROLES: RoleRecord[] = [];

// authenticationDict key for each provider kind's display label.
const KIND_LABEL_KEY: Record<AuthProviderKind, string> = {
  ldap: "kind.ldap",
  oidc: "kind.oidc",
};

// TLS transport options: technical `value` (sent to the API, never translated)
// paired with the authenticationDict key for its display label.
const TLS_OPTIONS: { value: LDAPTLSMode; labelKey: string }[] = [
  { value: "ldaps", labelKey: "tls.ldaps" },
  { value: "starttls", labelKey: "tls.starttls" },
  { value: "none", labelKey: "tls.none" },
];

export function Authentication() {
  const t = useT(authenticationDict);
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
        toast.success(
          t("toast.testOk", { name: p.name }),
          res.sampleUser ? t("toast.testOkSample", { message: res.message, sample: res.sampleUser }) : res.message,
        );
      } else {
        toast.warning(t("toast.testFailed", { name: p.name }), res.message);
      }
    } catch (err) {
      toastError(t("toast.testFailedTitle"), err);
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
      toast.success(p.enabled ? t("toast.disabledTitle") : t("toast.enabledTitle"), p.name);
      invalidate();
    } catch (err) {
      toastError(t("toast.updateFailed"), err);
    } finally {
      setTogglingId(null);
    }
  };

  const columns: Column<AuthProvider>[] = [
    {
      key: "name",
      header: t("col.provider"),
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
      header: t("col.type"),
      sortValue: (p) => p.kind,
      cell: (p) => <span className="chip">{t(KIND_LABEL_KEY[p.kind])}</span>,
    },
    {
      key: "enabled",
      header: t("col.status"),
      sortValue: (p) => (p.enabled ? 1 : 0),
      cell: (p) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusDot color={p.enabled ? "var(--success)" : "var(--state-stopped)"} />
          <span className="text-sm secondary">{p.enabled ? t("status.enabled") : t("status.disabled")}</span>
        </span>
      ),
    },
    {
      key: "secret",
      header: t("col.secret"),
      sortValue: (p) => (secretSet(p) ? 1 : 0),
      cell: (p) =>
        secretSet(p) ? (
          <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
            {t("secret.set")}
          </span>
        ) : (
          <span className="text-xs muted">{t("secret.none")}</span>
        ),
    },
    {
      key: "default",
      header: t("col.defaultRole"),
      cell: (p) => (p.defaultRoleId ? <span className="chip text-xs">{roleName(p.defaultRoleId)}</span> : <span className="muted text-sm">{t("role.none")}</span>),
    },
    {
      key: "created",
      header: t("col.added"),
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
            tooltip={canWrite ? t("action.mappings") : t("action.requiresWrite")}
            aria-label={t("action.mappingsAria")}
            onClick={() => setMappingsTarget(p)}
          >
            <IconRoles size={15} />
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            loading={testingId === p.id}
            disabled={!canWrite || testingId !== null}
            tooltip={canWrite ? t("action.testTooltip") : t("action.requiresWrite")}
            onClick={() => runTest(p)}
          >
            {t("action.test")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            loading={togglingId === p.id}
            disabled={!canWrite || togglingId !== null}
            tooltip={canWrite ? (p.enabled ? t("action.disable") : t("action.enable")) : t("action.requiresWrite")}
            onClick={() => toggleEnabled(p)}
          >
            {p.enabled ? t("action.disable") : t("action.enable")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            disabled={!canWrite}
            tooltip={canWrite ? t("action.edit") : t("action.requiresWrite")}
            onClick={() => setEditTarget(p)}
          >
            {t("action.edit")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canWrite}
            tooltip={canWrite ? t("action.delete") : t("action.requiresWrite")}
            aria-label={t("action.deleteAria")}
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
              {t("header.addProvider")}
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => providersQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="authentication" />
          </div>
        }
      />

      {providersQ.isLoading ? (
        <LoadingFill label={t("header.loading")} />
      ) : (
        <DataTable
          columns={columns}
          rows={providers}
          rowKey={(p) => p.id}
          defaultSortKey="name"
          emptyIcon={<IconShield size={40} />}
          emptyTitle={t("empty.title")}
          emptyMessage={t("empty.message")}
        />
      )}

      {createOpen ? <ProviderModal roles={roles} onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}
      {editTarget ? <ProviderModal provider={editTarget} roles={roles} onClose={() => setEditTarget(null)} onDone={invalidate} /> : null}
      {mappingsTarget ? (
        <MappingsModal provider={mappingsTarget} roles={roles} canWrite={canWrite} onClose={() => setMappingsTarget(null)} />
      ) : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title={t("delete.title")}
        variant="danger"
        confirmLabel={t("delete.confirm")}
        description={
          <>
            {t("delete.descBefore")} <strong>{deleteTarget?.name}</strong>
            {t("delete.descAfter")}
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.authProviderDelete(deleteTarget.id);
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
  const t = useT(authenticationDict);
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
        toast.success(t("toast.updatedTitle"), body.name);
      } else {
        await api.authProviderCreate(body);
        toast.success(t("toast.addedTitle"), body.name);
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(editing ? t("toast.updateFailed") : t("toast.createFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  const secretLabel = kind === "ldap" ? t("secret.labelBind") : t("secret.labelClient");

  return (
    <Modal
      open
      wide
      title={editing ? t("form.editTitle", { name: provider!.name }) : t("form.addTitle")}
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
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <TextField label={t("form.name")} autoFocus value={name} onChange={(e) => setName(e.target.value)} hint={t("form.nameHint")} />
          <SelectField
            label={t("form.type")}
            value={kind}
            disabled={editing}
            onChange={(e) => setKind(e.target.value as AuthProviderKind)}
            hint={editing ? t("form.typeHintEditing") : t("form.typeHintNew")}
          >
            <option value="oidc">{t("form.typeOidc")}</option>
            <option value="ldap">{t("form.typeLdap")}</option>
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
          placeholder={hasStoredSecret ? t("secret.placeholderKeep") : ""}
          hint={
            hasStoredSecret
              ? t("secret.hintStored")
              : kind === "ldap"
                ? t("secret.hintBind")
                : t("secret.hintClient")
          }
        />
        {hasStoredSecret ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={clearSecret} disabled={secret.length > 0} onChange={(e) => setClearSecret(e.target.checked)} />
            <span>{kind === "ldap" ? t("secret.clearBind") : t("secret.clearClient")}</span>
          </label>
        ) : null}

        {/* Shared: default role + enabled. */}
        <SelectField
          label={t("form.defaultRole")}
          value={defaultRoleId}
          onChange={(e) => setDefaultRoleId(e.target.value)}
          hint={t("form.defaultRoleHint")}
        >
          <option value="">{t("form.defaultRoleNone")}</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{t("form.enabled")}</span>
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
  const t = useT(authenticationDict);
  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      <SectionLabel>{t("ldap.section.connection")}</SectionLabel>
      <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
        <TextField label={t("ldap.host")} value={p.host} mono onChange={(e) => p.setHost(e.target.value)} placeholder="dc01.corp.example.com" />
        <TextField
          label={t("ldap.port")}
          type="number"
          value={String(p.port)}
          onChange={(e) => p.setPort(parseInt(e.target.value, 10) || 0)}
          hint={t("ldap.portHint")}
        />
      </div>
      <SelectField label={t("ldap.transport")} value={p.tls} onChange={(e) => p.setTls(e.target.value as LDAPTLSMode)}>
        {TLS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </option>
        ))}
      </SelectField>
      <label className="checkbox-row">
        <input type="checkbox" checked={p.skipVerify} onChange={(e) => p.setSkipVerify(e.target.checked)} />
        <span>{t("ldap.skipVerify")}</span>
      </label>

      <SectionLabel>{t("ldap.section.service")}</SectionLabel>
      <TextField
        label={t("ldap.bindDn")}
        value={p.bindDn}
        mono
        onChange={(e) => p.setBindDn(e.target.value)}
        placeholder="CN=castor-svc,OU=Service,DC=corp,DC=example,DC=com"
        hint={t("ldap.bindDnHint")}
      />
      <TextField
        label={t("ldap.baseDn")}
        value={p.baseDn}
        mono
        onChange={(e) => p.setBaseDn(e.target.value)}
        placeholder="DC=corp,DC=example,DC=com"
        hint={t("ldap.baseDnHint")}
      />
      <TextField
        label={t("ldap.userFilter")}
        value={p.userFilter}
        mono
        onChange={(e) => p.setUserFilter(e.target.value)}
        hint={t("ldap.userFilterHint")}
      />
      <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
        <TextField label={t("ldap.attrUsername")} value={p.attrUsername} mono onChange={(e) => p.setAttrUsername(e.target.value)} />
        <TextField label={t("ldap.attrEmail")} value={p.attrEmail} mono onChange={(e) => p.setAttrEmail(e.target.value)} />
        <TextField label={t("ldap.attrDisplay")} value={p.attrDisplay} mono onChange={(e) => p.setAttrDisplay(e.target.value)} />
      </div>

      <SectionLabel>{t("ldap.section.group")}</SectionLabel>
      <TextField
        label={t("ldap.attrMember")}
        value={p.attrMember}
        mono
        onChange={(e) => p.setAttrMember(e.target.value)}
        hint={t("ldap.attrMemberHint")}
      />
      <TextField
        label={t("ldap.groupBaseDn")}
        value={p.groupBaseDn}
        mono
        onChange={(e) => p.setGroupBaseDn(e.target.value)}
        placeholder="OU=Groups,DC=corp,DC=example,DC=com"
        hint={t("ldap.groupBaseDnHint")}
      />
      <TextField
        label={t("ldap.groupFilter")}
        value={p.groupFilter}
        mono
        onChange={(e) => p.setGroupFilter(e.target.value)}
        hint={t("ldap.groupFilterHint")}
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
  const t = useT(authenticationDict);
  const defaultRedirect = publicCallbackURL();
  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      <SectionLabel>{t("oidc.section.entra")}</SectionLabel>
      <div className="banner info" role="note" style={{ fontSize: "0.85em" }}>
        {t("oidc.banner.p1")} <strong>{t("oidc.banner.web")}</strong> {t("oidc.banner.p2")}{" "}
        <strong>{t("oidc.banner.idToken")}</strong> {t("oidc.banner.p3")} <strong>{t("oidc.banner.clientSecret")}</strong>{t("oidc.banner.p4")}{" "}
        <strong>{t("oidc.banner.groupsClaim")}</strong> {t("oidc.banner.p5")}{" "}
        <span className="mono">https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0</span>.
      </div>
      <TextField
        label={t("oidc.issuer")}
        value={p.issuer}
        mono
        onChange={(e) => p.setIssuer(e.target.value)}
        placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
        hint={t("oidc.issuerHint")}
      />
      <TextField
        label={t("oidc.clientId")}
        value={p.clientId}
        mono
        onChange={(e) => p.setClientId(e.target.value)}
        placeholder="00000000-0000-0000-0000-000000000000"
        hint={t("oidc.clientIdHint")}
      />
      <TextField
        label={t("oidc.redirectUrl")}
        value={p.redirectUrl}
        mono
        onChange={(e) => p.setRedirectUrl(e.target.value)}
        placeholder={defaultRedirect}
        hint={t("oidc.redirectUrlHint", { url: defaultRedirect })}
      />
      <TextField
        label={t("oidc.scopes")}
        value={p.scopes}
        mono
        onChange={(e) => p.setScopes(e.target.value)}
        hint={t("oidc.scopesHint")}
      />
      <SectionLabel>{t("oidc.section.claims")}</SectionLabel>
      <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
        <TextField label={t("oidc.usernameClaim")} value={p.usernameClaim} mono onChange={(e) => p.setUsernameClaim(e.target.value)} />
        <TextField label={t("oidc.emailClaim")} value={p.emailClaim} mono onChange={(e) => p.setEmailClaim(e.target.value)} />
        <TextField label={t("oidc.groupsClaim")} value={p.groupsClaim} mono onChange={(e) => p.setGroupsClaim(e.target.value)} />
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
  const t = useT(authenticationDict);
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
      toast.success(t("toast.mappingAdded"));
      setExternalGroup("");
      refresh();
    } catch (err) {
      toastError(t("toast.mappingAddFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (mappingId: string) => {
    setBusy(true);
    try {
      await api.authProviderMappingDelete(provider.id, mappingId);
      toast.success(t("toast.mappingRemoved"));
      refresh();
    } catch (err) {
      toastError(t("toast.mappingRemoveFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  const groupCaption = provider.kind === "ldap" ? t("mappings.captionLdap") : t("mappings.captionOidc");

  return (
    <Modal open wide title={t("mappings.title", { name: provider.name })} busy={busy} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t("mappings.done")}</button>}>
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("mappings.intro")}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-sm muted">{t("mappings.current")}</span>
          {mappingsQ.isLoading ? (
            <LoadingFill label={t("mappings.loading")} />
          ) : mappings.length === 0 ? (
            <span className="muted text-sm">{t("mappings.empty")}</span>
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
                    aria-label={t("mappings.removeAria")}
                    tooltip={canWrite ? t("mappings.removeTooltip") : t("action.requiresWrite")}
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
            {t("mappings.addTitle")}
          </span>
          <TextField
            label={t("mappings.externalGroup")}
            value={externalGroup}
            mono
            onChange={(e) => setExternalGroup(e.target.value)}
            placeholder={provider.kind === "ldap" ? "Castor-Admins" : t("mappings.externalGroupPlaceholderOidc")}
            hint={groupCaption}
          />
          <div className="row-wrap" style={{ gap: "var(--sp-3)", alignItems: "flex-end" }}>
            <SelectField label={t("mappings.role")} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
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
              tooltip={canWrite ? undefined : t("action.requiresWrite")}
              onClick={add}
            >
              <IconPlus size={14} />
              {t("mappings.add")}
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
