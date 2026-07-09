// ui/src/i18n/locales/k8sCluster.ts
//
// Locale dictionary for the Kubernetes cluster view (ui/src/views/K8sCluster.tsx).
// Covers the page header, tabs, per-kind table columns, empty states, the
// Create HPA / Create namespace / Apply ingress modals, and their toasts.
//
// DO NOT translate technical identifiers rendered verbatim from data: Kubernetes
// kinds (Ingress, HorizontalPodAutoscaler), API groups (networking.k8s.io/v1),
// resource names, YAML examples, field managers (castor), DNS-label patterns,
// namespace status values (Active), event types (Warning/Error). Those flow
// through the data path, never through `t`.

import { defineDict } from "../core";

export const k8sClusterDict = defineDict({
  en: {
    // Page header
    "header.title": "Cluster",
    "header.subtitle": "Autoscalers, namespaces, services, ingresses, config and events.",
    "header.allNamespaces": "All namespaces",
    "header.createHpa": "Create HPA",
    "header.createNamespace": "Create namespace",
    "header.applyYaml": "Apply YAML",
    "header.applyYamlTooltip": "Create or update an Ingress by applying YAML",
    "header.refresh": "Refresh",

    // Tabs
    "tab.hpa": "Autoscalers",
    "tab.namespaces": "Namespaces",
    "tab.services": "Services",
    "tab.ingresses": "Ingresses",
    "tab.configmaps": "ConfigMaps",
    "tab.secrets": "Secrets",
    "tab.events": "Events",

    // Shared / HPA columns
    "col.name": "Name",
    "col.namespace": "Namespace",
    "col.target": "Target",
    "col.replicas": "Replicas",
    "col.cpu": "CPU",
    "col.status": "Status",
    "col.created": "Created",
    "col.type": "Type",
    "col.clusterIp": "Cluster IP",
    "col.ports": "Ports",
    "col.externalIp": "External IP",
    "col.class": "Class",
    "col.hosts": "Hosts",
    "col.routes": "Routes",
    "col.address": "Address",
    "col.keys": "Keys",
    "col.reason": "Reason",
    "col.object": "Object",
    "col.message": "Message",
    "col.count": "Count",
    "col.age": "Age",

    // Routes cell overflow
    "cell.moreRoutes": "+{count} more",

    // Row actions
    "row.deleteHpa": "Delete HPA",
    "row.deleteNamespace": "Delete namespace",
    "row.deleteIngress": "Delete ingress",

    // Loading + empty states
    "list.loading": "Loading cluster data…",
    "empty.hpaTitle": "No autoscalers",
    "empty.hpaMessage": "No HorizontalPodAutoscalers in this scope.",
    "empty.namespacesTitle": "No namespaces",
    "empty.servicesTitle": "No services",
    "empty.ingressesTitle": "No ingresses",
    "empty.ingressesMessage": "No Ingress resources in this scope. Use “Apply YAML” to create one.",
    "empty.configmapsTitle": "No config maps",
    "empty.secretsTitle": "No secrets",
    "empty.secretsMessage": "Secret values are never shown — only key names.",
    "empty.eventsTitle": "No recent events",

    // Node metrics summary
    "metrics.unavailablePrefix": "Live metrics unavailable — install",
    "metrics.unavailableSuffix": "to see real CPU / memory usage and HPA utilization.",
    "metrics.liveUsage": "Live node usage ({count})",
    "metrics.cpu": "CPU",
    "metrics.cpuUnit": "cores",
    "metrics.memory": "Memory",

    // Delete HPA dialog
    "dialog.deleteHpaTitle": "Delete autoscaler",
    "dialog.deleteHpaBefore": "Delete HPA",
    "dialog.deleteHpaAfter": "? The target deployment keeps its current replica count but stops autoscaling.",

    // Delete namespace dialog
    "dialog.deleteNamespaceTitle": "Delete namespace",
    "dialog.deleteNamespaceBefore": "Delete namespace",
    "dialog.deleteNamespaceAfter": "? Every object in it (deployments, services, PVCs, secrets…) is destroyed. This cannot be undone.",

    // Delete ingress dialog
    "dialog.deleteIngressTitle": "Delete ingress",
    "dialog.deleteIngressBefore": "Delete ingress",
    "dialog.deleteIngressAfter": "? Its routing rules stop serving immediately. This cannot be undone.",
    "dialog.confirmDelete": "Delete",

    // Apply ingress modal
    "ingress.modalTitle": "Apply ingress YAML",
    "ingress.introBefore": "Create or update an Ingress by server-side applying a",
    "ingress.introMiddle": "manifest (field manager",
    "ingress.introAfter": "). Edit the skeleton below.",
    "ingress.yamlLabel": "Ingress YAML",
    "ingress.cancel": "Cancel",
    "ingress.apply": "Apply",

    // Create HPA modal
    "hpa.modalTitle": "Create autoscaler",
    "hpa.intro": "A CPU-utilization HorizontalPodAutoscaler targeting a Deployment in the same namespace.",
    "hpa.name": "Name",
    "hpa.namePlaceholder": "web",
    "hpa.namespace": "Namespace",
    "hpa.targetDeployment": "Target deployment",
    "hpa.selectDeployment": "Select a deployment…",
    "hpa.targetPlaceholder": "deployment name",
    "hpa.noDeployments": "No deployments loaded for this namespace — type the name.",
    "hpa.minReplicas": "Min replicas",
    "hpa.maxReplicas": "Max replicas",
    "hpa.targetCpu": "Target CPU %",
    "hpa.nameError": "Lowercase DNS label (a-z, 0-9, -).",
    "hpa.replicasError": "Min ≥ 1 and Max ≥ Min (whole numbers).",
    "hpa.cpuError": "CPU target is 1–100%.",
    "hpa.cancel": "Cancel",
    "hpa.create": "Create",

    // Create namespace modal
    "ns.modalTitle": "Create namespace",
    "ns.name": "Name",
    "ns.namePlaceholder": "team-a",
    "ns.nameError": "Lowercase DNS label (a-z, 0-9, -).",
    "ns.duplicateError": "A namespace with that name already exists.",
    "ns.cancel": "Cancel",
    "ns.create": "Create",

    // Toasts
    "toast.hpaDeleted": "HPA deleted",
    "toast.namespaceDeleted": "Namespace deleted",
    "toast.ingressDeleted": "Ingress deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.ingressApplied": "Ingress applied",
    "toast.ingressAppliedBody": "{count} resource(s).",
    "toast.appliedWithErrors": "Applied with errors",
    "toast.appliedWithErrorsBody": "{count} resource(s) failed.",
    "toast.applyFailed": "Apply failed",
    "toast.hpaCreated": "HPA created",
    "toast.namespaceCreated": "Namespace created",
    "toast.createFailed": "Create failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Cluster",
    "header.subtitle": "Autoscalers, namespaces, services, ingress, configuration et événements.",
    "header.allNamespaces": "Tous les namespaces",
    "header.createHpa": "Créer un HPA",
    "header.createNamespace": "Créer un namespace",
    "header.applyYaml": "Appliquer le YAML",
    "header.applyYamlTooltip": "Créer ou mettre à jour un Ingress en appliquant du YAML",
    "header.refresh": "Actualiser",

    // Onglets
    "tab.hpa": "Autoscalers",
    "tab.namespaces": "Namespaces",
    "tab.services": "Services",
    "tab.ingresses": "Ingress",
    "tab.configmaps": "ConfigMaps",
    "tab.secrets": "Secrets",
    "tab.events": "Événements",

    // Colonnes partagées / HPA
    "col.name": "Nom",
    "col.namespace": "Namespace",
    "col.target": "Cible",
    "col.replicas": "Réplicas",
    "col.cpu": "CPU",
    "col.status": "État",
    "col.created": "Créé",
    "col.type": "Type",
    "col.clusterIp": "IP cluster",
    "col.ports": "Ports",
    "col.externalIp": "IP externe",
    "col.class": "Classe",
    "col.hosts": "Hôtes",
    "col.routes": "Routes",
    "col.address": "Adresse",
    "col.keys": "Clés",
    "col.reason": "Raison",
    "col.object": "Objet",
    "col.message": "Message",
    "col.count": "Nombre",
    "col.age": "Âge",

    // Débordement cellule routes
    "cell.moreRoutes": "+{count} de plus",

    // Actions de ligne
    "row.deleteHpa": "Supprimer le HPA",
    "row.deleteNamespace": "Supprimer le namespace",
    "row.deleteIngress": "Supprimer l'ingress",

    // Chargement + états vides
    "list.loading": "Chargement des données du cluster…",
    "empty.hpaTitle": "Aucun autoscaler",
    "empty.hpaMessage": "Aucun HorizontalPodAutoscaler dans cette portée.",
    "empty.namespacesTitle": "Aucun namespace",
    "empty.servicesTitle": "Aucun service",
    "empty.ingressesTitle": "Aucun ingress",
    "empty.ingressesMessage": "Aucune ressource Ingress dans cette portée. Utilisez « Appliquer le YAML » pour en créer une.",
    "empty.configmapsTitle": "Aucune ConfigMap",
    "empty.secretsTitle": "Aucun secret",
    "empty.secretsMessage": "Les valeurs des secrets ne sont jamais affichées — seulement les noms de clés.",
    "empty.eventsTitle": "Aucun événement récent",

    // Résumé des métriques de nœuds
    "metrics.unavailablePrefix": "Métriques en temps réel indisponibles — installez",
    "metrics.unavailableSuffix": "pour voir l'utilisation réelle CPU / mémoire et le taux d'utilisation des HPA.",
    "metrics.liveUsage": "Utilisation des nœuds en temps réel ({count})",
    "metrics.cpu": "CPU",
    "metrics.cpuUnit": "cœurs",
    "metrics.memory": "Mémoire",

    // Dialogue suppression HPA
    "dialog.deleteHpaTitle": "Supprimer l'autoscaler",
    "dialog.deleteHpaBefore": "Supprimer le HPA",
    "dialog.deleteHpaAfter": " ? Le déploiement cible conserve son nombre de réplicas actuel mais cesse l'autoscaling.",

    // Dialogue suppression namespace
    "dialog.deleteNamespaceTitle": "Supprimer le namespace",
    "dialog.deleteNamespaceBefore": "Supprimer le namespace",
    "dialog.deleteNamespaceAfter": " ? Tous les objets qu'il contient (déploiements, services, PVC, secrets…) sont détruits. Action irréversible.",

    // Dialogue suppression ingress
    "dialog.deleteIngressTitle": "Supprimer l'ingress",
    "dialog.deleteIngressBefore": "Supprimer l'ingress",
    "dialog.deleteIngressAfter": " ? Ses règles de routage cessent immédiatement de servir. Action irréversible.",
    "dialog.confirmDelete": "Supprimer",

    // Fenêtre d'application d'ingress
    "ingress.modalTitle": "Appliquer le YAML d'ingress",
    "ingress.introBefore": "Créez ou mettez à jour un Ingress via un apply côté serveur d'un manifeste",
    "ingress.introMiddle": "(field manager",
    "ingress.introAfter": "). Modifiez le squelette ci-dessous.",
    "ingress.yamlLabel": "YAML de l'ingress",
    "ingress.cancel": "Annuler",
    "ingress.apply": "Appliquer",

    // Fenêtre de création de HPA
    "hpa.modalTitle": "Créer un autoscaler",
    "hpa.intro": "Un HorizontalPodAutoscaler basé sur l'utilisation CPU ciblant un Deployment dans le même namespace.",
    "hpa.name": "Nom",
    "hpa.namePlaceholder": "web",
    "hpa.namespace": "Namespace",
    "hpa.targetDeployment": "Déploiement cible",
    "hpa.selectDeployment": "Sélectionner un déploiement…",
    "hpa.targetPlaceholder": "nom du déploiement",
    "hpa.noDeployments": "Aucun déploiement chargé pour ce namespace — saisissez le nom.",
    "hpa.minReplicas": "Réplicas min.",
    "hpa.maxReplicas": "Réplicas max.",
    "hpa.targetCpu": "CPU cible %",
    "hpa.nameError": "Label DNS en minuscules (a-z, 0-9, -).",
    "hpa.replicasError": "Min ≥ 1 et Max ≥ Min (nombres entiers).",
    "hpa.cpuError": "La cible CPU est de 1 à 100 %.",
    "hpa.cancel": "Annuler",
    "hpa.create": "Créer",

    // Fenêtre de création de namespace
    "ns.modalTitle": "Créer un namespace",
    "ns.name": "Nom",
    "ns.namePlaceholder": "team-a",
    "ns.nameError": "Label DNS en minuscules (a-z, 0-9, -).",
    "ns.duplicateError": "Un namespace portant ce nom existe déjà.",
    "ns.cancel": "Annuler",
    "ns.create": "Créer",

    // Toasts
    "toast.hpaDeleted": "HPA supprimé",
    "toast.namespaceDeleted": "Namespace supprimé",
    "toast.ingressDeleted": "Ingress supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.ingressApplied": "Ingress appliqué",
    "toast.ingressAppliedBody": "{count} ressource(s).",
    "toast.appliedWithErrors": "Appliqué avec des erreurs",
    "toast.appliedWithErrorsBody": "{count} ressource(s) en échec.",
    "toast.applyFailed": "Échec de l'application",
    "toast.hpaCreated": "HPA créé",
    "toast.namespaceCreated": "Namespace créé",
    "toast.createFailed": "Échec de la création",
  },
});
