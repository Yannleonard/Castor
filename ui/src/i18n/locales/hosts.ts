// Castor by IT Leonard
// ui/src/i18n/locales/hosts.ts
//
// Locale dictionary for the Hosts view (ui/src/views/Hosts.tsx). Follows the
// audit.ts reference model: one dict per view, camelCase keys namespaced by UI
// zone.
//
//   header.*  page header (title/subtitle) + toolbar actions
//   empty.*   empty-state title
//   status.*  host status pill labels (mapped from the technical `status` value)
//   section.* card section labels (Orchestrators / Capabilities / System / …)
//   sys.*     "System" counter labels (CPU / Memory / Engine / OS / …)
//   summary.* "Summary" counter labels (Containers / Images / …)
//   chip.*    capability chip tooltip
//   action.*  card actions
//
// DO NOT translate technical identifiers rendered from data: capability ids,
// provider kinds, engine version strings, the "vCPU"/"v<version>" units. Those
// are shown verbatim, never through `t`.

import { defineDict } from "../core";

export const hostsDict = defineDict({
  en: {
    // Page header
    "header.title": "Hosts",
    "header.subtitle": "Connected engines and the orchestrators they expose.",
    "header.refresh": "Refresh",
    "header.loading": "Loading hosts…",

    // Empty state
    "empty.title": "No hosts registered",

    // Status pill
    "status.connected": "Connected",
    "status.pending": "Pending",
    "status.down": "Down",
    "status.degraded": "degraded",

    // Card sections
    "section.orchestrators": "Orchestrators",
    "section.orchestratorsNone": "None",
    "section.capabilities": "Capabilities",
    "section.system": "System",
    "section.summary": "Summary",

    // System counters
    "sys.cpu": "CPU",
    "sys.memory": "Memory",
    "sys.engine": "Engine",
    "sys.api": "API",
    "sys.os": "OS",
    "sys.arch": "Arch",
    "sys.kernel": "Kernel",
    "sys.hostname": "Hostname",

    // Summary counters
    "summary.containers": "Containers",
    "summary.images": "Images",
    "summary.networks": "Networks",
    "summary.volumes": "Volumes",
    "summary.swarmTasks": "Swarm tasks",
    "summary.k8sPods": "K8s pods",

    // Capability chip tooltip
    "chip.capability": "capability: {name}",

    // Card actions
    "action.openWorkloads": "Open workloads",
  },
  fr: {
    // En-tête de page
    "header.title": "Hôtes",
    "header.subtitle": "Moteurs connectés et les orchestrateurs qu'ils exposent.",
    "header.refresh": "Actualiser",
    "header.loading": "Chargement des hôtes…",

    // État vide
    "empty.title": "Aucun hôte enregistré",

    // Pastille de statut
    "status.connected": "Connecté",
    "status.pending": "En attente",
    "status.down": "Hors service",
    "status.degraded": "dégradé",

    // Sections de carte
    "section.orchestrators": "Orchestrateurs",
    "section.orchestratorsNone": "Aucun",
    "section.capabilities": "Capacités",
    "section.system": "Système",
    "section.summary": "Résumé",

    // Compteurs système
    "sys.cpu": "CPU",
    "sys.memory": "Mémoire",
    "sys.engine": "Moteur",
    "sys.api": "API",
    "sys.os": "OS",
    "sys.arch": "Arch",
    "sys.kernel": "Noyau",
    "sys.hostname": "Nom d'hôte",

    // Compteurs de résumé
    "summary.containers": "Conteneurs",
    "summary.images": "Images",
    "summary.networks": "Réseaux",
    "summary.volumes": "Volumes",
    "summary.swarmTasks": "Tâches Swarm",
    "summary.k8sPods": "Pods K8s",

    // Infobulle de la puce de capacité
    "chip.capability": "capacité : {name}",

    // Actions de carte
    "action.openWorkloads": "Ouvrir les charges de travail",
  },
});
