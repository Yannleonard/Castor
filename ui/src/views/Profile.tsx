// Castor by IT Leonard
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
import { useT, t as tr } from "../i18n";
import { profileDict } from "../i18n/locales/profile";
import { commonDict } from "../i18n/locales/common";
import type { TotpEnrollResponse, APIToken, CreateTokenResponse } from "../lib/types";

export function Profile() {
  const { user, refresh, amr } = useAuth();
  const t = useT(profileDict);

  return (
    <div className="page">
      <PageHeader title={t("header.title")} subtitle={t("header.subtitle")} actions={<HelpButton topic="profile" />} />

      <div className="card">
        <div className="card-header">
          <span className="card-title">{t("account.title")}</span>
        </div>
        <div className="card-body">
          <dl className="dl">
            <dt>{t("account.username")}</dt>
            <dd>{user?.username}</dd>
            <dt>{t("account.email")}</dt>
            <dd>{user?.email || "—"}</dd>
            <dt>{t("account.assurance")}</dt>
            <dd>
              <span className="pill" style={{ color: "var(--accent)", borderColor: "var(--accent)", background: "transparent" }}>
                {amr ?? "pwd"}
              </span>
            </dd>
            <dt>{t("account.twoFactor")}</dt>
            <dd>
              {user?.totpEnabled ? (
                <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
                  <IconShield size={12} /> {t("account.twoFactorEnabled")}
                </span>
              ) : (
                <span className="text-sm muted">{t("account.twoFactorNotConfigured")}</span>
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
  const t = useT(profileDict);
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
      toast.success(tr(profileDict, "password.toastTitle"), tr(profileDict, "password.toastBody"));
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError(err.message || tr(profileDict, "password.errPolicy"));
      else if (err instanceof ApiError && err.status === 401) setError(tr(profileDict, "password.errIncorrect"));
      else {
        toastError(tr(profileDict, "password.errFailed"), err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{t("password.title")}</span>
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-3)", maxWidth: 440 }}>
        <TextField label={t("password.current")} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <TextField label={t("password.new")} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint={t("password.newHint")} />
        <TextField
          label={t("password.confirm")}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && next !== confirm ? t("password.mismatch") : undefined}
        />
        {error ? <div className="banner danger">{error}</div> : null}
        <div className="row">
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("password.submit")}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function TotpCard({ enabled, onChanged }: { enabled: boolean; onChanged: () => Promise<unknown> }) {
  const t = useT(profileDict);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{t("totp.title")}</span>
        {enabled ? (
          <span className="pill" style={{ color: "var(--success)", background: "var(--success-bg)", borderColor: "transparent" }}>
            <IconShield size={12} /> {t("totp.active")}
          </span>
        ) : null}
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-3)", maxWidth: 540 }}>
        <span className="text-sm secondary">
          {enabled ? t("totp.descEnabled") : t("totp.descDisabled")}
        </span>
        <div className="row">
          {enabled ? (
            <ActionButton variant="danger" onClick={() => setDisableOpen(true)}>
              {t("totp.disable")}
            </ActionButton>
          ) : (
            <ActionButton variant="primary" onClick={() => setEnrollOpen(true)}>
              <IconShield size={15} />
              {t("totp.enable")}
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
  const t = useT(profileDict);
  const tc = useT(commonDict);
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
        toastError(tr(profileDict, "enroll.errStartTitle"), err);
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
      if (err instanceof ApiError && err.status === 401) setError(tr(profileDict, "enroll.errCodeMismatch"));
      else setError(err instanceof Error ? err.message : tr(profileDict, "enroll.errConfirmFailed"));
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!enroll) return;
    await navigator.clipboard.writeText(enroll.secret).catch(() => {});
    toast.success(tr(profileDict, "enroll.toastSecretCopied"));
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(recovery.join("\n")).catch(() => {});
    toast.success(tr(profileDict, "enroll.toastCodesCopied"));
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
      title={step === "codes" ? t("enroll.titleCodes") : t("enroll.titleScan")}
      busy={busy || step === "loading"}
      // Recovery codes are shown exactly once — an accidental Escape/scrim
      // click at that step would lose them, so only the footer action closes.
      dismissable={step !== "codes"}
      onClose={onClose}
      footer={
        step === "scan" ? (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>
              {tc("cancel")}
            </button>
            <ActionButton variant="primary" loading={busy} disabled={code.trim().length < 6} onClick={confirm}>
              {t("enroll.confirm")}
            </ActionButton>
          </>
        ) : step === "codes" ? (
          <ActionButton variant="primary" onClick={onClose}>
            {t("enroll.savedCodes")}
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
          <span className="text-sm secondary">{t("enroll.scanInstructions")}</span>
          <div className="row" style={{ justifyContent: "center" }}>
            <div style={{ padding: "var(--sp-3)", background: "#fff", borderRadius: "var(--radius-md)" }}>
              <img src={`data:image/png;base64,${enroll.qrPngBase64}`} alt={t("enroll.qrAlt")} width={180} height={180} />
            </div>
          </div>
          <div className="col" style={{ gap: "var(--sp-1)" }}>
            <span className="text-xs muted">{t("enroll.manualSecret")}</span>
            <div className="row" style={{ gap: "var(--sp-2)" }}>
              <code className="code-block" style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}>
                {enroll.secret}
              </code>
              <ActionButton size="sm" variant="ghost" iconOnly tooltip={t("enroll.copySecret")} aria-label={t("enroll.copySecret")} onClick={copySecret}>
                <IconCopy size={15} />
              </ActionButton>
            </div>
          </div>
          <TextField label={t("enroll.codeLabel")} mono inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} error={error || undefined} />
        </div>
      ) : (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <div className="banner warning">
            <IconCheck size={16} />
            <span>{t("enroll.codesWarning")}</span>
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
              <IconCopy size={14} /> {t("enroll.copyCodes")}
            </ActionButton>
            <ActionButton size="sm" variant="ghost" onClick={downloadCodes}>
              <IconDownload size={14} /> {t("enroll.downloadCodes")}
            </ActionButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DisableModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const t = useT(profileDict);
  const tc = useT(commonDict);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!password) return;
    setError("");
    setBusy(true);
    try {
      await api.totpDisable(password);
      toast.success(tr(profileDict, "disable.toastDone"));
      await onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setError(tr(profileDict, "disable.errPassword"));
      else setError(err instanceof Error ? err.message : tr(profileDict, "disable.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t("disable.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {tc("cancel")}
          </button>
          <ActionButton variant="danger" loading={busy} disabled={!password} onClick={submit}>
            {t("totp.disable")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="banner danger">
          <IconShield size={16} />
          <span>{t("disable.warning")}</span>
        </div>
        <TextField label={t("disable.passwordLabel")} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={error || undefined} />
      </div>
    </Modal>
  );
}

/* ===================== API tokens ===================== */

function APITokensCard() {
  const t = useT(profileDict);
  const queryClient = useQueryClient();
  const tokensQ = useAPITokens();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<APIToken | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.apiTokens });

  const tokens = tokensQ.data ?? [];

  const columns: Column<APIToken>[] = [
    {
      key: "name",
      header: t("col.name"),
      sortValue: (tok) => tok.name,
      cell: (tok) => <span style={{ fontWeight: 600 }}>{tok.name}</span>,
    },
    {
      key: "prefix",
      header: t("col.token"),
      cell: (tok) => <code className="mono text-sm muted">{tok.prefix}…</code>,
    },
    {
      key: "created",
      header: t("col.created"),
      sortValue: (tok) => tok.createdAt,
      cell: (tok) => <span className="text-xs muted nowrap">{timeAgo(tok.createdAt)}</span>,
    },
    {
      key: "expires",
      header: t("col.expires"),
      sortValue: (tok) => tok.expiresAt ?? Number.MAX_SAFE_INTEGER,
      cell: (tok) =>
        tok.expiresAt !== undefined ? (
          <span className="text-xs nowrap">{formatDateTime(tok.expiresAt)}</span>
        ) : (
          <span className="text-xs muted">{t("tokens.never")}</span>
        ),
    },
    {
      key: "lastUsed",
      header: t("col.lastUsed"),
      sortValue: (tok) => tok.lastUsedAt ?? 0,
      cell: (tok) =>
        tok.lastUsedAt !== undefined ? (
          <span className="text-xs muted nowrap">{timeAgo(tok.lastUsedAt)}</span>
        ) : (
          <span className="text-xs muted">{t("tokens.never")}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "110px",
      cell: (tok) =>
        tok.revokedAt !== undefined ? (
          <span className="text-xs muted">{t("tokens.revoked")}</span>
        ) : (
          <ActionButton size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={() => setRevokeTarget(tok)}>
            {t("tokens.revoke")}
          </ActionButton>
        ),
    },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{t("tokens.title")}</span>
        <ActionButton size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
          <IconPlus size={14} />
          {t("tokens.new")}
        </ActionButton>
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-3)" }}>
        <span className="text-sm secondary">
          {t("tokens.introBefore")}
          <code>Authorization: Bearer</code>
          {t("tokens.introAfter")}
        </span>
        {tokensQ.isLoading ? (
          <div className="center-fill" style={{ minHeight: 100 }}>
            <span className="spinner lg" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={tokens}
            rowKey={(tok) => tok.id}
            defaultSortKey="created"
            defaultSortDir="desc"
            emptyIcon={<IconTerminal size={40} />}
            emptyTitle={t("tokens.emptyTitle")}
            emptyMessage={t("tokens.emptyMessage")}
          />
        )}
      </div>

      {createOpen ? <CreateTokenModal onClose={() => setCreateOpen(false)} onCreated={invalidate} /> : null}

      <ConfirmDestructiveDialog
        open={!!revokeTarget}
        title={t("tokens.revokeTitle")}
        variant="danger"
        confirmLabel={t("tokens.revokeConfirm")}
        description={
          <>
            {t("tokens.revokeDescBefore")}
            <strong>{revokeTarget?.name}</strong>
            {t("tokens.revokeDescAfter")}
          </>
        }
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await api.apiTokenRevoke(revokeTarget.id);
            toast.success(tr(profileDict, "tokens.revokeToastTitle"), revokeTarget.name);
            invalidate();
          } catch (err) {
            toastError(tr(profileDict, "tokens.revokeErr"), err);
            throw err;
          }
        }}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}

// Expiration presets offered at creation ("" means the token never expires).
// `value` is the technical day-count sent to the API; `labelKey` resolves the
// display label through profileDict.
const EXPIRY_OPTIONS = [
  { value: "30", labelKey: "expiry.30" },
  { value: "90", labelKey: "expiry.90" },
  { value: "365", labelKey: "expiry.365" },
  { value: "", labelKey: "expiry.never" },
] as const;

function CreateTokenModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT(profileDict);
  const tc = useT(commonDict);
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
      toastError(tr(profileDict, "create.errCreate"), err);
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      setCopied(true);
      toast.success(tr(profileDict, "create.toastCopied"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(tr(profileDict, "create.errCopy"));
    }
  };

  return (
    <Modal
      open
      title={createdToken ? t("create.titleReveal") : t("create.titleForm")}
      busy={busy}
      // The raw token appears only in this response and is never shown again —
      // the reveal step must survive Escape/scrim/X until explicitly closed.
      dismissable={!createdToken}
      onClose={onClose}
      footer={
        createdToken ? (
          <ActionButton variant="primary" onClick={onClose}>
            {t("create.savedToken")}
          </ActionButton>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>
              {tc("cancel")}
            </button>
            <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
              {t("create.createBtn")}
            </ActionButton>
          </>
        )
      }
    >
      {createdToken ? (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <div className="banner warning">
            <IconShield size={16} />
            <span>{t("create.revealWarning")}</span>
          </div>
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <code className="code-block" style={{ padding: "var(--sp-2) var(--sp-3)", flex: 1, whiteSpace: "normal", wordBreak: "break-all" }}>
              {createdToken.token}
            </code>
            <ActionButton size="sm" variant="ghost" iconOnly tooltip={t("create.copyToken")} aria-label={t("create.copyToken")} onClick={copyToken}>
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionButton>
          </div>
          <span className="text-xs muted">
            {t("create.sendHintBefore")}
            <code>Authorization: Bearer &lt;token&gt;</code>
            {t("create.sendHintAfter")}
          </span>
        </div>
      ) : (
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <TextField
            label={t("create.nameLabel")}
            autoFocus
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={t("create.nameHint")}
          />
          <SelectField label={t("create.expiryLabel")} value={expiry} onChange={(e) => setExpiry(e.target.value)} hint={t("create.expiryHint")}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.labelKey} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </SelectField>
        </div>
      )}
    </Modal>
  );
}
