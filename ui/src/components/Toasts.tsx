// ui/src/components/Toasts.tsx
import { useToastStore } from "../lib/toast";
import { IconCheck, IconAlert, IconClose } from "./icons";

const ICON = {
  success: <IconCheck size={18} />,
  error: <IconAlert size={18} />,
  warning: <IconAlert size={18} />,
  info: <IconAlert size={18} />,
};

/** Fixed bottom-right toast region. Mounted once near the app root. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-region" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span
            style={{
              color:
                t.kind === "success"
                  ? "var(--success)"
                  : t.kind === "error"
                    ? "var(--danger)"
                    : t.kind === "warning"
                      ? "var(--warning)"
                      : "var(--accent)",
            }}
          >
            {ICON[t.kind]}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
          </div>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
