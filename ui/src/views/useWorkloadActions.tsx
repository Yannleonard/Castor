// ui/src/views/useWorkloadActions.tsx
//
// Shared lifecycle action handling for Docker workloads: start/stop/restart/remove
// with ConfirmDestructiveDialog and (for protected, admin-override) ReasonPromptDialog.
// Returns trigger functions plus the dialog elements to render.
//
// Decision matrix for remove (per REST contract):
//   - protected + admin (rbac.* / "*") → ReasonPromptDialog (confirm:true + reason)
//   - protected + non-admin            → blocked (the gate disables the button)
//   - non-protected                    → ConfirmDestructiveDialog (force/volumes)

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../lib/auth";
import {
  ConfirmDestructiveDialog,
  type DestructiveOptions,
} from "../components/ConfirmDestructiveDialog";
import { ReasonPromptDialog } from "../components/ReasonPromptDialog";
import { cleanName } from "../lib/format";
import type { Workload } from "../lib/types";

type PendingKind = "stop" | "restart" | "remove" | "remove-protected" | null;

interface Pending {
  kind: PendingKind;
  workload: Workload;
}

// isRunningConflict reports whether err is the backend's "container is running"
// refusal (HTTP 409 conflict) — the one case a force-remove can resolve. It is
// deliberately narrow: a protected_resource 409 from the guard is NOT included,
// since forcing cannot bypass that.
function isRunningConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === "conflict";
}

export function useWorkloadActions(hostId: string) {
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const [pending, setPending] = useState<Pending | null>(null);
  // forcePrompt is a second, independent dialog state: when a non-forced remove is
  // refused with 409 (container running), we offer a one-click force-remove. It is
  // kept separate from `pending` so closing the first dialog doesn't clobber it.
  const [forcePrompt, setForcePrompt] = useState<Workload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isAdmin = permissions.includes("*");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
    queryClient.invalidateQueries({ queryKey: ["host", hostId] });
  };

  const runStart = async (w: Workload) => {
    setBusyId(w.id);
    try {
      await api.workloadStart(hostId, w.id);
      toast.success("Started", cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError("Start failed", err);
    } finally {
      setBusyId(null);
    }
  };

  const triggerStop = (w: Workload) => setPending({ kind: "stop", workload: w });
  const triggerRestart = (w: Workload) => setPending({ kind: "restart", workload: w });
  const triggerRemove = (w: Workload) =>
    setPending({ kind: w.protected ? "remove-protected" : "remove", workload: w });

  const closeDialog = () => setPending(null);
  const closeForcePrompt = () => setForcePrompt(null);

  const confirmStop = async () => {
    if (!pending) return;
    const w = pending.workload;
    try {
      await api.workloadStop(hostId, w.id);
      toast.success("Stopped", cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError("Stop failed", err);
      throw err;
    }
  };

  const confirmRestart = async () => {
    if (!pending) return;
    const w = pending.workload;
    try {
      await api.workloadRestart(hostId, w.id);
      toast.success("Restarted", cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError("Restart failed", err);
      throw err;
    }
  };

  const confirmRemove = async (opts: DestructiveOptions) => {
    if (!pending) return;
    const w = pending.workload;
    try {
      await api.workloadRemove(hostId, w.id, { force: opts.force, volumes: opts.volumes });
      toast.success("Removed", cleanName(w.name));
      invalidate();
    } catch (err) {
      // A running container refused without force comes back as 409 conflict.
      // Rather than dead-end on a toast, close this dialog and offer a one-click
      // force-remove. (If the user already forced, fall through to the error.)
      if (!opts.force && isRunningConflict(err)) {
        setForcePrompt(w);
        return; // let ConfirmDestructiveDialog close itself; forcePrompt is separate state
      }
      toastError("Remove failed", err);
      throw err;
    }
  };

  // confirmRemoveForced retries the remove with force after the 409 re-prompt.
  const confirmRemoveForced = async (opts: DestructiveOptions) => {
    if (!forcePrompt) return;
    const w = forcePrompt;
    try {
      await api.workloadRemove(hostId, w.id, { force: true, volumes: opts.volumes });
      toast.success("Removed", cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError("Remove failed", err);
      throw err;
    }
  };

  const confirmRemoveProtected = async (reason: string, opts: DestructiveOptions) => {
    if (!pending) return;
    const w = pending.workload;
    try {
      await api.workloadRemove(hostId, w.id, {
        force: opts.force,
        volumes: opts.volumes,
        confirm: true,
        reason,
      });
      toast.success("Removed (override)", cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError("Override remove failed", err);
      throw err;
    }
  };

  const dialogs = (
    <>
      <ConfirmDestructiveDialog
        open={pending?.kind === "stop"}
        title="Stop workload"
        variant="primary"
        confirmLabel="Stop"
        description={
          <>
            Stop <strong className="mono">{cleanName(pending?.workload.name)}</strong>? Running processes
            will receive SIGTERM.
          </>
        }
        onConfirm={confirmStop}
        onClose={closeDialog}
      />
      <ConfirmDestructiveDialog
        open={pending?.kind === "restart"}
        title="Restart workload"
        variant="primary"
        confirmLabel="Restart"
        description={
          <>
            Restart <strong className="mono">{cleanName(pending?.workload.name)}</strong>? The container
            will be stopped and started again.
          </>
        }
        onConfirm={confirmRestart}
        onClose={closeDialog}
      />
      <ConfirmDestructiveDialog
        open={pending?.kind === "remove"}
        title="Remove workload"
        variant="danger"
        confirmLabel="Remove"
        showRemoveOptions
        description={
          <>
            Permanently remove <strong className="mono">{cleanName(pending?.workload.name)}</strong>? This
            cannot be undone.
          </>
        }
        onConfirm={confirmRemove}
        onClose={closeDialog}
      />
      <ReasonPromptDialog
        open={pending?.kind === "remove-protected"}
        title="Remove protected workload"
        targetName={cleanName(pending?.workload.name)}
        showRemoveOptions
        onConfirm={confirmRemoveProtected}
        onClose={closeDialog}
      />
      <ConfirmDestructiveDialog
        open={forcePrompt !== null}
        title="Container is running"
        variant="danger"
        confirmLabel="Force remove"
        description={
          <>
            <strong className="mono">{cleanName(forcePrompt?.name)}</strong> is still running, so it
            can't be removed normally. Force removal will <strong>kill the container</strong> and then
            remove it. This cannot be undone.
          </>
        }
        onConfirm={confirmRemoveForced}
        onClose={closeForcePrompt}
      />
    </>
  );

  return {
    runStart,
    triggerStop,
    triggerRestart,
    triggerRemove,
    busyId,
    dialogs,
    isAdmin,
  };
}
