// ui/src/i18n/locales/notFound.ts
//
// Locale dictionary for the NotFound view (ui/src/views/NotFound.tsx).
// Follows the audit.ts reference model: one dictionary per view, camelCase keys
// namespaced by UI zone.

import { defineDict } from "../core";

export const notFoundDict = defineDict({
  en: {
    "empty.title": "Page not found",
    "empty.message": "This page does not exist or has moved. The beaver looked everywhere.",
    "action.back": "Back to dashboard",
  },
  fr: {
    "empty.title": "Page introuvable",
    "empty.message": "Cette page n'existe pas ou a été déplacée. Le castor a cherché partout.",
    "action.back": "Retour au tableau de bord",
  },
});
