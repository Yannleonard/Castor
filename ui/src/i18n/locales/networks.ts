// ui/src/i18n/locales/networks.ts
//
// Locale dictionary for the Networks view (ui/src/views/Networks.tsx). Follows
// the audit.ts model: one dictionary per view, authored with `defineDict`, keys
// camelCase namespaced by UI zone (header.*, filter.*, col.*, badge.*, gate.*,
// empty.*, form.*, dialog.*, toast.*).
//
// DO NOT translate technical identifiers rendered verbatim from data: driver
// names (bridge, overlay…), scope values, permission strings
// (docker.network.create), the system-network name set, and network ids.

import { defineDict } from "../core";

export const networksDict = defineDict({
  en: {
    // Page header
    "header.title": "Networks",
    "header.subtitle": "Docker networks on this host.",
    "header.create": "Create network",
    "header.prune": "Prune",
    "header.pruneTooltip": "Prune unused networks",
    "header.refresh": "Refresh",

    // Filter / search bar
    "filter.searchPlaceholder": "Search networks…",
    "filter.count": "{shown} of {total}",

    // Loading
    "list.loading": "Loading networks…",

    // Table columns
    "col.name": "Name",
    "col.id": "ID",
    "col.driver": "Driver",
    "col.scope": "Scope",
    "col.internal": "Internal",

    // Badges / pills
    "badge.system": "system",
    "badge.internal": "internal",

    // Row action + capability gate reasons
    "action.remove": "Remove network",
    "gate.noNetworks": "Provider does not manage networks",
    "gate.systemNetwork": "System networks cannot be removed",
    "gate.needDelete": "Requires docker.network.delete (admin)",
    "gate.needCreate": "Requires docker.network.create",
    "gate.needPrune": "Requires docker.system.prune (admin)",

    // Empty state
    "empty.title": "No networks",
    "empty.message": "Create a network to let containers talk to each other.",
    "empty.create": "Create a network",

    // Create modal
    "form.title": "Create network",
    "form.name": "Name",
    "form.namePlaceholder": "my-network",
    "form.nameError": "Start with a letter or digit; then letters, digits, '_', '.' or '-'.",
    "form.driver": "Driver",
    "form.internal": "Internal network (no outbound access)",
    "form.create": "Create",

    // Prune dialog
    "dialog.pruneTitle": "Prune unused networks",
    "dialog.pruneConfirm": "Prune",
    "dialog.pruneDescription": "Remove all networks not used by at least one container. This cannot be undone.",

    // Remove dialog
    "dialog.removeTitle": "Remove network",
    "dialog.removeConfirm": "Remove",
    "dialog.removeQuestion": "Remove network",
    "dialog.removeHint": "? Containers must be detached first.",

    // Toasts
    "toast.createdTitle": "Network created",
    "toast.createFailed": "Create failed",
    "toast.prunedTitle": "{count} networks removed",
    "toast.prunedBody": "{size} reclaimed",
    "toast.pruneFailed": "Prune failed",
    "toast.removedTitle": "Network removed",
    "toast.removeFailed": "Remove failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Réseaux",
    "header.subtitle": "Réseaux Docker sur cet hôte.",
    "header.create": "Créer un réseau",
    "header.prune": "Nettoyer",
    "header.pruneTooltip": "Nettoyer les réseaux inutilisés",
    "header.refresh": "Actualiser",

    // Barre de recherche / filtres
    "filter.searchPlaceholder": "Rechercher des réseaux…",
    "filter.count": "{shown} sur {total}",

    // Chargement
    "list.loading": "Chargement des réseaux…",

    // Colonnes du tableau
    "col.name": "Nom",
    "col.id": "ID",
    "col.driver": "Pilote",
    "col.scope": "Portée",
    "col.internal": "Interne",

    // Badges / pastilles
    "badge.system": "système",
    "badge.internal": "interne",

    // Action de ligne + raisons du contrôle de capacité
    "action.remove": "Supprimer le réseau",
    "gate.noNetworks": "Le fournisseur ne gère pas les réseaux",
    "gate.systemNetwork": "Les réseaux système ne peuvent pas être supprimés",
    "gate.needDelete": "Nécessite docker.network.delete (admin)",
    "gate.needCreate": "Nécessite docker.network.create",
    "gate.needPrune": "Nécessite docker.system.prune (admin)",

    // État vide
    "empty.title": "Aucun réseau",
    "empty.message": "Créez un réseau pour permettre aux conteneurs de communiquer entre eux.",
    "empty.create": "Créer un réseau",

    // Fenêtre de création
    "form.title": "Créer un réseau",
    "form.name": "Nom",
    "form.namePlaceholder": "mon-reseau",
    "form.nameError": "Commencez par une lettre ou un chiffre ; ensuite lettres, chiffres, « _ », « . » ou « - ».",
    "form.driver": "Pilote",
    "form.internal": "Réseau interne (aucun accès sortant)",
    "form.create": "Créer",

    // Fenêtre de nettoyage
    "dialog.pruneTitle": "Nettoyer les réseaux inutilisés",
    "dialog.pruneConfirm": "Nettoyer",
    "dialog.pruneDescription": "Supprimer tous les réseaux qui ne sont utilisés par aucun conteneur. Cette action est irréversible.",

    // Fenêtre de suppression
    "dialog.removeTitle": "Supprimer le réseau",
    "dialog.removeConfirm": "Supprimer",
    "dialog.removeQuestion": "Supprimer le réseau",
    "dialog.removeHint": " ? Les conteneurs doivent d'abord être détachés.",

    // Toasts
    "toast.createdTitle": "Réseau créé",
    "toast.createFailed": "Échec de la création",
    "toast.prunedTitle": "{count} réseaux supprimés",
    "toast.prunedBody": "{size} récupérés",
    "toast.pruneFailed": "Échec du nettoyage",
    "toast.removedTitle": "Réseau supprimé",
    "toast.removeFailed": "Échec de la suppression",
  },
});
