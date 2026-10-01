// Castor by IT Leonard
// ui/src/i18n/locales/k8sWorkloads.ts
//
// Locale dictionary for the Kubernetes workloads view (ui/src/views/K8sWorkloads.tsx):
// pods, deployments, statefulsets, daemonsets, jobs, cronjobs and nodes, plus the
// scale / resources / apply-manifest modals and the pod terminal / logs modals.
//
// Conventions (see ui/src/i18n/locales/audit.ts for the reference model):
//   • camelCase keys, namespaced by UI zone (header.*, tab.*, col.*, action.*,
//     empty.*, dialog.*, scale.*, resources.*, apply.*, term.*, logs.*, toast.*).
//   • Interpolations use {token}.
//   • Technical identifiers are NOT translated and never routed through `t`:
//     Kubernetes kind names (Pod, Deployment, StatefulSet, DaemonSet, Job,
//     CronJob, Node), backend state/action values (Ready, Active, created,
//     configured, unchanged, error…), the docker/k8s permission strings, the
//     `castor` field manager, shell paths (/bin/sh…), and the docker run snippet.

import { defineDict } from "../core";

export const k8sWorkloadsDict = defineDict({
  en: {
    // Page header
    "header.subtitle": "Manage pods and workload controllers, or apply a manifest.",
    "header.allNamespaces": "All namespaces",
    "header.applyYaml": "Apply YAML",
    "header.setupGuide": "Setup guide",
    "header.refresh": "Refresh",

    // Tabs
    "tab.pods": "Pods",
    "tab.deployments": "Deployments",
    "tab.statefulsets": "StatefulSets",
    "tab.daemonsets": "DaemonSets",
    "tab.jobs": "Jobs",
    "tab.cronjobs": "CronJobs",
    "tab.nodes": "Nodes",

    // Loading
    "list.loading": "Loading Kubernetes data…",

    // Shared columns
    "col.namespace": "Namespace",
    "col.ready": "Ready",
    "col.available": "Available",
    "col.qos": "QoS",
    "col.image": "Image",
    "col.created": "Created",

    // Pod columns
    "col.pod": "Pod",
    "col.state": "State",
    "col.node": "Node",
    "col.cpu": "CPU",
    "col.memory": "Memory",
    "col.owner": "Owner",
    "unit.cores": "cores",

    // Deployment / controller name columns
    "col.deployment": "Deployment",
    "col.statefulset": "StatefulSet",
    "col.daemonset": "DaemonSet",
    "col.desired": "Desired",
    "col.job": "Job",
    "col.status": "Status",
    "col.duration": "Duration",
    "col.cronjob": "CronJob",
    "col.schedule": "Schedule",
    "col.lastRun": "Last run",

    // Node columns
    "col.nodeName": "Node",
    "col.roles": "Roles",
    "col.version": "Version",
    "col.internalIp": "Internal IP",

    // CronJob state cell
    "cron.suspended": "Suspended",
    "cron.active": "Active",

    // Row actions (tooltips + aria-labels)
    "action.logs": "Logs",
    "action.podLogs": "Pod logs",
    "action.terminal": "Terminal",
    "action.podTerminal": "Pod terminal",
    "action.podNotRunning": "Pod is not running",
    "action.deletePod": "Delete pod",
    "action.scale": "Scale",
    "action.scaleDeployment": "Scale deployment",
    "action.scaleStatefulset": "Scale statefulset",
    "action.resources": "Resources",
    "action.editResources": "Edit resources",
    "action.rolloutRestart": "Rollout restart",
    "action.restartDeployment": "Restart deployment",
    "action.restartStatefulset": "Restart statefulset",
    "action.restartDaemonset": "Restart daemonset",
    "action.delete": "Delete",
    "action.deleteDeployment": "Delete deployment",
    "action.deleteStatefulset": "Delete statefulset",
    "action.deleteDaemonset": "Delete daemonset",
    "action.deleteJob": "Delete job",
    "action.deleteCronjob": "Delete cronjob",
    "action.runNow": "Run now",
    "action.runCronjobNow": "Run cronjob now",
    "action.resume": "Resume",
    "action.suspend": "Suspend",
    "action.resumeCronjob": "Resume cronjob",
    "action.suspendCronjob": "Suspend cronjob",

    // Empty states
    "empty.clusterTitle": "No Kubernetes cluster reachable",
    "empty.clusterMessage":
      "Castor connects to an existing cluster through a mounted kubeconfig. Mount your kubeconfig into the container and point CASTOR_KUBECONFIG at it, then make sure its server address is reachable from inside the container.",
    "empty.showSetupGuide": "Show setup guide",
    "empty.metricsHint": "CPU / memory columns are blank — install",
    "empty.metricsHintTail": "for live pod usage.",
    "empty.noPods": "No pods",
    "empty.noPodsMessage": "No Kubernetes cluster is reachable, or the namespace is empty.",
    "empty.noDeployments": "No deployments",
    "empty.noStatefulsets": "No StatefulSets",
    "empty.noDaemonsets": "No DaemonSets",
    "empty.noJobs": "No jobs",
    "empty.noCronjobs": "No CronJobs",
    "empty.noNodes": "No nodes",

    // Confirm dialogs
    "dialog.restartTitle": "Rollout restart",
    "dialog.restartConfirm": "Restart",
    "dialog.restartDeployBody1": "Trigger a rolling restart of",
    "dialog.restartDeployBody2": "? Pods are recreated one batch at a time.",
    "dialog.restartStsBody2": "? Pods are recreated in ordinal order, one at a time.",
    "dialog.restartDsBody2": "? Pods are recreated node by node.",

    "dialog.deleteConfirm": "Delete",
    "dialog.deleteDeployTitle": "Delete deployment",
    "dialog.deleteDeployBody1": "Delete",
    "dialog.deleteDeployBody2": "? Its pods are terminated. This cannot be undone.",
    "dialog.deletePodTitle": "Delete pod",
    "dialog.deletePodBody1": "Delete pod",
    "dialog.deletePodBody2": "? If it is managed by a controller it will be recreated.",
    "dialog.deleteStsTitle": "Delete StatefulSet",
    "dialog.deleteStsBody2": "? Its pods are terminated (PVCs are retained). This cannot be undone.",
    "dialog.deleteDsTitle": "Delete DaemonSet",
    "dialog.deleteDsBody2": "? Its pods are removed from every node. This cannot be undone.",
    "dialog.deleteJobTitle": "Delete job",
    "dialog.deleteJobBody2": "? Its pods are removed with it. This cannot be undone.",
    "dialog.deleteCronTitle": "Delete CronJob",
    "dialog.deleteCronBody2": "? No further runs are scheduled. This cannot be undone.",

    // Inline command copy button
    "cmd.copy": "Copy command",

    // Pod terminal modal
    "term.title": "Pod terminal",
    "term.shell": "Shell",
    "term.container": "Container",
    "term.containerPlaceholder": "(default)",
    "term.containerAria": "Container name (blank for default)",
    "term.openSession": "Open session",
    "term.restartSession": "Restart session",
    "term.lastExited": "Last session exited",
    "term.lastExitedCode": "Last session exited (code {code})",
    "term.hint": "For a multi-container pod, name the container to exec into; leave blank for the pod's default container.",
    "term.placeholderTitle": "Pick a shell and open an interactive session.",
    "term.close": "Close",

    // Pod logs modal
    "logs.title": "Pod logs",
    "logs.container": "Container",
    "logs.containerPlaceholder": "(default)",
    "logs.containerAria": "Container name (blank for default)",
    "logs.hint": "Name a container for a multi-container pod; blank streams the default container.",
    "logs.streamError": "Log stream error: {error}",
    "logs.streaming": "streaming",
    "logs.connecting": "connecting…",
    "logs.close": "Close",

    // Scale modal
    "scale.title": "Scale {noun}",
    "scale.currentPrefix": "— currently",
    "scale.currentSuffix": "desired.",
    "scale.replicas": "Replicas",
    "scale.wholeNumber": "Whole number ≥ 0.",
    "scale.cancel": "Cancel",
    "scale.submit": "Scale",

    // Resources modal
    "resources.title": "Edit resources",
    "resources.intro1": "Set CPU / memory requests and limits on",
    "resources.intro2": ". A blank field leaves that value unchanged on the server.",
    "resources.noContainers": "This deployment exposes no containers to configure.",
    "resources.container": "Container",
    "resources.current": "Current",
    "resources.requestsLabel": "requests:",
    "resources.limitsLabel": "limits:",
    "resources.requests": "Requests",
    "resources.limits": "Limits",
    "resources.millicoresHint1": "CPU is millicores (1000m = 1 core); the new values resolve to",
    "resources.cancel": "Cancel",
    "resources.apply": "Apply",

    // Apply manifest modal
    "apply.title": "Apply manifest",
    "apply.intro1": "Paste one or more YAML documents (separated by",
    "apply.intro2": "). Each is server-side applied (field manager",
    "apply.intro3": "); per-document outcomes are shown below.",
    "apply.yamlAria": "Manifest YAML",
    "apply.close": "Close",
    "apply.apply": "Apply",
    "apply.noDocuments": "No documents found in the manifest.",
    "apply.results": "Results ({count})",
    "apply.colKind": "Kind",
    "apply.colName": "Name",
    "apply.colNamespace": "Namespace",
    "apply.colAction": "Action",

    // Toasts
    "toast.copied": "Copied to clipboard",
    "toast.cronTriggered": "CronJob triggered",
    "toast.cronTriggeredBody": "Created job {job}.",
    "toast.triggerFailed": "Trigger failed",
    "toast.cronResumed": "CronJob resumed",
    "toast.cronSuspended": "CronJob suspended",
    "toast.resumeFailed": "Resume failed",
    "toast.suspendFailed": "Suspend failed",
    "toast.rolloutRestarted": "Rollout restarted",
    "toast.restartFailed": "Restart failed",
    "toast.deployDeleted": "Deployment deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.podDeleted": "Pod deleted",
    "toast.stsDeleted": "StatefulSet deleted",
    "toast.dsDeleted": "DaemonSet deleted",
    "toast.jobDeleted": "Job deleted",
    "toast.cronDeleted": "CronJob deleted",
    "toast.scaled": "{noun} scaled",
    "toast.scaledBody": "{namespace}/{name} → {count} replica(s).",
    "toast.scaleFailed": "Scale failed",
    "toast.resourcesUpdated": "Resources updated",
    "toast.updateFailed": "Update failed",
    "toast.manifestApplied": "Manifest applied",
    "toast.manifestAppliedBody": "{count} resource(s).",
    "toast.appliedWithErrors": "Applied with errors",
    "toast.appliedWithErrorsBody": "{errors} of {total} resource(s) failed.",
    "toast.applyFailed": "Apply failed",
  },
  fr: {
    // En-tête de page
    "header.subtitle": "Gérez les pods et les contrôleurs de charge de travail, ou appliquez un manifeste.",
    "header.allNamespaces": "Tous les namespaces",
    "header.applyYaml": "Appliquer YAML",
    "header.setupGuide": "Guide de configuration",
    "header.refresh": "Actualiser",

    // Onglets
    "tab.pods": "Pods",
    "tab.deployments": "Deployments",
    "tab.statefulsets": "StatefulSets",
    "tab.daemonsets": "DaemonSets",
    "tab.jobs": "Jobs",
    "tab.cronjobs": "CronJobs",
    "tab.nodes": "Nœuds",

    // Chargement
    "list.loading": "Chargement des données Kubernetes…",

    // Colonnes partagées
    "col.namespace": "Namespace",
    "col.ready": "Prêts",
    "col.available": "Disponibles",
    "col.qos": "QoS",
    "col.image": "Image",
    "col.created": "Créé",

    // Colonnes des pods
    "col.pod": "Pod",
    "col.state": "État",
    "col.node": "Nœud",
    "col.cpu": "CPU",
    "col.memory": "Mémoire",
    "col.owner": "Propriétaire",
    "unit.cores": "cœurs",

    // Colonnes de noms de contrôleurs
    "col.deployment": "Deployment",
    "col.statefulset": "StatefulSet",
    "col.daemonset": "DaemonSet",
    "col.desired": "Souhaités",
    "col.job": "Job",
    "col.status": "Statut",
    "col.duration": "Durée",
    "col.cronjob": "CronJob",
    "col.schedule": "Planification",
    "col.lastRun": "Dernière exécution",

    // Colonnes des nœuds
    "col.nodeName": "Nœud",
    "col.roles": "Rôles",
    "col.version": "Version",
    "col.internalIp": "IP interne",

    // Cellule d'état des CronJobs
    "cron.suspended": "Suspendu",
    "cron.active": "Actif",

    // Actions de ligne (infobulles + aria-labels)
    "action.logs": "Journaux",
    "action.podLogs": "Journaux du pod",
    "action.terminal": "Terminal",
    "action.podTerminal": "Terminal du pod",
    "action.podNotRunning": "Le pod n'est pas en cours d'exécution",
    "action.deletePod": "Supprimer le pod",
    "action.scale": "Mettre à l'échelle",
    "action.scaleDeployment": "Mettre à l'échelle le deployment",
    "action.scaleStatefulset": "Mettre à l'échelle le statefulset",
    "action.resources": "Ressources",
    "action.editResources": "Modifier les ressources",
    "action.rolloutRestart": "Redémarrage progressif",
    "action.restartDeployment": "Redémarrer le deployment",
    "action.restartStatefulset": "Redémarrer le statefulset",
    "action.restartDaemonset": "Redémarrer le daemonset",
    "action.delete": "Supprimer",
    "action.deleteDeployment": "Supprimer le deployment",
    "action.deleteStatefulset": "Supprimer le statefulset",
    "action.deleteDaemonset": "Supprimer le daemonset",
    "action.deleteJob": "Supprimer le job",
    "action.deleteCronjob": "Supprimer le cronjob",
    "action.runNow": "Exécuter maintenant",
    "action.runCronjobNow": "Exécuter le cronjob maintenant",
    "action.resume": "Reprendre",
    "action.suspend": "Suspendre",
    "action.resumeCronjob": "Reprendre le cronjob",
    "action.suspendCronjob": "Suspendre le cronjob",

    // États vides
    "empty.clusterTitle": "Aucun cluster Kubernetes joignable",
    "empty.clusterMessage":
      "Castor se connecte à un cluster existant via un kubeconfig monté. Montez votre kubeconfig dans le conteneur et faites pointer CASTOR_KUBECONFIG dessus, puis assurez-vous que l'adresse de son serveur est joignable depuis l'intérieur du conteneur.",
    "empty.showSetupGuide": "Afficher le guide de configuration",
    "empty.metricsHint": "Les colonnes CPU / mémoire sont vides — installez",
    "empty.metricsHintTail": "pour l'utilisation en direct des pods.",
    "empty.noPods": "Aucun pod",
    "empty.noPodsMessage": "Aucun cluster Kubernetes n'est joignable, ou le namespace est vide.",
    "empty.noDeployments": "Aucun deployment",
    "empty.noStatefulsets": "Aucun StatefulSet",
    "empty.noDaemonsets": "Aucun DaemonSet",
    "empty.noJobs": "Aucun job",
    "empty.noCronjobs": "Aucun CronJob",
    "empty.noNodes": "Aucun nœud",

    // Boîtes de dialogue de confirmation
    "dialog.restartTitle": "Redémarrage progressif",
    "dialog.restartConfirm": "Redémarrer",
    "dialog.restartDeployBody1": "Déclencher un redémarrage progressif de",
    "dialog.restartDeployBody2": " ? Les pods sont recréés par lots successifs.",
    "dialog.restartStsBody2": " ? Les pods sont recréés dans l'ordre ordinal, un à la fois.",
    "dialog.restartDsBody2": " ? Les pods sont recréés nœud par nœud.",

    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteDeployTitle": "Supprimer le deployment",
    "dialog.deleteDeployBody1": "Supprimer",
    "dialog.deleteDeployBody2": " ? Ses pods sont arrêtés. Cette action est irréversible.",
    "dialog.deletePodTitle": "Supprimer le pod",
    "dialog.deletePodBody1": "Supprimer le pod",
    "dialog.deletePodBody2": " ? S'il est géré par un contrôleur, il sera recréé.",
    "dialog.deleteStsTitle": "Supprimer le StatefulSet",
    "dialog.deleteStsBody2": " ? Ses pods sont arrêtés (les PVC sont conservés). Cette action est irréversible.",
    "dialog.deleteDsTitle": "Supprimer le DaemonSet",
    "dialog.deleteDsBody2": " ? Ses pods sont retirés de chaque nœud. Cette action est irréversible.",
    "dialog.deleteJobTitle": "Supprimer le job",
    "dialog.deleteJobBody2": " ? Ses pods sont supprimés avec lui. Cette action est irréversible.",
    "dialog.deleteCronTitle": "Supprimer le CronJob",
    "dialog.deleteCronBody2": " ? Aucune exécution future n'est planifiée. Cette action est irréversible.",

    // Bouton copier de la commande en ligne
    "cmd.copy": "Copier la commande",

    // Fenêtre du terminal du pod
    "term.title": "Terminal du pod",
    "term.shell": "Shell",
    "term.container": "Conteneur",
    "term.containerPlaceholder": "(par défaut)",
    "term.containerAria": "Nom du conteneur (vide pour le conteneur par défaut)",
    "term.openSession": "Ouvrir une session",
    "term.restartSession": "Redémarrer la session",
    "term.lastExited": "La dernière session s'est terminée",
    "term.lastExitedCode": "La dernière session s'est terminée (code {code})",
    "term.hint": "Pour un pod multi-conteneurs, indiquez le conteneur dans lequel exécuter la commande ; laissez vide pour le conteneur par défaut du pod.",
    "term.placeholderTitle": "Choisissez un shell et ouvrez une session interactive.",
    "term.close": "Fermer",

    // Fenêtre des journaux du pod
    "logs.title": "Journaux du pod",
    "logs.container": "Conteneur",
    "logs.containerPlaceholder": "(par défaut)",
    "logs.containerAria": "Nom du conteneur (vide pour le conteneur par défaut)",
    "logs.hint": "Indiquez un conteneur pour un pod multi-conteneurs ; vide diffuse le conteneur par défaut.",
    "logs.streamError": "Erreur du flux de journaux : {error}",
    "logs.streaming": "diffusion",
    "logs.connecting": "connexion…",
    "logs.close": "Fermer",

    // Fenêtre de mise à l'échelle
    "scale.title": "Mettre à l'échelle {noun}",
    "scale.currentPrefix": "— actuellement",
    "scale.currentSuffix": "souhaité(s).",
    "scale.replicas": "Réplicas",
    "scale.wholeNumber": "Nombre entier ≥ 0.",
    "scale.cancel": "Annuler",
    "scale.submit": "Mettre à l'échelle",

    // Fenêtre des ressources
    "resources.title": "Modifier les ressources",
    "resources.intro1": "Définir les requêtes et limites CPU / mémoire sur",
    "resources.intro2": ". Un champ vide laisse cette valeur inchangée sur le serveur.",
    "resources.noContainers": "Ce deployment n'expose aucun conteneur à configurer.",
    "resources.container": "Conteneur",
    "resources.current": "Actuel",
    "resources.requestsLabel": "requêtes :",
    "resources.limitsLabel": "limites :",
    "resources.requests": "Requêtes",
    "resources.limits": "Limites",
    "resources.millicoresHint1": "Le CPU est en millicores (1000m = 1 cœur) ; les nouvelles valeurs se résolvent en",
    "resources.cancel": "Annuler",
    "resources.apply": "Appliquer",

    // Fenêtre d'application de manifeste
    "apply.title": "Appliquer un manifeste",
    "apply.intro1": "Collez un ou plusieurs documents YAML (séparés par",
    "apply.intro2": "). Chacun est appliqué côté serveur (gestionnaire de champs",
    "apply.intro3": ") ; les résultats par document sont affichés ci-dessous.",
    "apply.yamlAria": "Manifeste YAML",
    "apply.close": "Fermer",
    "apply.apply": "Appliquer",
    "apply.noDocuments": "Aucun document trouvé dans le manifeste.",
    "apply.results": "Résultats ({count})",
    "apply.colKind": "Type",
    "apply.colName": "Nom",
    "apply.colNamespace": "Namespace",
    "apply.colAction": "Action",

    // Toasts
    "toast.copied": "Copié dans le presse-papiers",
    "toast.cronTriggered": "CronJob déclenché",
    "toast.cronTriggeredBody": "Job {job} créé.",
    "toast.triggerFailed": "Échec du déclenchement",
    "toast.cronResumed": "CronJob repris",
    "toast.cronSuspended": "CronJob suspendu",
    "toast.resumeFailed": "Échec de la reprise",
    "toast.suspendFailed": "Échec de la suspension",
    "toast.rolloutRestarted": "Redémarrage progressif effectué",
    "toast.restartFailed": "Échec du redémarrage",
    "toast.deployDeleted": "Deployment supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.podDeleted": "Pod supprimé",
    "toast.stsDeleted": "StatefulSet supprimé",
    "toast.dsDeleted": "DaemonSet supprimé",
    "toast.jobDeleted": "Job supprimé",
    "toast.cronDeleted": "CronJob supprimé",
    "toast.scaled": "{noun} mis à l'échelle",
    "toast.scaledBody": "{namespace}/{name} → {count} réplica(s).",
    "toast.scaleFailed": "Échec de la mise à l'échelle",
    "toast.resourcesUpdated": "Ressources mises à jour",
    "toast.updateFailed": "Échec de la mise à jour",
    "toast.manifestApplied": "Manifeste appliqué",
    "toast.manifestAppliedBody": "{count} ressource(s).",
    "toast.appliedWithErrors": "Appliqué avec des erreurs",
    "toast.appliedWithErrorsBody": "{errors} ressource(s) sur {total} ont échoué.",
    "toast.applyFailed": "Échec de l'application",
  },
});
