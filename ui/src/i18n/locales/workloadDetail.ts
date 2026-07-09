// ui/src/i18n/locales/workloadDetail.ts
//
// Locale dictionary for the Workload detail view (ui/src/views/WorkloadDetail.tsx).
// Follows the audit.ts model: one dict per view, camelCase keys namespaced by UI
// zone (tab.*, header.*, banner.*, dialog.*, gate.*, loading.*, empty.*, toast.*).
//
// NOT translated (rendered verbatim from data / technical identifiers): workload
// names, image refs, ids, node names, permission strings (docker.container.update),
// orchestrator kinds. Those never pass through `t`.

import { defineDict } from "../core";

export const workloadDetailDict = defineDict({
  en: {
    // Tabs
    "tab.overview": "Overview",
    "tab.logs": "Logs",
    "tab.stats": "Stats",
    "tab.terminal": "Terminal",
    "tab.inspect": "Inspect",

    // Header actions
    "header.refresh": "Refresh",

    // Loading / not-found states
    "loading.workload": "Loading workload…",
    "empty.title": "Workload not found",
    "empty.message": "It may have been removed, or you may not have access.",
    "empty.back": "Back to workloads",
    "empty.pageTitle": "Workload",

    // Update banner
    "banner.updateAvailable": "A newer image is available for",
    "banner.updateNow": "Update now",

    // Capability gate reasons for the update action
    "gate.protected": "Protected — cannot be recreated",
    "gate.missingPermission": "You lack the docker.container.update permission",

    // Update confirmation dialog
    "dialog.title": "Update container",
    "dialog.confirm": "Update",
    "dialog.descPull": "Pull the newest image for",
    "dialog.descRecreate": "and recreate",
    "dialog.descConfig": "with the same configuration. The container restarts on the new image — expect a brief downtime.",

    // Toasts
    "toast.updatedTitle": "Updated",
    "toast.updatedBody": "{name} recreated on the newest image",
    "toast.updateFailed": "Update failed",
  },
  fr: {
    // Onglets
    "tab.overview": "Vue d'ensemble",
    "tab.logs": "Journaux",
    "tab.stats": "Statistiques",
    "tab.terminal": "Terminal",
    "tab.inspect": "Inspecter",

    // Actions d'en-tête
    "header.refresh": "Actualiser",

    // États chargement / introuvable
    "loading.workload": "Chargement du workload…",
    "empty.title": "Workload introuvable",
    "empty.message": "Il a peut-être été supprimé, ou vous n'y avez pas accès.",
    "empty.back": "Retour aux workloads",
    "empty.pageTitle": "Workload",

    // Bannière de mise à jour
    "banner.updateAvailable": "Une image plus récente est disponible pour",
    "banner.updateNow": "Mettre à jour",

    // Motifs de blocage pour l'action de mise à jour
    "gate.protected": "Protégé — ne peut pas être recréé",
    "gate.missingPermission": "Vous n'avez pas la permission docker.container.update",

    // Fenêtre de confirmation de mise à jour
    "dialog.title": "Mettre à jour le conteneur",
    "dialog.confirm": "Mettre à jour",
    "dialog.descPull": "Récupérer l'image la plus récente pour",
    "dialog.descRecreate": "et recréer",
    "dialog.descConfig": "avec la même configuration. Le conteneur redémarre sur la nouvelle image — une brève interruption est à prévoir.",

    // Toasts
    "toast.updatedTitle": "Mis à jour",
    "toast.updatedBody": "{name} recréé sur l'image la plus récente",
    "toast.updateFailed": "Échec de la mise à jour",
  },
});
