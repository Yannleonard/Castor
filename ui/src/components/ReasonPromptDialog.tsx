// Castor by IT Leonard
// ui/src/components/ReasonPromptDialog.tsx
//
// Admin-override dialog used when removing a workload that carries a protected
// label (non-self). Captures a mandatory reason that the backend records in the
// audit detail, and sends {confirm:true, reason} per the REST contract.

import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { ActionButton } from "./ActionButton";
import { IconShield } from "./icons";
import { useT } from "../i18n";
import { commonDict } from "../i18n/locales/common";
import { dialogsDict } from "../i18n/locales/dialogs";
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
  const tc = useT(commonDict);
  const td = useT(dialogsDict);
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

  // The protected banner template holds a literal "{name}" placeholder. Splitting
  // on it (rather than interpolating) lets the target name render with its own
  // mono styling, positioned correctly for each language's word order.
  const bannerParts: ReactNode[] = td("reason.protectedBanner")
    .split("{name}")
    .flatMap((seg, i) =>
      i === 0
        ? [<span key={`seg${i}`}>{seg}</span>]
        : [
            <strong key="name" style={{ fontFamily: "var(--font-mono)" }}>
              {targetName}
            </strong>,
            <span key={`seg${i}`}>{seg}</span>,
          ],
    );

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
            {tc("cancel")}
          </button>
          <ActionButton variant="danger" loading={busy} disabled={!valid} onClick={confirm}>
            {td("reason.overrideRemove")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="banner warning">
          <IconShield size={16} />
          <span>{bannerParts}</span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="override-reason">
            {td("reason.label")}
          </label>
          <textarea
            id="override-reason"
            className="textarea"
            placeholder={td("reason.placeholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          {!valid && reason.length > 0 ? (
            <span className="field-error">{td("reason.tooShort")}</span>
          ) : null}
        </div>
        {showRemoveOptions ? (
          <div className="col" style={{ gap: "var(--sp-2)" }}>
            <label className="checkbox-row">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>{td("confirm.forceRemoval")}</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={volumes} onChange={(e) => setVolumes(e.target.checked)} />
              <span>{td("confirm.removeVolumes")}</span>
            </label>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
