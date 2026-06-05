// ui/src/components/WorkloadActionButtons.tsx
//
// Renders the start/stop/restart/remove buttons for a single workload, each
// gated via CapabilityGate (provider capability + user permission). Swarm/K8s
// workloads render NO lifecycle buttons (read-only). Start is shown when stopped;
// stop/restart when running/paused/restarting.

import type { Capability, Workload } from "../lib/types";
import { gateWorkloadAction } from "../lib/rbac";
import { CapabilityGate } from "./CapabilityGate";
import { ActionButton } from "./ActionButton";
import { IconPlay, IconStop, IconRestart, IconTrash } from "./icons";

interface Props {
  workload: Workload;
  caps: Capability[] | undefined;
  permissions: string[] | undefined;
  busy: boolean;
  size?: "sm" | "md";
  onStart: (w: Workload) => void;
  onStop: (w: Workload) => void;
  onRestart: (w: Workload) => void;
  onRemove: (w: Workload) => void;
}

export function WorkloadActionButtons({
  workload,
  caps,
  permissions,
  busy,
  size = "sm",
  onStart,
  onStop,
  onRestart,
  onRemove,
}: Props) {
  // Read-only orchestrators: no lifecycle affordances at all.
  if (workload.kind !== "docker") {
    return <span className="text-xs muted">Read-only</span>;
  }

  const isStopped = workload.state === "stopped" || workload.state === "unknown";
  const canShowStart = isStopped;
  const canShowStopRestart = !isStopped;

  return (
    <div className="dt-actions" onClick={(e) => e.stopPropagation()}>
      {canShowStart ? (
        <CapabilityGate gate={gateWorkloadAction("start", workload.kind, caps, permissions)}>
          {(allowed, reason) => (
            <ActionButton
              size={size}
              iconOnly
              variant="ghost"
              disabled={!allowed}
              loading={busy}
              tooltip={allowed ? "Start" : reason}
              aria-label="Start"
              onClick={() => onStart(workload)}
              style={allowed ? { color: "var(--success)" } : undefined}
            >
              <IconPlay size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ) : null}

      {canShowStopRestart ? (
        <>
          <CapabilityGate gate={gateWorkloadAction("restart", workload.kind, caps, permissions)}>
            {(allowed, reason) => (
              <ActionButton
                size={size}
                iconOnly
                variant="ghost"
                disabled={!allowed}
                loading={busy}
                tooltip={allowed ? "Restart" : reason}
                aria-label="Restart"
                onClick={() => onRestart(workload)}
              >
                <IconRestart size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={gateWorkloadAction("stop", workload.kind, caps, permissions)}>
            {(allowed, reason) => (
              <ActionButton
                size={size}
                iconOnly
                variant="ghost"
                disabled={!allowed}
                loading={busy}
                tooltip={allowed ? "Stop" : reason}
                aria-label="Stop"
                onClick={() => onStop(workload)}
                style={allowed ? { color: "var(--warning)" } : undefined}
              >
                <IconStop size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
        </>
      ) : null}

      <CapabilityGate gate={gateWorkloadAction("remove", workload.kind, caps, permissions)}>
        {(allowed, reason) => {
          // protected workloads: button visible but explains why it is blocked.
          const protectedBlock = workload.protected && !(permissions ?? []).includes("*");
          const finalReason = protectedBlock
            ? "Protected — only an administrator can override removal"
            : reason;
          return (
            <ActionButton
              size={size}
              iconOnly
              variant="ghost"
              disabled={!allowed || protectedBlock}
              loading={busy}
              tooltip={allowed && !protectedBlock ? "Remove" : finalReason}
              aria-label="Remove"
              onClick={() => onRemove(workload)}
              style={allowed && !protectedBlock ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          );
        }}
      </CapabilityGate>
    </div>
  );
}
