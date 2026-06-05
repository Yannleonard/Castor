// ui/src/components/StateBadge.tsx
import type { WorkloadState } from "../lib/types";
import { StatusDot } from "./StatusDot";

const LABEL: Record<WorkloadState, string> = {
  running: "Running",
  stopped: "Stopped",
  paused: "Paused",
  restarting: "Restarting",
  pending: "Pending",
  unknown: "Unknown",
};

const TINT: Record<WorkloadState, { bg: string; fg: string }> = {
  running: { bg: "var(--success-bg)", fg: "var(--state-running)" },
  stopped: { bg: "rgba(110,138,166,0.16)", fg: "var(--state-stopped)" },
  paused: { bg: "var(--warning-bg)", fg: "var(--state-paused)" },
  restarting: { bg: "rgba(36,150,237,0.16)", fg: "var(--state-restarting)" },
  pending: { bg: "rgba(142,124,195,0.18)", fg: "var(--state-pending)" },
  unknown: { bg: "rgba(110,138,166,0.16)", fg: "var(--state-unknown)" },
};

interface Props {
  state: WorkloadState;
  /** show the engine-native raw string as the badge tooltip */
  raw?: string;
}

/** A pill rendering a normalized WorkloadState with the matching token color. */
export function StateBadge({ state, raw }: Props) {
  const tint = TINT[state] ?? TINT.unknown;
  return (
    <span
      className="pill"
      style={{ background: tint.bg, color: tint.fg, borderColor: "transparent" }}
      title={raw || LABEL[state]}
    >
      <StatusDot state={state} pulse={state === "running"} />
      {LABEL[state] ?? state}
    </span>
  );
}
