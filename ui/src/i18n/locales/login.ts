// ui/src/i18n/locales/login.ts
//
// Locale dictionary for the Login view (ui/src/views/Login.tsx). Follows the
// audit.ts reference model: one dictionary per view, camelCase keys namespaced
// by UI zone.
//
//   sso.*    single-sign-on error banner text (from ?sso_error codes)
//   auth.*   generic auth error messages (bad creds, locked, unreachable)
//   form.*   local credential form labels + submit button
//   divider.* "or continue with" separator
//   oidc.*   OIDC provider buttons
//   ldap.*   LDAP directory form (select, submit, hint)
//   footer.* first-run footnote
//
// DO NOT translate: provider display names (p.name), technical values, or the
// product name "Castor". Interpolations use {token}.

import { defineDict } from "../core";

export const loginDict = defineDict({
  en: {
    // SSO error banner (mapped from bounded ?sso_error codes)
    "sso.invalidState": "Your sign-in session expired or was already used. Please try again.",
    "sso.invalidRequest": "The sign-in response was malformed. Please try again.",
    "sso.providerUnavailable": "That sign-in method is no longer available. Contact an administrator.",
    "sso.idpUnreachable": "The identity provider could not be reached. Please try again shortly.",
    "sso.codeExchangeFailed": "Sign-in could not be completed with the identity provider. Please try again.",
    "sso.tokenVerificationFailed": "The identity provider's response could not be verified. Please try again.",
    "sso.accessDenied": "Sign-in was cancelled.",
    "sso.serverError": "Something went wrong completing sign-in. Please try again.",
    "sso.generic": "Single sign-on failed. Please try again or use another method.",

    // Generic auth errors
    "auth.accountLocked": "This account is temporarily locked. Try again later.",
    "auth.invalidCredentials": "Invalid username or password.",
    "auth.serverUnreachable": "Unable to reach the server.",

    // Local credential form
    "form.username": "Username",
    "form.password": "Password",
    "form.signIn": "Sign in",

    // SSO divider
    "divider.continueWith": "or continue with",

    // OIDC buttons
    "oidc.signInWith": "Sign in with {provider}",
    "oidc.defaultProvider": "Microsoft",

    // LDAP directory form
    "ldap.directoryLabel": "Directory",
    "ldap.signInWith": "Sign in with {provider} (LDAP)",
    "ldap.defaultProvider": "directory",
    "ldap.enterCredsTooltip": "Enter your directory username and password above",
    "ldap.hint": "Use the username and password fields above with your corporate directory credentials.",

    // First-run footnote
    "footer.firstTime": "First time here?",
    "footer.initialize": "Initialize Castor",
  },
  fr: {
    // Bannière d'erreur SSO (issue des codes ?sso_error bornés)
    "sso.invalidState": "Votre session de connexion a expiré ou a déjà été utilisée. Veuillez réessayer.",
    "sso.invalidRequest": "La réponse de connexion était mal formée. Veuillez réessayer.",
    "sso.providerUnavailable": "Cette méthode de connexion n'est plus disponible. Contactez un administrateur.",
    "sso.idpUnreachable": "Le fournisseur d'identité est injoignable. Veuillez réessayer sous peu.",
    "sso.codeExchangeFailed": "La connexion n'a pas pu être finalisée avec le fournisseur d'identité. Veuillez réessayer.",
    "sso.tokenVerificationFailed": "La réponse du fournisseur d'identité n'a pas pu être vérifiée. Veuillez réessayer.",
    "sso.accessDenied": "La connexion a été annulée.",
    "sso.serverError": "Un problème est survenu lors de la connexion. Veuillez réessayer.",
    "sso.generic": "L'authentification unique a échoué. Veuillez réessayer ou utiliser une autre méthode.",

    // Erreurs d'authentification génériques
    "auth.accountLocked": "Ce compte est temporairement verrouillé. Réessayez plus tard.",
    "auth.invalidCredentials": "Nom d'utilisateur ou mot de passe invalide.",
    "auth.serverUnreachable": "Impossible de joindre le serveur.",

    // Formulaire d'identifiants locaux
    "form.username": "Nom d'utilisateur",
    "form.password": "Mot de passe",
    "form.signIn": "Se connecter",

    // Séparateur SSO
    "divider.continueWith": "ou continuer avec",

    // Boutons OIDC
    "oidc.signInWith": "Se connecter avec {provider}",
    "oidc.defaultProvider": "Microsoft",

    // Formulaire annuaire LDAP
    "ldap.directoryLabel": "Annuaire",
    "ldap.signInWith": "Se connecter avec {provider} (LDAP)",
    "ldap.defaultProvider": "l'annuaire",
    "ldap.enterCredsTooltip": "Saisissez votre nom d'utilisateur et votre mot de passe d'annuaire ci-dessus",
    "ldap.hint": "Utilisez les champs nom d'utilisateur et mot de passe ci-dessus avec vos identifiants d'annuaire d'entreprise.",

    // Note de premier lancement
    "footer.firstTime": "Première visite ?",
    "footer.initialize": "Initialiser Castor",
  },
});
