// ui/src/i18n/locales/mktDeployedInstances.ts
//
// Locale dictionary for the marketplace "Deployed instances" affordance
// (ui/src/views/marketplace/DeployedInstances.tsx): the per-card "N deployed"
// badge and the modal listing every instance deployed from a given template.
//
// Keys are camelCase, namespaced by UI zone (badge.*, modal.*, empty.*, col.*).
// Interpolations use {token}. Technical terms (Docker, template names, host names)
// are rendered verbatim from the data, never through `t`.

import { defineDict } from "../core";

export const mktDeployedInstancesDict = defineDict({
  en: {
    // Per-card badge
    "badge.title": "{count} running/created instance of this template — click to view",
    "badge.titlePlural": "{count} running/created instances of this template — click to view",
    "badge.label": "{count} deployed",

    // Modal
    "modal.title": "Deployed instances",
    "modal.close": "Close",

    // Empty state
    "empty.title": "No instances",
    "empty.message": "Nothing deployed from this template is currently on the selected host.",

    // Table columns
    "col.name": "Name",
    "col.state": "State",
    "col.created": "Created",
  },
  fr: {
    // Badge par carte
    "badge.title": "{count} instance en cours/créée de ce modèle — cliquez pour voir",
    "badge.titlePlural": "{count} instances en cours/créées de ce modèle — cliquez pour voir",
    "badge.label": "{count} déployées",

    // Fenêtre modale
    "modal.title": "Instances déployées",
    "modal.close": "Fermer",

    // État vide
    "empty.title": "Aucune instance",
    "empty.message": "Rien de déployé depuis ce modèle n'est actuellement présent sur l'hôte sélectionné.",

    // Colonnes du tableau
    "col.name": "Nom",
    "col.state": "État",
    "col.created": "Créée",
  },
});
