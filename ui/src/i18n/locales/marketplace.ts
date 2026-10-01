// Castor by IT Leonard
// ui/src/i18n/locales/marketplace.ts
//
// Locale dictionary for the Marketplace view (ui/src/views/Marketplace.tsx).
// Follows the audit.ts model: one dictionary per view, `defineDict` (en + fr),
// camelCase keys namespaced by UI zone.
//
//   header.*  page header (title/subtitle) + toolbar actions
//   filter.*  search bar + category pills
//   empty.*   empty-state titles/messages
//   list.*    loading state
//   card.*    template card labels + tooltips
//   deploy.*  deploy capability-gate reasons
//   dialog.*  delete confirmation dialog
//   toast.*   toast titles + bodies (support {vars} interpolation)
//
// DO NOT translate technical values rendered verbatim from the data: template
// `source` ("custom") and `category` values, image refs, permission strings
// (marketplace.template.create, docker.container.create). Those flow through the
// data, not through `t`.

import { defineDict } from "../core";

export const marketplaceDict = defineDict({
  en: {
    // Page header
    "header.subtitle": "Deploy curated app templates to your host in one click, or publish your own.",
    "header.addTemplate": "Add template",
    "header.addTemplateDenied": "Requires marketplace.template.create (admin)",
    "header.refresh": "Refresh",

    // Search + category filter
    "filter.searchPlaceholder": "Search by name, description or image…",
    "filter.count": "{shown} of {total}",
    "filter.all": "All",

    // Loading state
    "list.loading": "Loading templates…",

    // Empty state
    "empty.noneTitle": "No templates",
    "empty.noneMessage": "The catalog is empty. Add a custom template to get started.",
    "empty.noMatchTitle": "No matching templates",
    "empty.noMatchMessage": "Try a different search term or category.",

    // Template card
    "card.noDescription": "No description provided.",
    "card.edit": "Edit",
    "card.editTooltip": "Edit template",
    "card.delete": "Delete template",
    "card.deploy": "Deploy",
    "card.deployTooltip": "Deploy to host",

    // Deploy capability-gate reasons
    "deploy.noCreate": "This provider cannot create containers",
    "deploy.needPermission": "Requires docker.container.create",

    // Delete confirmation dialog
    "dialog.deleteTitle": "Delete template",
    "dialog.deleteConfirm": "Delete",
    "dialog.deleteBefore": "Delete the custom template ",
    "dialog.deleteAfter": "? Containers already deployed from it are not affected.",

    // Toasts
    "toast.deletedTitle": "Template deleted",
    "toast.deleteFailed": "Delete failed",
  },
  fr: {
    // En-tête de page
    "header.subtitle": "Déployez des modèles d'applications prêts à l'emploi sur votre hôte en un clic, ou publiez les vôtres.",
    "header.addTemplate": "Ajouter un modèle",
    "header.addTemplateDenied": "Nécessite marketplace.template.create (admin)",
    "header.refresh": "Actualiser",

    // Recherche + filtre par catégorie
    "filter.searchPlaceholder": "Rechercher par nom, description ou image…",
    "filter.count": "{shown} sur {total}",
    "filter.all": "Tous",

    // Chargement
    "list.loading": "Chargement des modèles…",

    // État vide
    "empty.noneTitle": "Aucun modèle",
    "empty.noneMessage": "Le catalogue est vide. Ajoutez un modèle personnalisé pour commencer.",
    "empty.noMatchTitle": "Aucun modèle correspondant",
    "empty.noMatchMessage": "Essayez un autre terme de recherche ou une autre catégorie.",

    // Carte de modèle
    "card.noDescription": "Aucune description fournie.",
    "card.edit": "Modifier",
    "card.editTooltip": "Modifier le modèle",
    "card.delete": "Supprimer le modèle",
    "card.deploy": "Déployer",
    "card.deployTooltip": "Déployer sur l'hôte",

    // Raisons du blocage de déploiement
    "deploy.noCreate": "Ce fournisseur ne peut pas créer de conteneurs",
    "deploy.needPermission": "Nécessite docker.container.create",

    // Fenêtre de confirmation de suppression
    "dialog.deleteTitle": "Supprimer le modèle",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteBefore": "Supprimer le modèle personnalisé ",
    "dialog.deleteAfter": " ? Les conteneurs déjà déployés à partir de celui-ci ne sont pas affectés.",

    // Toasts
    "toast.deletedTitle": "Modèle supprimé",
    "toast.deleteFailed": "Échec de la suppression",
  },
});
