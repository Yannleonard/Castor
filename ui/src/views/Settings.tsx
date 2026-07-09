// ui/src/views/Settings.tsx
//
// Instance settings (admin; settings.read / settings.update). Toggles for
// security.totp_required_for_mutations and editing security.protected_labels,
// plus a read-only view of instance metadata. Secret-like keys are never exposed
// by the API.
//
// Also hosts the Notifications section (notifications.manage): CRUD over alert
// channels (Discord/Slack/ntfy/webhook). Channel changes apply immediately —
// they do NOT go through the global "Save changes" button. Webhook URLs are
// write-only: reads carry urlSet, never the URL itself.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { qk, useNotificationChannels, useSettings } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { HelpButton } from "../components/HelpButton";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { TextField, SelectField } from "../components/Field";
import { IconPlus, IconClose, IconShield, IconTrash } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import type {
  NotificationChannel,
  NotificationChannelInput,
  NotificationChannelType,
  NotificationEvent,
} from "../lib/types";

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
          <div className="row">
            <ActionButton variant="primary" disabled={!canUpdate || !dirty} loading={busy} tooltip={canUpdate ? undefined : "Requires settings.update"} onClick={save}>
              Save changes
            </ActionButton>
            <HelpButton topic="settings" />
          </div>
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

      <NotificationsSection />
    </div>
  );
}

/* ===================== Notifications ===================== */

const CHANNEL_TYPE_OPTIONS: { value: NotificationChannelType; label: string }[] = [
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "ntfy", label: "ntfy" },
  { value: "webhook", label: "Webhook" },
];

const CHANNEL_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CHANNEL_TYPE_OPTIONS.map((t) => [t.value, t.label]),
);

const EVENT_OPTIONS: { value: NotificationEvent; label: string }[] = [
  { value: "container.down", label: "Container went down" },
  { value: "update.available", label: "Image update available" },
];

const EVENT_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_OPTIONS.map((e) => [e.value, e.label]),
);

