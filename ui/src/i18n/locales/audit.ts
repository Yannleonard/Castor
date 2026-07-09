// ui/src/i18n/locales/audit.ts
//
// Locale dictionary for the Audit view (ui/src/views/Audit.tsx). This file is
// the REFERENCE MODEL other view-conversion agents follow:
//
//   • One dictionary per view, authored with `defineDict` (en + fr halves).
//   • Keys are camelCase, namespaced by UI zone:
//       header.*  page header (title/subtitle) + toolbar actions
//       filter.*  filter bar (placeholders, result options, buttons)
//       col.*     table column headers
//       empty.*   empty-state title/message
//       list.*    pagination / footer
//       detail.*  detail modal labels
//       toast.*   toast titles + bodies (support {vars} interpolation)
//   • Interpolations use {token} — e.g. list.endOfLog: "End of log · {count} …".
//   • DO NOT translate technical identifiers: action names (docker.container.stop),
//     permission strings, API values (success/denied/error), scope ids. Those are
//     rendered verbatim from the data, never through `t`.

import { defineDict } from "../core";

export const auditDict = defineDict({
  en: {
    // Page header
    "header.title": "Audit log",
    "header.subtitle": "Append-only record of every mutating action and access decision.",
    "header.exportLoaded": "Export loaded rows",
    "header.exportLoadedEmpty": "No rows loaded yet",
    "header.exportAll": "Load all then export",
    "header.refresh": "Refresh",

    // Filter bar
    "filter.actionPlaceholder": "Action (e.g. docker.container.stop)",
    "filter.actorPlaceholder": "Actor id",
    "filter.targetPlaceholder": "Target type",
    "filter.apply": "Apply",
    "filter.reset": "Reset",
    "filter.resultAll": "All results",
    "filter.resultSuccess": "Success",
    "filter.resultDenied": "Denied",
    "filter.resultError": "Error",

    // Result cell (capitalized labels for the `result` values)
    "result.success": "Success",
    "result.denied": "Denied",
    "result.error": "Error",

    // Table columns
    "col.time": "Time",
    "col.result": "Result",
    "col.actor": "Actor",
    "col.action": "Action",
    "col.target": "Target",
    "col.http": "HTTP",

    // Row-level actions
    "row.viewDetail": "View detail",

    // Empty state
    "empty.title": "No audit entries",
    "empty.message": "Nothing matches the current filters.",

    // Loading / pagination footer
    "list.loading": "Loading audit log…",
    "list.loadMore": "Load more",
    "list.endOfLog": "End of log · {count} entries loaded",

    // Detail modal
    "detail.title": "Audit entry",
    "detail.time": "Time",
    "detail.result": "Result",
    "detail.actor": "Actor",
    "detail.action": "Action",
    "detail.target": "Target",
    "detail.scope": "Scope",
    "detail.httpStatus": "HTTP status",
    "detail.requestId": "Request id",
    "detail.sanitized": "Detail (sanitized)",

    // Toasts
    "toast.nothingTitle": "Nothing to export",
    "toast.nothingBody": "No audit rows are loaded.",
    "toast.exportedTitle": "Export ready",
    "toast.exportedBody": "{count} rows written to CSV.",
    "toast.exportFailed": "Export failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Journal d'audit",
    "header.subtitle": "Enregistrement en ajout seul de chaque action modifiante et décision d'accès.",
    "header.exportLoaded": "Exporter les lignes chargées",
    "header.exportLoadedEmpty": "Aucune ligne chargée pour l'instant",
    "header.exportAll": "Tout charger puis exporter",
    "header.refresh": "Actualiser",

    // Barre de filtres
    "filter.actionPlaceholder": "Action (ex. docker.container.stop)",
    "filter.actorPlaceholder": "Id de l'acteur",
    "filter.targetPlaceholder": "Type de cible",
    "filter.apply": "Appliquer",
    "filter.reset": "Réinitialiser",
    "filter.resultAll": "Tous les résultats",
    "filter.resultSuccess": "Succès",
    "filter.resultDenied": "Refusé",
    "filter.resultError": "Erreur",

    // Cellule résultat
    "result.success": "Succès",
    "result.denied": "Refusé",
    "result.error": "Erreur",

    // Colonnes du tableau
    "col.time": "Heure",
    "col.result": "Résultat",
    "col.actor": "Acteur",
    "col.action": "Action",
    "col.target": "Cible",
    "col.http": "HTTP",

    // Actions au niveau ligne
    "row.viewDetail": "Voir le détail",

    // État vide
    "empty.title": "Aucune entrée d'audit",
    "empty.message": "Rien ne correspond aux filtres actuels.",

    // Chargement / pagination
    "list.loading": "Chargement du journal d'audit…",
    "list.loadMore": "Charger plus",
    "list.endOfLog": "Fin du journal · {count} entrées chargées",

    // Fenêtre de détail
    "detail.title": "Entrée d'audit",
    "detail.time": "Heure",
    "detail.result": "Résultat",
    "detail.actor": "Acteur",
    "detail.action": "Action",
    "detail.target": "Cible",
    "detail.scope": "Portée",
    "detail.httpStatus": "Statut HTTP",
    "detail.requestId": "Id de requête",
    "detail.sanitized": "Détail (expurgé)",

    // Toasts
    "toast.nothingTitle": "Rien à exporter",
    "toast.nothingBody": "Aucune ligne d'audit n'est chargée.",
    "toast.exportedTitle": "Export prêt",
    "toast.exportedBody": "{count} lignes écrites en CSV.",
    "toast.exportFailed": "Échec de l'export",
  },
});
