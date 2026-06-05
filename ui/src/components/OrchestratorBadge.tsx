// ui/src/components/OrchestratorBadge.tsx
import type { OrchestratorKind } from "../lib/types";

const META: Record<OrchestratorKind, { label: string; color: string }> = {
  docker: { label: "Docker", color: "var(--orch-docker)" },
  swarm: { label: "Swarm", color: "var(--orch-swarm)" },
  kubernetes: { label: "Kubernetes", color: "var(--orch-kubernetes)" },
};

interface Props {
  kind: OrchestratorKind;
  /** read-only orchestrators show a small lock-ish marker */
  readonly?: boolean;
  compact?: boolean;
}

/** Colored badge identifying which orchestrator a workload comes from. */
export function OrchestratorBadge({ kind, readonly, compact }: Props) {
  const meta = META[kind] ?? { label: kind, color: "var(--text-muted)" };
  return (
    <span
      className="pill"
      style={{
        color: meta.color,
        background: "transparent",
        borderColor: meta.color,
      }}
      title={readonly ? `${meta.label} (read-only)` : meta.label}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: meta.color,
          display: "inline-block",
        }}
      />
      {compact ? meta.label.slice(0, 1) : meta.label}
    </span>
  );
}