// Alert channel management. Unlike the settings above, every change here is an
// immediate API call (create/update/delete/test) — nothing is staged behind the
// page-level "Save changes" button.
function NotificationsSection() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can("notifications.manage");
  // Listing also requires notifications.manage server-side, so don't fetch
  // (and 403) for viewers — render the greyed-out section instead.
  const channelsQ = useNotificationChannels({ enabled: canManage });

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NotificationChannel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NotificationChannel | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.notificationChannels });

  const runTest = async (ch: NotificationChannel) => {
    setTestingId(ch.id);
    try {
      await api.notificationChannelTest(ch.id);
      toast.success("Test notification sent", ch.name);
    } catch (err) {
      toastError("Test failed", err);
    } finally {
      setTestingId(null);
    }
  };

  // Immediate PUT; url is omitted so the stored (sealed) URL is kept.
  const toggleEnabled = async (ch: NotificationChannel, enabled: boolean) => {
    setTogglingId(ch.id);
    try {
      await api.notificationChannelUpdate(ch.id, {
        name: ch.name,
        type: ch.type,
        events: ch.events,
        enabled,
      });
      toast.success(enabled ? "Channel enabled" : "Channel disabled", ch.name);
      invalidate();
    } catch (err) {
      toastError("Update failed", err);
    } finally {
      setTogglingId(null);
    }
  };

  const channels = channelsQ.data ?? [];

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Notifications</span>
        <ActionButton
          size="sm"
          disabled={!canManage}
          tooltip={canManage ? undefined : "Requires notifications.manage"}
          onClick={() => setCreateOpen(true)}
        >
          <IconPlus size={14} />
          Add channel
        </ActionButton>
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-4)" }}>
        <span className="text-xs muted" style={{ maxWidth: 540 }}>
          Alert channels for container and image-update events. Webhook URLs are stored encrypted
          and never displayed again.
        </span>

        {!canManage ? (
          <span className="text-sm muted">
            Managing notification channels requires the notifications.manage permission.
          </span>
        ) : channelsQ.isLoading ? (
          <span className="text-sm muted">Loading channels…</span>
        ) : channelsQ.isError ? (
          <span className="text-sm" style={{ color: "var(--danger)" }}>
            Failed to load notification channels.
          </span>
        ) : channels.length === 0 ? (
          <span className="text-sm muted">No notification channels configured.</span>
        ) : (
          <div className="col" style={{ gap: "var(--sp-4)" }}>
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="row"
                style={{ justifyContent: "space-between", alignItems: "center", gap: "var(--sp-3)" }}
              >
                <div className="col" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="text-sm truncate" style={{ fontWeight: 600 }}>
                      {ch.name}
                    </span>
                    <span className="chip">{CHANNEL_TYPE_LABEL[ch.type] ?? ch.type}</span>
                  </div>
                  <div className="row-wrap" style={{ gap: 6 }}>
                    {ch.events.length > 0 ? (
                      ch.events.map((e) => (
                        <span key={e} className="chip text-xs">
                          {EVENT_LABEL[e] ?? e}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs muted">No events subscribed.</span>
                    )}
                  </div>
                </div>
                <div className="row" style={{ gap: "var(--sp-2)", flex: "0 0 auto" }}>
                  <Toggle
                    checked={ch.enabled}
                    disabled={togglingId !== null}
                    onChange={(v) => toggleEnabled(ch, v)}
                  />
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    loading={testingId === ch.id}
                    disabled={testingId !== null}
                    tooltip="Send a test notification"
                    onClick={() => runTest(ch)}
                  >
                    Test
                  </ActionButton>
                  <ActionButton size="sm" variant="ghost" tooltip="Edit" onClick={() => setEditTarget(ch)}>
                    Edit
                  </ActionButton>
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    iconOnly
                    tooltip="Delete channel"
                    aria-label={`Delete ${ch.name}`}
                    style={{ color: "var(--danger)" }}
                    onClick={() => setDeleteTarget(ch)}
                  >
                    <IconTrash size={15} />
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {createOpen ? <ChannelModal onClose={() => setCreateOpen(false)} onDone={invalidate} /> : null}
      {editTarget ? (
        <ChannelModal channel={editTarget} onClose={() => setEditTarget(null)} onDone={invalidate} />
      ) : null}

      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title="Delete channel"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete notification channel <strong>{deleteTarget?.name}</strong>? Alerts routed to it
            will stop immediately.
          </>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.notificationChannelDelete(deleteTarget.id);
            toast.success("Channel deleted", deleteTarget.name);
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

function ChannelModal({
  channel,
  onClose,
  onDone,
}: {
  channel?: NotificationChannel;
  onClose: () => void;
  onDone: () => void;
}) {
  const editing = !!channel;
  const [name, setName] = useState(channel?.name ?? "");
  const [type, setType] = useState<NotificationChannelType>(channel?.type ?? "discord");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<NotificationEvent[]>(channel?.events ?? []);
  const [busy, setBusy] = useState(false);

  // On create the URL is mandatory; on edit a blank field means "keep".
  const valid = name.trim().length > 0 && (editing ? true : url.trim().length > 0);

  const toggleEvent = (kind: NotificationEvent, checked: boolean) =>
    setEvents((prev) => (checked ? [...prev, kind] : prev.filter((e) => e !== kind)));

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: NotificationChannelInput = {
        name: name.trim(),
        type,
        events,
        // The row toggle owns enabled; preserve it on edit (omitted => true).
        enabled: editing ? channel!.enabled : true,
      };
      // Omitting url on update keeps the stored, sealed URL (see notifications.go).
      if (url.trim()) body.url = url.trim();
      if (editing) {
        await api.notificationChannelUpdate(channel!.id, body);
        toast.success("Channel updated", body.name);
      } else {
        await api.notificationChannelCreate(body);
        toast.success("Channel added", body.name);
      }
      onDone();
      onClose();
    } catch (err) {
      toastError(editing ? "Update failed" : "Create failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={editing ? `Edit ${channel!.name}` : "Add channel"}
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
        <TextField
          label="Name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint="A label for this channel."
        />
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as NotificationChannelType)}>
          {CHANNEL_TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Webhook URL"
          type="password"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="new-password"
          placeholder={editing && channel?.urlSet ? "•••••• (unchanged)" : "https://…"}
          hint={
            editing && channel?.urlSet
              ? "A URL is already stored. Leave blank to keep it, or type a new one to replace it."
              : "Absolute http(s) endpoint. Stored encrypted; never displayed again."
          }
        />
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-sm" style={{ fontWeight: 600 }}>
            Events
          </span>
          {EVENT_OPTIONS.map((ev) => (
            <label key={ev.value} className="checkbox-row">
              <input
                type="checkbox"
                checked={events.includes(ev.value)}
                onChange={(e) => toggleEvent(ev.value, e.target.checked)}
              />
              <span>{ev.label}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
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
