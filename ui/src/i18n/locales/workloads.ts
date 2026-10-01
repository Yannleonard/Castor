// Castor by IT Leonard
// ui/src/i18n/locales/workloads.ts
//
// Locale dictionary for the Workloads view (ui/src/views/Workloads.tsx). Follows
// the audit.ts reference model: one dictionary per view, authored with
// `defineDict`, camelCase keys namespaced by UI zone.
//
//   header.*  page header (title/subtitle) + toolbar actions
//   filter.*  filter toolbar (search, kind/state selects, checkbox, counter)
//   col.*     table column headers + in-cell badges
//   row.*     row-level action tooltips / labels
//   empty.*   empty-state titles + messages
//   bulk.*    bulk-selection bar (labels + action buttons + tooltips)
//   dialog.*  destructive-confirmation dialogs (prune / update)
//   toast.*   toast titles + bodies (support {vars} interpolation)
//
// DO NOT translate technical identifiers rendered verbatim from data or gates:
// permission strings (docker.image.pull, docker.container.update), orchestrator
// kind values, workload state values, image names. Those never pass through `t`.

import { defineDict } from "../core";

export const workloadsDict = defineDict({
  en: {
    // Page header
    "header.title": "Workloads",
    "header.subtitle": "Every container, service-task and pod across your orchestrators.",
    "header.pruneStopped": "Prune stopped",
    "header.checkUpdates": "Check updates",
    "header.refresh": "Refresh",

    // Capability-gate reasons (permission strings stay verbatim)
    "gate.needImagePull": "You lack the docker.image.pull permission",

    // Filter toolbar
    "filter.searchPlaceholder": "Search name, image, id, node…",
    "filter.kindAll": "All orchestrators",
    "filter.stateAll": "All states",
    "filter.stateRunning": "Running",
    "filter.stateStopped": "Stopped",
    "filter.statePaused": "Paused",
    "filter.stateRestarting": "Restarting",
    "filter.statePending": "Pending",
    "filter.stateUnknown": "Unknown",
    "filter.stacksAll": "All stacks",
    "filter.includeStopped": "Include stopped",
    "filter.counter": "{shown} of {total}",

    // Loading
    "list.loading": "Loading workloads…",

    // Table columns
    "col.name": "Name",
    "col.state": "State",
    "col.orchestrator": "Orchestrator",
    "col.image": "Image",
    "col.group": "Stack / group",
    "col.ports": "Ports",
    "col.created": "Created",

    // In-cell badges / tooltips
    "col.updatePill": "update",
    "col.updateAvailableTitle": "New image digest available: {image}",

    // Row-level actions
    "row.protectedTooltip": "Protected — cannot be recreated",
    "row.updateTooltip": "Update to the newest image",
    "row.updateLabel": "Update",

    // Empty states
    "empty.noneTitle": "No workloads yet",
    "empty.noneMessage": "Deploy your first app from the Marketplace — a container will show up here.",
    "empty.noneAction": "Deploy your first app",
    "empty.noMatchTitle": "No workloads match",
    "empty.noMatchMessage": "Adjust the filters above, or start some containers.",

    // Bulk-selection bar
    "bulk.selected": "{count} selected",
    "bulk.actionable": "{count} actionable (docker, unprotected)",
    "bulk.start": "Start",
    "bulk.stop": "Stop",
    "bulk.remove": "Remove",
    "bulk.clear": "Clear",
    "bulk.startDisabled": "No selected docker workloads can be started",
    "bulk.stopDisabled": "No selected docker workloads can be stopped",
    "bulk.removeDisabled": "No selected docker workloads can be removed",

    // Prune dialog
    "dialog.pruneTitle": "Prune stopped containers",
    "dialog.pruneConfirm": "Prune",
    "dialog.pruneAllStopped": "all stopped containers",
    "dialog.pruneBody1": "Permanently remove ",
    "dialog.pruneBody2": " on this host. Their writable layers are deleted; images and named volumes are kept. This cannot be undone.",

    // Update dialog
    "dialog.updateTitle": "Update container",
    "dialog.updateConfirm": "Update",
    "dialog.updateBody1": "Pull the newest image for ",
    "dialog.updateBody2": " and recreate ",
    "dialog.updateBody3": " with the same configuration. The container restarts on the new image — expect a brief downtime.",

    // Toasts
    "toast.prunedTitle": "Pruned",
    "toast.prunedBody": "{count} containers · {size} reclaimed",
    "toast.pruneFailed": "Prune failed",
    "toast.updateCheckStartedTitle": "Update check started",
    "toast.updateCheckStartedBody": "Comparing image digests against registries…",
    "toast.updateCheckFailed": "Update check failed",
    "toast.updatedTitle": "Updated",
    "toast.updatedBody": "{name} recreated on the newest image",
    "toast.updateFailed": "Update failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Workloads",
    "header.subtitle": "Chaque conteneur, tâche de service et pod de vos orchestrateurs.",
    "header.pruneStopped": "Purger les arrêtés",
    "header.checkUpdates": "Vérifier les mises à jour",
    "header.refresh": "Actualiser",

    // Motifs de gate de capacité (les chaînes de permission restent verbatim)
    "gate.needImagePull": "Vous n'avez pas la permission docker.image.pull",

    // Barre de filtres
    "filter.searchPlaceholder": "Rechercher par nom, image, id, nœud…",
    "filter.kindAll": "Tous les orchestrateurs",
    "filter.stateAll": "Tous les états",
    "filter.stateRunning": "En cours",
    "filter.stateStopped": "Arrêté",
    "filter.statePaused": "En pause",
    "filter.stateRestarting": "Redémarrage",
    "filter.statePending": "En attente",
    "filter.stateUnknown": "Inconnu",
    "filter.stacksAll": "Toutes les stacks",
    "filter.includeStopped": "Inclure les arrêtés",
    "filter.counter": "{shown} sur {total}",

    // Chargement
    "list.loading": "Chargement des workloads…",

    // Colonnes du tableau
    "col.name": "Nom",
    "col.state": "État",
    "col.orchestrator": "Orchestrateur",
    "col.image": "Image",
    "col.group": "Stack / groupe",
    "col.ports": "Ports",
    "col.created": "Créé",

    // Badges / infobulles en cellule
    "col.updatePill": "mise à jour",
    "col.updateAvailableTitle": "Nouveau digest d'image disponible : {image}",

    // Actions au niveau ligne
    "row.protectedTooltip": "Protégé — ne peut pas être recréé",
    "row.updateTooltip": "Mettre à jour vers la dernière image",
    "row.updateLabel": "Mettre à jour",

    // États vides
    "empty.noneTitle": "Aucun workload pour l'instant",
    "empty.noneMessage": "Déployez votre première application depuis le Marketplace — un conteneur apparaîtra ici.",
    "empty.noneAction": "Déployer votre première application",
    "empty.noMatchTitle": "Aucun workload correspondant",
    "empty.noMatchMessage": "Ajustez les filtres ci-dessus, ou démarrez des conteneurs.",

    // Barre de sélection groupée
    "bulk.selected": "{count} sélectionné(s)",
    "bulk.actionable": "{count} actionnable(s) (docker, non protégé)",
    "bulk.start": "Démarrer",
    "bulk.stop": "Arrêter",
    "bulk.remove": "Retirer",
    "bulk.clear": "Effacer",
    "bulk.startDisabled": "Aucun workload docker sélectionné ne peut être démarré",
    "bulk.stopDisabled": "Aucun workload docker sélectionné ne peut être arrêté",
    "bulk.removeDisabled": "Aucun workload docker sélectionné ne peut être retiré",

    // Fenêtre de purge
    "dialog.pruneTitle": "Purger les conteneurs arrêtés",
    "dialog.pruneConfirm": "Purger",
    "dialog.pruneAllStopped": "tous les conteneurs arrêtés",
    "dialog.pruneBody1": "Supprimer définitivement ",
    "dialog.pruneBody2": " sur cet hôte. Leurs couches inscriptibles sont supprimées ; les images et les volumes nommés sont conservés. Cette action est irréversible.",

    // Fenêtre de mise à jour
    "dialog.updateTitle": "Mettre à jour le conteneur",
    "dialog.updateConfirm": "Mettre à jour",
    "dialog.updateBody1": "Récupérer la dernière image pour ",
    "dialog.updateBody2": " et recréer ",
    "dialog.updateBody3": " avec la même configuration. Le conteneur redémarre sur la nouvelle image — prévoyez une brève interruption.",

    // Toasts
    "toast.prunedTitle": "Purgé",
    "toast.prunedBody": "{count} conteneurs · {size} récupérés",
    "toast.pruneFailed": "Échec de la purge",
    "toast.updateCheckStartedTitle": "Vérification des mises à jour lancée",
    "toast.updateCheckStartedBody": "Comparaison des digests d'images avec les registres…",
    "toast.updateCheckFailed": "Échec de la vérification des mises à jour",
    "toast.updatedTitle": "Mis à jour",
    "toast.updatedBody": "{name} recréé sur la dernière image",
    "toast.updateFailed": "Échec de la mise à jour",
  },
});
