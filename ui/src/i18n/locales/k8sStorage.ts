// Castor by IT Leonard
// ui/src/i18n/locales/k8sStorage.ts
//
// Locale dictionary for the Kubernetes Storage view (ui/src/views/K8sStorage.tsx):
// PersistentVolumes, PersistentVolumeClaims and StorageClasses, plus the
// "Create PVC" modal and delete confirmation.
//
// Keys are camelCase, namespaced by UI zone (header.*, tab.*, col.*, empty.*,
// action.*, dialog.*, form.*, toast.*). DO NOT translate technical identifiers
// rendered verbatim from the data: Kubernetes phase values (Bound, Pending…),
// access modes (ReadWriteOnce…), provisioner names, storage-class names, the
// "default" badge value, and the size units (Mi/Gi/Ti). Those never go through t().

import { defineDict } from "../core";

export const k8sStorageDict = defineDict({
  en: {
    // Page header
    "header.title": "Storage",
    "header.subtitle": "PersistentVolumes, claims and storage classes.",
    "header.allNamespaces": "All namespaces",
    "header.createPvc": "Create PVC",
    "header.refresh": "Refresh",

    // Tabs
    "tab.pvs": "Persistent Volumes",
    "tab.pvcs": "Volume Claims",
    "tab.storageClasses": "Storage Classes",

    // Shared / PV / PVC columns
    "col.name": "Name",
    "col.capacity": "Capacity",
    "col.status": "Status",
    "col.access": "Access",
    "col.reclaim": "Reclaim",
    "col.storageClass": "Storage class",
    "col.claim": "Claim",
    "col.namespace": "Namespace",
    "col.volume": "Volume",
    "col.provisioner": "Provisioner",
    "col.bindingMode": "Binding mode",

    // Loading + empty states
    "list.loading": "Loading storage…",
    "empty.pvsTitle": "No persistent volumes",
    "empty.pvsMessage": "No Kubernetes cluster is reachable, or no PVs are provisioned.",
    "empty.pvcsTitle": "No volume claims",
    "empty.pvcsMessage": "No PersistentVolumeClaims in this scope.",
    "empty.storageClassesTitle": "No storage classes",

    // Row action
    "action.deletePvc": "Delete PVC",

    // Delete confirmation dialog
    "dialog.deleteTitle": "Delete volume claim",
    "dialog.deleteConfirm": "Delete",
    "dialog.deleteDescriptionSuffix":
      "? Depending on the volume's reclaim policy its bound PersistentVolume may be deleted too. This cannot be undone.",

    // Create PVC modal
    "form.title": "Create volume claim",
    "form.cancel": "Cancel",
    "form.create": "Create",
    "form.name": "Name",
    "form.namePlaceholder": "data",
    "form.nameError": "Lowercase DNS label (a-z, 0-9, -).",
    "form.namespace": "Namespace",
    "form.storageClass": "Storage class",
    "form.storageClassDefault": "Cluster default",
    "form.storageClassDefaultSuffix": " (default)",
    "form.accessMode": "Access mode",
    "form.size": "Size",
    "form.sizeError": "Positive number.",
    "form.unit": "Unit",
    "form.requestsHintPrefix": "Requests ",
    "form.requestsHintSuffix":
      " of storage. A blank storage class uses the cluster default provisioner.",

    // Toasts
    "toast.deletedTitle": "PVC deleted",
    "toast.deleteFailed": "Delete failed",
    "toast.createdTitle": "PVC created",
    "toast.createFailed": "Create failed",
  },
  fr: {
    // En-tête de page
    "header.title": "Stockage",
    "header.subtitle": "PersistentVolumes, claims et storage classes.",
    "header.allNamespaces": "Tous les namespaces",
    "header.createPvc": "Créer un PVC",
    "header.refresh": "Actualiser",

    // Onglets
    "tab.pvs": "Persistent Volumes",
    "tab.pvcs": "Volume Claims",
    "tab.storageClasses": "Storage Classes",

    // Colonnes partagées / PV / PVC
    "col.name": "Nom",
    "col.capacity": "Capacité",
    "col.status": "Statut",
    "col.access": "Accès",
    "col.reclaim": "Récupération",
    "col.storageClass": "Storage class",
    "col.claim": "Claim",
    "col.namespace": "Namespace",
    "col.volume": "Volume",
    "col.provisioner": "Provisionneur",
    "col.bindingMode": "Mode de liaison",

    // Chargement + états vides
    "list.loading": "Chargement du stockage…",
    "empty.pvsTitle": "Aucun persistent volume",
    "empty.pvsMessage": "Aucun cluster Kubernetes joignable, ou aucun PV provisionné.",
    "empty.pvcsTitle": "Aucun volume claim",
    "empty.pvcsMessage": "Aucun PersistentVolumeClaim dans cette portée.",
    "empty.storageClassesTitle": "Aucune storage class",

    // Action de ligne
    "action.deletePvc": "Supprimer le PVC",

    // Fenêtre de confirmation de suppression
    "dialog.deleteTitle": "Supprimer le volume claim",
    "dialog.deleteConfirm": "Supprimer",
    "dialog.deleteDescriptionSuffix":
      " ? Selon la politique de récupération du volume, son PersistentVolume lié peut être supprimé aussi. Action irréversible.",

    // Fenêtre de création de PVC
    "form.title": "Créer un volume claim",
    "form.cancel": "Annuler",
    "form.create": "Créer",
    "form.name": "Nom",
    "form.namePlaceholder": "data",
    "form.nameError": "Label DNS en minuscules (a-z, 0-9, -).",
    "form.namespace": "Namespace",
    "form.storageClass": "Storage class",
    "form.storageClassDefault": "Défaut du cluster",
    "form.storageClassDefaultSuffix": " (défaut)",
    "form.accessMode": "Mode d'accès",
    "form.size": "Taille",
    "form.sizeError": "Nombre positif.",
    "form.unit": "Unité",
    "form.requestsHintPrefix": "Demande ",
    "form.requestsHintSuffix":
      " de stockage. Une storage class vide utilise le provisionneur par défaut du cluster.",

    // Toasts
    "toast.deletedTitle": "PVC supprimé",
    "toast.deleteFailed": "Échec de la suppression",
    "toast.createdTitle": "PVC créé",
    "toast.createFailed": "Échec de la création",
  },
});
