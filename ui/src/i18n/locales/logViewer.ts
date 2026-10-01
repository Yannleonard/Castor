// Castor by IT Leonard
// ui/src/i18n/locales/logViewer.ts
//
// Locale dictionary for the LogViewer component (ui/src/components/LogViewer.tsx),
// a virtualized stdout/stderr log viewer with a client-side filter and a follow
// (auto-scroll) toggle.
//
// Conventions follow ui/src/i18n/locales/audit.ts:
//   • camelCase keys namespaced by UI zone:
//       filter.*  filter input (placeholder, aria-label)
//       count.*   line-count label next to the filter
//       action.*  header controls (follow, download, clear)
//       empty.*   empty-state messages inside the scroll area
//   • DO NOT translate technical stream names (stdout/stderr) — those come from
//     the data and are never rendered through `t`.

import { defineDict } from "../core";

export const logViewerDict = defineDict({
  en: {
    // Filter input
    "filter.placeholder": "Filter log lines…",
    "filter.aria": "Filter logs",

    // Line-count label (rendered after the formatted number)
    "count.matched": "matched",
    "count.lines": "lines",

    // Header controls
    "action.follow": "Follow",
    "action.download": "Download logs",
    "action.clear": "Clear",
    "action.clearTooltip": "Clear buffer",

    // Empty state
    "empty.noMatch": "No lines match the filter.",
    "empty.waiting": "Waiting for log output…",
  },
  fr: {
    // Champ de filtre
    "filter.placeholder": "Filtrer les lignes de log…",
    "filter.aria": "Filtrer les logs",

    // Étiquette du compteur de lignes
    "count.matched": "correspondantes",
    "count.lines": "lignes",

    // Contrôles de l'en-tête
    "action.follow": "Suivre",
    "action.download": "Télécharger les logs",
    "action.clear": "Vider",
    "action.clearTooltip": "Vider le tampon",

    // État vide
    "empty.noMatch": "Aucune ligne ne correspond au filtre.",
    "empty.waiting": "En attente de sortie des logs…",
  },
});
