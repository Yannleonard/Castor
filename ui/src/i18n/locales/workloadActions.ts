// Castor by IT Leonard
// ui/src/i18n/locales/workloadActions.ts
//
// Locale dictionary for the shared workload lifecycle actions hook
// (ui/src/views/useWorkloadActions.tsx). Covers the confirm/reason dialogs and
// the success/error toasts for start/pause/unpause/stop/restart/remove, plus the
// bulk-action flow.
//
// Key zones:
//   toast.*  toast titles + bodies (some support {vars} interpolation)
//   dialog.* confirm/reason dialog titles, confirm labels, descriptions
//   bulk.*   bulk-action verbs (verb.*), past participles (past.*), toasts
//
// DO NOT translate technical identifiers rendered verbatim from data (workload
// names, action ids). Those never pass through `t`.

import { defineDict } from "../core";

export const workloadActionsDict = defineDict({
  en: {
    // Single-action toasts (title only; body is the workload name)
    "toast.startedTitle": "Started",
    "toast.startFailed": "Start failed",
    "toast.pausedTitle": "Paused",
    "toast.pauseFailed": "Pause failed",
    "toast.unpausedTitle": "Unpaused",
    "toast.unpauseFailed": "Unpause failed",
    "toast.stoppedTitle": "Stopped",
    "toast.stopFailed": "Stop failed",
    "toast.restartedTitle": "Restarted",
    "toast.restartFailed": "Restart failed",
    "toast.removedTitle": "Removed",
    "toast.removeFailed": "Remove failed",
    "toast.removedOverrideTitle": "Removed (override)",
    "toast.overrideRemoveFailed": "Override remove failed",

    // Bulk: nothing-to-do info toast
    "toast.nothingTitle": "Nothing to do",
    "toast.nothingBody": "None of the selected workloads support this action.",

    // Stop dialog
    "dialog.stopTitle": "Stop workload",
    "dialog.stopConfirm": "Stop",
    // description split around the workload name (rendered <strong> between)
    "dialog.stopDescPrefix": "Stop ",
    "dialog.stopDescSuffix": "? Running processes will receive SIGTERM.",

    // Restart dialog
    "dialog.restartTitle": "Restart workload",
    "dialog.restartConfirm": "Restart",
    "dialog.restartDescPrefix": "Restart ",
    "dialog.restartDescSuffix": "? The container will be stopped and started again.",

    // Remove dialog
    "dialog.removeTitle": "Remove workload",
    "dialog.removeConfirm": "Remove",
    "dialog.removeDescPrefix": "Permanently remove ",
    "dialog.removeDescSuffix": "? This cannot be undone.",

    // Remove protected (reason prompt) dialog
    "dialog.removeProtectedTitle": "Remove protected workload",

    // Force-remove (409 running) dialog
    "dialog.forceTitle": "Container is running",
    "dialog.forceConfirm": "Force remove",
    "dialog.forceDescSuffix": " is still running, so it can't be removed normally. Force removal will ",
    "dialog.forceDescKill": "kill the container",
    "dialog.forceDescTail": " and then remove it. This cannot be undone.",

    // Bulk dialog
    "dialog.bulkTitle": "{verb} {count} workloads",
    "dialog.bulkConfirmFallback": "Confirm",
    "dialog.bulkRemovePrefix": "Permanently remove the following ",
    "dialog.bulkRemoveSuffix": " workloads? This cannot be undone.",
    "dialog.bulkActionSuffix": " the following ",
    "dialog.bulkActionTail": " workloads?",

    // Bulk action verbs (button labels / dialog title)
    "bulk.verb.start": "Start",
    "bulk.verb.stop": "Stop",
    "bulk.verb.remove": "Remove",

    // Bulk past participles (used in result toasts)
    "bulk.past.start": "started",
    "bulk.past.stop": "stopped",
    "bulk.past.remove": "removed",

    // Bulk result toasts
    "toast.bulkCompleteTitle": "Bulk action complete",
    "toast.bulkCompleteBody": "{ok} {past}.",
    "toast.bulkFailedTitle": "Bulk action failed",
    "toast.bulkFailedBody": "{failed} failed.",
    "toast.bulkPartialTitle": "Bulk action partial",
    "toast.bulkPartialBody": "{ok} {past}, {failed} failed.",
  },
  fr: {
    // Toasts d'action unitaire (titre seul ; le corps est le nom du workload)
    "toast.startedTitle": "Démarré",
    "toast.startFailed": "Échec du démarrage",
    "toast.pausedTitle": "En pause",
    "toast.pauseFailed": "Échec de la mise en pause",
    "toast.unpausedTitle": "Repris",
    "toast.unpauseFailed": "Échec de la reprise",
    "toast.stoppedTitle": "Arrêté",
    "toast.stopFailed": "Échec de l'arrêt",
    "toast.restartedTitle": "Redémarré",
    "toast.restartFailed": "Échec du redémarrage",
    "toast.removedTitle": "Supprimé",
    "toast.removeFailed": "Échec de la suppression",
    "toast.removedOverrideTitle": "Supprimé (dérogation)",
    "toast.overrideRemoveFailed": "Échec de la suppression avec dérogation",

    // Bulk : toast « rien à faire »
    "toast.nothingTitle": "Rien à faire",
    "toast.nothingBody": "Aucun des workloads sélectionnés ne prend en charge cette action.",

    // Dialogue d'arrêt
    "dialog.stopTitle": "Arrêter le workload",
    "dialog.stopConfirm": "Arrêter",
    "dialog.stopDescPrefix": "Arrêter ",
    "dialog.stopDescSuffix": " ? Les processus en cours recevront SIGTERM.",

    // Dialogue de redémarrage
    "dialog.restartTitle": "Redémarrer le workload",
    "dialog.restartConfirm": "Redémarrer",
    "dialog.restartDescPrefix": "Redémarrer ",
    "dialog.restartDescSuffix": " ? Le conteneur sera arrêté puis redémarré.",

    // Dialogue de suppression
    "dialog.removeTitle": "Supprimer le workload",
    "dialog.removeConfirm": "Supprimer",
    "dialog.removeDescPrefix": "Supprimer définitivement ",
    "dialog.removeDescSuffix": " ? Cette action est irréversible.",

    // Dialogue de suppression protégée (demande de motif)
    "dialog.removeProtectedTitle": "Supprimer un workload protégé",

    // Dialogue de suppression forcée (409 en cours d'exécution)
    "dialog.forceTitle": "Le conteneur est en cours d'exécution",
    "dialog.forceConfirm": "Forcer la suppression",
    "dialog.forceDescSuffix": " est toujours en cours d'exécution et ne peut donc pas être supprimé normalement. La suppression forcée va ",
    "dialog.forceDescKill": "tuer le conteneur",
    "dialog.forceDescTail": " puis le supprimer. Cette action est irréversible.",

    // Dialogue groupé
    "dialog.bulkTitle": "{verb} {count} workloads",
    "dialog.bulkConfirmFallback": "Confirmer",
    "dialog.bulkRemovePrefix": "Supprimer définitivement les ",
    "dialog.bulkRemoveSuffix": " workloads suivants ? Cette action est irréversible.",
    "dialog.bulkActionSuffix": " les ",
    "dialog.bulkActionTail": " workloads suivants ?",

    // Verbes d'action groupée (libellés de bouton / titre du dialogue)
    "bulk.verb.start": "Démarrer",
    "bulk.verb.stop": "Arrêter",
    "bulk.verb.remove": "Supprimer",

    // Participes passés pour les toasts de résultat groupé
    "bulk.past.start": "démarré(s)",
    "bulk.past.stop": "arrêté(s)",
    "bulk.past.remove": "supprimé(s)",

    // Toasts de résultat groupé
    "toast.bulkCompleteTitle": "Action groupée terminée",
    "toast.bulkCompleteBody": "{ok} {past}.",
    "toast.bulkFailedTitle": "Échec de l'action groupée",
    "toast.bulkFailedBody": "{failed} en échec.",
    "toast.bulkPartialTitle": "Action groupée partielle",
    "toast.bulkPartialBody": "{ok} {past}, {failed} en échec.",
  },
});
