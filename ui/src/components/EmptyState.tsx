// ui/src/components/EmptyState.tsx
import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}

/** Centered empty placeholder for lists/tables with no rows. */
export function EmptyState({ icon, title, message, action }: Props) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-title">{title}</div>
      {message ? <div className="empty-msg">{message}</div> : null}
      {action ? <div style={{ marginTop: "var(--sp-2)" }}>{action}</div> : null}
    </div>
  );
}
