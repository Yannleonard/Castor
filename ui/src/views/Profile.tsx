// ui/src/views/Profile.tsx
//
// Self-service profile: change password (revokes other sessions), enroll TOTP
// (QR + secret → confirm → one-time recovery codes), and disable TOTP. The
// enrollment flow follows the contract:
//   enroll → {secret, otpauthUrl, qrPngBase64}
//   confirm(code) → {recoveryCodes:[...x10]} (shown once)
//   disable(password)

import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { TextField } from "../components/Field";
import { IconShield, IconCopy, IconCheck, IconDownload } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import type { TotpEnrollResponse } from "../lib/types";

export function Profile() {
  const { user, refresh, amr } = useAuth();

  return (
    <div className="page">
      <PageHeader title="Profile & security" subtitle="Manage your password and two-factor authentication." />

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
      onClose={step === "codes" ? onClose : onClose}
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
