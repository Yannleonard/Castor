// Castor by IT Leonard
// ui/src/i18n/locales/volumes.ts
//
// Locale dictionary for the Volumes view (ui/src/views/Volumes.tsx). Follows the
// audit.ts model: one dictionary per view, camelCase keys namespaced by UI zone
// (header.*, filter.*, col.*, badge.*, action.*, empty.*, form.*, dialog.*,
// toast.*). Interpolations use {token}.
//
// DO NOT translate technical identifiers rendered verbatim from data: permission
// strings (docker.volume.create), driver names, mountpoints, volume names. Those
// never pass through `t`.

import { defineDict } from "../core";

export const volumesDict = defineDict({
  en: {
    // Page header
    "header.title": "Volumes",
    "header.subtitle": "Docker volumes on this host.",
    "header.create": "Create volume",
    "header.prune": "Prune",
    "header.pruneTooltip": "Remove all unused volumes",
    "header.refresh": "Refresh",

    // Capability-gate reasons (why an action is disabled)
    "gate.noVolumes": "Provider does not manage volumes",
    "gate.createRequires": "Requires docker.volume.create",
    "gate.pruneRequires": "Requires docker.system.prune (admin)",
    "gate.removeProtected": "Castor data volume is protected",
    "gate.removeRequires": "Requires docker.volume.remove (admin)",
    "gate.backupRequires": "Requires docker.volume.backup",

    // Filter / search bar
    "filter.searchPlaceholder": "Search volumes…",
    "filter.count": "{shown} of {total}",

    // Table columns
    "col.name": "Name",
    "col.driver": "Driver",
    "col.mountpoint": "Mountpoint",
    "col.created": "Created",

    // Badges / protected marker
    "badge.protected": "Castor data volume — removal is blocked",

    // Row-level actions
    "action.backup": "Back up this volume",
    "action.backupLabel": "Back up volume",
    "action.remove": "Remove volume",
    "action.removeLabel": "Remove volume",

    // Empty state
    "empty.title": "No volumes",
    "empty.message": "Create a volume to persist data across container restarts.",
    "empty.action": "Create a volume",

    // Loading
    "list.loading": "Loading volumes…",

    // Create modal
    "form.title": "Create volume",
    "form.cancel": "Cancel",
    "form.submit": "Create",
    "form.nameLabel": "Name",
    "form.namePlaceholder": "my-volume",
    "form.nameError": "Letters, digits, then letters, digits, '_', '.' or '-' only.",
    "form.driverLabel": "Driver",
    "form.driverPlaceholder": "local",
    "form.driverHint": "Optional — leave empty for the default local driver.",

    // Prune confirmation (description split around two <strong> fragments)
    "dialog.pruneTitle": "Prune unused volumes",
    "dialog.pruneConfirm": "Prune",
    "dialog.pruneLead": "Delete",
    "dialog.pruneEvery": "every volume not attached to a container",
    "dialog.pruneMid": " on this host. All data in those volumes will be",
    "dialog.pruneLost": "lost permanently",
    "dialog.pruneTail": " — this cannot be undone. Volumes currently in use are not affected.",

    // Remove confirmation (description split around a <strong> volume name)
    "dialog.removeTitle": "Remove volume",
    "dialog.removeConfirm": "Remove",
    "dialog.removeLead": "Remove volume",
    "dialog.removeQuestion": "? Data in this volume will be lost permanently.",

    // Toasts
    "toast.createdTitle": "Volume created",
    "toast.createFailed": "Create failed",
    "toast.prunedTitle": "Volumes pruned",
    "toast.prunedBody": "{count} volumes · {size} reclaimed",
    "toast.pruneFailed": "Prune failed",
    "toast.removedTitle": "Volume removed",
    "toast.removeFailed": "Remove failed",
    "toast.backingUpTitle": "Backing up volume",
    "toast.backingUpBody": "{name} — this may take a few seconds (a helper container streams the data).",
    "toast.backupCompleteTitle": "Backup complete",
    "toast.backupCompleteBody": "{name} — available on the Backups page.",
    "toast.backupFailed": "Backup failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Volumes",
    "header.subtitle": "Volumes Docker sur cet hôte.",
    "header.create": "Créer un volume",
    "header.prune": "Nettoyer",
    "header.pruneTooltip": "Supprimer tous les volumes inutilisés",
    "header.refresh": "Actualiser",

    // Raisons de blocage (capacité manquante)
    "gate.noVolumes": "Le fournisseur ne gère pas les volumes",
    "gate.createRequires": "Nécessite docker.volume.create",
    "gate.pruneRequires": "Nécessite docker.system.prune (admin)",
    "gate.removeProtected": "Le volume de données Castor est protégé",
    "gate.removeRequires": "Nécessite docker.volume.remove (admin)",
    "gate.backupRequires": "Nécessite docker.volume.backup",

    // Barre de recherche / filtre
    "filter.searchPlaceholder": "Rechercher des volumes…",
    "filter.count": "{shown} sur {total}",

    // Colonnes du tableau
    "col.name": "Nom",
    "col.driver": "Pilote",
    "col.mountpoint": "Point de montage",
    "col.created": "Créé",

    // Badges / marqueur protégé
    "badge.protected": "Volume de données Castor — la suppression est bloquée",

    // Actions au niveau ligne
    "action.backup": "Sauvegarder ce volume",
    "action.backupLabel": "Sauvegarder le volume",
    "action.remove": "Supprimer le volume",
    "action.removeLabel": "Supprimer le volume",

    // État vide
    "empty.title": "Aucun volume",
    "empty.message": "Créez un volume pour conserver les données au fil des redémarrages de conteneurs.",
    "empty.action": "Créer un volume",

    // Chargement
    "list.loading": "Chargement des volumes…",

    // Fenêtre de création
    "form.title": "Créer un volume",
    "form.cancel": "Annuler",
    "form.submit": "Créer",
    "form.nameLabel": "Nom",
    "form.namePlaceholder": "mon-volume",
    "form.nameError": "Lettres, chiffres, puis lettres, chiffres, « _ », « . » ou « - » uniquement.",
    "form.driverLabel": "Pilote",
    "form.driverPlaceholder": "local",
    "form.driverHint": "Facultatif — laisser vide pour le pilote local par défaut.",

    // Confirmation de nettoyage (description scindée autour de deux fragments <strong>)
    "dialog.pruneTitle": "Nettoyer les volumes inutilisés",
    "dialog.pruneConfirm": "Nettoyer",
    "dialog.pruneLead": "Supprimer",
    "dialog.pruneEvery": "tout volume non rattaché à un conteneur",
    "dialog.pruneMid": " sur cet hôte. Toutes les données de ces volumes seront",
    "dialog.pruneLost": "perdues définitivement",
    "dialog.pruneTail": " — action irréversible. Les volumes actuellement utilisés ne sont pas affectés.",

    // Confirmation de suppression (description scindée autour du nom <strong> du volume)
    "dialog.removeTitle": "Supprimer le volume",
    "dialog.removeConfirm": "Supprimer",
    "dialog.removeLead": "Supprimer le volume",
    "dialog.removeQuestion": " ? Les données de ce volume seront perdues définitivement.",

    // Toasts
    "toast.createdTitle": "Volume créé",
    "toast.createFailed": "Échec de la création",
    "toast.prunedTitle": "Volumes nettoyés",
    "toast.prunedBody": "{count} volumes · {size} récupérés",
    "toast.pruneFailed": "Échec du nettoyage",
    "toast.removedTitle": "Volume supprimé",
    "toast.removeFailed": "Échec de la suppression",
    "toast.backingUpTitle": "Sauvegarde du volume",
    "toast.backingUpBody": "{name} — cela peut prendre quelques secondes (un conteneur auxiliaire transfère les données).",
    "toast.backupCompleteTitle": "Sauvegarde terminée",
    "toast.backupCompleteBody": "{name} — disponible sur la page Sauvegardes.",
    "toast.backupFailed": "Échec de la sauvegarde",
  },
});
