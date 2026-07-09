// ui/src/i18n/locales/wlLogsTab.ts
//
// Locale dictionary for the workload Logs tab (ui/src/views/workload/LogsTab.tsx):
// live log streaming for a Docker container / Swarm task / K8s pod, with an
// optional container picker for multi-container pods.
//
// Namespaces (see audit.ts for the reference model):
//   picker.*  container picker label
//   status.*  LogViewer connection status (streaming / connecting)
//   banner.*  inline log-stream error banner (supports {error})
//   toast.*   toast title raised on forbidden/unsupported stream errors
//
// DO NOT translate the technical error `{error}` value — it is the raw code or
// message returned by the WS backend and is interpolated verbatim.

import { defineDict } from "../core";

export const wlLogsTabDict = defineDict({
  en: {
    // Container picker (K8s multi-container pods)
    "picker.container": "Container",

    // LogViewer connection status
    "status.streaming": "streaming",
    "status.connecting": "connecting…",

    // Inline error banner
    "banner.streamError": "Log stream error: {error}",

    // Toast (forbidden / unsupported stream)
    "toast.title": "Logs",
  },
  fr: {
    // Sélecteur de conteneur (pods K8s multi-conteneurs)
    "picker.container": "Conteneur",

    // Statut de connexion du visualiseur de logs
    "status.streaming": "diffusion",
    "status.connecting": "connexion…",

    // Bannière d'erreur en ligne
    "banner.streamError": "Erreur du flux de logs : {error}",

    // Toast (flux interdit / non pris en charge)
    "toast.title": "Logs",
  },
});
