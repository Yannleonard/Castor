// ui/src/views/Settings.tsx
//
// Instance settings (admin; settings.read / settings.update). Toggles for
// security.totp_required_for_mutations and editing security.protected_labels,
// plus a read-only view of instance metadata. Secret-like keys are never exposed
// by the API.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { IconPlus, IconClose, IconShield } from "../components/icons";
import { toast, toastError } from "../lib/toast";

export function Settings() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const settingsQ = useSettings();
  const canUpdate = can("settings.update");

  const [totpRequired, setTotpRequired] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [ttl, setTtl] = useState(43200);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settingsQ.data) {
      setTotpRequired(settingsQ.data["security.totp_required_for_mutations"]);
      setLabels(settingsQ.data["security.protected_labels"] ?? []);
      setTtl(settingsQ.data["session.ttl_seconds"] ?? 43200);
      setDirty(false);
    }
  }, [settingsQ.data]);

  if (settingsQ.isLoading) return <LoadingFill label="Loading settings…" />;
  const data = settingsQ.data;

  const addLabel = () => {
    const v = newLabel.trim();
    if (!v || labels.includes(v)) return;
    setLabels((prev) => [...prev, v]);
    setNewLabel("");
    setDirty(true);
  };
  const removeLabel = (v: string) => {
    setLabels((prev) => prev.filter((l) => l !== v));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.settingsUpdate({
        "security.totp_required_for_mutations": totpRequired,
        "security.protected_labels": labels,
        "session.ttl_seconds": ttl,
      });
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setDirty(false);
    } catch (err) {
      toastError("Save failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Instance security and behavior."
        actions={
          <ActionButton variant="primary" disabled={!canUpdate || !dirty} loading={busy} tooltip={canUpdate ? undefined : "Requires settings.update"} onClick={save}>
            Save changes
          </ActionButton>
        }
      />

      <div className="card">
        <div className="card-header">
          <span className="card-title">Security</span>
        </div>
        <div className="card-body col" style={{ gap: "var(--sp-5)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="col" style={{ gap: 2, maxWidth: 540 }}>
              <span className="text-sm" style={{ fontWeight: 600 }}>
                Require 2FA for mutating actions
              </span>
              <span className="text-xs muted">
                When enabled, users with TOTP configured must have an authentication assurance level of
                pwd+totp to perform any state-changing operation.
              </span>
            </div>
            <Toggle checked={totpRequired} disabled={!canUpdate} onChange={(v) => { setTotpRequired(v); setDirty(true); }} />
          </div>

          <div className="col" style={{ gap: "var(--sp-2)" }}>
            <span className="text-sm" style={{ fontWeight: 600 }}>
              Session lifetime
            </span>
            <div className="row" style={{ gap: "var(--sp-2)" }}>
              <input
                className="input"
                style={{ width: 140 }}
                type="number"
                min={300}
                step={300}
                value={ttl}
                disabled={!canUpdate}
                onChange={(e) => { setTtl(Number(e.target.value)); setDirty(true); }}
              />
              <span className="text-sm muted">seconds ({Math.round(ttl / 3600)}h sliding window)</span>
            </div>
          </div>

          <div className="col" style={{ gap: "var(--sp-2)" }}>
            <span className="text-sm" style={{ fontWeight: 600 }}>
              <span className="row" style={{ gap: 6 }}>
                <IconShield size={15} /> Protected labels
              </span>
            </span>
            <span className="text-xs muted" style={{ maxWidth: 540 }}>
              Containers carrying any of these labels are treated as protected and cannot be removed without
              an audited admin override.
            </span>
            <div className="row-wrap" style={{ gap: 6, marginTop: 4 }}>
              {labels.map((l) => (
                <span key={l} className="chip chip-mono" style={{ color: "var(--state-protected)" }}>
                  {l}
                  {canUpdate ? (
                    <button
                      className="toast-close"
                      style={{ marginLeft: 4 }}
                      onClick={() => removeLabel(l)}
                      aria-label={`Remove ${l}`}
                    >
                      <IconClose size={12} />
                    </button>
                  ) : null}
                </span>
              ))}
              {labels.length === 0 ? <span className="muted text-sm">No protected labels.</span> : null}
            </div>
            {canUpdate ? (
              <div className="row" style={{ gap: "var(--sp-2)", marginTop: 4 }}>
                <input
                  className="input input-mono"
                  style={{ maxWidth: 320 }}
                  placeholder="io.castor.protected"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addLabel()}
                />
                <ActionButton variant="ghost" size="sm" onClick={addLabel} disabled={!newLabel.trim()}>
                  <IconPlus size={14} />
                  Add
                </ActionButton>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Instance</span>
        </div>
        <div className="card-body">
          <dl className="dl">
            <dt>Instance ID</dt>
            <dd className="mono">{data?.["instance.id"] ?? "—"}</dd>
            <dt>Bootstrap</dt>
            <dd>{data?.["bootstrap.completed"] ? "Completed" : "Pending"}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        border: "1px solid var(--border-strong)",
        background: checked ? "var(--accent)" : "var(--bg-inset)",
        position: "relative",
        transition: "background var(--dur-fast) var(--ease)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: checked ? "var(--text-on-accent)" : "var(--text-muted)",
          transition: "left var(--dur-fast) var(--ease)",
        }}
      />
    </button>
  );
}
