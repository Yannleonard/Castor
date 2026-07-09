// ui/src/views/useWorkloadActions.tsx
//
// Shared lifecycle action handling for Docker workloads: start/pause/unpause/
// stop/restart/remove with ConfirmDestructiveDialog and (for protected,
// admin-override) ReasonPromptDialog. Returns trigger functions plus the dialog
// elements to render.
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
import { useT, t as tr } from "../i18n";
import { workloadActionsDict } from "../i18n/locales/workloadActions";
import type { Workload } from "../lib/types";

type PendingKind = "stop" | "restart" | "remove" | "remove-protected" | null;

interface Pending {
  kind: PendingKind;
  workload: Workload;
}

// Bulk actions apply to a selection of workloads at once. Only start/stop/remove
// are exposed in the bulk bar (pause/restart stay per-row).
export type BulkAction = "start" | "stop" | "remove";

interface BulkPending {
  action: BulkAction;
  // Already filtered to actionable docker targets (non-protected) by the caller.
  workloads: Workload[];
}

// bulkApi maps a bulk action to its single-target api call.
async function bulkApi(action: BulkAction, hostId: string, w: Workload, opts: DestructiveOptions): Promise<void> {
  switch (action) {
    case "start":
      await api.workloadStart(hostId, w.id);
      return;
    case "stop":
      await api.workloadStop(hostId, w.id);
      return;
    case "remove":
      await api.workloadRemove(hostId, w.id, { force: opts.force, volumes: opts.volumes });
      return;
  }
}

// isRunningConflict reports whether err is the backend's "container is running"
// refusal (HTTP 409 conflict) — the one case a force-remove can resolve. It is
// deliberately narrow: a protected_resource 409 from the guard is NOT included,
// since forcing cannot bypass that.
function isRunningConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === "conflict";
}

