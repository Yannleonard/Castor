// ui/src/components/Modal.tsx
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

interface Props {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** wider modal for editors */
  wide?: boolean;
  /** prevent backdrop/Escape close while a mutation is in flight */
  busy?: boolean;
  /**
   * When false, Escape, scrim clicks and the header X cannot close the modal —
   * only an explicit footer action can. Content shown exactly once (API
   * tokens, recovery codes) is unrecoverable after an accidental dismiss.
   */
  dismissable?: boolean;
}

/** Accessible modal dialog using the --overlay scrim and brand surfaces. */
export function Modal({ open, title, onClose, children, footer, wide, busy, dismissable = true }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && dismissable) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, busy, dismissable]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && dismissable) onClose();
      }}
    >
      <div
        className="modal"
        style={wide ? { maxWidth: 720 } : undefined}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          {dismissable ? (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={busy} aria-label="Close">
              <IconClose size={16} />
            </button>
          ) : null}
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
