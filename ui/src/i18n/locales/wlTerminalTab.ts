// Castor by IT Leonard
// ui/src/i18n/locales/wlTerminalTab.ts
//
// Locale dictionary for the workload Terminal tab
// (ui/src/views/workload/TerminalTab.tsx). Docker-only interactive exec session:
// container/shell pickers, session controls, exit status, and empty state.
//
// NOT translated: shell command labels (/bin/sh, /bin/bash…) and container names
// (rendered verbatim from data), and the exit code value itself.

import { defineDict } from "../core";

export const wlTerminalTabDict = defineDict({
  en: {
    // Pickers
    "picker.container": "Container",
    "picker.shell": "Shell",

    // Session controls
    "action.open": "Open session",
    "action.restart": "Restart session",

    // Exit status (interpolated with the exit {code})
    "status.exited": "Last session exited",
    "status.exitedCode": "Last session exited (code {code})",

    // Empty state
    "empty.hint": "Pick a shell and open an interactive session.",
  },
  fr: {
    // Sélecteurs
    "picker.container": "Conteneur",
    "picker.shell": "Shell",

    // Contrôles de session
    "action.open": "Ouvrir une session",
    "action.restart": "Redémarrer la session",

    // Statut de sortie (interpolé avec le {code} de sortie)
    "status.exited": "Dernière session terminée",
    "status.exitedCode": "Dernière session terminée (code {code})",

    // État vide
    "empty.hint": "Choisissez un shell et ouvrez une session interactive.",
  },
});
