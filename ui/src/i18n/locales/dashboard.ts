// Castor by IT Leonard
// ui/src/i18n/locales/dashboard.ts
//
// Locale dictionary for the Dashboard view (ui/src/views/Dashboard.tsx). Follows
// the reference model in audit.ts: one dictionary per view, camelCase keys
// namespaced by UI zone.
//
//   header.*   page header (welcome title / subtitle) + loading state
//   banner.*   degraded-hosts warning banner
//   kpi.*      KPI tile labels + sub-lines
//   chart.*    chart card titles / hints / empty states
//   gauge.*    resource gauge labels + footers
//   orch.*     orchestrators card
//   activity.* recent-activity card
//   tip.*      chart tooltip strings
//
// Interpolations use {token} — e.g. header.subtitle: "Live analytics for {host}".
// DO NOT translate technical identifiers rendered verbatim from the data:
// container states, action names, host/provider ids, "Docker" product name.

import { defineDict } from "../core";

export const dashboardDict = defineDict({
  en: {
    // Page header
    "header.welcome": "Welcome back, {name}",
    "header.subtitle": "Live analytics for {host}",
    "header.subtitleDocker": "Live analytics for {host} · Docker {version}",
    "header.loading": "Loading dashboard…",

    // Degraded banner
    "banner.degraded": "One or more hosts or providers are degraded. Cached data may be stale.",
    "banner.reviewHosts": "Review hosts",

    // KPI tiles
    "kpi.running": "Running",
    "kpi.runningSub": "{stopped} stopped · {total} total",
    "kpi.cpu": "CPU usage",
    "kpi.cpuSub": "across {cores} cores",
    "kpi.memory": "Memory used",
    "kpi.memorySub": "{pct} of {total}",
    "kpi.memorySubUnknown": "capacity unknown",
    "kpi.images": "Images",
    "kpi.imagesSub": "pulled on host",
    "kpi.volumes": "Volumes",
    "kpi.volumesSub": "persistent data",
    "kpi.networks": "Networks",
    "kpi.networksSub": "docker networks",

    // Chart cards
    "chart.states": "Container states",
    "chart.statesHint": "{count} total",
    "chart.statesEmpty": "No containers",
    "chart.donutRunning": "running",
    "chart.resource": "Resource utilization",
    "chart.resourceHint": "live sample",
    "chart.topCpu": "Top containers by CPU",
    "chart.topCpuHint": "%",
    "chart.topMem": "Top containers by memory",
    "chart.topMemHint": "bytes",
    "chart.topEmpty": "No live samples",

    // Resource gauges
    "gauge.cpu": "CPU",
    "gauge.memory": "Memory",
    "gauge.cores": "{cores} cores",
    "gauge.limitUnknown": "limit unknown",

    // Orchestrators card
    "orch.title": "Orchestrators",
    "orch.hint": "{svc} svc · {tasks} tasks · {pods} pods",
    "orch.empty": "No orchestrators connected.",

    // Recent activity card
    "activity.title": "Recent activity",
    "activity.viewAll": "View all",
    "activity.noPermission": "You do not have permission to view the audit log.",
    "activity.empty": "No activity yet",

    // Chart tooltips
    "tip.containerOne": "{count} container",
    "tip.containerOther": "{count} containers",
  },
  fr: {
    // En-tête de page
    "header.welcome": "Bon retour, {name}",
    "header.subtitle": "Analytique en temps réel pour {host}",
    "header.subtitleDocker": "Analytique en temps réel pour {host} · Docker {version}",
    "header.loading": "Chargement du tableau de bord…",

    // Bannière dégradée
    "banner.degraded": "Un ou plusieurs hôtes ou fournisseurs sont dégradés. Les données en cache peuvent être obsolètes.",
    "banner.reviewHosts": "Vérifier les hôtes",

    // Tuiles KPI
    "kpi.running": "En cours d'exécution",
    "kpi.runningSub": "{stopped} arrêtés · {total} au total",
    "kpi.cpu": "Utilisation CPU",
    "kpi.cpuSub": "sur {cores} cœurs",
    "kpi.memory": "Mémoire utilisée",
    "kpi.memorySub": "{pct} de {total}",
    "kpi.memorySubUnknown": "capacité inconnue",
    "kpi.images": "Images",
    "kpi.imagesSub": "présentes sur l'hôte",
    "kpi.volumes": "Volumes",
    "kpi.volumesSub": "données persistantes",
    "kpi.networks": "Réseaux",
    "kpi.networksSub": "réseaux docker",

    // Cartes graphiques
    "chart.states": "États des conteneurs",
    "chart.statesHint": "{count} au total",
    "chart.statesEmpty": "Aucun conteneur",
    "chart.donutRunning": "en cours",
    "chart.resource": "Utilisation des ressources",
    "chart.resourceHint": "échantillon en direct",
    "chart.topCpu": "Top conteneurs par CPU",
    "chart.topCpuHint": "%",
    "chart.topMem": "Top conteneurs par mémoire",
    "chart.topMemHint": "octets",
    "chart.topEmpty": "Aucun échantillon en direct",

    // Jauges de ressources
    "gauge.cpu": "CPU",
    "gauge.memory": "Mémoire",
    "gauge.cores": "{cores} cœurs",
    "gauge.limitUnknown": "limite inconnue",

    // Carte orchestrateurs
    "orch.title": "Orchestrateurs",
    "orch.hint": "{svc} svc · {tasks} tâches · {pods} pods",
    "orch.empty": "Aucun orchestrateur connecté.",

    // Carte activité récente
    "activity.title": "Activité récente",
    "activity.viewAll": "Voir tout",
    "activity.noPermission": "Vous n'avez pas la permission de consulter le journal d'audit.",
    "activity.empty": "Aucune activité pour l'instant",

    // Infobulles des graphiques
    "tip.containerOne": "{count} conteneur",
    "tip.containerOther": "{count} conteneurs",
  },
});
