// ui/src/components/StatCard.tsx — dashboard metric tile.
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: string; // CSS color for the icon/value accent
  onClick?: () => void;
}

export function StatCard({ label, value, sub, icon, accent = "var(--accent)", onClick }: Props) {
  return (
    <div
      className="card card-pad"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        cursor: onClick ? "pointer" : undefined,
      }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="text-sm muted">{label}</span>
        {icon ? <span style={{ color: accent, opacity: 0.85 }}>{icon}</span> : null}
      </div>
      <div style={{ fontSize: "var(--fs-2xl)", fontWeight: "var(--fw-bold)", lineHeight: 1.1, color: "var(--text-primary)" }}>
        {value}
      </div>
      {sub ? <div className="text-xs muted">{sub}</div> : null}
    </div>
  );
}
