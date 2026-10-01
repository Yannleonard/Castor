// Castor by IT Leonard
// ui/src/i18n/locales/stacks.ts
//
// Locale dictionary for the Stacks view (ui/src/views/Stacks.tsx). Follows the
// reference model in ./audit.ts: one dictionary per view, authored with
// `defineDict` (en + fr halves), camelCase keys namespaced by UI zone.
//
//   header.*  page header (title/subtitle) + toolbar actions
//   badge.*   stack-status pill labels
//   filter.*  search bar (placeholder, "X of Y" counter)
//   col.*     table column headers
//   row.*     row-level actions + capability-gate reasons
//   empty.*   empty-state title/message/action
//   list.*    loading label + table empty labels
//   dialog.*  bring-down confirm dialog
//   toast.*   toast titles + bodies (support {vars} interpolation)
//
// DO NOT translate technical identifiers (permission strings like
// docker.container.remove, backend status values) — those are rendered verbatim
// from data, never through `t`.

import { defineDict } from "../core";

export const stacksDict = defineDict({
  en: {
    // Page header
    "header.title": "Stacks",
    "header.subtitle": "Multi-container compose stacks on this host.",
    "header.deploy": "Deploy stack",
    "header.refresh": "Refresh",

    // Stack-status pill labels
    "badge.running": "Running",
    "badge.partial": "Partial",
    "badge.pending": "Pending",
    "badge.stopped": "Stopped",
    "badge.error": "Error",

    // Search bar
    "filter.searchPlaceholder": "Search stacks…",
    "filter.count": "{shown} of {total}",

    // Table columns
    "col.name": "Name",
    "col.status": "Status",
    "col.services": "Services",
    "col.created": "Created",

    // Name cell + row actions
    "row.gitBadge": "Git",
    "row.gitTracked": "Tracked from {url}",
    "row.gitTrackedRef": "Tracked from {url} ({ref})",
    "row.bringDown": "Bring stack down",
    "row.noRemoveSupport": "Provider does not support removal",
    "row.needRemovePerm": "Requires docker.container.remove",
    "row.noDeploySupport": "Provider does not support deploy",
    "row.needCreatePerm": "Requires docker.container.create",

    // Empty state (no stacks on the host)
    "empty.title": "No stacks",
    "empty.message": "Deploy a multi-container stack from a compose file to get started.",
    "empty.action": "Create your first stack",

    // Loading / filtered-empty table
    "list.loading": "Loading stacks…",
    "list.emptyTitle": "No stacks",
    "list.emptyMessage": "Deploy a stack from a compose file to get started.",

    // Bring-down confirm dialog
    "dialog.title": "Bring stack down",
    "dialog.confirm": "Bring down",
    "dialog.descPrefix": "Bring down",
    "dialog.descSuffix":
      "? All {count} container(s) in this stack will be stopped and removed, along with the stack's network(s). Named volumes are left intact.",

    // Toasts
    "toast.removedTitle": "Stack removed",
    "toast.downFailed": "Bring down failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Stacks",
    "header.subtitle": "Stacks compose multi-conteneurs sur cet hôte.",
    "header.deploy": "Déployer un stack",
    "header.refresh": "Actualiser",

    // Libellés des pastilles de statut
    "badge.running": "En cours",
    "badge.partial": "Partiel",
    "badge.pending": "En attente",
    "badge.stopped": "Arrêté",
    "badge.error": "Erreur",

    // Barre de recherche
    "filter.searchPlaceholder": "Rechercher des stacks…",
    "filter.count": "{shown} sur {total}",

    // Colonnes du tableau
    "col.name": "Nom",
    "col.status": "Statut",
    "col.services": "Services",
    "col.created": "Créé",

    // Cellule nom + actions de ligne
    "row.gitBadge": "Git",
    "row.gitTracked": "Suivi depuis {url}",
    "row.gitTrackedRef": "Suivi depuis {url} ({ref})",
    "row.bringDown": "Arrêter le stack",
    "row.noRemoveSupport": "Le fournisseur ne prend pas en charge la suppression",
    "row.needRemovePerm": "Nécessite docker.container.remove",
    "row.noDeploySupport": "Le fournisseur ne prend pas en charge le déploiement",
    "row.needCreatePerm": "Nécessite docker.container.create",

    // État vide (aucun stack sur l'hôte)
    "empty.title": "Aucun stack",
    "empty.message": "Déployez un stack multi-conteneurs depuis un fichier compose pour commencer.",
    "empty.action": "Créer votre premier stack",

    // Chargement / tableau filtré vide
    "list.loading": "Chargement des stacks…",
    "list.emptyTitle": "Aucun stack",
    "list.emptyMessage": "Déployez un stack depuis un fichier compose pour commencer.",

    // Fenêtre de confirmation d'arrêt
    "dialog.title": "Arrêter le stack",
    "dialog.confirm": "Arrêter",
    "dialog.descPrefix": "Arrêter",
    "dialog.descSuffix":
      " ? Les {count} conteneur(s) de ce stack seront arrêtés et supprimés, ainsi que le(s) réseau(x) du stack. Les volumes nommés sont conservés.",

    // Toasts
    "toast.removedTitle": "Stack supprimé",
    "toast.downFailed": "Échec de l'arrêt",
  },
});
