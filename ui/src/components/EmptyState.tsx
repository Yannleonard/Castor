// Castor by IT Leonard
// ui/src/components/EmptyState.tsx
import type { ReactNode } from "react";
import { useT } from "../i18n";
import { dialogsDict } from "../i18n/locales/dialogs";

interface Props {
  icon?: ReactNode;
  /** Heading. Falls back to a translated default when omitted. */
  title?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
}

/** Centered empty placeholder for lists/tables with no rows. */
export function EmptyState({ icon, title, message, action }: Props) {
  const t = useT(dialogsDict);
  // Caller-provided text always wins; the dictionary only fills the default.
  const heading = title ?? t("empty.title");
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-title">{heading}</div>
      {message ? <div className="empty-msg">{message}</div> : null}
      {action ? <div style={{ marginTop: "var(--sp-2)" }}>{action}</div> : null}
    </div>
  );
}
