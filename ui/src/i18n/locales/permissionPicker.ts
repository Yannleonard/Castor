// ui/src/i18n/locales/permissionPicker.ts
//
// Locale dictionary for the PermissionPicker component
// (ui/src/components/PermissionPicker.tsx). The picker groups the flat
// permission catalog by domain into collapsible sections.
//
// NOTE — group identifiers ("Superuser", "Docker", "Swarm", "Kubernetes",
// "RBAC", "Audit", "Settings", "Other") are internal keys used for grouping,
// ordering and React keys; they are never displayed raw. Only their display
// labels are translated here (group.*). Proper names / technical terms
// (Docker, Swarm, Kubernetes, RBAC) stay identical across languages.
// Permission strings themselves (e.g. docker.container.start) are rendered
// verbatim from the data and are never translated.

import { defineDict } from "../core";

export const permissionPickerDict = defineDict({
  en: {
    // Group section headers
    "group.Superuser": "Superuser",
    "group.Docker": "Docker",
    "group.Swarm": "Swarm",
    "group.Kubernetes": "Kubernetes",
    "group.RBAC": "RBAC",
    "group.Audit": "Audit",
    "group.Settings": "Settings",
    "group.Other": "Other",

    // Wildcard superuser banner (the "*" fragment stays as literal JSX)
    "banner.wildcardPrefix": "The",
    "banner.wildcardSuffix": "superuser permission grants everything; individual toggles are implied.",
  },
  fr: {
    // En-têtes de section
    "group.Superuser": "Superutilisateur",
    "group.Docker": "Docker",
    "group.Swarm": "Swarm",
    "group.Kubernetes": "Kubernetes",
    "group.RBAC": "RBAC",
    "group.Audit": "Audit",
    "group.Settings": "Paramètres",
    "group.Other": "Autre",

    // Bannière superutilisateur (le fragment « * » reste du JSX littéral)
    "banner.wildcardPrefix": "La permission superutilisateur",
    "banner.wildcardSuffix": "accorde tout ; les cases individuelles sont implicites.",
  },
});
