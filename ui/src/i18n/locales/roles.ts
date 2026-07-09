// ui/src/i18n/locales/roles.ts
//
// Locale dictionary for the Roles view (ui/src/views/Roles.tsx). Follows the
// audit.ts model: one dictionary per view, authored with `defineDict`, camelCase
// keys namespaced by UI zone (header.*, col.*, badge.*, action.*, editor.*,
// dialog.*, toast.*, empty.*, list.*).
//
// DO NOT translate technical identifiers rendered verbatim from data:
// permission strings (rbac.role.delete), the superuser "*" marker, role names.

import { defineDict } from "../core";

export const rolesDict = defineDict({
  en: {
    // Loading
    "list.loading": "Loading roles…",

    // Page header
    "header.title": "Roles",
    "header.subtitle": "Permission bundles assigned to users. Built-in roles are immutable.",
    "header.newRole": "New role",
    "header.newRoleDenied": "Requires rbac.role.create",
    "header.refresh": "Refresh",

    // Table columns
    "col.role": "Role",
    "col.permissions": "Permissions",

    // Badges / pills
    "badge.builtin": "built-in",
    "badge.superuser": "superuser (*)",
    "list.morePerms": "+{count} more",

    // Empty state
    "empty.title": "No roles",

    // Row actions
    "action.view": "View",
    "action.edit": "Edit",
    "action.deleteBuiltin": "Built-in roles cannot be deleted",
    "action.delete": "Delete role",
    "action.deleteDenied": "Requires rbac.role.delete",
    "action.deleteAria": "Delete role",

    // Delete confirmation dialog
    "dialog.deleteTitle": "Delete role",
    "dialog.deleteConfirm": "Delete",
    "dialog.deleteDescBefore": "Delete role ",
    "dialog.deleteDescAfter": "? Users bound to it lose those permissions.",

    // Editor modal — titles
    "editor.titleNew": "New role",
    "editor.titleView": "Role: {name}",
    "editor.titleEdit": "Edit role: {name}",

    // Editor modal — footer buttons
    "editor.close": "Close",
    "editor.cancel": "Cancel",
    "editor.createRole": "Create role",
    "editor.saveChanges": "Save changes",

    // Editor modal — body
    "editor.builtinBanner": "This is a built-in role and cannot be modified.",
    "editor.name": "Name",
    "editor.description": "Description",
    "editor.permissions": "Permissions",
    "editor.permsAll": "all",

    // Toasts
    "toast.deletedTitle": "Role deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.createdTitle": "Role created",
    "toast.createFailed": "Create failed",
    "toast.updatedTitle": "Role updated",
    "toast.updateFailed": "Update failed",
  },
  fr: {
    // Chargement
    "list.loading": "Chargement des rôles…",

    // En-tête de page
    "header.title": "Rôles",
    "header.subtitle": "Ensembles de permissions attribués aux utilisateurs. Les rôles intégrés sont immuables.",
    "header.newRole": "Nouveau rôle",
    "header.newRoleDenied": "Nécessite rbac.role.create",
    "header.refresh": "Actualiser",

    // Colonnes du tableau
    "col.role": "Rôle",
    "col.permissions": "Permissions",

    // Badges / pastilles
    "badge.builtin": "intégré",
    "badge.superuser": "superutilisateur (*)",
    "list.morePerms": "+{count} de plus",

    // État vide
    "empty.title": "Aucun rôle",

    // Actions au niveau ligne
    "action.view": "Voir",
    "action.edit": "Modifier",
    "action.deleteBuiltin": "Les rôles intégrés ne peuvent pas être supprimés",
    "action.delete": "Supprimer le rôle",
    "action.deleteDenied": "Nécessite rbac.role.delete",
    "action.deleteAria": "Supprimer le rôle",

    // Fenêtre de confirmation de suppression
    "dialog.deleteTitle": "Supprimer le rôle",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteDescBefore": "Supprimer le rôle ",
    "dialog.deleteDescAfter": " ? Les utilisateurs qui y sont liés perdent ces permissions.",

    // Fenêtre d'édition — titres
    "editor.titleNew": "Nouveau rôle",
    "editor.titleView": "Rôle : {name}",
    "editor.titleEdit": "Modifier le rôle : {name}",

    // Fenêtre d'édition — boutons de pied
    "editor.close": "Fermer",
    "editor.cancel": "Annuler",
    "editor.createRole": "Créer le rôle",
    "editor.saveChanges": "Enregistrer les modifications",

    // Fenêtre d'édition — corps
    "editor.builtinBanner": "Ceci est un rôle intégré et ne peut pas être modifié.",
    "editor.name": "Nom",
    "editor.description": "Description",
    "editor.permissions": "Permissions",
    "editor.permsAll": "toutes",

    // Toasts
    "toast.deletedTitle": "Rôle supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.createdTitle": "Rôle créé",
    "toast.createFailed": "Échec de la création",
    "toast.updatedTitle": "Rôle mis à jour",
    "toast.updateFailed": "Échec de la mise à jour",
  },
});
