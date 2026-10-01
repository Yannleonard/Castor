// Castor by IT Leonard
// ui/src/i18n/locales/common.ts
//
// Shared "common" dictionary: the small set of generic labels used across many
// views (generic actions, states, yes/no). Keep this file lean — it is the one
// dictionary many components import, so only truly cross-cutting strings belong
// here. Anything view-specific lives in that view's own locale file.
//
// Key naming: flat camelCase verbs/nouns (`cancel`, `noResults`). Grouped keys
// use a dotted prefix (`state.running`).

import { defineDict } from "../core";

export const commonDict = defineDict({
  en: {
    // Generic actions
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    delete: "Delete",
    remove: "Remove",
    confirm: "Confirm",
    refresh: "Refresh",
    apply: "Apply",
    reset: "Reset",
    create: "Create",
    edit: "Edit",
    search: "Search",
    view: "View",
    add: "Add",
    copy: "Copy",
    copied: "Copied to clipboard",
    retry: "Retry",
    back: "Back",
    next: "Next",
    done: "Done",

    // States / feedback
    loading: "Loading…",
    noResults: "No results",
    none: "None",
    all: "All",
    error: "Error",
    success: "Success",

    // Yes / no
    yes: "Yes",
    no: "No",
    enabled: "Enabled",
    disabled: "Disabled",
    on: "On",
    off: "Off",
  },
  fr: {
    // Actions génériques
    cancel: "Annuler",
    close: "Fermer",
    save: "Enregistrer",
    delete: "Supprimer",
    remove: "Retirer",
    confirm: "Confirmer",
    refresh: "Actualiser",
    apply: "Appliquer",
    reset: "Réinitialiser",
    create: "Créer",
    edit: "Modifier",
    search: "Rechercher",
    view: "Voir",
    add: "Ajouter",
    copy: "Copier",
    copied: "Copié dans le presse-papiers",
    retry: "Réessayer",
    back: "Retour",
    next: "Suivant",
    done: "Terminé",

    // États / retours
    loading: "Chargement…",
    noResults: "Aucun résultat",
    none: "Aucun",
    all: "Tous",
    error: "Erreur",
    success: "Succès",

    // Oui / non
    yes: "Oui",
    no: "Non",
    enabled: "Activé",
    disabled: "Désactivé",
    on: "Activé",
    off: "Désactivé",
  },
});
