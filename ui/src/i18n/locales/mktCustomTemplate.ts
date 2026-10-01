// Castor by IT Leonard
// ui/src/i18n/locales/mktCustomTemplate.ts
//
// Locale dictionary for the custom marketplace template editor
// (ui/src/views/marketplace/CustomTemplateModal.tsx). Create/edit an
// operator-authored template: metadata plus default ports / env / volumes.
//
// Keys are camelCase, namespaced by UI zone:
//   dialog.*  modal title + footer button labels
//   field.*   form field labels, placeholders and hints
//   section.* editor section labels + hints (ports / env / volumes)
//   valid.*   inline validation messages + submit-disabled hint
//   toast.*   success / failure toast titles (support {vars} interpolation)
//
// DO NOT translate technical identifiers rendered verbatim from data or examples:
//   image references (nginx:latest, registry/name:tag), example categories, logo
//   paths/URLs, the normalized slug value itself.

import { defineDict } from "../core";

export const mktCustomTemplateDict = defineDict({
  en: {
    // Modal title + footer
    "dialog.createTitle": "Add custom template",
    "dialog.editTitle": "Edit {name}",
    "dialog.editTitleFallback": "template",
    "dialog.create": "Create",
    "dialog.save": "Save",

    // Form fields
    "field.name": "Name",
    "field.slug": "Slug",
    "field.slugError": "Use a-z, 0-9, -",
    "field.slugHint": "Used for deploy + URLs.",
    "field.slugHintStored": "Stored as: {slug}",
    "field.category": "Category",
    "field.categoryPlaceholder": "database, web…",
    "field.image": "Image",
    "field.imagePlaceholder": "nginx:latest",
    "field.imageError": "Enter a valid image reference (e.g. registry/name:tag).",
    "field.description": "Description",
    "field.descriptionPlaceholder": "One-line summary shown on the card.",
    "field.logoUrl": "Logo URL (optional)",
    "field.logoUrlPlaceholder": "/templates/logos/my-app.svg or https://…",
    "field.logoUrlHint": "Leave blank to show an auto-generated initials tile.",

    // Editor sections
    "section.ports": "Default ports",
    "section.portsHint": "Container ports published on deploy (host:container default 1:1).",
    "section.env": "Default environment",
    "section.envRequired": "required",
    "section.envHint": "Mark variables the operator must fill in before deploy.",
    "section.volumes": "Default volumes",
    "section.volumesHint": "Only the container path is stored; deploy creates a named volume per path.",

    // Validation
    "valid.nameRequired": "Name is required.",
    "valid.slugRequired": "A valid slug is required.",
    "valid.imageRequired": "A valid image reference is required.",
    "valid.envKeyRequired": "Every environment row needs a key.",

    // Toasts
    "toast.created": "Template created",
    "toast.updated": "Template updated",
    "toast.createFailed": "Create failed",
    "toast.updateFailed": "Update failed",
  },
  fr: {
    // Titre de la fenêtre + pied
    "dialog.createTitle": "Ajouter un modèle personnalisé",
    "dialog.editTitle": "Modifier {name}",
    "dialog.editTitleFallback": "modèle",
    "dialog.create": "Créer",
    "dialog.save": "Enregistrer",

    // Champs du formulaire
    "field.name": "Nom",
    "field.slug": "Slug",
    "field.slugError": "Utilisez a-z, 0-9, -",
    "field.slugHint": "Utilisé pour le déploiement et les URLs.",
    "field.slugHintStored": "Enregistré comme : {slug}",
    "field.category": "Catégorie",
    "field.categoryPlaceholder": "database, web…",
    "field.image": "Image",
    "field.imagePlaceholder": "nginx:latest",
    "field.imageError": "Saisissez une référence d'image valide (ex. registry/name:tag).",
    "field.description": "Description",
    "field.descriptionPlaceholder": "Résumé d'une ligne affiché sur la carte.",
    "field.logoUrl": "URL du logo (facultatif)",
    "field.logoUrlPlaceholder": "/templates/logos/my-app.svg ou https://…",
    "field.logoUrlHint": "Laissez vide pour afficher une tuile d'initiales générée automatiquement.",

    // Sections de l'éditeur
    "section.ports": "Ports par défaut",
    "section.portsHint": "Ports du conteneur publiés au déploiement (hôte:conteneur par défaut 1:1).",
    "section.env": "Environnement par défaut",
    "section.envRequired": "requis",
    "section.envHint": "Marquez les variables que l'opérateur doit renseigner avant le déploiement.",
    "section.volumes": "Volumes par défaut",
    "section.volumesHint": "Seul le chemin dans le conteneur est enregistré ; le déploiement crée un volume nommé par chemin.",

    // Validation
    "valid.nameRequired": "Le nom est requis.",
    "valid.slugRequired": "Un slug valide est requis.",
    "valid.imageRequired": "Une référence d'image valide est requise.",
    "valid.envKeyRequired": "Chaque ligne d'environnement doit avoir une clé.",

    // Toasts
    "toast.created": "Modèle créé",
    "toast.updated": "Modèle mis à jour",
    "toast.createFailed": "Échec de la création",
    "toast.updateFailed": "Échec de la mise à jour",
  },
});
