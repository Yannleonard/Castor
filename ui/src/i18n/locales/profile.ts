// Castor by IT Leonard
// ui/src/i18n/locales/profile.ts
//
// Locale dictionary for the Profile & security view (ui/src/views/Profile.tsx):
// account summary, change password, TOTP enrollment/disable, and personal API
// tokens. Follows the audit.ts model (one dict per view, camelCase keys
// namespaced by UI zone).
//
// DO NOT translate technical identifiers rendered verbatim from data or config:
// the assurance-level value (amr, e.g. "pwd"), token prefixes, HTTP header
// literals (Authorization: Bearer). Those never pass through `t`.

import { defineDict } from "../core";

export const profileDict = defineDict({
  en: {
    // Page header
    "header.title": "Profile & security",
    "header.subtitle": "Manage your password and two-factor authentication.",

    // Account card
    "account.title": "Account",
    "account.username": "Username",
    "account.email": "Email",
    "account.assurance": "Assurance level",
    "account.twoFactor": "Two-factor",
    "account.twoFactorEnabled": "enabled",
    "account.twoFactorNotConfigured": "not configured",

    // Change password card
    "password.title": "Change password",
    "password.current": "Current password",
    "password.new": "New password",
    "password.newHint": "At least 10 characters.",
    "password.confirm": "Confirm new password",
    "password.mismatch": "Passwords do not match.",
    "password.submit": "Update password",
    "password.toastTitle": "Password changed",
    "password.toastBody": "Other sessions were signed out.",
    "password.errPolicy": "Password does not meet the policy.",
    "password.errIncorrect": "Current password is incorrect.",
    "password.errFailed": "Password change failed",

    // Two-factor card
    "totp.title": "Two-factor authentication",
    "totp.active": "active",
    "totp.descEnabled": "An authenticator app is protecting your account. You can disable it if you no longer need it.",
    "totp.descDisabled": "Add a time-based one-time password (TOTP) from an authenticator app for stronger protection.",
    "totp.enable": "Enable 2FA",
    "totp.disable": "Disable 2FA",

    // Enrollment modal
    "enroll.titleScan": "Enable two-factor authentication",
    "enroll.titleCodes": "Save your recovery codes",
    "enroll.scanInstructions": "Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.",
    "enroll.qrAlt": "TOTP QR code",
    "enroll.manualSecret": "Or enter this secret manually:",
    "enroll.copySecret": "Copy secret",
    "enroll.codeLabel": "Authentication code",
    "enroll.confirm": "Confirm",
    "enroll.savedCodes": "I have saved them",
    "enroll.codesWarning": "Store these single-use codes somewhere safe. They are shown only once and let you sign in if you lose your device.",
    "enroll.copyCodes": "Copy",
    "enroll.downloadCodes": "Download",
    "enroll.toastSecretCopied": "Secret copied",
    "enroll.toastCodesCopied": "Recovery codes copied",
    "enroll.errStartTitle": "Could not start enrollment",
    "enroll.errCodeMismatch": "That code did not match. Try the current code.",
    "enroll.errConfirmFailed": "Confirmation failed.",

    // Disable modal
    "disable.title": "Disable two-factor authentication",
    "disable.warning": "Disabling 2FA weakens your account security. Confirm with your password to continue.",
    "disable.passwordLabel": "Password",
    "disable.toastDone": "2FA disabled",
    "disable.errPassword": "Password incorrect or a fresh 2FA login is required.",
    "disable.errFailed": "Could not disable 2FA.",

    // API tokens card
    "tokens.title": "API tokens",
    "tokens.new": "New token",
    "tokens.introBefore": "Automate Castor through its API — send a token in the ",
    "tokens.introAfter": " header.",
    "col.name": "Name",
    "col.token": "Token",
    "col.created": "Created",
    "col.expires": "Expires",
    "col.lastUsed": "Last used",
    "tokens.never": "Never",
    "tokens.revoked": "revoked",
    "tokens.revoke": "Revoke",
    "tokens.emptyTitle": "No API tokens",
    "tokens.emptyMessage": "Create a token to call the Castor API from scripts and CI.",
    "tokens.revokeTitle": "Revoke API token",
    "tokens.revokeConfirm": "Revoke",
    "tokens.revokeDescBefore": "Revoke token ",
    "tokens.revokeDescAfter": "? Requests using it will be rejected immediately. This cannot be undone.",
    "tokens.revokeToastTitle": "Token revoked",
    "tokens.revokeErr": "Revoke failed",

    // Expiration presets
    "expiry.30": "30 days",
    "expiry.90": "90 days",
    "expiry.365": "365 days",
    "expiry.never": "Never",

    // Create token modal
    "create.titleForm": "New API token",
    "create.titleReveal": "Copy your new token",
    "create.savedToken": "I've saved my token",
    "create.createBtn": "Create token",
    "create.revealWarning": "Copy this token now — you won't be able to see it again.",
    "create.copyToken": "Copy token",
    "create.sendHintBefore": "Send it as ",
    "create.sendHintAfter": " on API requests.",
    "create.nameLabel": "Name",
    "create.nameHint": "A label to recognize this token later (e.g. “CI deploy”).",
    "create.expiryLabel": "Expiration",
    "create.expiryHint": "Expired tokens are rejected; revocation works at any time.",
    "create.toastCopied": "Token copied",
    "create.errCopy": "Copy failed",
    "create.errCreate": "Could not create token",
  },
  fr: {
    // En-tête de page
    "header.title": "Profil et sécurité",
    "header.subtitle": "Gérez votre mot de passe et l'authentification à deux facteurs.",

    // Carte Compte
    "account.title": "Compte",
    "account.username": "Nom d'utilisateur",
    "account.email": "E-mail",
    "account.assurance": "Niveau d'assurance",
    "account.twoFactor": "Double authentification",
    "account.twoFactorEnabled": "activée",
    "account.twoFactorNotConfigured": "non configurée",

    // Carte Changer le mot de passe
    "password.title": "Changer le mot de passe",
    "password.current": "Mot de passe actuel",
    "password.new": "Nouveau mot de passe",
    "password.newHint": "Au moins 10 caractères.",
    "password.confirm": "Confirmer le nouveau mot de passe",
    "password.mismatch": "Les mots de passe ne correspondent pas.",
    "password.submit": "Mettre à jour le mot de passe",
    "password.toastTitle": "Mot de passe modifié",
    "password.toastBody": "Les autres sessions ont été déconnectées.",
    "password.errPolicy": "Le mot de passe ne respecte pas la politique.",
    "password.errIncorrect": "Le mot de passe actuel est incorrect.",
    "password.errFailed": "Échec du changement de mot de passe",

    // Carte Double authentification
    "totp.title": "Authentification à deux facteurs",
    "totp.active": "active",
    "totp.descEnabled": "Une application d'authentification protège votre compte. Vous pouvez la désactiver si vous n'en avez plus besoin.",
    "totp.descDisabled": "Ajoutez un mot de passe à usage unique basé sur le temps (TOTP) depuis une application d'authentification pour une protection renforcée.",
    "totp.enable": "Activer la 2FA",
    "totp.disable": "Désactiver la 2FA",

    // Fenêtre d'enrôlement
    "enroll.titleScan": "Activer l'authentification à deux facteurs",
    "enroll.titleCodes": "Enregistrez vos codes de secours",
    "enroll.scanInstructions": "Scannez ce QR code avec votre application d'authentification, puis saisissez le code à 6 chiffres pour confirmer.",
    "enroll.qrAlt": "QR code TOTP",
    "enroll.manualSecret": "Ou saisissez ce secret manuellement :",
    "enroll.copySecret": "Copier le secret",
    "enroll.codeLabel": "Code d'authentification",
    "enroll.confirm": "Confirmer",
    "enroll.savedCodes": "Je les ai enregistrés",
    "enroll.codesWarning": "Conservez ces codes à usage unique en lieu sûr. Ils ne sont affichés qu'une seule fois et vous permettent de vous connecter si vous perdez votre appareil.",
    "enroll.copyCodes": "Copier",
    "enroll.downloadCodes": "Télécharger",
    "enroll.toastSecretCopied": "Secret copié",
    "enroll.toastCodesCopied": "Codes de secours copiés",
    "enroll.errStartTitle": "Impossible de démarrer l'enrôlement",
    "enroll.errCodeMismatch": "Ce code ne correspond pas. Essayez le code actuel.",
    "enroll.errConfirmFailed": "Échec de la confirmation.",

    // Fenêtre de désactivation
    "disable.title": "Désactiver l'authentification à deux facteurs",
    "disable.warning": "Désactiver la 2FA affaiblit la sécurité de votre compte. Confirmez avec votre mot de passe pour continuer.",
    "disable.passwordLabel": "Mot de passe",
    "disable.toastDone": "2FA désactivée",
    "disable.errPassword": "Mot de passe incorrect ou une connexion 2FA récente est requise.",
    "disable.errFailed": "Impossible de désactiver la 2FA.",

    // Carte Tokens d'API
    "tokens.title": "Tokens d'API",
    "tokens.new": "Nouveau token",
    "tokens.introBefore": "Automatisez Castor via son API — envoyez un token dans l'en-tête ",
    "tokens.introAfter": ".",
    "col.name": "Nom",
    "col.token": "Token",
    "col.created": "Créé",
    "col.expires": "Expire",
    "col.lastUsed": "Dernière utilisation",
    "tokens.never": "Jamais",
    "tokens.revoked": "révoqué",
    "tokens.revoke": "Révoquer",
    "tokens.emptyTitle": "Aucun token d'API",
    "tokens.emptyMessage": "Créez un token pour appeler l'API Castor depuis des scripts et la CI.",
    "tokens.revokeTitle": "Révoquer le token d'API",
    "tokens.revokeConfirm": "Révoquer",
    "tokens.revokeDescBefore": "Révoquer le token ",
    "tokens.revokeDescAfter": " ? Les requêtes l'utilisant seront rejetées immédiatement. Cette action est irréversible.",
    "tokens.revokeToastTitle": "Token révoqué",
    "tokens.revokeErr": "Échec de la révocation",

    // Préréglages d'expiration
    "expiry.30": "30 jours",
    "expiry.90": "90 jours",
    "expiry.365": "365 jours",
    "expiry.never": "Jamais",

    // Fenêtre de création de token
    "create.titleForm": "Nouveau token d'API",
    "create.titleReveal": "Copiez votre nouveau token",
    "create.savedToken": "J'ai enregistré mon token",
    "create.createBtn": "Créer le token",
    "create.revealWarning": "Copiez ce token maintenant — vous ne pourrez plus le revoir.",
    "create.copyToken": "Copier le token",
    "create.sendHintBefore": "Envoyez-le en tant que ",
    "create.sendHintAfter": " sur les requêtes API.",
    "create.nameLabel": "Nom",
    "create.nameHint": "Un libellé pour reconnaître ce token plus tard (ex. « CI deploy »).",
    "create.expiryLabel": "Expiration",
    "create.expiryHint": "Les tokens expirés sont rejetés ; la révocation fonctionne à tout moment.",
    "create.toastCopied": "Token copié",
    "create.errCopy": "Échec de la copie",
    "create.errCreate": "Impossible de créer le token",
  },
});
