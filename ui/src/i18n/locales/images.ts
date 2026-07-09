// ui/src/i18n/locales/images.ts
//
// Locale dictionary for the Images view (ui/src/views/Images.tsx). Follows the
// audit.ts model: one dict per view, camelCase keys namespaced by UI zone
// (header.*, filter.*, col.*, empty.*, badge.*, gate.*, pull.*, prune.*,
// remove.*, toast.*).
//
// DO NOT translate technical identifiers rendered verbatim from data: permission
// strings (docker.image.pull, docker.image.delete, docker.system.prune), image
// refs, the "<none>" / "dangling" API-derived values shown in the repo cell, and
// example refs like "nginx:latest". Those never pass through `t`.

import { defineDict } from "../core";

export const imagesDict = defineDict({
  en: {
    // Page header
    "header.title": "Images",
    "header.subtitle": "Local Docker images on this host.",
    "header.pull": "Pull image",
    "header.prune": "Prune",
    "header.refresh": "Refresh",

    // Search / filter bar
    "filter.searchPlaceholder": "Search images…",
    "filter.count": "{shown} of {total}",

    // Table columns
    "col.repoTag": "Repository : tag",
    "col.imageId": "Image ID",
    "col.size": "Size",
    "col.created": "Created",

    // Badge shown on the dangling images
    "badge.dangling": "dangling",

    // Capability-gate reasons (tooltips on disabled controls)
    "gate.noImagesProvider": "Provider does not manage images",
    "gate.needPull": "Requires docker.image.pull",
    "gate.needDelete": "Requires docker.image.delete (admin)",
    "gate.needPrune": "Requires docker.system.prune",

    // Row action
    "row.deleteImage": "Delete image",

    // Loading
    "list.loading": "Loading images…",

    // Empty state
    "empty.title": "No images",
    "empty.message": "Pull an image from a registry to get started.",
    "empty.action": "Pull an image",
    "empty.tableMessage": "Pull an image to get started.",

    // Pull modal
    "pull.title": "Pull image",
    "pull.cancel": "Cancel",
    "pull.confirm": "Pull",
    "pull.refLabel": "Image reference",
    "pull.refError": "Enter a valid image reference (e.g. registry/name:tag).",
    "pull.refHint": "An image reference only — arbitrary URLs are rejected by the server.",

    // Prune modal
    "prune.title": "Prune images",
    "prune.cancel": "Cancel",
    "prune.confirm": "Prune",
    "prune.description":
      "By default only dangling images (untagged layers not referenced by any tag) are removed. This frees disk space without touching images you may still run.",
    "prune.removeAll": "Also remove all unused images (not just dangling)",

    // Delete confirmation dialog. The image ref sits in a <strong> between the
    // prefix and suffix; the suffix carries the "?" so FR can add its space.
    "remove.title": "Delete image",
    "remove.confirm": "Delete",
    "remove.confirmPrefix": "Delete",
    "remove.confirmSuffix": "?",
    "remove.warning": "Containers using it must be removed first unless forced server-side.",

    // Toasts
    "toast.pullStartedTitle": "Pull started",
    "toast.pullStartedBody": "{ref} — progress streams via events.",
    "toast.pullFailed": "Pull failed",
    "toast.prunedTitle": "Pruned",
    "toast.prunedBody": "{count} images · {reclaimed} reclaimed",
    "toast.pruneFailed": "Prune failed",
    "toast.deletedTitle": "Image deleted",
    "toast.deleteFailed": "Delete failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Images",
    "header.subtitle": "Images Docker locales sur cet hôte.",
    "header.pull": "Tirer une image",
    "header.prune": "Nettoyer",
    "header.refresh": "Actualiser",

    // Barre de recherche / filtre
    "filter.searchPlaceholder": "Rechercher des images…",
    "filter.count": "{shown} sur {total}",

    // Colonnes du tableau
    "col.repoTag": "Dépôt : tag",
    "col.imageId": "ID de l'image",
    "col.size": "Taille",
    "col.created": "Créée",

    // Badge affiché sur les images orphelines
    "badge.dangling": "orpheline",

    // Motifs des capability-gates (infobulles sur contrôles désactivés)
    "gate.noImagesProvider": "Le fournisseur ne gère pas les images",
    "gate.needPull": "Nécessite docker.image.pull",
    "gate.needDelete": "Nécessite docker.image.delete (admin)",
    "gate.needPrune": "Nécessite docker.system.prune",

    // Action au niveau ligne
    "row.deleteImage": "Supprimer l'image",

    // Chargement
    "list.loading": "Chargement des images…",

    // État vide
    "empty.title": "Aucune image",
    "empty.message": "Tirez une image depuis un registre pour commencer.",
    "empty.action": "Tirer une image",
    "empty.tableMessage": "Tirez une image pour commencer.",

    // Fenêtre de tirage (pull)
    "pull.title": "Tirer une image",
    "pull.cancel": "Annuler",
    "pull.confirm": "Tirer",
    "pull.refLabel": "Référence d'image",
    "pull.refError": "Saisissez une référence d'image valide (ex. registry/name:tag).",
    "pull.refHint": "Une référence d'image uniquement — les URL arbitraires sont rejetées par le serveur.",

    // Fenêtre de nettoyage (prune)
    "prune.title": "Nettoyer les images",
    "prune.cancel": "Annuler",
    "prune.confirm": "Nettoyer",
    "prune.description":
      "Par défaut, seules les images orphelines (couches sans tag non référencées par aucun tag) sont supprimées. Cela libère de l'espace disque sans toucher aux images que vous pourriez encore exécuter.",
    "prune.removeAll": "Supprimer aussi toutes les images inutilisées (pas seulement les orphelines)",

    // Boîte de confirmation de suppression. La référence d'image est dans un
    // <strong> entre le préfixe et le suffixe ; le suffixe porte le " ?".
    "remove.title": "Supprimer l'image",
    "remove.confirm": "Supprimer",
    "remove.confirmPrefix": "Supprimer",
    "remove.confirmSuffix": " ?",
    "remove.warning": "Les conteneurs qui l'utilisent doivent d'abord être supprimés, sauf forçage côté serveur.",

    // Toasts
    "toast.pullStartedTitle": "Tirage démarré",
    "toast.pullStartedBody": "{ref} — la progression est diffusée via les événements.",
    "toast.pullFailed": "Échec du tirage",
    "toast.prunedTitle": "Nettoyé",
    "toast.prunedBody": "{count} images · {reclaimed} récupérés",
    "toast.pruneFailed": "Échec du nettoyage",
    "toast.deletedTitle": "Image supprimée",
    "toast.deleteFailed": "Échec de la suppression",
  },
});
