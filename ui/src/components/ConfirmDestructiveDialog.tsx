// ui/src/components/ConfirmDestructiveDialog.tsx
//
// Confirmation dialog for destructive lifecycle actions (stop/restart/remove).
// For remove it can surface force / volumes toggles. The async onConfirm runs
// with the dialog in a busy state; errors are surfaced by the caller via toast.

import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { ActionButton } from "./ActionButton";
import { IconAlert } from "./icons";

export interface DestructiveOptions {
  force?: boolean;
  volumes?: boolean;
}

interface Props {
  open: boolean;
  title: string;
  /** body description; can reference the target name */
  description: ReactNode;
  confirmLabel?: string;
  variant?: "danger" | "primary";
  /** show force/volumes toggles (remove only) */
  showRemoveOptions?: boolean;
  onConfirm: (opts: DestructiveOptions) => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDestructiveDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "danger",
  showRemoveOptions,
  onConfirm,
  onClose,
}: Props) {
  const [force, setForce] = useState(false);
  const [volumes, setVolumes] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForce(false);
      setVolumes(false);
      setBusy(false);
    }
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm({ force, volumes });
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
          <span style={{ color: variant === "danger" ? "var(--danger)" : "var(--accent)" }}>
            <IconAlert size={18} />
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
          <ActionButton variant={variant} loading={busy} onClick={confirm}>
            {confirmLabel}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">{description}</div>
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
