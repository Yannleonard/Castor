// Castor by IT Leonard
// ui/src/i18n/locales/backups.ts
//
// Locale dictionary for the Backups view (ui/src/views/Backups.tsx). Follows the
// audit.ts reference model: one dictionary per view, camelCase keys namespaced by
// UI zone.
//
//   header.*  page header (title/subtitle) + toolbar actions
//   filter.*  search bar (placeholder, result count)
//   col.*     table column headers
//   status.*  backup status pill labels
//   row.*     per-row action tooltips / aria-labels
//   gate.*    capability-gate disabled reasons
//   empty.*   empty-state title/message
//   list.*    loading label
//   restore.* restore modal labels + copy
//   delete.*  delete confirmation dialog labels + copy
//   toast.*   toast titles + bodies (support {vars} interpolation)
//
// DO NOT translate technical identifiers rendered verbatim from data: permission
// strings (docker.volume.restore, docker.volume.backup), volume names, kinds.

import { defineDict } from "../core";

export const backupsDict = defineDict({
  en: {
    // Page header
    "header.title": "Backups",
    "header.subtitle": "Volume tar archives. Create a backup from the Volumes page; restore or download here.",
    "header.refresh": "Refresh",

    // Search bar
    "filter.searchPlaceholder": "Search backups…",
    "filter.count": "{shown} of {total}",

    // Table columns
    "col.volume": "Volume",
    "col.size": "Size",
    "col.status": "Status",
    "col.created": "Created",

    // Status pill labels
    "status.completed": "Completed",
    "status.failed": "Failed",
    "status.pending": "Pending",

    // Row actions (tooltips + aria-labels)
    "row.download": "Download archive",
    "row.downloadAria": "Download backup",
    "row.archiveUnavailable": "Archive is not available",
    "row.restore": "Restore into a volume",
    "row.restoreAria": "Restore backup",
    "row.delete": "Delete backup",
    "row.deleteAria": "Delete backup",

    // Capability-gate disabled reasons
    "gate.noVolumes": "Provider does not manage volumes",
    "gate.needRestore": "Requires docker.volume.restore (admin)",
    "gate.needBackup": "Requires docker.volume.backup",

    // Empty state
    "empty.title": "No backups",
    "empty.message": "Back up a volume from the Volumes page to create an archive.",

    // Loading
    "list.loading": "Loading backups…",

    // Restore modal
    "restore.title": "Restore backup",
    "restore.cancel": "Cancel",
    "restore.confirm": "Restore",
    "restore.descPrefix": "Restore the archive of ",
    "restore.descSuffix":
      " into the destination volume below. Existing contents of the destination are overwritten.",
    "restore.volumeLabel": "Destination volume",
    "restore.volumeHint": "Defaults to the original volume. Pick another existing volume to restore elsewhere.",
    "restore.original": "{name} (original)",

    // Delete dialog
    "delete.title": "Delete backup",
    "delete.confirm": "Delete",
    "delete.descPrefix": "Delete the backup archive of ",
    "delete.descSuffix": "? The tar file is removed from the server permanently.",

    // Toasts
    "toast.restoreOkTitle": "Restore complete",
    "toast.restoreOkBody": "Volume {target} was restored from the archive.",
    "toast.restoreFailed": "Restore failed",
    "toast.deletedTitle": "Backup deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.downloadFailed": "Download failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Sauvegardes",
    "header.subtitle":
      "Archives tar de volumes. Créez une sauvegarde depuis la page Volumes ; restaurez ou téléchargez ici.",
    "header.refresh": "Actualiser",

    // Barre de recherche
    "filter.searchPlaceholder": "Rechercher des sauvegardes…",
    "filter.count": "{shown} sur {total}",

    // Colonnes du tableau
    "col.volume": "Volume",
    "col.size": "Taille",
    "col.status": "Statut",
    "col.created": "Créée",

    // Libellés de la pastille de statut
    "status.completed": "Terminée",
    "status.failed": "Échouée",
    "status.pending": "En attente",

    // Actions de ligne (infobulles + aria-labels)
    "row.download": "Télécharger l'archive",
    "row.downloadAria": "Télécharger la sauvegarde",
    "row.archiveUnavailable": "L'archive n'est pas disponible",
    "row.restore": "Restaurer dans un volume",
    "row.restoreAria": "Restaurer la sauvegarde",
    "row.delete": "Supprimer la sauvegarde",
    "row.deleteAria": "Supprimer la sauvegarde",

    // Raisons de désactivation (capability gate)
    "gate.noVolumes": "Le fournisseur ne gère pas les volumes",
    "gate.needRestore": "Nécessite docker.volume.restore (admin)",
    "gate.needBackup": "Nécessite docker.volume.backup",

    // État vide
    "empty.title": "Aucune sauvegarde",
    "empty.message": "Sauvegardez un volume depuis la page Volumes pour créer une archive.",

    // Chargement
    "list.loading": "Chargement des sauvegardes…",

    // Fenêtre de restauration
    "restore.title": "Restaurer la sauvegarde",
    "restore.cancel": "Annuler",
    "restore.confirm": "Restaurer",
    "restore.descPrefix": "Restaurez l'archive de ",
    "restore.descSuffix":
      " dans le volume de destination ci-dessous. Le contenu existant de la destination est écrasé.",
    "restore.volumeLabel": "Volume de destination",
    "restore.volumeHint":
      "Par défaut le volume d'origine. Choisissez un autre volume existant pour restaurer ailleurs.",
    "restore.original": "{name} (d'origine)",

    // Fenêtre de suppression
    "delete.title": "Supprimer la sauvegarde",
    "delete.confirm": "Supprimer",
    "delete.descPrefix": "Supprimer l'archive de sauvegarde de ",
    "delete.descSuffix": " ? Le fichier tar est supprimé définitivement du serveur.",

    // Toasts
    "toast.restoreOkTitle": "Restauration terminée",
    "toast.restoreOkBody": "Le volume {target} a été restauré depuis l'archive.",
    "toast.restoreFailed": "Échec de la restauration",
    "toast.deletedTitle": "Sauvegarde supprimée",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.downloadFailed": "Échec du téléchargement",
  },
});
