// ui/src/i18n/locales/users.ts
//
// Locale dictionary for the Users view (ui/src/views/Users.tsx): RBAC user
// management — list/create/edit/delete users and manage their role bindings.
//
// Follows the audit.ts model: one dictionary per view, camelCase keys namespaced
// by UI zone (header.*, col.*, status.*, action.*, tooltip.*, create.*, edit.*,
// roles.*, delete.*, toast.*). Interpolations use {token}.
//
// DO NOT translate technical identifiers rendered verbatim from data: permission
// strings (rbac.user.create, rbac.binding.create), scope type values
// (global/host/cluster) as returned by the backend, usernames, emails. Those
// never go through `t`. Generic labels (Cancel, Save, Add, Edit, Refresh) come
// from commonDict, not this file.

import { defineDict } from "../core";

export const usersDict = defineDict({
  en: {
    // Page header
    "header.title": "Users",
    "header.subtitle": "Local accounts and their role bindings.",
    "header.newUser": "New user",
    "header.requiresCreate": "Requires rbac.user.create",

    // Loading
    "loading.users": "Loading users…",

    // Empty state
    "empty.title": "No users",

    // Table columns
    "col.user": "User",
    "col.status": "Status",
    "col.twoFactor": "2FA",
    "col.roles": "Roles",
    "col.lastLogin": "Last login",

    // User cell
    "cell.you": "you",

    // Status values
    "status.active": "Active",
    "status.disabled": "Disabled",

    // 2FA values
    "twoFactor.enabled": "enabled",
    "twoFactor.off": "off",

    // Roles cell
    "roles.none": "none",

    // Last login
    "lastLogin.never": "never",

    // Row action tooltips / labels
    "action.manageRoles": "Manage roles",
    "action.manageRolesRequires": "Requires rbac.binding.create",
    "action.edit": "Edit",
    "action.editRequires": "Requires rbac.user.update",
    "action.deleteUser": "Delete user",
    "action.deleteSelf": "You cannot delete yourself",
    "action.deleteRequires": "Requires rbac.user.delete",

    // Create user modal
    "create.title": "Create user",
    "create.username": "Username",
    "create.usernameHint": "At least 3 characters.",
    "create.email": "Email (optional)",
    "create.tempPassword": "Temporary password",
    "create.tempPasswordHint": "At least 10 characters.",
    "create.mustChange": "Require password change at next login",
    "create.submit": "Create",

    // Edit user modal
    "edit.title": "Edit {username}",
    "edit.email": "Email",
    "edit.accountActive": "Account active",

    // Roles modal
    "roles.title": "Roles · {username}",
    "roles.currentBindings": "Current bindings",
    "roles.noneAssigned": "No roles assigned.",
    "roles.removeBinding": "Remove binding",
    "roles.removeRole": "Remove role",
    "roles.addTitle": "Add role",
    "roles.roleLabel": "Role",
    "roles.scopeLabel": "Scope",
    "roles.scopeGlobal": "Global",
    "roles.scopeHost": "Host",
    "roles.scopeCluster": "Cluster",
    "roles.add": "Add",
    "roles.scopeHint": "Scope id targeting is reserved for V2 multi-host; V1 scopes apply to the local instance.",

    // Delete confirmation dialog
    "delete.title": "Delete user",
    "delete.confirm": "Delete",
    // Split around the <strong>{username}</strong> element in JSX.
    "delete.descBefore": "Permanently delete ",
    "delete.descAfter": " and revoke all their sessions?",

    // Toasts
    "toast.userDeleted": "User deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.userCreated": "User created",
    "toast.createFailed": "Create failed",
    "toast.userUpdated": "User updated",
    "toast.updateFailed": "Update failed",
    "toast.roleAdded": "Role added",
    "toast.addRoleFailed": "Add role failed",
    "toast.roleRemoved": "Role removed",
    "toast.removeRoleFailed": "Remove role failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Utilisateurs",
    "header.subtitle": "Comptes locaux et leurs affectations de rôles.",
    "header.newUser": "Nouvel utilisateur",
    "header.requiresCreate": "Nécessite rbac.user.create",

    // Chargement
    "loading.users": "Chargement des utilisateurs…",

    // État vide
    "empty.title": "Aucun utilisateur",

    // Colonnes du tableau
    "col.user": "Utilisateur",
    "col.status": "Statut",
    "col.twoFactor": "2FA",
    "col.roles": "Rôles",
    "col.lastLogin": "Dernière connexion",

    // Cellule utilisateur
    "cell.you": "vous",

    // Valeurs de statut
    "status.active": "Actif",
    "status.disabled": "Désactivé",

    // Valeurs 2FA
    "twoFactor.enabled": "activé",
    "twoFactor.off": "désactivé",

    // Cellule rôles
    "roles.none": "aucun",

    // Dernière connexion
    "lastLogin.never": "jamais",

    // Tooltips / libellés d'action de ligne
    "action.manageRoles": "Gérer les rôles",
    "action.manageRolesRequires": "Nécessite rbac.binding.create",
    "action.edit": "Modifier",
    "action.editRequires": "Nécessite rbac.user.update",
    "action.deleteUser": "Supprimer l'utilisateur",
    "action.deleteSelf": "Vous ne pouvez pas vous supprimer vous-même",
    "action.deleteRequires": "Nécessite rbac.user.delete",

    // Fenêtre de création d'utilisateur
    "create.title": "Créer un utilisateur",
    "create.username": "Nom d'utilisateur",
    "create.usernameHint": "Au moins 3 caractères.",
    "create.email": "E-mail (facultatif)",
    "create.tempPassword": "Mot de passe temporaire",
    "create.tempPasswordHint": "Au moins 10 caractères.",
    "create.mustChange": "Exiger le changement de mot de passe à la prochaine connexion",
    "create.submit": "Créer",

    // Fenêtre de modification d'utilisateur
    "edit.title": "Modifier {username}",
    "edit.email": "E-mail",
    "edit.accountActive": "Compte actif",

    // Fenêtre des rôles
    "roles.title": "Rôles · {username}",
    "roles.currentBindings": "Affectations actuelles",
    "roles.noneAssigned": "Aucun rôle attribué.",
    "roles.removeBinding": "Retirer l'affectation",
    "roles.removeRole": "Retirer le rôle",
    "roles.addTitle": "Ajouter un rôle",
    "roles.roleLabel": "Rôle",
    "roles.scopeLabel": "Portée",
    "roles.scopeGlobal": "Globale",
    "roles.scopeHost": "Hôte",
    "roles.scopeCluster": "Cluster",
    "roles.add": "Ajouter",
    "roles.scopeHint": "Le ciblage par scope id est réservé au multi-hôte V2 ; les portées V1 s'appliquent à l'instance locale.",

    // Boîte de dialogue de suppression
    "delete.title": "Supprimer l'utilisateur",
    "delete.confirm": "Supprimer",
    // Fragments autour de l'élément <strong>{username}</strong> dans le JSX.
    "delete.descBefore": "Supprimer définitivement ",
    "delete.descAfter": " et révoquer toutes ses sessions ?",

    // Toasts
    "toast.userDeleted": "Utilisateur supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.userCreated": "Utilisateur créé",
    "toast.createFailed": "Échec de la création",
    "toast.userUpdated": "Utilisateur mis à jour",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.roleAdded": "Rôle ajouté",
    "toast.addRoleFailed": "Échec de l'ajout du rôle",
    "toast.roleRemoved": "Rôle retiré",
    "toast.removeRoleFailed": "Échec du retrait du rôle",
  },
});
