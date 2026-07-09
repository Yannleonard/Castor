// ui/src/i18n/locales/registries.ts
//
// Locale dictionary for the Registries view (ui/src/views/Registries.tsx):
// image registry credentials used to pull private (and rate-limited public)
// images. Follows the audit.ts model — one dictionary per view, camelCase keys
// namespaced by UI zone (header.*, col.*, badge.*, action.*, empty.*, dialog.*,
// form.*, toast.*).
//
// DO NOT translate technical identifiers rendered verbatim from data: the
// permission string "marketplace.registry.write", registry type option labels
// (Docker Hub, GitHub (ghcr.io), GitLab, Quay, Amazon ECR — proper nouns and
// host examples), hostnames (ghcr.io, quay.io, registry.example.com), and the
// backend-provided registry name/url/username/message values.

import { defineDict } from "../core";

export const registriesDict = defineDict({
  en: {
    // Page header
    "header.title": "Registries",
    "header.subtitle": "Image registry credentials used to pull private (and rate-limited public) images.",
    "header.add": "Add registry",
    "header.refresh": "Refresh",

    // Table columns
    "col.name": "Name",
    "col.type": "Type",
    "col.username": "Username",
    "col.credential": "Credential",
    "col.added": "Added",

    // Credential cell
    "badge.secretSet": "•••• set",
    "badge.secretNone": "none",

    // Row-level actions
    "action.test": "Test",
    "action.testTooltip": "Test login against the registry",
    "action.edit": "Edit",
    "action.editTooltip": "Edit",
    "action.delete": "Delete registry",
    "action.requiresWrite": "Requires marketplace.registry.write",

    // Empty state
    "empty.title": "No registries",
    "empty.message": "Add a registry to pull images that need authentication.",

    // Loading
    "list.loading": "Loading registries…",

    // Delete confirmation dialog
    "dialog.deleteTitle": "Delete registry",
    "dialog.deleteConfirm": "Delete",
    "dialog.deletePrefix": "Delete registry ",
    "dialog.deleteSuffix": " and its stored credential? Pulls that rely on it will fail until re-added.",

    // Registry modal — title + footer
    "form.editTitle": "Edit {name}",
    "form.addTitle": "Add registry",
    "form.cancel": "Cancel",
    "form.save": "Save",
    "form.add": "Add",

    // Registry modal — fields
    "form.nameLabel": "Name",
    "form.nameHint": "A label for this credential.",
    "form.typeLabel": "Type",
    "form.urlLabel": "URL (optional)",
    "form.urlPlaceholder": "registry.example.com",
    "form.usernameLabel": "Username",
    "form.secretLabel": "Password / token",
    "form.secretPlaceholderKeep": "•••• leave blank to keep current",
    "form.secretHintReplace": "A credential is already stored. Type a new value to replace it.",
    "form.secretHintNew": "Stored encrypted; never displayed again.",
    "form.clearSecret": "Clear the stored credential",
    "form.emailLabel": "Email (optional)",

    // URL hints per registry type
    "form.urlHintGhcr": "Defaults to ghcr.io when blank.",
    "form.urlHintQuay": "Defaults to quay.io when blank.",
    "form.urlHintDockerhub": "Leave blank for Docker Hub (the daemon default).",
    "form.urlHintCustom": "Registry host, e.g. registry.gitlab.com or registry.example.com.",

    // Toasts
    "toast.loginOkTitle": "{name}: login OK",
    "toast.loginFailedTitle": "{name}: login failed",
    "toast.testFailed": "Test failed",
    "toast.deletedTitle": "Registry deleted",
    "toast.updatedTitle": "Registry updated",
    "toast.addedTitle": "Registry added",
    "toast.updateFailed": "Update failed",
    "toast.createFailed": "Create failed",
    "toast.deleteFailed": "Delete failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Registres",
    "header.subtitle": "Identifiants de registre d'images utilisés pour récupérer les images privées (et publiques limitées en débit).",
    "header.add": "Ajouter un registre",
    "header.refresh": "Actualiser",

    // Colonnes du tableau
    "col.name": "Nom",
    "col.type": "Type",
    "col.username": "Utilisateur",
    "col.credential": "Identifiant",
    "col.added": "Ajouté",

    // Cellule identifiant
    "badge.secretSet": "•••• défini",
    "badge.secretNone": "aucun",

    // Actions au niveau ligne
    "action.test": "Tester",
    "action.testTooltip": "Tester la connexion au registre",
    "action.edit": "Modifier",
    "action.editTooltip": "Modifier",
    "action.delete": "Supprimer le registre",
    "action.requiresWrite": "Nécessite marketplace.registry.write",

    // État vide
    "empty.title": "Aucun registre",
    "empty.message": "Ajoutez un registre pour récupérer des images nécessitant une authentification.",

    // Chargement
    "list.loading": "Chargement des registres…",

    // Fenêtre de confirmation de suppression
    "dialog.deleteTitle": "Supprimer le registre",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deletePrefix": "Supprimer le registre ",
    "dialog.deleteSuffix": " et son identifiant stocké ? Les récupérations qui en dépendent échoueront jusqu'à un nouvel ajout.",

    // Fenêtre du registre — titre + pied
    "form.editTitle": "Modifier {name}",
    "form.addTitle": "Ajouter un registre",
    "form.cancel": "Annuler",
    "form.save": "Enregistrer",
    "form.add": "Ajouter",

    // Fenêtre du registre — champs
    "form.nameLabel": "Nom",
    "form.nameHint": "Un libellé pour cet identifiant.",
    "form.typeLabel": "Type",
    "form.urlLabel": "URL (facultatif)",
    "form.urlPlaceholder": "registry.example.com",
    "form.usernameLabel": "Utilisateur",
    "form.secretLabel": "Mot de passe / token",
    "form.secretPlaceholderKeep": "•••• laisser vide pour conserver l'actuel",
    "form.secretHintReplace": "Un identifiant est déjà stocké. Saisissez une nouvelle valeur pour le remplacer.",
    "form.secretHintNew": "Stocké chiffré ; jamais réaffiché.",
    "form.clearSecret": "Effacer l'identifiant stocké",
    "form.emailLabel": "E-mail (facultatif)",

    // Indications d'URL selon le type de registre
    "form.urlHintGhcr": "Par défaut ghcr.io si laissé vide.",
    "form.urlHintQuay": "Par défaut quay.io si laissé vide.",
    "form.urlHintDockerhub": "Laisser vide pour Docker Hub (valeur par défaut du démon).",
    "form.urlHintCustom": "Hôte du registre, ex. registry.gitlab.com ou registry.example.com.",

    // Toasts
    "toast.loginOkTitle": "{name} : connexion OK",
    "toast.loginFailedTitle": "{name} : échec de la connexion",
    "toast.testFailed": "Échec du test",
    "toast.deletedTitle": "Registre supprimé",
    "toast.updatedTitle": "Registre mis à jour",
    "toast.addedTitle": "Registre ajouté",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.createFailed": "Échec de la création",
    "toast.deleteFailed": "Échec de la suppression",
  },
});
