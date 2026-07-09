// ui/src/i18n/locales/onboarding.ts
//
// Locale dictionary for the "Getting started" onboarding checklist
// (ui/src/components/OnboardingChecklist.tsx). Shown at the top of the Dashboard
// until every step is done or the user dismisses it.
//
// Namespaces: header.* (card title/progress/dismiss), step.* (checklist items).
// Product names (Marketplace, Swarm, Kubernetes, Castor) are not translated.

import { defineDict } from "../core";

export const onboardingDict = defineDict({
  en: {
    // Card header
    "header.title": "Getting started",
    "header.progress": "{done} of {total} done",
    "header.dismiss": "Dismiss",

    // Checklist steps
    "step.totp": "Secure your account with 2FA",
    "step.deploy": "Deploy your first app from the Marketplace",
    "step.stack": "Create a stack (compose)",
    "step.team": "Invite your team & assign roles",
    "step.orchestrator": "Connect Swarm or Kubernetes",
  },
  fr: {
    // En-tête de la carte
    "header.title": "Prise en main",
    "header.progress": "{done} sur {total} terminées",
    "header.dismiss": "Ignorer",

    // Étapes de la checklist
    "step.totp": "Sécurisez votre compte avec la 2FA",
    "step.deploy": "Déployez votre première application depuis le Marketplace",
    "step.stack": "Créez un stack (compose)",
    "step.team": "Invitez votre équipe et attribuez les rôles",
    "step.orchestrator": "Connectez Swarm ou Kubernetes",
  },
});
