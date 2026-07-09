// ui/src/views/Profile.tsx
//
// Self-service profile: change password (revokes other sessions), enroll TOTP
// (QR + secret → confirm → one-time recovery codes), disable TOTP, and manage
// personal API tokens. The TOTP enrollment flow follows the contract:
//   enroll → {secret, otpauthUrl, qrPngBase64}
//   confirm(code) → {recoveryCodes:[...x10]} (shown once)
//   disable(password)
// API tokens mirror the same "shown once" contract: the raw token appears only
// in the creation response; the list carries metadata (prefix, dates) only.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAPITokens, qk } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { HelpButton } from "../components/HelpButton";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { TextField, SelectField } from "../components/Field";
import { DataTable, type Column } from "../components/DataTable";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { IconShield, IconCopy, IconCheck, IconDownload, IconPlus, IconTerminal } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { timeAgo, formatDateTime } from "../lib/format";
import type { TotpEnrollResponse, APIToken, CreateTokenResponse } from "../lib/types";

export function Profile() {
  const { user, refresh, amr } = useAuth();

  return (
    <div className="page">
      <PageHeader title="Profile & security" subtitle="Manage your password and two-factor authentication." actions={<HelpButton topic="profile" />} />

      <div className="card">
        <div className="card-header">
          <span className="card-title">Account</span>
        </div>
        <div className="card-body">
          <dl className="dl">
            <dt>Username</dt>
            <dd>{user?.username}</dd>
            <dt>Email</dt>
            <dd>{user?.email || "—"}</dd>
            <dt>Assurance level</dt>
            <dd>
              <span className="pill" style={{ color: "var(--accent)", borderColor: "var(--accent)", background: "transparent" }}>
                {amr ?? "pwd"}
              </span>
            </dd>
            <dt>Two-factor</dt>
            <dd>
              {user?.totpEnabled ? (
                <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
                  <IconShield size={12} /> enabled
                </span>
              ) : (
                <span className="text-sm muted">not configured</span>
              )}
            </dd>
          </dl>
        </div>
      </div>

      <ChangePasswordCard />

      <TotpCard enabled={!!user?.totpEnabled} onChanged={refresh} />

      <APITokensCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = current.length > 0 && next.length >= 10 && next === confirm;

  const submit = async () => {
    if (!valid) return;
    setError("");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast.success("Password changed", "Other sessions were signed out.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError(err.message || "Password does not meet the policy.");
      else if (err instanceof ApiError && err.status === 401) setError("Current password is incorrect.");
      else {
        toastError("Password change failed", err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Change password</span>
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-3)", maxWidth: 440 }}>
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="At least 10 characters." />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && next !== confirm ? "Passwords do not match." : undefined}
        />
        {error ? <div className="banner danger">{error}</div> : null}
        <div className="row">
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Update password
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function TotpCard({ enabled, onChanged }: { enabled: boolean; onChanged: () => Promise<unknown> }) {
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Two-factor authentication</span>
        {enabled ? (
          <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
            <IconShield size={12} /> active
          </span>
        ) : null}
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-3)", maxWidth: 540 }}>
        <span className="text-sm secondary">
          {enabled
            ? "An authenticator app is protecting your account. You can disable it if you no longer need it."
            : "Add a time-based one-time password (TOTP) from an authenticator app for stronger protection."}
        </span>
        <div className="row">
          {enabled ? (
            <ActionButton variant="danger" onClick={() => setDisableOpen(true)}>
              Disable 2FA
            </ActionButton>
          ) : (
            <ActionButton variant="primary" onClick={() => setEnrollOpen(true)}>
              <IconShield size={15} />
              Enable 2FA
            </ActionButton>
          )}
        </div>
      </div>

      {enrollOpen ? <EnrollModal onClose={() => setEnrollOpen(false)} onDone={onChanged} /> : null}
      {disableOpen ? <DisableModal onClose={() => setDisableOpen(false)} onDone={onChanged} /> : null}
    </div>
  );
}

function EnrollModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [step, setStep] = useState<"loading" | "scan" | "codes">("loading");
  const [enroll, setEnroll] = useState<TotpEnrollResponse | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // start enrollment on mount
  useEffect(() => {
    let alive = true;
    api
      .totpEnroll()
      .then((e) => {
        if (!alive) return;
        setEnroll(e);
        setStep("scan");
      })
      .catch((err) => {
        if (!alive) return;
        toastError("Could not start enrollment", err);
        onClose();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    if (code.trim().length < 6) return;
    setError("");
    setBusy(true);
    try {
      const res = await api.totpConfirm(code.trim());
      setRecovery(res.recoveryCodes);
      setStep("codes");
      await onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("That code did not match. Try the current code.");
      else setError(err instanceof Error ? err.message : "Confirmation failed.");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!enroll) return;
    await navigator.clipboard.writeText(enroll.secret).catch(() => {});
    toast.success("Secret copied");
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(recovery.join("\n")).catch(() => {});
    toast.success("Recovery codes copied");
  };

  const downloadCodes = () => {
    const blob = new Blob([recovery.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "castor-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open
      title={step === "codes" ? "Save your recovery codes" : "Enable two-factor authentication"}
      busy={busy || step === "loading"}
      // Recovery codes are shown exactly once — an accidental Escape/scrim
      // click at that step would lose them, so only the footer action closes.
      dismissable={step !== "codes"}
      onClose={onClose}
      footer={
        step === "scan" ? (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <ActionButton variant="primary" loading={busy} disabled={code.trim().length < 6} onClick={confirm}>
              Confirm
            </ActionButton>
          </>
        ) : step === "codes" ? (
          <ActionButton variant="primary" onClick={onClose}>
            I have saved them
          </ActionButton>
        ) : null
      }
    >
      {step === "loading" ? (
        <div className="center-fill" style={{ minHeight: 200 }}>
          <span className="spinner lg" />
        </div>
      ) : step === "scan" && enroll ? (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <span className="text-sm secondary">Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</span>
          <div className="row" style={{ justifyContent: "center" }}>
            <div style={{ padding: "var(--sp-3)", background: "#fff", borderRadius: "var(--radius-md)" }}>
              <img src={`data:image/png;base64,${enroll.qrPngBase64}`} alt="TOTP QR code" width={180} height={180} />
            </div>
          </div>
          <div className="col" style={{ gap: "var(--sp-1)" }}>
            <span className="text-xs muted">Or enter this secret manually:</span>
            <div className="row" style={{ gap: "var(--sp-2)" }}>
              <code className="code-block" style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}>
                {enroll.secret}
              </code>
              <ActionButton size="sm" variant="ghost" iconOnly tooltip="Copy secret" aria-label="Copy secret" onClick={copySecret}>
                <IconCopy size={15} />
              </ActionButton>
            </div>
          </div>
          <TextField label="Authentication code" mono inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} error={error || undefined} />
        </div>
      ) : (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <div className="banner warning">
            <IconCheck size={16} />
            <span>Store these single-use codes somewhere safe. They are shown only once and let you sign in if you lose your device.</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
            {recovery.map((c) => (
              <code key={c} className="chip chip-mono" style={{ justifyContent: "center", height: 30, fontSize: "var(--fs-sm)" }}>
                {c}
              </code>
            ))}
          </div>
          <div className="row">
            <ActionButton size="sm" variant="ghost" onClick={copyCodes}>
              <IconCopy size={14} /> Copy
            </ActionButton>
            <ActionButton size="sm" variant="ghost" onClick={downloadCodes}>
              <IconDownload size={14} /> Download
            </ActionButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DisableModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!password) return;
    setError("");
    setBusy(true);
    try {
      await api.totpDisable(password);
      toast.success("2FA disabled");
      await onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setError("Password incorrect or a fresh 2FA login is required.");
      else setError(err instanceof Error ? err.message : "Could not disable 2FA.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Disable two-factor authentication"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="danger" loading={busy} disabled={!password} onClick={submit}>
            Disable 2FA
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="banner danger">
          <IconShield size={16} />
          <span>Disabling 2FA weakens your account security. Confirm with your password to continue.</span>
        </div>
        <TextField label="Password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={error || undefined} />
      </div>
    </Modal>
  );
}

/* ===================== API tokens ===================== */

function APITokensCard() {
  const queryClient = useQueryClient();
  const tokensQ = useAPITokens();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<APIToken | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.apiTokens });

  const tokens = tokensQ.data ?? [];

  const columns: Column<APIToken>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (t) => t.name,
      cell: (t) => <span style={{ fontWeight: 600 }}>{t.name}</span>,
    },
    {
      key: "prefix",
      header: "Token",
      cell: (t) => <code className="mono text-sm muted">{t.prefix}…</code>,
    },
    {
      key: "created",
      header: "Created",
      sortValue: (t) => t.createdAt,
      cell: (t) => <span className="text-xs muted nowrap">{timeAgo(t.createdAt)}</span>,
    },
    {
      key: "expires",
      header: "Expires",
      sortValue: (t) => t.expiresAt ?? Number.MAX_SAFE_INTEGER,
      cell: (t) =>
        t.expiresAt !== undefined ? (
          <span className="text-xs nowrap">{formatDateTime(t.expiresAt)}</span>
        ) : (
          <span className="text-xs muted">Never</span>
        ),
    },
    {
      key: "lastUsed",
      header: "Last used",
      sortValue: (t) => t.lastUsedAt ?? 0,
      cell: (t) =>
        t.lastUsedAt !== undefined ? (
          <span className="text-xs muted nowrap">{timeAgo(t.lastUsedAt)}</span>
        ) : (
          <span className="text-xs muted">Never</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "110px",
      cell: (t) =>
        t.revokedAt !== undefined ? (
          <span className="text-xs muted">revoked</span>
        ) : (
          <ActionButton size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={() => setRevokeTarget(t)}>
            Revoke
          </ActionButton>
        ),
    },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">API tokens</span>
        <ActionButton size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
          <IconPlus size={14} />
          New token
        </ActionButton>
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-3)" }}>
        <span className="text-sm secondary">
          Automate Castor through its API — send a token in the <code>Authorization: Bearer</code> header.
        </span>
        {tokensQ.isLoading ? (
          <div className="center-fill" style={{ minHeight: 100 }}>
            <span className="spinner lg" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={tokens}
            rowKey={(t) => t.id}
            defaultSortKey="created"
            defaultSortDir="desc"
            emptyIcon={<IconTerminal size={40} />}
            emptyTitle="No API tokens"
            emptyMessage="Create a token to call the Castor API from scripts and CI."
          />
        )}
      </div>

      {createOpen ? <CreateTokenModal onClose={() => setCreateOpen(false)} onCreated={invalidate} /> : null}

      <ConfirmDestructiveDialog
        open={!!revokeTarget}
        title="Revoke API token"
        variant="danger"
        confirmLabel="Revoke"
        description={
          <>
            Revoke token <strong>{revokeTarget?.name}</strong>? Requests using it will be rejected immediately. This cannot be undone.
          </>
        }
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await api.apiTokenRevoke(revokeTarget.id);
            toast.success("Token revoked", revokeTarget.name);
            invalidate();
          } catch (err) {
            toastError("Revoke failed", err);
            throw err;
          }
        }}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}

// Expiration presets offered at creation ("" means the token never expires).
const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: "", label: "Never" },
] as const;

function CreateTokenModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  // Once set, the modal switches to the one-time token reveal step.
  const [createdToken, setCreatedToken] = useState<CreateTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: { name: string; expiresInDays?: number } = { name: name.trim() };
      if (expiry) body.expiresInDays = Number(expiry);
      const res = await api.apiTokenCreate(body);
      setCreatedToken(res);
      onCreated();
    } catch (err) {
      // PAT-authenticated callers get a 403 here (tokens cannot manage tokens).
      toastError("Could not create token", err);
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      setCopied(true);
      toast.success("Token copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Modal
      open
      title={createdToken ? "Copy your new token" : "New API token"}
      busy={busy}
      // The raw token appears only in this response and is never shown again —
      // the reveal step must survive Escape/scrim/X until explicitly closed.
      dismissable={!createdToken}
      onClose={onClose}
      footer={
        createdToken ? (
          <ActionButton variant="primary" onClick={onClose}>
            I've saved my token
          </ActionButton>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
              Create token
            </ActionButton>
          </>
        )
      }
    >
      {createdToken ? (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <div className="banner warning">
            <IconShield size={16} />
            <span>Copy this token now — you won't be able to see it again.</span>
          </div>
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <code className="code-block" style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}>
              {createdToken.token}
            </code>
            <ActionButton size="sm" variant="ghost" iconOnly tooltip="Copy token" aria-label="Copy token" onClick={copyToken}>
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionButton>
          </div>
          <span className="text-xs muted">
            Send it as <code>Authorization: Bearer &lt;token&gt;</code> on API requests.
          </span>
        </div>
      ) : (
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <TextField
            label="Name"
            autoFocus
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="A label to recognize this token later (e.g. “CI deploy”)."
          />
          <SelectField label="Expiration" value={expiry} onChange={(e) => setExpiry(e.target.value)} hint="Expired tokens are rejected; revocation works at any time.">
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>
      )}
    </Modal>
  );
}
