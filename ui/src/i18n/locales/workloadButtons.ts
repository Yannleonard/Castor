// Castor by IT Leonard
// ui/src/i18n/locales/workloadButtons.ts
//
// Locale dictionary for the WorkloadActionButtons component
// (ui/src/components/WorkloadActionButtons.tsx): the per-workload lifecycle
// buttons (start / unpause / restart / pause / stop / remove) plus the
// read-only marker for non-Docker orchestrators and the protected-removal note.
//
// Keys are camelCase, namespaced by UI zone:
//   badge.*   inline status marker (read-only orchestrators)
//   action.*  button tooltip + aria-label per lifecycle action
//   tooltip.* contextual tooltip overrides (protected removal block)
//
// DO NOT translate: the `reason` strings surfaced by gateWorkloadAction
// (ui/src/lib/rbac.ts) — those are rendered verbatim from that helper, never
// through this dictionary, and carry technical permission identifiers.

import { defineDict } from "../core";

export const workloadButtonsDict = defineDict({
  en: {
    // Non-Docker (Swarm / Kubernetes) workloads: no lifecycle affordances.
    "badge.readOnly": "Read-only",

    // Button labels (used for both tooltip and aria-label).
    "action.start": "Start",
    "action.unpause": "Unpause",
    "action.restart": "Restart",
    "action.pause": "Pause",
    "action.stop": "Stop",
    "action.remove": "Remove",

    // Protected workload: removal is blocked unless the user is an administrator.
    "tooltip.protected": "Protected — only an administrator can override removal",
  },
  fr: {
    // Charges de travail non Docker (Swarm / Kubernetes) : aucune action de cycle de vie.
    "badge.readOnly": "Lecture seule",

    // Libellés des boutons (utilisés à la fois pour l'infobulle et l'aria-label).
    "action.start": "Démarrer",
    "action.unpause": "Reprendre",
    "action.restart": "Redémarrer",
    "action.pause": "Suspendre",
    "action.stop": "Arrêter",
    "action.remove": "Supprimer",

    // Charge de travail protégée : la suppression est bloquée sauf pour un administrateur.
    "tooltip.protected": "Protégé — seul un administrateur peut forcer la suppression",
  },
});
