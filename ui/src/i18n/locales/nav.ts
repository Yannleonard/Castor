// ui/src/i18n/locales/nav.ts
//
// Navigation dictionary: sidebar group labels + item labels, TopBar page titles,
// and the user-menu labels. Keys mirror the existing GROUPS structure WITHOUT
// changing it — the sidebar keeps its untranslated `label` strings as stable
// lookup keys and translates them at render time via `t()`.
//
// Key naming:
//   group.<Label>   → sidebar section header (keyed by the English GROUPS label)
//   item.<Label>    → sidebar nav item (keyed by the English item label)
//   title.<path>    → TopBar page title per route
//   menu.<x>        → user-menu labels (profile, signOut, theme, language)
//   theme.<x>       → theme preference names

import { defineDict } from "../core";

export const navDict = defineDict({
  en: {
    // Sidebar group headers
    "group.Overview": "Overview",
    "group.Compute": "Compute",
    "group.Storage": "Storage",
    "group.Orchestrators": "Orchestrators",
    "group.Admin": "Admin",

    // Sidebar items (keyed by their English label in GROUPS)
    "item.Dashboard": "Dashboard",
    "item.Hosts": "Hosts",
    "item.Workloads": "Workloads",
    "item.Marketplace": "Marketplace",
    "item.Stacks": "Stacks",
    "item.Images": "Images",
    "item.Networks": "Networks",
    "item.Volumes": "Volumes",
    "item.Backups": "Backups",
    "item.Swarm": "Swarm",
    "item.Kubernetes": "Kubernetes",
    "item.Storage": "Storage",
    "item.Cluster": "Cluster",
    "item.Helm": "Helm",
    "item.Audit": "Audit",
    "item.Users": "Users",
    "item.Roles": "Roles",
    "item.Registries": "Registries",
    "item.Catalogs": "Catalogs",
    "item.Authentication": "Authentication",
    "item.Settings": "Settings",

    // TopBar page titles (keyed by pathname)
    "title./": "Dashboard",
    "title./hosts": "Hosts",
    "title./workloads": "Workloads",
    "title./images": "Images",
    "title./networks": "Networks",
    "title./volumes": "Volumes",
    "title./swarm": "Swarm",
    "title./k8s": "Kubernetes",
    "title./audit": "Audit log",
    "title./users": "Users",
    "title./roles": "Roles",
    "title./settings": "Settings",
    "title./profile": "Profile",
    "title.workloadDetail": "Workload detail",
    "title.fallback": "Castor",

    // User menu
    "menu.hosts": "Hosts",
    "menu.noHosts": "No hosts",
    "menu.profile": "Profile & security",
    "menu.signOut": "Sign out",
    "menu.signedOut": "Signed out",
    "menu.logout": "Logout",
    "menu.theme": "Theme",
    "menu.themeTooltip": "Cycle theme: Light → Dark → System",
    "menu.themeAria": "Theme: {theme} (click to change)",
    "menu.language": "Language",

    // Theme preference names
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",

    // TopBar misc
    "topbar.search": "Search…",
    "topbar.openPalette": "Open command palette",
    "topbar.toggleNav": "Toggle navigation menu",
    "topbar.degraded": "Degraded",
    "topbar.degradedTitle": "One or more hosts/providers are degraded",
    "topbar.live": "Live",
    "topbar.liveOn": "Live updates connected",
    "topbar.liveOff": "Live updates offline",
  },
  fr: {
    // En-têtes de groupe
    "group.Overview": "Vue d'ensemble",
    "group.Compute": "Calcul",
    "group.Storage": "Stockage",
    "group.Orchestrators": "Orchestrateurs",
    "group.Admin": "Administration",

    // Éléments de navigation
    "item.Dashboard": "Tableau de bord",
    "item.Hosts": "Hôtes",
    "item.Workloads": "Charges de travail",
    "item.Marketplace": "Catalogue",
    "item.Stacks": "Stacks",
    "item.Images": "Images",
    "item.Networks": "Réseaux",
    "item.Volumes": "Volumes",
    "item.Backups": "Sauvegardes",
    "item.Swarm": "Swarm",
    "item.Kubernetes": "Kubernetes",
    "item.Storage": "Stockage",
    "item.Cluster": "Cluster",
    "item.Helm": "Helm",
    "item.Audit": "Audit",
    "item.Users": "Utilisateurs",
    "item.Roles": "Rôles",
    "item.Registries": "Registres",
    "item.Catalogs": "Catalogues",
    "item.Authentication": "Authentification",
    "item.Settings": "Paramètres",

    // Titres de page (TopBar)
    "title./": "Tableau de bord",
    "title./hosts": "Hôtes",
    "title./workloads": "Charges de travail",
    "title./images": "Images",
    "title./networks": "Réseaux",
    "title./volumes": "Volumes",
    "title./swarm": "Swarm",
    "title./k8s": "Kubernetes",
    "title./audit": "Journal d'audit",
    "title./users": "Utilisateurs",
    "title./roles": "Rôles",
    "title./settings": "Paramètres",
    "title./profile": "Profil",
    "title.workloadDetail": "Détail de la charge de travail",
    "title.fallback": "Castor",

    // Menu utilisateur
    "menu.hosts": "Hôtes",
    "menu.noHosts": "Aucun hôte",
    "menu.profile": "Profil et sécurité",
    "menu.signOut": "Se déconnecter",
    "menu.signedOut": "Déconnecté",
    "menu.logout": "Déconnexion",
    "menu.theme": "Thème",
    "menu.themeTooltip": "Alterner le thème : Clair → Sombre → Système",
    "menu.themeAria": "Thème : {theme} (cliquer pour changer)",
    "menu.language": "Langue",

    // Noms des préférences de thème
    "theme.light": "Clair",
    "theme.dark": "Sombre",
    "theme.system": "Système",

    // Divers TopBar
    "topbar.search": "Rechercher…",
    "topbar.openPalette": "Ouvrir la palette de commandes",
    "topbar.toggleNav": "Basculer le menu de navigation",
    "topbar.degraded": "Dégradé",
    "topbar.degradedTitle": "Un ou plusieurs hôtes/fournisseurs sont dégradés",
    "topbar.live": "Live",
    "topbar.liveOn": "Mises à jour en direct connectées",
    "topbar.liveOff": "Mises à jour en direct hors ligne",
  },
});
