// ui/src/i18n/locales/settings.ts
//
// Locale dictionary for the Settings view (ui/src/views/Settings.tsx). Covers the
// page header + global save, the Security card (2FA toggle, session lifetime,
// protected labels), the read-only Instance card, and the Notifications section
// (channel list, add/edit modal, delete dialog, toasts).
//
// Namespaces mirror audit.ts conventions:
//   header.*   page header + Save changes button (+ its permission tooltip)
//   sec.*      Security card
//   inst.*     Instance card
//   notif.*    Notifications section (list, permissions, empty/error states)
//   channel.*  channel-type + event display labels
//   modal.*    add/edit channel modal (fields, hints, footer)
//   dialog.*   delete-channel confirm dialog
//   toast.*    toast titles + bodies
//
// DO NOT translate: permission strings (settings.update, notifications.manage),
// technical label examples (io.castor.protected), URL placeholders, or the state
// values echoed from the backend.

import { defineDict } from "../core";

export const settingsDict = defineDict({
  en: {
    // Page header + global save
    "header.title": "Settings",
    "header.subtitle": "Instance security and behavior.",
    "header.save": "Save changes",
    "header.saveDenied": "Requires settings.update",
    "header.loading": "Loading settings…",

    // Security card
    "sec.title": "Security",
    "sec.totpLabel": "Require 2FA for mutating actions",
    "sec.totpHint":
      "When enabled, users with TOTP configured must have an authentication assurance level of pwd+totp to perform any state-changing operation.",
    "sec.sessionLabel": "Session lifetime",
    "sec.sessionUnit": "seconds ({hours}h sliding window)",
    "sec.labelsLabel": "Protected labels",
    "sec.labelsHint":
      "Containers carrying any of these labels are treated as protected and cannot be removed without an audited admin override.",
    "sec.labelsEmpty": "No protected labels.",
    "sec.removeLabel": "Remove {label}",
    "sec.add": "Add",

    // Instance card
    "inst.title": "Instance",
    "inst.id": "Instance ID",
    "inst.bootstrap": "Bootstrap",
    "inst.bootstrapCompleted": "Completed",
    "inst.bootstrapPending": "Pending",

    // Notifications section
    "notif.title": "Notifications",
    "notif.addChannel": "Add channel",
    "notif.addDenied": "Requires notifications.manage",
    "notif.intro":
      "Alert channels for container and image-update events. Webhook URLs are stored encrypted and never displayed again.",
    "notif.noPermission": "Managing notification channels requires the notifications.manage permission.",
    "notif.loading": "Loading channels…",
    "notif.loadError": "Failed to load notification channels.",
    "notif.empty": "No notification channels configured.",
    "notif.noEvents": "No events subscribed.",
    "notif.test": "Test",
    "notif.testTooltip": "Send a test notification",
    "notif.edit": "Edit",
    "notif.deleteTooltip": "Delete channel",
    "notif.deleteAria": "Delete {name}",

    // Channel-type + event display labels
    "channel.type.discord": "Discord",
    "channel.type.slack": "Slack",
    "channel.type.ntfy": "ntfy",
    "channel.type.webhook": "Webhook",
    "channel.event.containerDown": "Container went down",
    "channel.event.updateAvailable": "Image update available",

    // Add / edit channel modal
    "modal.editTitle": "Edit {name}",
    "modal.addTitle": "Add channel",
    "modal.name": "Name",
    "modal.nameHint": "A label for this channel.",
    "modal.type": "Type",
    "modal.url": "Webhook URL",
    "modal.urlPlaceholderKept": "•••••• (unchanged)",
    "modal.urlHintKept": "A URL is already stored. Leave blank to keep it, or type a new one to replace it.",
    "modal.urlHintNew": "Absolute http(s) endpoint. Stored encrypted; never displayed again.",
    "modal.events": "Events",
    "modal.cancel": "Cancel",
    "modal.save": "Save",
    "modal.add": "Add",

    // Delete-channel confirm dialog. Body is split around the bold channel name.
    "dialog.deleteTitle": "Delete channel",
    "dialog.deleteConfirm": "Delete",
    "dialog.deleteBody1": "Delete notification channel",
    "dialog.deleteBody2": "? Alerts routed to it will stop immediately.",

    // Toasts
    "toast.saved": "Settings saved",
    "toast.saveFailed": "Save failed",
    "toast.testSent": "Test notification sent",
    "toast.testFailed": "Test failed",
    "toast.channelEnabled": "Channel enabled",
    "toast.channelDisabled": "Channel disabled",
    "toast.updateFailed": "Update failed",
    "toast.channelDeleted": "Channel deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.channelUpdated": "Channel updated",
    "toast.channelAdded": "Channel added",
    "toast.createFailed": "Create failed",
  },
  fr: {
    // En-tête de page + enregistrement global
    "header.title": "Paramètres",
    "header.subtitle": "Sécurité et comportement de l'instance.",
    "header.save": "Enregistrer les modifications",
    "header.saveDenied": "Nécessite settings.update",
    "header.loading": "Chargement des paramètres…",

    // Carte Sécurité
    "sec.title": "Sécurité",
    "sec.totpLabel": "Exiger la 2FA pour les actions modifiantes",
    "sec.totpHint":
      "Une fois activé, les utilisateurs ayant configuré TOTP doivent disposer d'un niveau d'assurance d'authentification pwd+totp pour effectuer toute opération modifiant l'état.",
    "sec.sessionLabel": "Durée de session",
    "sec.sessionUnit": "secondes (fenêtre glissante de {hours} h)",
    "sec.labelsLabel": "Labels protégés",
    "sec.labelsHint":
      "Les conteneurs portant l'un de ces labels sont considérés comme protégés et ne peuvent pas être supprimés sans un contournement admin audité.",
    "sec.labelsEmpty": "Aucun label protégé.",
    "sec.removeLabel": "Retirer {label}",
    "sec.add": "Ajouter",

    // Carte Instance
    "inst.title": "Instance",
    "inst.id": "ID d'instance",
    "inst.bootstrap": "Amorçage",
    "inst.bootstrapCompleted": "Terminé",
    "inst.bootstrapPending": "En attente",

    // Section Notifications
    "notif.title": "Notifications",
    "notif.addChannel": "Ajouter un canal",
    "notif.addDenied": "Nécessite notifications.manage",
    "notif.intro":
      "Canaux d'alerte pour les événements de conteneur et de mise à jour d'image. Les URL de webhook sont stockées chiffrées et ne sont plus jamais affichées.",
    "notif.noPermission": "La gestion des canaux de notification nécessite la permission notifications.manage.",
    "notif.loading": "Chargement des canaux…",
    "notif.loadError": "Échec du chargement des canaux de notification.",
    "notif.empty": "Aucun canal de notification configuré.",
    "notif.noEvents": "Aucun événement abonné.",
    "notif.test": "Tester",
    "notif.testTooltip": "Envoyer une notification de test",
    "notif.edit": "Modifier",
    "notif.deleteTooltip": "Supprimer le canal",
    "notif.deleteAria": "Supprimer {name}",

    // Libellés de type de canal + d'événement
    "channel.type.discord": "Discord",
    "channel.type.slack": "Slack",
    "channel.type.ntfy": "ntfy",
    "channel.type.webhook": "Webhook",
    "channel.event.containerDown": "Conteneur arrêté",
    "channel.event.updateAvailable": "Mise à jour d'image disponible",

    // Fenêtre d'ajout / de modification de canal
    "modal.editTitle": "Modifier {name}",
    "modal.addTitle": "Ajouter un canal",
    "modal.name": "Nom",
    "modal.nameHint": "Un libellé pour ce canal.",
    "modal.type": "Type",
    "modal.url": "URL de webhook",
    "modal.urlPlaceholderKept": "•••••• (inchangée)",
    "modal.urlHintKept": "Une URL est déjà stockée. Laissez vide pour la conserver, ou saisissez-en une nouvelle pour la remplacer.",
    "modal.urlHintNew": "Point de terminaison http(s) absolu. Stocké chiffré ; plus jamais affiché.",
    "modal.events": "Événements",
    "modal.cancel": "Annuler",
    "modal.save": "Enregistrer",
    "modal.add": "Ajouter",

    // Fenêtre de confirmation de suppression de canal. Corps scindé autour du nom en gras.
    "dialog.deleteTitle": "Supprimer le canal",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteBody1": "Supprimer le canal de notification",
    "dialog.deleteBody2": " ? Les alertes qui y sont routées cesseront immédiatement.",

    // Toasts
    "toast.saved": "Paramètres enregistrés",
    "toast.saveFailed": "Échec de l'enregistrement",
    "toast.testSent": "Notification de test envoyée",
    "toast.testFailed": "Échec du test",
    "toast.channelEnabled": "Canal activé",
    "toast.channelDisabled": "Canal désactivé",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.channelDeleted": "Canal supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.channelUpdated": "Canal mis à jour",
    "toast.channelAdded": "Canal ajouté",
    "toast.createFailed": "Échec de la création",
  },
});
