// ui/src/components/StatusDot.tsx
import clsx from "clsx";
import type { WorkloadState, HostStatus } from "../lib/types";

const STATE_COLOR: Record<WorkloadState, string> = {
  running: "var(--state-running)",
  stopped: "var(--state-stopped)",
  paused: "var(--state-paused)",
  restarting: "var(--state-restarting)",
  pending: "var(--state-pending)",
  unknown: "var(--state-unknown)",
};

const HOST_COLOR: Record<HostStatus, string> = {
  connected: "var(--state-running)",
  down: "var(--danger)",
  pending: "var(--state-pending)",
};

interface Props {
  state?: WorkloadState;
  hostStatus?: HostStatus;
  /** explicit override color (CSS var or hex) */
  color?: string;
  /** pulse animation for live "running"/"connected" */
  pulse?: boolean;
  title?: string;
}

/** A colored dot mapping a WorkloadState or HostStatus to --state-* tokens. */
export function StatusDot({ state, hostStatus, color, pulse, title }: Props) {
  const resolved =
    color ??
    (state ? STATE_COLOR[state] : undefined) ??
    (hostStatus ? HOST_COLOR[hostStatus] : undefined) ??
    "var(--state-unknown)";
  const animate =
    pulse ?? (state === "running" || state === "restarting" || hostStatus === "connected");
  return (
    <span
      className={clsx("status-dot", animate && "pulse")}
      style={{ background: resolved, color: resolved }}
      title={title ?? state ?? hostStatus}
      aria-hidden
    />
  );
}
