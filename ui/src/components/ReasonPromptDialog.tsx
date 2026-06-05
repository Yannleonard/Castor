// ui/src/components/ReasonPromptDialog.tsx
//
// Admin-override dialog used when removing a workload that carries a protected
// label (non-self). Captures a mandatory reason that the backend records in the
// audit detail, and sends {confirm:true, reason} per the REST contract.

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { ActionButton } from "./ActionButton";
import { IconShield } from "./icons";
import type { DestructiveOptions } from "./ConfirmDestructiveDialog";

interface Props {
  open: boolean;
  title: string;
  targetName: string;
  showRemoveOptions?: boolean;
  onConfirm: (reason: string, opts: DestructiveOptions) => Promise<void> | void;
  onClose: () => void;
}

export function ReasonPromptDialog({
  open,
  title,
  targetName,
  showRemoveOptions,
  onConfirm,
  onClose,
}: Props) {
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [volumes, setVolumes] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setForce(false);
      setVolumes(false);
      setBusy(false);
    }
  }, [open]);

  const valid = reason.trim().length >= 4;

  const confirm = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim(), { force, volumes });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span className="row">
          <span style={{ color: "var(--state-protected)" }}>
            <IconShield size={18} />
          </span>
          {title}
        </span>
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="danger" loading={busy} disabled={!valid} onClick={confirm}>
            Override and remove
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="banner warning">
          <IconShield size={16} />
          <span>
            <strong style={{ fontFamily: "var(--font-mono)" }}>{targetName}</strong> is marked protected.
            Overriding requires an audited reason.
          </span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="override-reason">
            Reason (recorded in the audit log)
          </label>
          <textarea
            id="override-reason"
            className="textarea"
            placeholder="e.g. Decommissioning stale staging stack approved in CHG-1234"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          {!valid && reason.length > 0 ? (
            <span className="field-error">Please provide at least 4 characters.</span>
          ) : null}
        </div>
        {showRemoveOptions ? (
          <div className="col" style={{ gap: "var(--sp-2)" }}>
            <label className="checkbox-row">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>Force removal (kill if running)</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={volumes} onChange={(e) => setVolumes(e.target.checked)} />
              <span>Also remove anonymous volumes</span>
            </label>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
