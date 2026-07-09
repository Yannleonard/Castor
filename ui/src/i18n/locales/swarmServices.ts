// ui/src/i18n/locales/swarmServices.ts
//
// Locale dictionary for the Swarm view (ui/src/views/SwarmServices.tsx) and its
// in-file modals (deploy service, scale, update, create secret/config, attach
// editors). Follows the audit.ts model: one dictionary per view, camelCase keys
// namespaced by UI zone.
//
//   header.*   page header (title/subtitle) + toolbar actions
//   tab.*      section tabs
//   col.*      table column headers
//   action.*   row / table action tooltips + aria labels
//   node.*     node availability labels
//   empty.*    empty-state titles/messages
//   dialog.*   confirm dialog titles/labels/descriptions
//   create.*   deploy-service modal fields/labels
//   scale.*    scale modal
//   update.*   update modal
//   secretModal.* create secret/config modal
//   attach.*   shared attach-secret/config editor
//   toast.*    toast titles + bodies (support {vars} interpolation)
//
// DO NOT translate technical identifiers rendered verbatim from data: image
// references, service/secret/config names, restart-policy values (any/on-failure/
// none), protocols (tcp/udp/sctp), permission strings, shell commands. Those are
// never routed through `t`.

import { defineDict } from "../core";

export const swarmServicesDict = defineDict({
  en: {
    // Page header
    "header.subtitle": "Manage Swarm services, secrets and configs; tasks are read-only.",
    "header.deployService": "Deploy service",
    "header.createSecret": "Create secret",
    "header.createConfig": "Create config",
    "header.setupGuide": "Setup guide",
    "header.refresh": "Refresh",

    // Section tabs
    "tab.services": "Services",
    "tab.tasks": "Tasks",
    "tab.nodes": "Nodes",
    "tab.secrets": "Secrets",
    "tab.configs": "Configs",

    // Loading
    "loading.data": "Loading swarm data…",

    // Service columns
    "col.service": "Service",
    "col.mode": "Mode",
    "col.replicas": "Replicas",
    "col.image": "Image",
    "col.resources": "Resources",
    "col.id": "ID",
    "col.created": "Created",
    "col.updated": "Updated",
    "col.name": "Name",
    // Task columns
    "col.task": "Task",
    "col.state": "State",
    "col.node": "Node",
    // Node columns
    "col.hostname": "Hostname",
    "col.role": "Role",
    "col.availability": "Availability",
    "col.address": "Address",

    // Resource summary
    "resource.reservations": "Reservations",

    // Row / table actions (tooltips + aria labels)
    "action.scale": "Scale",
    "action.scaleAria": "Scale service",
    "action.update": "Update",
    "action.updateAria": "Update service",
    "action.forceRestart": "Force restart",
    "action.restartAria": "Restart service",
    "action.remove": "Remove",
    "action.removeAria": "Remove service",
    "action.deleteSecret": "Delete secret",
    "action.deleteSecretAria": "Delete secret",
    "action.deleteConfig": "Delete config",
    "action.deleteConfigAria": "Delete config",

    // Node availability
    "node.drain": "Drain",
    "node.activate": "Activate",

    // Empty states
    "empty.servicesTitle": "No swarm services",
    "empty.servicesGuideMessage": "This engine is not part of an active swarm, or has no services. Initialise a single-node swarm to start deploying, then add nodes for high availability.",
    "empty.servicesShortMessage": "This engine is not part of an active swarm, or has no services.",
    "empty.showSetupGuide": "Show setup guide",
    "empty.tasksTitle": "No swarm tasks",
    "empty.secretsTitle": "No swarm secrets",
    "empty.secretsMessage": "Secret values are write-only and are never shown — only names and timestamps.",
    "empty.configsTitle": "No swarm configs",
    "empty.nodesTitle": "No swarm nodes",

    // Inline command copy
    "command.copyAria": "Copy command",

    // Restart confirm dialog
    "dialog.restartTitle": "Restart service",
    "dialog.restartConfirm": "Restart",
    "dialog.restartDescPrefix": "Force a rolling redeploy of every task in ",
    "dialog.restartDescSuffix": "? The image and configuration are unchanged.",
    // Remove service confirm dialog
    "dialog.removeTitle": "Remove service",
    "dialog.removeConfirm": "Remove",
    "dialog.removeDescPrefix": "Remove ",
    "dialog.removeDescSuffix": " and all of its tasks? This cannot be undone.",
    // Node drain/activate confirm dialog
    "dialog.drainTitle": "Drain node",
    "dialog.activateTitle": "Activate node",
    "dialog.drainConfirm": "Drain",
    "dialog.activateConfirm": "Activate",
    "dialog.drainDescPrefix": "Drain ",
    "dialog.drainDescSuffix": "? Tasks are rescheduled off this node and no new tasks are placed on it.",
    "dialog.activateDescPrefix": "Set ",
    "dialog.activateDescMid": " back to ",
    "dialog.activateDescActive": "active",
    "dialog.activateDescSuffix": " so the scheduler can place tasks on it again?",
    // Delete secret confirm dialog
    "dialog.deleteSecretTitle": "Delete secret",
    "dialog.deleteConfirm": "Delete",
    "dialog.deleteSecretDescPrefix": "Delete secret ",
    "dialog.deleteSecretDescSuffix": "? Services still referencing it must be updated first; a secret in use cannot be removed.",
    // Delete config confirm dialog
    "dialog.deleteConfigTitle": "Delete config",
    "dialog.deleteConfigDescPrefix": "Delete config ",
    "dialog.deleteConfigDescSuffix": "? Services still referencing it must be updated first; a config in use cannot be removed.",

    // Generic modal buttons
    "modal.cancel": "Cancel",

    // Create secret/config modal
    "secretModal.createTitle": "Create {noun}",
    "secretModal.create": "Create",
    "secretModal.name": "Name",
    "secretModal.nameError": "Letters, digits, dot, dash, underscore (max 64).",
    "secretModal.value": "Value",
    "secretModal.valueWriteOnly": "Value (write-only)",
    "secretModal.secretPlaceholder": "super-secret-value",
    "secretModal.configPlaceholder": "server { listen 80; }",
    "secretModal.secretHint": "Stored encrypted by the swarm; the value is never shown again after creation.",
    "secretModal.configHint": "Configs are non-secret content mounted as files (e.g. an nginx.conf).",
    "secretModal.valueAria": "{noun} value",

    // Deploy service modal
    "create.title": "Deploy service",
    "create.deploy": "Deploy",
    "create.name": "Name",
    "create.nameError": "Letters, digits, dot, dash, underscore (max 63).",
    "create.image": "Image",
    "create.replicas": "Replicas",
    "create.replicasError": "Whole number ≥ 0.",
    "create.restart": "Restart",
    "create.networks": "Networks",
    "create.networksHint": "Attached overlay networks by name/id (space or comma separated).",
    "create.publishedPorts": "Published ports",
    "create.portPublished": "published",
    "create.portTarget": "target",
    "create.portPublishedAria": "Published port",
    "create.portTargetAria": "Target port",
    "create.protocolAria": "Protocol",
    "create.removePortAria": "Remove port",
    "create.addPort": "Add port",
    "create.environment": "Environment",
    "create.envKeyAria": "Env key",
    "create.envValueAria": "Env value",
    "create.removeEnvAria": "Remove env var",
    "create.addVariable": "Add variable",
    "create.resources": "Resources",
    "create.secrets": "Secrets",
    "create.configs": "Configs",

    // Scale modal
    "scale.title": "Scale service",
    "scale.scale": "Scale",
    "scale.currentPrefix": "Service ",
    "scale.currentMid": " — currently ",
    "scale.currentSuffix": ".",
    "scale.replicas": "Replicas",
    "scale.replicasError": "Whole number ≥ 0.",
    "scale.hint": "Only replicated services can be scaled.",

    // Update modal
    "update.title": "Update service",
    "update.apply": "Apply update",
    "update.introPrefix": "Updating ",
    "update.introSuffix": ". Changing the image triggers a rolling update.",
    "update.image": "Image",
    "update.imageError": "Image is required.",
    "update.replicas": "Replicas",
    "update.replicasError": "Whole number ≥ 0.",
    "update.replicasHint": "Replicated services only. Leave as-is to keep the current count.",
    "update.replaceEnv": "Replace environment",
    "update.envAria": "Environment (one KEY=value per line)",
    "update.envUnchecked": "Leave unchecked to keep the existing environment.",
    "update.resources": "Resources",
    "update.resourcesHint": "Seeded from the current limits. Clearing a field removes that limit on apply.",
    "update.replaceAttach": "Replace secrets & configs",
    "update.secrets": "Secrets",
    "update.configs": "Configs",
    "update.attachReplaceHint": "This REPLACES the full set of attached secrets/configs (empty = detach all).",
    "update.attachUnchecked": "Leave unchecked to keep the service's current secret/config attachments.",

    // Attach secret/config editor
    "attach.noneExist": "No {noun}s exist yet — create one in the {tab} tab first.",
    "attach.selectAria": "Select {noun}",
    "attach.selectPlaceholder": "Select a {noun}…",
    "attach.targetFileAria": "Target file",
    "attach.removeAria": "Remove {noun}",
    "attach.add": "Attach {noun}",
    "attach.nounSecret": "secret",
    "attach.nounConfig": "config",
    "attach.tabSecrets": "Secrets",
    "attach.tabConfigs": "Configs",

    // Toasts
    "toast.nodeDraining": "Node draining",
    "toast.nodeActivated": "Node activated",
    "toast.drainFailed": "Drain failed",
    "toast.activateFailed": "Activate failed",
    "toast.serviceRestarting": "Service restarting",
    "toast.serviceRestartingBody": "{name} — tasks are being redeployed.",
    "toast.restartFailed": "Restart failed",
    "toast.serviceRemoved": "Service removed",
    "toast.removeFailed": "Remove failed",
    "toast.secretDeleted": "Secret deleted",
    "toast.configDeleted": "Config deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.serviceDeployed": "Service deployed",
    "toast.serviceDeployedBody": "{name} — {id}",
    "toast.deployFailed": "Deploy failed",
    "toast.serviceScaled": "Service scaled",
    "toast.serviceScaledBody": "{name} → {n} replica(s).",
    "toast.scaleFailed": "Scale failed",
    "toast.serviceUpdated": "Service updated",
    "toast.serviceUpdatedBody": "{name} — rolling update in progress.",
    "toast.updateFailed": "Update failed",
    "toast.secretCreated": "Secret created",
    "toast.configCreated": "Config created",
    "toast.createFailed": "Create failed",
  },
  fr: {
    // En-tête de page
    "header.subtitle": "Gérez les services, secrets et configs Swarm ; les tâches sont en lecture seule.",
    "header.deployService": "Déployer un service",
    "header.createSecret": "Créer un secret",
    "header.createConfig": "Créer une config",
    "header.setupGuide": "Guide de configuration",
    "header.refresh": "Actualiser",

    // Onglets de section
    "tab.services": "Services",
    "tab.tasks": "Tâches",
    "tab.nodes": "Nœuds",
    "tab.secrets": "Secrets",
    "tab.configs": "Configs",

    // Chargement
    "loading.data": "Chargement des données Swarm…",

    // Colonnes services
    "col.service": "Service",
    "col.mode": "Mode",
    "col.replicas": "Réplicas",
    "col.image": "Image",
    "col.resources": "Ressources",
    "col.id": "ID",
    "col.created": "Créé",
    "col.updated": "Mis à jour",
    "col.name": "Nom",
    // Colonnes tâches
    "col.task": "Tâche",
    "col.state": "État",
    "col.node": "Nœud",
    // Colonnes nœuds
    "col.hostname": "Nom d'hôte",
    "col.role": "Rôle",
    "col.availability": "Disponibilité",
    "col.address": "Adresse",

    // Résumé des ressources
    "resource.reservations": "Réservations",

    // Actions ligne / tableau (tooltips + libellés aria)
    "action.scale": "Mettre à l'échelle",
    "action.scaleAria": "Mettre le service à l'échelle",
    "action.update": "Mettre à jour",
    "action.updateAria": "Mettre à jour le service",
    "action.forceRestart": "Forcer le redémarrage",
    "action.restartAria": "Redémarrer le service",
    "action.remove": "Supprimer",
    "action.removeAria": "Supprimer le service",
    "action.deleteSecret": "Supprimer le secret",
    "action.deleteSecretAria": "Supprimer le secret",
    "action.deleteConfig": "Supprimer la config",
    "action.deleteConfigAria": "Supprimer la config",

    // Disponibilité des nœuds
    "node.drain": "Drainer",
    "node.activate": "Activer",

    // États vides
    "empty.servicesTitle": "Aucun service Swarm",
    "empty.servicesGuideMessage": "Ce moteur ne fait pas partie d'un swarm actif, ou n'a aucun service. Initialisez un swarm mono-nœud pour commencer à déployer, puis ajoutez des nœuds pour la haute disponibilité.",
    "empty.servicesShortMessage": "Ce moteur ne fait pas partie d'un swarm actif, ou n'a aucun service.",
    "empty.showSetupGuide": "Afficher le guide de configuration",
    "empty.tasksTitle": "Aucune tâche Swarm",
    "empty.secretsTitle": "Aucun secret Swarm",
    "empty.secretsMessage": "Les valeurs des secrets sont en écriture seule et ne sont jamais affichées — seuls les noms et horodatages le sont.",
    "empty.configsTitle": "Aucune config Swarm",
    "empty.nodesTitle": "Aucun nœud Swarm",

    // Copie de commande en ligne
    "command.copyAria": "Copier la commande",

    // Confirmation de redémarrage
    "dialog.restartTitle": "Redémarrer le service",
    "dialog.restartConfirm": "Redémarrer",
    "dialog.restartDescPrefix": "Forcer un redéploiement progressif de chaque tâche de ",
    "dialog.restartDescSuffix": " ? L'image et la configuration restent inchangées.",
    // Confirmation de suppression de service
    "dialog.removeTitle": "Supprimer le service",
    "dialog.removeConfirm": "Supprimer",
    "dialog.removeDescPrefix": "Supprimer ",
    "dialog.removeDescSuffix": " et toutes ses tâches ? Cette action est irréversible.",
    // Confirmation drainer/activer un nœud
    "dialog.drainTitle": "Drainer le nœud",
    "dialog.activateTitle": "Activer le nœud",
    "dialog.drainConfirm": "Drainer",
    "dialog.activateConfirm": "Activer",
    "dialog.drainDescPrefix": "Drainer ",
    "dialog.drainDescSuffix": " ? Les tâches sont replanifiées ailleurs et aucune nouvelle tâche n'est placée sur ce nœud.",
    "dialog.activateDescPrefix": "Rétablir ",
    "dialog.activateDescMid": " sur ",
    "dialog.activateDescActive": "actif",
    "dialog.activateDescSuffix": " pour que l'ordonnanceur puisse à nouveau y placer des tâches ?",
    // Confirmation de suppression de secret
    "dialog.deleteSecretTitle": "Supprimer le secret",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteSecretDescPrefix": "Supprimer le secret ",
    "dialog.deleteSecretDescSuffix": " ? Les services qui le référencent encore doivent d'abord être mis à jour ; un secret en cours d'utilisation ne peut pas être supprimé.",
    // Confirmation de suppression de config
    "dialog.deleteConfigTitle": "Supprimer la config",
    "dialog.deleteConfigDescPrefix": "Supprimer la config ",
    "dialog.deleteConfigDescSuffix": " ? Les services qui la référencent encore doivent d'abord être mis à jour ; une config en cours d'utilisation ne peut pas être supprimée.",

    // Boutons de fenêtre génériques
    "modal.cancel": "Annuler",

    // Fenêtre de création de secret/config
    "secretModal.createTitle": "Créer un {noun}",
    "secretModal.create": "Créer",
    "secretModal.name": "Nom",
    "secretModal.nameError": "Lettres, chiffres, point, tiret, souligné (64 max).",
    "secretModal.value": "Valeur",
    "secretModal.valueWriteOnly": "Valeur (écriture seule)",
    "secretModal.secretPlaceholder": "super-secret-value",
    "secretModal.configPlaceholder": "server { listen 80; }",
    "secretModal.secretHint": "Chiffré et stocké par le swarm ; la valeur n'est plus jamais affichée après la création.",
    "secretModal.configHint": "Les configs sont du contenu non secret monté sous forme de fichiers (ex. un nginx.conf).",
    "secretModal.valueAria": "Valeur du {noun}",

    // Fenêtre de déploiement de service
    "create.title": "Déployer un service",
    "create.deploy": "Déployer",
    "create.name": "Nom",
    "create.nameError": "Lettres, chiffres, point, tiret, souligné (63 max).",
    "create.image": "Image",
    "create.replicas": "Réplicas",
    "create.replicasError": "Nombre entier ≥ 0.",
    "create.restart": "Redémarrage",
    "create.networks": "Réseaux",
    "create.networksHint": "Réseaux overlay attachés par nom/id (séparés par espace ou virgule).",
    "create.publishedPorts": "Ports publiés",
    "create.portPublished": "publié",
    "create.portTarget": "cible",
    "create.portPublishedAria": "Port publié",
    "create.portTargetAria": "Port cible",
    "create.protocolAria": "Protocole",
    "create.removePortAria": "Retirer le port",
    "create.addPort": "Ajouter un port",
    "create.environment": "Environnement",
    "create.envKeyAria": "Clé d'environnement",
    "create.envValueAria": "Valeur d'environnement",
    "create.removeEnvAria": "Retirer la variable",
    "create.addVariable": "Ajouter une variable",
    "create.resources": "Ressources",
    "create.secrets": "Secrets",
    "create.configs": "Configs",

    // Fenêtre de mise à l'échelle
    "scale.title": "Mettre le service à l'échelle",
    "scale.scale": "Mettre à l'échelle",
    "scale.currentPrefix": "Service ",
    "scale.currentMid": " — actuellement ",
    "scale.currentSuffix": ".",
    "scale.replicas": "Réplicas",
    "scale.replicasError": "Nombre entier ≥ 0.",
    "scale.hint": "Seuls les services répliqués peuvent être mis à l'échelle.",

    // Fenêtre de mise à jour
    "update.title": "Mettre à jour le service",
    "update.apply": "Appliquer la mise à jour",
    "update.introPrefix": "Mise à jour de ",
    "update.introSuffix": ". Changer l'image déclenche une mise à jour progressive.",
    "update.image": "Image",
    "update.imageError": "L'image est requise.",
    "update.replicas": "Réplicas",
    "update.replicasError": "Nombre entier ≥ 0.",
    "update.replicasHint": "Services répliqués uniquement. Laissez tel quel pour conserver le nombre actuel.",
    "update.replaceEnv": "Remplacer l'environnement",
    "update.envAria": "Environnement (un KEY=value par ligne)",
    "update.envUnchecked": "Laissez décoché pour conserver l'environnement existant.",
    "update.resources": "Ressources",
    "update.resourcesHint": "Pré-rempli avec les limites actuelles. Vider un champ retire cette limite à l'application.",
    "update.replaceAttach": "Remplacer les secrets et configs",
    "update.secrets": "Secrets",
    "update.configs": "Configs",
    "update.attachReplaceHint": "Ceci REMPLACE l'ensemble des secrets/configs attachés (vide = tout détacher).",
    "update.attachUnchecked": "Laissez décoché pour conserver les attachements de secrets/configs actuels du service.",

    // Éditeur d'attachement de secret/config
    "attach.noneExist": "Aucun {noun} n'existe encore — créez-en un dans l'onglet {tab} d'abord.",
    "attach.selectAria": "Sélectionner un {noun}",
    "attach.selectPlaceholder": "Sélectionner un {noun}…",
    "attach.targetFileAria": "Fichier cible",
    "attach.removeAria": "Retirer le {noun}",
    "attach.add": "Attacher un {noun}",
    "attach.nounSecret": "secret",
    "attach.nounConfig": "config",
    "attach.tabSecrets": "Secrets",
    "attach.tabConfigs": "Configs",

    // Toasts
    "toast.nodeDraining": "Nœud en cours de drainage",
    "toast.nodeActivated": "Nœud activé",
    "toast.drainFailed": "Échec du drainage",
    "toast.activateFailed": "Échec de l'activation",
    "toast.serviceRestarting": "Redémarrage du service",
    "toast.serviceRestartingBody": "{name} — les tâches sont en cours de redéploiement.",
    "toast.restartFailed": "Échec du redémarrage",
    "toast.serviceRemoved": "Service supprimé",
    "toast.removeFailed": "Échec de la suppression",
    "toast.secretDeleted": "Secret supprimé",
    "toast.configDeleted": "Config supprimée",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.serviceDeployed": "Service déployé",
    "toast.serviceDeployedBody": "{name} — {id}",
    "toast.deployFailed": "Échec du déploiement",
    "toast.serviceScaled": "Service mis à l'échelle",
    "toast.serviceScaledBody": "{name} → {n} réplica(s).",
    "toast.scaleFailed": "Échec de la mise à l'échelle",
    "toast.serviceUpdated": "Service mis à jour",
    "toast.serviceUpdatedBody": "{name} — mise à jour progressive en cours.",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.secretCreated": "Secret créé",
    "toast.configCreated": "Config créée",
    "toast.createFailed": "Échec de la création",
  },
});