export function useWorkloadActions(hostId: string) {
  const t = useT(workloadActionsDict);
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const [pending, setPending] = useState<Pending | null>(null);
  // forcePrompt is a second, independent dialog state: when a non-forced remove is
  // refused with 409 (container running), we offer a one-click force-remove. It is
  // kept separate from `pending` so closing the first dialog doesn't clobber it.
  const [forcePrompt, setForcePrompt] = useState<Workload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Bulk flow: its own dialog state, independent of the single-target `pending`.
  const [bulkPending, setBulkPending] = useState<BulkPending | null>(null);

  const isAdmin = permissions.includes("*");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
    queryClient.invalidateQueries({ queryKey: ["host", hostId] });
  };

  const runStart = async (w: Workload) => {
    setBusyId(w.id);
    try {
      await api.workloadStart(hostId, w.id);
      toast.success(tr(workloadActionsDict, "toast.startedTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError(tr(workloadActionsDict, "toast.startFailed"), err);
    } finally {
      setBusyId(null);
    }
  };

  const runPause = async (w: Workload) => {
    setBusyId(w.id);
    try {
      await api.workloadPause(hostId, w.id);
      toast.success(tr(workloadActionsDict, "toast.pausedTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError(tr(workloadActionsDict, "toast.pauseFailed"), err);
    } finally {
      setBusyId(null);
    }
  };

  const runUnpause = async (w: Workload) => {
    setBusyId(w.id);
    try {
      await api.workloadUnpause(hostId, w.id);
      toast.success(tr(workloadActionsDict, "toast.unpausedTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError(tr(workloadActionsDict, "toast.unpauseFailed"), err);
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
      toast.success(tr(workloadActionsDict, "toast.stoppedTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError(tr(workloadActionsDict, "toast.stopFailed"), err);
      throw err;
    }
  };

  const confirmRestart = async () => {
    if (!pending) return;
    const w = pending.workload;
    try {
      await api.workloadRestart(hostId, w.id);
      toast.success(tr(workloadActionsDict, "toast.restartedTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError(tr(workloadActionsDict, "toast.restartFailed"), err);
      throw err;
    }
  };

  const confirmRemove = async (opts: DestructiveOptions) => {
    if (!pending) return;
    const w = pending.workload;
    try {
      await api.workloadRemove(hostId, w.id, { force: opts.force, volumes: opts.volumes });
      toast.success(tr(workloadActionsDict, "toast.removedTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      // A running container refused without force comes back as 409 conflict.
      // Rather than dead-end on a toast, close this dialog and offer a one-click
      // force-remove. (If the user already forced, fall through to the error.)
      if (!opts.force && isRunningConflict(err)) {
        setForcePrompt(w);
        return; // let ConfirmDestructiveDialog close itself; forcePrompt is separate state
      }
      toastError(tr(workloadActionsDict, "toast.removeFailed"), err);
      throw err;
    }
  };

  // confirmRemoveForced retries the remove with force after the 409 re-prompt.
  const confirmRemoveForced = async (opts: DestructiveOptions) => {
    if (!forcePrompt) return;
    const w = forcePrompt;
    try {
      await api.workloadRemove(hostId, w.id, { force: true, volumes: opts.volumes });
      toast.success(tr(workloadActionsDict, "toast.removedTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError(tr(workloadActionsDict, "toast.removeFailed"), err);
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
      toast.success(tr(workloadActionsDict, "toast.removedOverrideTitle"), cleanName(w.name));
      invalidate();
    } catch (err) {
      toastError(tr(workloadActionsDict, "toast.overrideRemoveFailed"), err);
      throw err;
    }
  };

  // runBulk opens the bulk confirm dialog. Targets are narrowed to actionable
  // docker workloads (non-protected); protected/non-docker are dropped here so
  // the dialog never lists something the backend would refuse. Nothing to do →
  // an info toast instead of an empty dialog.
  const runBulk = (action: BulkAction, workloads: Workload[]) => {
    const targets = workloads.filter((w) => w.kind === "docker" && !w.protected);
    if (targets.length === 0) {
      toast.info(
        tr(workloadActionsDict, "toast.nothingTitle"),
        tr(workloadActionsDict, "toast.nothingBody"),
      );
      return;
    }
    setBulkPending({ action, workloads: targets });
  };

  const closeBulk = () => setBulkPending(null);

  // confirmBulk fires every call in parallel and aggregates the outcome into a
  // single toast ("3 stopped, 1 failed"). It never throws, so the dialog closes
  // even on partial failure; per-item errors are summarized, not re-toasted.
  const confirmBulk = async (opts: DestructiveOptions) => {
    if (!bulkPending) return;
    const { action, workloads } = bulkPending;
    const results = await Promise.allSettled(
      workloads.map((w) => bulkApi(action, hostId, w, opts)),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    const past = tr(workloadActionsDict, `bulk.past.${action}`);
    if (failed === 0) {
      toast.success(
        tr(workloadActionsDict, "toast.bulkCompleteTitle"),
        tr(workloadActionsDict, "toast.bulkCompleteBody", { ok, past }),
      );
    } else if (ok === 0) {
      toast.error(
        tr(workloadActionsDict, "toast.bulkFailedTitle"),
        tr(workloadActionsDict, "toast.bulkFailedBody", { failed }),
      );
    } else {
      toast.warning(
        tr(workloadActionsDict, "toast.bulkPartialTitle"),
        tr(workloadActionsDict, "toast.bulkPartialBody", { ok, past, failed }),
      );
    }
    invalidate();
  };

  const dialogs = (
    <>
      <ConfirmDestructiveDialog
        open={pending?.kind === "stop"}
        title={t("dialog.stopTitle")}
        variant="primary"
        confirmLabel={t("dialog.stopConfirm")}
        description={
          <>
            {t("dialog.stopDescPrefix")}
            <strong className="mono">{cleanName(pending?.workload.name)}</strong>
            {t("dialog.stopDescSuffix")}
          </>
        }
        onConfirm={confirmStop}
        onClose={closeDialog}
      />
      <ConfirmDestructiveDialog
        open={pending?.kind === "restart"}
        title={t("dialog.restartTitle")}
        variant="primary"
        confirmLabel={t("dialog.restartConfirm")}
        description={
          <>
            {t("dialog.restartDescPrefix")}
            <strong className="mono">{cleanName(pending?.workload.name)}</strong>
            {t("dialog.restartDescSuffix")}
          </>
        }
        onConfirm={confirmRestart}
        onClose={closeDialog}
      />
      <ConfirmDestructiveDialog
        open={pending?.kind === "remove"}
        title={t("dialog.removeTitle")}
        variant="danger"
        confirmLabel={t("dialog.removeConfirm")}
        showRemoveOptions
        description={
          <>
            {t("dialog.removeDescPrefix")}
            <strong className="mono">{cleanName(pending?.workload.name)}</strong>
            {t("dialog.removeDescSuffix")}
          </>
        }
        onConfirm={confirmRemove}
        onClose={closeDialog}
      />
      <ReasonPromptDialog
        open={pending?.kind === "remove-protected"}
        title={t("dialog.removeProtectedTitle")}
        targetName={cleanName(pending?.workload.name)}
        showRemoveOptions
        onConfirm={confirmRemoveProtected}
        onClose={closeDialog}
      />
      <ConfirmDestructiveDialog
        open={forcePrompt !== null}
        title={t("dialog.forceTitle")}
        variant="danger"
        confirmLabel={t("dialog.forceConfirm")}
        description={
          <>
            <strong className="mono">{cleanName(forcePrompt?.name)}</strong>
            {t("dialog.forceDescSuffix")}
            <strong>{t("dialog.forceDescKill")}</strong>
            {t("dialog.forceDescTail")}
          </>
        }
        onConfirm={confirmRemoveForced}
        onClose={closeForcePrompt}
      />
      <ConfirmDestructiveDialog
        open={bulkPending !== null}
        title={
          bulkPending
            ? t("dialog.bulkTitle", {
                verb: t(`bulk.verb.${bulkPending.action}`),
                count: bulkPending.workloads.length,
              })
            : ""
        }
        variant={bulkPending?.action === "remove" ? "danger" : "primary"}
        confirmLabel={bulkPending ? t(`bulk.verb.${bulkPending.action}`) : t("dialog.bulkConfirmFallback")}
        showRemoveOptions={bulkPending?.action === "remove"}
        description={
          <div className="col" style={{ gap: "var(--sp-3)" }}>
            <span>
              {bulkPending?.action === "remove" ? (
                <>
                  {t("dialog.bulkRemovePrefix")}
                  <strong>{bulkPending.workloads.length}</strong>
                  {t("dialog.bulkRemoveSuffix")}
                </>
              ) : (
                <>
                  {t(`bulk.verb.${bulkPending?.action ?? "stop"}`)}
                  {t("dialog.bulkActionSuffix")}
                  <strong>{bulkPending?.workloads.length}</strong>
                  {t("dialog.bulkActionTail")}
                </>
              )}
            </span>
            <ul className="col" style={{ gap: 2, maxHeight: 200, overflow: "auto", margin: 0, paddingLeft: "var(--sp-4)" }}>
              {bulkPending?.workloads.map((w) => (
                <li key={w.id} className="mono text-sm">
                  {cleanName(w.name)}
                </li>
              ))}
            </ul>
          </div>
        }
        onConfirm={confirmBulk}
        onClose={closeBulk}
      />
    </>
  );

  return {
    runStart,
    runPause,
    runUnpause,
    triggerStop,
    triggerRestart,
    triggerRemove,
    runBulk,
    busyId,
    dialogs,
    isAdmin,
  };
}
