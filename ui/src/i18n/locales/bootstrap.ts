// Castor by IT Leonard
// ui/src/i18n/locales/bootstrap.ts
//
// Locale dictionary for the first-run setup view (ui/src/views/Bootstrap.tsx).
// Follows the reference model in ui/src/i18n/locales/audit.ts:
//
//   • One dictionary per view, authored with `defineDict` (en + fr halves).
//   • Keys are camelCase, namespaced by UI zone:
//       loading.*  the "checking instance status" splash
//       brand.*    AuthBrand subtitles
//       form.*     field labels, hints and validation errors
//       action.*   the submit button
//       error.*    submit-time error banners (built in the handler, via `tr`)
//       toast.*    success toast on completed bootstrap
//   • DO NOT translate the env var name CASTOR_BOOTSTRAP_TOKEN or the product
//     name "Castor" — those are rendered verbatim.

import { defineDict } from "../core";

export const bootstrapDict = defineDict({
  en: {
    // Loading splash (status check before the form is shown)
    "brand.initializing": "Initializing",
    "loading.checking": "Checking instance status…",

    // Form header
    "brand.createFirstAdmin": "Create the first administrator",

    // Form fields
    "form.usernameLabel": "Admin username",
    "form.usernameHint": "At least 3 characters.",
    "form.emailLabel": "Email (optional)",
    "form.passwordLabel": "Password",
    "form.passwordHint": "At least 10 characters.",
    "form.passwordTooShort": "Use at least 10 characters.",
    "form.confirmLabel": "Confirm password",
    "form.confirmMismatch": "Passwords do not match.",
    "form.tokenLabel": "Bootstrap token (if required)",
    "form.tokenHint": "Set CASTOR_BOOTSTRAP_TOKEN to require this. Leave blank otherwise.",

    // Submit action
    "action.create": "Create administrator",

    // Submit-time errors
    "error.alreadyInitialized": "Castor is already initialized. Please sign in.",
    "error.checkForm": "Please check the form values.",
    "error.unreachable": "Unable to reach the server.",

    // Success toast
    "toast.readyTitle": "Castor initialized",
    "toast.readyBody": "Welcome aboard. Consider enabling 2FA in Profile.",
  },
  fr: {
    // Écran de chargement (vérification de statut avant le formulaire)
    "brand.initializing": "Initialisation",
    "loading.checking": "Vérification de l'état de l'instance…",

    // En-tête du formulaire
    "brand.createFirstAdmin": "Créer le premier administrateur",

    // Champs du formulaire
    "form.usernameLabel": "Nom d'utilisateur administrateur",
    "form.usernameHint": "Au moins 3 caractères.",
    "form.emailLabel": "E-mail (facultatif)",
    "form.passwordLabel": "Mot de passe",
    "form.passwordHint": "Au moins 10 caractères.",
    "form.passwordTooShort": "Utilisez au moins 10 caractères.",
    "form.confirmLabel": "Confirmer le mot de passe",
    "form.confirmMismatch": "Les mots de passe ne correspondent pas.",
    "form.tokenLabel": "Jeton d'amorçage (si requis)",
    "form.tokenHint": "Définissez CASTOR_BOOTSTRAP_TOKEN pour l'exiger. Laissez vide sinon.",

    // Action de soumission
    "action.create": "Créer l'administrateur",

    // Erreurs à la soumission
    "error.alreadyInitialized": "Castor est déjà initialisé. Veuillez vous connecter.",
    "error.checkForm": "Veuillez vérifier les valeurs du formulaire.",
    "error.unreachable": "Impossible de joindre le serveur.",

    // Toast de succès
    "toast.readyTitle": "Castor initialisé",
    "toast.readyBody": "Bienvenue. Pensez à activer la double authentification dans le Profil.",
  },
});
