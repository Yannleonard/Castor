// Castor by IT Leonard
// ui/src/i18n/locales/totpChallenge.ts
//
// Locale dictionary for the TOTP challenge view (ui/src/views/TotpChallenge.tsx).
// Second-factor step: the user submits a 6-digit TOTP code or a recovery code.
//
// Keys are camelCase, namespaced by UI zone:
//   brand.*   auth brand subtitle
//   field.*   code input label / placeholder / hint
//   action.*  buttons (verify, toggle between authenticator and recovery)
//   error.*   inline error banner messages
//
// DO NOT translate: sample code formats (123456, xxxx-xxxx-xx) — those are
// literal input hints, not prose.

import { defineDict } from "../core";

export const totpChallengeDict = defineDict({
  en: {
    // Auth brand
    "brand.subtitle": "Two-factor authentication",

    // Code field
    "field.recoveryLabel": "Recovery code",
    "field.codeLabel": "Authentication code",
    "field.recoveryHint": "Enter one of your saved single-use recovery codes.",
    "field.codeHint": "Open your authenticator app and enter the 6-digit code.",

    // Actions
    "action.verify": "Verify",
    "action.useAuthenticator": "Use authenticator app instead",
    "action.useRecovery": "Use a recovery code",

    // Errors
    "error.invalidRecovery": "Invalid recovery code.",
    "error.invalidCode": "Invalid authentication code.",
    "error.unreachable": "Unable to reach the server.",
  },
  fr: {
    // Marque d'authentification
    "brand.subtitle": "Authentification à deux facteurs",

    // Champ code
    "field.recoveryLabel": "Code de récupération",
    "field.codeLabel": "Code d'authentification",
    "field.recoveryHint": "Saisissez l'un de vos codes de récupération à usage unique enregistrés.",
    "field.codeHint": "Ouvrez votre application d'authentification et saisissez le code à 6 chiffres.",

    // Actions
    "action.verify": "Vérifier",
    "action.useAuthenticator": "Utiliser plutôt l'application d'authentification",
    "action.useRecovery": "Utiliser un code de récupération",

    // Erreurs
    "error.invalidRecovery": "Code de récupération invalide.",
    "error.invalidCode": "Code d'authentification invalide.",
    "error.unreachable": "Impossible de joindre le serveur.",
  },
});
