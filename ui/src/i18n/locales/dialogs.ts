// ui/src/i18n/locales/dialogs.ts
//
// Shared dictionary for the generic dialog/placeholder components:
//   • ConfirmDestructiveDialog  (default confirm label + remove-option toggles)
//   • ReasonPromptDialog        (protected-override reason capture)
//   • EmptyState                (nothing user-facing beyond caller-provided text,
//                                but kept here for a default title if ever needed)
//
// These strings are DEFAULTS. Where a component accepts a text prop (title,
// description, confirmLabel, …) the caller-provided value always wins; the
// dictionary only fills the built-in fallbacks. Callers that pass their own
// already-translated text are unaffected.

import { defineDict } from "../core";

export const dialogsDict = defineDict({
  en: {
    // ConfirmDestructiveDialog
    "confirm.default": "Confirm",
    "confirm.forceRemoval": "Force removal (kill if running)",
    "confirm.removeVolumes": "Also remove anonymous volumes",

    // ReasonPromptDialog
    "reason.overrideRemove": "Override and remove",
    "reason.protectedBanner":
      "{name} is marked protected. Overriding requires an audited reason.",
    "reason.label": "Reason (recorded in the audit log)",
    "reason.placeholder": "e.g. Decommissioning stale staging stack approved in CHG-1234",
    "reason.tooShort": "Please provide at least 4 characters.",

    // EmptyState
    "empty.title": "Nothing here yet",
  },
  fr: {
    // ConfirmDestructiveDialog
    "confirm.default": "Confirmer",
    "confirm.forceRemoval": "Forcer la suppression (arrêt si en cours d'exécution)",
    "confirm.removeVolumes": "Supprimer aussi les volumes anonymes",

    // ReasonPromptDialog
    "reason.overrideRemove": "Passer outre et supprimer",
    "reason.protectedBanner":
      "{name} est marqué comme protégé. Passer outre nécessite un motif audité.",
    "reason.label": "Motif (consigné dans le journal d'audit)",
    "reason.placeholder": "ex. Mise hors service d'une stack de staging obsolète approuvée dans CHG-1234",
    "reason.tooShort": "Veuillez fournir au moins 4 caractères.",

    // EmptyState
    "empty.title": "Rien ici pour l'instant",
  },
});
