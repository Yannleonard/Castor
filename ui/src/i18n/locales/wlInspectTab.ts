// Castor by IT Leonard
// ui/src/i18n/locales/wlInspectTab.ts
//
// Locale dictionary for the workload Inspect tab
// (ui/src/views/workload/InspectTab.tsx): pretty-printed engine-native inspect
// JSON with a client-side line filter and a copy-to-clipboard action.
//
// NOTE: technical values (JSON, clipboard) are user-facing wording, not
// identifiers, so they are translated. The literal "// no matching lines"
// placeholder is a translated hint shown inside the <pre>.

import { defineDict } from "../core";

export const wlInspectTabDict = defineDict({
  en: {
    // Filter bar
    "filter.placeholder": "Filter JSON lines…",
    "filter.secretNote": "Secret env masked unless granted.",

    // Header action
    "action.copy": "Copy",

    // Code block placeholder
    "empty.noMatch": "// no matching lines",

    // Toasts
    "toast.copiedTitle": "Copied",
    "toast.copiedBody": "Inspect JSON copied to clipboard.",
    "toast.copyFailedTitle": "Copy failed",
    "toast.copyFailedBody": "Clipboard is unavailable.",
  },
  fr: {
    // Barre de filtre
    "filter.placeholder": "Filtrer les lignes JSON…",
    "filter.secretNote": "Variables secrètes masquées sans autorisation.",

    // Action d'en-tête
    "action.copy": "Copier",

    // Texte du bloc de code
    "empty.noMatch": "// aucune ligne correspondante",

    // Toasts
    "toast.copiedTitle": "Copié",
    "toast.copiedBody": "JSON d'inspection copié dans le presse-papiers.",
    "toast.copyFailedTitle": "Échec de la copie",
    "toast.copyFailedBody": "Le presse-papiers est indisponible.",
  },
});
