// Castor by IT Leonard
// ui/src/i18n/locales/catalogs.ts
//
// Locale dictionary for the Catalogs view (ui/src/views/Catalogs.tsx) — remote
// template catalog sources feeding the Marketplace. Follows the audit.ts model:
// one dictionary per view, camelCase keys namespaced by UI zone (header.*,
// col.*, badge.*, action.*, empty.*, dialog.*, form.*, toast.*).
//
// DO NOT translate technical identifiers rendered verbatim from data or perms:
//   • permission strings (marketplace.catalog.write)
//   • proper nouns (Castor, Portainer, Marketplace)
//   • the example URL / JSON placeholder
// Those are never routed through `t`.

import { defineDict } from "../core";

export const catalogsDict = defineDict({
  en: {
    // Page header
    "header.title": "Catalogs",
    "header.subtitle": "Remote catalog sources that import community templates into the Marketplace.",
    "header.add": "Add catalog",
    "header.refresh": "Refresh",
    "header.requiresWrite": "Requires marketplace.catalog.write",

    // Table columns
    "col.name": "Name",
    "col.status": "Status",
    "col.templates": "Templates",
    "col.lastFetched": "Last fetched",

    // Status badge / cells
    "badge.enabled": "Enabled",
    "badge.disabled": "Disabled",
    "badge.error": "error",
    "badge.never": "never",

    // Row actions
    "action.refresh": "Refresh",
    "action.refreshTip": "Re-fetch templates from this catalog",
    "action.enable": "Enable",
    "action.disable": "Disable",
    "action.delete": "Delete catalog",

    // Empty state
    "empty.title": "No catalogs",
    "empty.message": "Add a catalog URL to import community templates into the Marketplace.",

    // Loading
    "list.loading": "Loading catalogs…",

    // Delete dialog
    "dialog.deleteTitle": "Delete catalog",
    "dialog.deleteConfirm": "Delete",
    "dialog.deleteLead": "Remove catalog",
    "dialog.deleteBody": "? Its templates will no longer appear in the Marketplace. Already-deployed containers are unaffected.",

    // Add-catalog modal
    "form.addTitle": "Add catalog",
    "form.add": "Add",
    "form.nameLabel": "Name",
    "form.nameHint": "A label for this source.",
    "form.urlLabel": "Catalog URL",
    "form.urlHint": "An http(s) URL serving Castor-native or Portainer-style template JSON.",

    // Toasts
    "toast.refreshFailedTitle": "{name}: refresh failed",
    "toast.refreshedTitle": "{name} refreshed",
    "toast.refreshedOne": "{count} template",
    "toast.refreshedMany": "{count} templates",
    "toast.refreshFailed": "Refresh failed",
    "toast.disabledTitle": "Catalog disabled",
    "toast.enabledTitle": "Catalog enabled",
    "toast.updateFailed": "Update failed",
    "toast.deletedTitle": "Catalog deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.addedTitle": "Catalog added",
    "toast.createFailed": "Create failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Catalogues",
    "header.subtitle": "Sources de catalogues distants qui importent des modèles communautaires dans la Marketplace.",
    "header.add": "Ajouter un catalogue",
    "header.refresh": "Actualiser",
    "header.requiresWrite": "Nécessite marketplace.catalog.write",

    // Colonnes du tableau
    "col.name": "Nom",
    "col.status": "Statut",
    "col.templates": "Modèles",
    "col.lastFetched": "Dernière récupération",

    // Badge / cellules de statut
    "badge.enabled": "Activé",
    "badge.disabled": "Désactivé",
    "badge.error": "erreur",
    "badge.never": "jamais",

    // Actions de ligne
    "action.refresh": "Actualiser",
    "action.refreshTip": "Re-récupérer les modèles depuis ce catalogue",
    "action.enable": "Activer",
    "action.disable": "Désactiver",
    "action.delete": "Supprimer le catalogue",

    // État vide
    "empty.title": "Aucun catalogue",
    "empty.message": "Ajoutez une URL de catalogue pour importer des modèles communautaires dans la Marketplace.",

    // Chargement
    "list.loading": "Chargement des catalogues…",

    // Fenêtre de suppression
    "dialog.deleteTitle": "Supprimer le catalogue",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteLead": "Supprimer le catalogue",
    "dialog.deleteBody": " ? Ses modèles n'apparaîtront plus dans la Marketplace. Les conteneurs déjà déployés ne sont pas affectés.",

    // Fenêtre d'ajout de catalogue
    "form.addTitle": "Ajouter un catalogue",
    "form.add": "Ajouter",
    "form.nameLabel": "Nom",
    "form.nameHint": "Un libellé pour cette source.",
    "form.urlLabel": "URL du catalogue",
    "form.urlHint": "Une URL http(s) servant du JSON de modèles au format Castor-natif ou Portainer.",

    // Toasts
    "toast.refreshFailedTitle": "{name} : échec de l'actualisation",
    "toast.refreshedTitle": "{name} actualisé",
    "toast.refreshedOne": "{count} modèle",
    "toast.refreshedMany": "{count} modèles",
    "toast.refreshFailed": "Échec de l'actualisation",
    "toast.disabledTitle": "Catalogue désactivé",
    "toast.enabledTitle": "Catalogue activé",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.deletedTitle": "Catalogue supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.addedTitle": "Catalogue ajouté",
    "toast.createFailed": "Échec de la création",
  },
});
