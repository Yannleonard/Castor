// Castor by IT Leonard
// ui/src/i18n/locales/wlStatsTab.ts
//
// Locale dictionary for the workload Stats tab (ui/src/views/workload/StatsTab.tsx).
// Follows the audit.ts model: one dict per view, camelCase keys namespaced by zone.
//
// NOTE: the raw live-stream `status` value (connecting/live/superseded/error/ended)
// is a technical state rendered verbatim from the component and is NOT translated.

import { defineDict } from "../core";

export const wlStatsTabDict = defineDict({
  en: {
    // Banners
    "banner.superseded":
      "Live stats were taken over by another workload (one live stream per session). Reopen this tab to resume here.",
    "banner.error": "Stats stream error: {msg}",

    // Chart / metric labels
    "metric.cpu": "CPU",
    "metric.memory": "Memory",
    "metric.netRx": "Net RX",
    "metric.netTx": "Net TX",
    "metric.blockRead": "Block read",
    "metric.blockWrite": "Block write",

    // Status footer
    "status.label": "Status:",
    "status.note": "one live stats stream per session (server-enforced).",
  },
  fr: {
    // Bannières
    "banner.superseded":
      "Les statistiques en direct ont été reprises par une autre charge de travail (un seul flux en direct par session). Rouvrez cet onglet pour reprendre ici.",
    "banner.error": "Erreur du flux de statistiques : {msg}",

    // Libellés des graphiques / métriques
    "metric.cpu": "CPU",
    "metric.memory": "Mémoire",
    "metric.netRx": "Réseau RX",
    "metric.netTx": "Réseau TX",
    "metric.blockRead": "Lecture bloc",
    "metric.blockWrite": "Écriture bloc",

    // Pied de statut
    "status.label": "Statut :",
    "status.note": "un seul flux de statistiques en direct par session (imposé par le serveur).",
  },
});
