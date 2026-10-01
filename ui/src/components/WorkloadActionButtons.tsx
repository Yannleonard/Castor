// Castor by IT Leonard
// ui/src/components/WorkloadActionButtons.tsx
//
// Renders the start/pause/unpause/stop/restart/remove buttons for a single
// workload, each gated via CapabilityGate (provider capability + user
// permission). Swarm/K8s workloads render NO lifecycle buttons (read-only).
// Start is shown when stopped; unpause when paused (in place of start/stop);
// pause only when running; stop when running/restarting; restart whenever
// not stopped.

import type { Capability, Workload } from "../lib/types";
import { gateWorkloadAction } from "../lib/rbac";
import { CapabilityGate } from "./CapabilityGate";
import { ActionButton } from "./ActionButton";
import { IconPlay, IconPause, IconStop, IconRestart, IconTrash } from "./icons";
import { useT } from "../i18n";
import { workloadButtonsDict } from "../i18n/locales/workloadButtons";

interface Props {
  workload: Workload;
  caps: Capability[] | undefined;
  permissions: string[] | undefined;
  busy: boolean;
  size?: "sm" | "md";
  onStart: (w: Workload) => void;
  // Optional: callers that don't wire pause/unpause keep the legacy behavior
  // (paused workloads show stop; running workloads show no pause button).
  onPause?: (w: Workload) => void;
  onUnpause?: (w: Workload) => void;
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
  onPause,
  onUnpause,
  onStop,
  onRestart,
  onRemove,
}: Props) {
  const t = useT(workloadButtonsDict);

  // Read-only orchestrators: no lifecycle affordances at all.
  if (workload.kind !== "docker") {
    return <span className="text-xs muted">{t("badge.readOnly")}</span>;
  }

  const isStopped = workload.state === "stopped" || workload.state === "unknown";
  const isPaused = workload.state === "paused";
  const isRunning = workload.state === "running";
  const canShowStart = isStopped;
  // Paused workloads swap start/stop for unpause but keep restart (and remove).
  // Without an onUnpause handler the legacy stop button is kept instead.
  const canShowUnpause = isPaused && !!onUnpause;
  const canShowPause = isRunning && !!onPause;
  const canShowRestart = !isStopped;
  const canShowStop = !isStopped && !canShowUnpause;

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
              tooltip={allowed ? t("action.start") : reason}
              aria-label={t("action.start")}
              onClick={() => onStart(workload)}
              style={allowed ? { color: "var(--success)" } : undefined}
            >
              <IconPlay size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ) : null}

      {canShowUnpause ? (
        <CapabilityGate gate={gateWorkloadAction("unpause", workload.kind, caps, permissions)}>
          {(allowed, reason) => (
            <ActionButton
              size={size}
              iconOnly
              variant="ghost"
              disabled={!allowed}
              loading={busy}
              tooltip={allowed ? t("action.unpause") : reason}
              aria-label={t("action.unpause")}
              onClick={() => onUnpause?.(workload)}
              style={allowed ? { color: "var(--success)" } : undefined}
            >
              <IconPlay size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ) : null}

      {canShowRestart ? (
        <CapabilityGate gate={gateWorkloadAction("restart", workload.kind, caps, permissions)}>
          {(allowed, reason) => (
            <ActionButton
              size={size}
              iconOnly
              variant="ghost"
              disabled={!allowed}
              loading={busy}
              tooltip={allowed ? t("action.restart") : reason}
              aria-label={t("action.restart")}
              onClick={() => onRestart(workload)}
            >
              <IconRestart size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ) : null}

      {canShowPause ? (
        <CapabilityGate gate={gateWorkloadAction("pause", workload.kind, caps, permissions)}>
          {(allowed, reason) => (
            <ActionButton
              size={size}
              iconOnly
              variant="ghost"
              disabled={!allowed}
              loading={busy}
              tooltip={allowed ? t("action.pause") : reason}
              aria-label={t("action.pause")}
              onClick={() => onPause?.(workload)}
            >
              <IconPause size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ) : null}

      {canShowStop ? (
        <CapabilityGate gate={gateWorkloadAction("stop", workload.kind, caps, permissions)}>
          {(allowed, reason) => (
            <ActionButton
              size={size}
              iconOnly
              variant="ghost"
              disabled={!allowed}
              loading={busy}
              tooltip={allowed ? t("action.stop") : reason}
              aria-label={t("action.stop")}
              onClick={() => onStop(workload)}
              style={allowed ? { color: "var(--warning)" } : undefined}
            >
              <IconStop size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ) : null}

      <CapabilityGate gate={gateWorkloadAction("remove", workload.kind, caps, permissions)}>
        {(allowed, reason) => {
          // protected workloads: button visible but explains why it is blocked.
          const protectedBlock = workload.protected && !(permissions ?? []).includes("*");
          const finalReason = protectedBlock
            ? t("tooltip.protected")
            : reason;
          return (
            <ActionButton
              size={size}
              iconOnly
              variant="ghost"
              disabled={!allowed || protectedBlock}
              loading={busy}
              tooltip={allowed && !protectedBlock ? t("action.remove") : finalReason}
              aria-label={t("action.remove")}
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
