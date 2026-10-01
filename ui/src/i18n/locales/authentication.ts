// Castor by IT Leonard
// ui/src/i18n/locales/authentication.ts
//
// Locale dictionary for the Authentication view (ui/src/views/Authentication.tsx):
// enterprise SSO admin — external identity providers (LDAP / LDAPS and OpenID
// Connect / Microsoft Entra ID), their enable/disable/test/delete actions and
// group → role mappings.
//
// Follows the audit.ts model: one dictionary per view, camelCase keys namespaced
// by UI zone (header.*, col.*, status.*, action.*, empty.*, form.*, ldap.*,
// oidc.*, mappings.*, delete.*, toast.*). Interpolations use {token}.
//
// DO NOT translate technical identifiers rendered verbatim: permission strings
// (auth.provider.write), protocol/scheme names (LDAP, LDAPS, STARTTLS, OIDC),
// product names (Castor, Microsoft Entra ID, Active Directory, OpenLDAP), LDAP
// attribute / claim names (sAMAccountName, memberOf, groups, preferred_username),
// DNs, filters, URLs and example values shown in placeholders.

import { defineDict } from "../core";

export const authenticationDict = defineDict({
  en: {
    // Provider kind labels (the protocol names stay verbatim)
    "kind.ldap": "LDAP / LDAPS",
    "kind.oidc": "OpenID Connect",

    // TLS transport options
    "tls.ldaps": "LDAPS (implicit TLS, port 636)",
    "tls.starttls": "STARTTLS (upgrade on 389)",
    "tls.none": "None (plaintext — lab only)",

    // Page header
    "header.title": "Authentication",
    "header.subtitle": "External identity providers (LDAP / LDAPS and Microsoft Entra ID via OpenID Connect) for enterprise single sign-on.",
    "header.addProvider": "Add provider",
    "header.refresh": "Refresh",
    "header.loading": "Loading providers…",

    // Table columns
    "col.provider": "Provider",
    "col.type": "Type",
    "col.status": "Status",
    "col.secret": "Secret",
    "col.defaultRole": "Default role",
    "col.added": "Added",

    // Status / secret / role cell values
    "status.enabled": "Enabled",
    "status.disabled": "Disabled",
    "secret.set": "•••• set",
    "secret.none": "none",
    "role.none": "none",

    // Row actions
    "action.mappings": "Group → role mappings",
    "action.mappingsAria": "Group role mappings",
    "action.test": "Test",
    "action.testTooltip": "Test connection",
    "action.enable": "Enable",
    "action.disable": "Disable",
    "action.edit": "Edit",
    "action.delete": "Delete provider",
    "action.deleteAria": "Delete provider",
    "action.requiresWrite": "Requires auth.provider.write",

    // Empty state
    "empty.title": "No identity providers",
    "empty.message": "Add an LDAP directory or a Microsoft Entra ID (OIDC) app to let your team sign in with their corporate accounts.",

    // Create / edit modal
    "form.editTitle": "Edit {name}",
    "form.addTitle": "Add identity provider",
    "form.cancel": "Cancel",
    "form.save": "Save",
    "form.add": "Add",
    "form.name": "Name",
    "form.nameHint": "A label shown on the login screen.",
    "form.type": "Type",
    "form.typeHintEditing": "Type cannot be changed after creation.",
    "form.typeHintNew": "OpenID Connect for Microsoft Entra ID; LDAP for Active Directory / OpenLDAP.",
    "form.typeOidc": "OpenID Connect (Entra ID)",
    "form.typeLdap": "LDAP / LDAPS",

    // Secret field (three-state)
    "secret.labelBind": "Bind password",
    "secret.labelClient": "Client secret",
    "secret.placeholderKeep": "•••• leave blank to keep current",
    "secret.hintStored": "A secret is already stored. Type a new value to replace it.",
    "secret.hintBind": "Password for the service bind DN. Stored encrypted; never displayed again.",
    "secret.hintClient": "The Entra app registration client secret value. Stored encrypted; never displayed again.",
    "secret.clearBind": "Clear the stored bind password",
    "secret.clearClient": "Clear the stored client secret",

    // Default role + enabled toggle
    "form.defaultRole": "Default role (fallback)",
    "form.defaultRoleHint": "Assigned at sign-in when no group mapping matches. Leave as “No default” to grant nothing until an admin does.",
    "form.defaultRoleNone": "No default (deny by default)",
    "form.enabled": "Enabled (show on the login screen and accept sign-ins)",

    // LDAP fields
    "ldap.section.connection": "Connection",
    "ldap.host": "Host",
    "ldap.port": "Port",
    "ldap.portHint": "636 for LDAPS, 389 otherwise.",
    "ldap.transport": "Transport security",
    "ldap.skipVerify": "Skip TLS certificate verification (self-signed — not recommended in production)",
    "ldap.section.service": "Service account & search",
    "ldap.bindDn": "Bind DN",
    "ldap.bindDnHint": "A read-only service account used to search for users. Leave blank for anonymous bind.",
    "ldap.baseDn": "Base DN",
    "ldap.baseDnHint": "Subtree searched for user entries.",
    "ldap.userFilter": "User filter",
    "ldap.userFilterHint": "LDAP filter for the login lookup. %s is replaced with the (escaped) username.",
    "ldap.attrUsername": "Username attribute",
    "ldap.attrEmail": "Email attribute",
    "ldap.attrDisplay": "Display-name attribute",
    "ldap.section.group": "Group membership",
    "ldap.attrMember": "Member attribute",
    "ldap.attrMemberHint": "Attribute on the user entry listing their groups (e.g. memberOf). Used when no group base DN is set.",
    "ldap.groupBaseDn": "Group base DN (optional)",
    "ldap.groupBaseDnHint": "Set to resolve groups via a reverse search instead of the member attribute.",
    "ldap.groupFilter": "Group filter",
    "ldap.groupFilterHint": "Filter for the group search. %s is replaced with the user's DN.",

    // OIDC fields
    "oidc.section.entra": "Microsoft Entra ID (OpenID Connect)",

    // OIDC banner — assembled in JSX around <strong> emphasis spans, in order:
    // p1 <Web> p2 <ID token> p3 <client secret> p4 <groups claim> p5 <mono issuer>.
    "oidc.banner.p1": "In the Entra admin center, register an application, add the redirect URI below as a",
    "oidc.banner.web": "Web",
    "oidc.banner.p2": "platform, enable the",
    "oidc.banner.idToken": "ID token",
    "oidc.banner.p3": "under Authentication, create a",
    "oidc.banner.clientSecret": "client secret",
    "oidc.banner.p4": ", and add an optional",
    "oidc.banner.groupsClaim": "groups claim",
    "oidc.banner.p5": "(Token configuration → groups) so role mappings work. The issuer is",

    "oidc.issuer": "Issuer",
    "oidc.issuerHint": "The OIDC issuer URL. Discovery (/.well-known/openid-configuration) is performed automatically.",
    "oidc.clientId": "Client ID",
    "oidc.clientIdHint": "The application (client) ID of the Entra app registration.",
    "oidc.redirectUrl": "Redirect URL",
    "oidc.redirectUrlHint": "Must exactly match a redirect URI registered in Entra. Leave blank to use {url}",
    "oidc.scopes": "Scopes",
    "oidc.scopesHint": "Space-separated OAuth scopes. Keep openid; profile/email populate the username and email.",
    "oidc.section.claims": "Claim names",
    "oidc.usernameClaim": "Username claim",
    "oidc.emailClaim": "Email claim",
    "oidc.groupsClaim": "Groups claim",

    // Group → role mappings modal
    "mappings.title": "Group mappings · {name}",
    "mappings.done": "Done",
    "mappings.intro": "At sign-in, the union of the user's external groups is resolved to Castor roles. A user matching no mapping receives the provider's default role.",
    "mappings.current": "Current mappings",
    "mappings.loading": "Loading mappings…",
    "mappings.empty": "No group mappings yet.",
    "mappings.removeAria": "Remove mapping",
    "mappings.removeTooltip": "Remove mapping",
    "mappings.addTitle": "Add mapping",
    "mappings.externalGroup": "External group",
    "mappings.externalGroupPlaceholderOidc": "Castor-Admins or a group GUID",
    "mappings.captionLdap": "Match against the LDAP group DN or its CN (e.g. CN=Castor-Admins,OU=Groups,DC=corp,DC=example,DC=com or Castor-Admins). Matching is case-insensitive.",
    "mappings.captionOidc": "Match against the Entra group's object id (GUID) or its display name as it appears in the token's groups claim. Matching is case-insensitive.",
    "mappings.role": "Role",
    "mappings.add": "Add",

    // Delete confirmation (JSX: descBefore <strong>{name}</strong> descAfter)
    "delete.title": "Delete provider",
    "delete.confirm": "Delete",
    "delete.descBefore": "Delete provider",
    "delete.descAfter": ", its stored secret and all its group mappings? Users who signed in through it keep their accounts but can no longer authenticate via this provider until it is re-added.",

    // Toasts
    "toast.testOk": "{name}: test OK",
    "toast.testOkSample": "{message} (e.g. {sample})",
    "toast.testFailed": "{name}: test failed",
    "toast.testFailedTitle": "Test failed",
    "toast.disabledTitle": "Provider disabled",
    "toast.enabledTitle": "Provider enabled",
    "toast.updateFailed": "Update failed",
    "toast.updatedTitle": "Provider updated",
    "toast.addedTitle": "Provider added",
    "toast.createFailed": "Create failed",
    "toast.deletedTitle": "Provider deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.mappingAdded": "Mapping added",
    "toast.mappingAddFailed": "Add mapping failed",
    "toast.mappingRemoved": "Mapping removed",
    "toast.mappingRemoveFailed": "Remove mapping failed",
  },
  fr: {
    // Libellés des types de fournisseur (les noms de protocole restent verbatim)
    "kind.ldap": "LDAP / LDAPS",
    "kind.oidc": "OpenID Connect",

    // Options de transport TLS
    "tls.ldaps": "LDAPS (TLS implicite, port 636)",
    "tls.starttls": "STARTTLS (bascule sur le 389)",
    "tls.none": "Aucun (en clair — labo uniquement)",

    // En-tête de page
    "header.title": "Authentification",
    "header.subtitle": "Fournisseurs d'identité externes (LDAP / LDAPS et Microsoft Entra ID via OpenID Connect) pour l'authentification unique d'entreprise.",
    "header.addProvider": "Ajouter un fournisseur",
    "header.refresh": "Actualiser",
    "header.loading": "Chargement des fournisseurs…",

    // Colonnes du tableau
    "col.provider": "Fournisseur",
    "col.type": "Type",
    "col.status": "État",
    "col.secret": "Secret",
    "col.defaultRole": "Rôle par défaut",
    "col.added": "Ajouté",

    // Valeurs des cellules état / secret / rôle
    "status.enabled": "Activé",
    "status.disabled": "Désactivé",
    "secret.set": "•••• défini",
    "secret.none": "aucun",
    "role.none": "aucun",

    // Actions de ligne
    "action.mappings": "Correspondances groupe → rôle",
    "action.mappingsAria": "Correspondances groupe / rôle",
    "action.test": "Tester",
    "action.testTooltip": "Tester la connexion",
    "action.enable": "Activer",
    "action.disable": "Désactiver",
    "action.edit": "Modifier",
    "action.delete": "Supprimer le fournisseur",
    "action.deleteAria": "Supprimer le fournisseur",
    "action.requiresWrite": "Nécessite auth.provider.write",

    // État vide
    "empty.title": "Aucun fournisseur d'identité",
    "empty.message": "Ajoutez un annuaire LDAP ou une application Microsoft Entra ID (OIDC) pour permettre à votre équipe de se connecter avec ses comptes d'entreprise.",

    // Fenêtre de création / modification
    "form.editTitle": "Modifier {name}",
    "form.addTitle": "Ajouter un fournisseur d'identité",
    "form.cancel": "Annuler",
    "form.save": "Enregistrer",
    "form.add": "Ajouter",
    "form.name": "Nom",
    "form.nameHint": "Un libellé affiché sur l'écran de connexion.",
    "form.type": "Type",
    "form.typeHintEditing": "Le type ne peut pas être modifié après la création.",
    "form.typeHintNew": "OpenID Connect pour Microsoft Entra ID ; LDAP pour Active Directory / OpenLDAP.",
    "form.typeOidc": "OpenID Connect (Entra ID)",
    "form.typeLdap": "LDAP / LDAPS",

    // Champ secret (trois états)
    "secret.labelBind": "Mot de passe de bind",
    "secret.labelClient": "Secret client",
    "secret.placeholderKeep": "•••• laisser vide pour conserver l'actuel",
    "secret.hintStored": "Un secret est déjà enregistré. Saisissez une nouvelle valeur pour le remplacer.",
    "secret.hintBind": "Mot de passe du compte de service (bind DN). Chiffré au stockage ; jamais réaffiché.",
    "secret.hintClient": "La valeur du secret client de l'inscription d'application Entra. Chiffrée au stockage ; jamais réaffichée.",
    "secret.clearBind": "Effacer le mot de passe de bind enregistré",
    "secret.clearClient": "Effacer le secret client enregistré",

    // Rôle par défaut + bascule activé
    "form.defaultRole": "Rôle par défaut (repli)",
    "form.defaultRoleHint": "Attribué à la connexion lorsqu'aucune correspondance de groupe ne s'applique. Laissez sur « Aucun par défaut » pour n'accorder aucun droit tant qu'un administrateur ne le fait pas.",
    "form.defaultRoleNone": "Aucun par défaut (refus par défaut)",
    "form.enabled": "Activé (afficher sur l'écran de connexion et accepter les connexions)",

    // Champs LDAP
    "ldap.section.connection": "Connexion",
    "ldap.host": "Hôte",
    "ldap.port": "Port",
    "ldap.portHint": "636 pour LDAPS, 389 sinon.",
    "ldap.transport": "Sécurité du transport",
    "ldap.skipVerify": "Ignorer la vérification du certificat TLS (auto-signé — déconseillé en production)",
    "ldap.section.service": "Compte de service et recherche",
    "ldap.bindDn": "Bind DN",
    "ldap.bindDnHint": "Un compte de service en lecture seule utilisé pour rechercher les utilisateurs. Laissez vide pour un bind anonyme.",
    "ldap.baseDn": "Base DN",
    "ldap.baseDnHint": "Sous-arbre parcouru pour les entrées utilisateur.",
    "ldap.userFilter": "Filtre utilisateur",
    "ldap.userFilterHint": "Filtre LDAP pour la recherche à la connexion. %s est remplacé par le nom d'utilisateur (échappé).",
    "ldap.attrUsername": "Attribut nom d'utilisateur",
    "ldap.attrEmail": "Attribut e-mail",
    "ldap.attrDisplay": "Attribut nom d'affichage",
    "ldap.section.group": "Appartenance aux groupes",
    "ldap.attrMember": "Attribut membre",
    "ldap.attrMemberHint": "Attribut de l'entrée utilisateur listant ses groupes (ex. memberOf). Utilisé lorsqu'aucun base DN de groupe n'est défini.",
    "ldap.groupBaseDn": "Base DN de groupe (facultatif)",
    "ldap.groupBaseDnHint": "À définir pour résoudre les groupes par une recherche inverse plutôt que par l'attribut membre.",
    "ldap.groupFilter": "Filtre de groupe",
    "ldap.groupFilterHint": "Filtre pour la recherche de groupe. %s est remplacé par le DN de l'utilisateur.",

    // Champs OIDC
    "oidc.section.entra": "Microsoft Entra ID (OpenID Connect)",

    // Bannière OIDC — assemblée en JSX autour de segments <strong>, dans l'ordre :
    // p1 <Web> p2 <jeton d'ID> p3 <secret client> p4 <revendication de groupes> p5 <émetteur mono>.
    "oidc.banner.p1": "Dans le centre d'administration Entra, inscrivez une application, ajoutez l'URI de redirection ci-dessous comme plateforme",
    "oidc.banner.web": "Web",
    "oidc.banner.p2": "puis activez le",
    "oidc.banner.idToken": "jeton d'ID",
    "oidc.banner.p3": "sous Authentification, créez un",
    "oidc.banner.clientSecret": "secret client",
    "oidc.banner.p4": " et ajoutez une",
    "oidc.banner.groupsClaim": "revendication de groupes",
    "oidc.banner.p5": "facultative (Configuration du jeton → groupes) pour que les correspondances de rôles fonctionnent. L'émetteur est",

    "oidc.issuer": "Émetteur",
    "oidc.issuerHint": "L'URL de l'émetteur OIDC. La découverte (/.well-known/openid-configuration) est effectuée automatiquement.",
    "oidc.clientId": "ID client",
    "oidc.clientIdHint": "L'ID d'application (client) de l'inscription d'application Entra.",
    "oidc.redirectUrl": "URL de redirection",
    "oidc.redirectUrlHint": "Doit correspondre exactement à une URI de redirection enregistrée dans Entra. Laissez vide pour utiliser {url}",
    "oidc.scopes": "Scopes",
    "oidc.scopesHint": "Scopes OAuth séparés par des espaces. Conservez openid ; profile/email renseignent le nom d'utilisateur et l'e-mail.",
    "oidc.section.claims": "Noms des claims",
    "oidc.usernameClaim": "Claim nom d'utilisateur",
    "oidc.emailClaim": "Claim e-mail",
    "oidc.groupsClaim": "Claim groupes",

    // Fenêtre des correspondances groupe → rôle
    "mappings.title": "Correspondances de groupes · {name}",
    "mappings.done": "Terminé",
    "mappings.intro": "À la connexion, l'union des groupes externes de l'utilisateur est résolue en rôles Castor. Un utilisateur ne correspondant à aucune correspondance reçoit le rôle par défaut du fournisseur.",
    "mappings.current": "Correspondances actuelles",
    "mappings.loading": "Chargement des correspondances…",
    "mappings.empty": "Aucune correspondance de groupe pour l'instant.",
    "mappings.removeAria": "Retirer la correspondance",
    "mappings.removeTooltip": "Retirer la correspondance",
    "mappings.addTitle": "Ajouter une correspondance",
    "mappings.externalGroup": "Groupe externe",
    "mappings.externalGroupPlaceholderOidc": "Castor-Admins ou un GUID de groupe",
    "mappings.captionLdap": "À faire correspondre avec le DN du groupe LDAP ou son CN (ex. CN=Castor-Admins,OU=Groups,DC=corp,DC=example,DC=com ou Castor-Admins). La correspondance est insensible à la casse.",
    "mappings.captionOidc": "À faire correspondre avec l'object id (GUID) du groupe Entra ou son nom d'affichage tel qu'il apparaît dans le claim groups du token. La correspondance est insensible à la casse.",
    "mappings.role": "Rôle",
    "mappings.add": "Ajouter",

    // Confirmation de suppression (JSX : descBefore <strong>{name}</strong> descAfter)
    "delete.title": "Supprimer le fournisseur",
    "delete.confirm": "Supprimer",
    "delete.descBefore": "Supprimer le fournisseur",
    "delete.descAfter": ", son secret enregistré et toutes ses correspondances de groupes ? Les utilisateurs qui s'y sont connectés conservent leurs comptes mais ne pourront plus s'authentifier via ce fournisseur tant qu'il n'est pas rajouté.",

    // Toasts
    "toast.testOk": "{name} : test OK",
    "toast.testOkSample": "{message} (ex. {sample})",
    "toast.testFailed": "{name} : échec du test",
    "toast.testFailedTitle": "Échec du test",
    "toast.disabledTitle": "Fournisseur désactivé",
    "toast.enabledTitle": "Fournisseur activé",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.updatedTitle": "Fournisseur mis à jour",
    "toast.addedTitle": "Fournisseur ajouté",
    "toast.createFailed": "Échec de la création",
    "toast.deletedTitle": "Fournisseur supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.mappingAdded": "Correspondance ajoutée",
    "toast.mappingAddFailed": "Échec de l'ajout de la correspondance",
    "toast.mappingRemoved": "Correspondance retirée",
    "toast.mappingRemoveFailed": "Échec du retrait de la correspondance",
  },
});
