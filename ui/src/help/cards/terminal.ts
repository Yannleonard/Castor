// Castor by IT Leonard
// ui/src/help/cards/terminal.ts — In-browser terminal (exec) & live logs help card.
import type { HelpCard } from "../types";

export const terminalCard: HelpCard = {
  id: "terminal",
  title: { en: "Terminal & logs", fr: "Terminal & journaux" },

  en: {
    summary: "Open an interactive shell inside a container or pod and stream its logs live — right in your browser.",
    sections: [
      {
        title: "What it is for",
        blocks: [
          { kind: "p", text: "The **Terminal** opens an interactive shell (`exec`) **inside** a running container or pod, rendered directly in your browser with a full terminal emulator (xterm.js) — no SSH, no local Docker CLI. Next to it, **Logs** streams the container's output **in real time** over a WebSocket, so you watch lines appear as they are written." },
          { kind: "p", text: "Together they cover the two things you reach for when something misbehaves: **look at what it's saying** (logs) and **poke around inside** (terminal)." },
        ],
      },
      {
        title: "How it works in Castor",
        blocks: [
          { kind: "p", text: "From a container's detail view, **Terminal** attaches a shell (Castor tries `/bin/sh`, then falls back if needed) and gives you an interactive prompt streamed over a WebSocket. **Logs** opens a live tail of stdout/stderr in the same view." },
          { kind: "p", text: "For a **multi-container pod** (Kubernetes / Swarm task with several containers), Castor lets you **pick which container** to attach the shell to or read logs from — choose it from the selector before the session opens." },
          { kind: "callout", tone: "info", text: "Every exec session is **audited**: who opened a shell, on which container, and when is recorded. The terminal is a powerful tool, so its use is always traceable." },
        ],
      },
      {
        title: "Why does Castor ask for 2FA again?",
        blocks: [
          { kind: "p", text: "Opening a shell is a **mutation-level action**: from inside a container you can read secrets, change files, or run arbitrary commands — potentially **root-equivalent**. So if two-factor authentication is enabled on your account, Castor performs a **TOTP step-up (AAL2)** before attaching the terminal." },
          { kind: "callout", tone: "warn", text: "This re-prompt is **a protection, not a bug**. A step-up is **always required** to open an exec terminal, even if you already logged in with 2FA earlier — it confirms it's really you at the moment of a high-impact action, and pins that fact into the audit trail." },
          { kind: "note", text: "If the setting **\"2FA required for mutations\"** is on, other write actions (start, stop, remove…) may also ask for a code. The exec terminal, however, always requires the step-up regardless of that setting." },
        ],
      },
      {
        title: "Permissions & requirements",
        blocks: [
          { kind: "list", items: [
            "**Terminal (exec):** you need the **`docker.container.exec`** permission — typically an **operator** or **admin** role. A **viewer** cannot open a shell.",
            "**Logs:** you need the **`docker.container.logs`** permission — available to viewers and above.",
            "**Socket mode:** exec needs a container **lifecycle** connection, so the Docker socket must be mounted **`:rw`**. With the default read-only (`:ro`) socket you can read logs but the terminal is disabled.",
            "**2FA:** with two-factor enabled, expect a TOTP step-up each time you open the terminal (see above).",
          ] },
        ],
      },
      {
        title: "Tips & good practices",
        blocks: [
          { kind: "list", items: [
            "If the terminal **closes**, Castor shows the shell's **exit code** — a quick clue as to whether you left cleanly (`0`) or the process/container died.",
            "Type `exit` (or `Ctrl-D`) to close the shell cleanly rather than just closing the panel.",
            "Prefer **logs** for a quick diagnosis; reach for the **terminal** only when you actually need to inspect or change state inside the container.",
            "On a distroless / minimal image there may be **no shell** to attach to — the exec will fail. Use logs, or ship a debug image.",
            "Avoid making persistent changes from an exec shell: they vanish on the next redeploy. Fix the image or the config instead.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/container/exec/", label: "docker container exec — official reference" },
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/container/logs/", label: "docker container logs — official reference" },
        ],
      },
    ],
  },

  fr: {
    summary: "Ouvrez un shell interactif dans un conteneur ou un pod et streamez ses journaux en direct — directement dans votre navigateur.",
    sections: [
      {
        title: "À quoi ça sert",
        blocks: [
          { kind: "p", text: "Le **Terminal** ouvre un shell interactif (`exec`) **dans** un conteneur ou un pod en cours d'exécution, rendu directement dans votre navigateur avec un véritable émulateur de terminal (xterm.js) — pas de SSH, pas de CLI Docker local. À côté, les **Journaux** streament la sortie du conteneur **en temps réel** via un WebSocket : vous voyez les lignes apparaître au fil de leur écriture." },
          { kind: "p", text: "Ensemble, ils couvrent les deux réflexes quand quelque chose cloche : **voir ce qu'il raconte** (journaux) et **aller fouiller à l'intérieur** (terminal)." },
        ],
      },
      {
        title: "Comment ça marche dans Castor",
        blocks: [
          { kind: "p", text: "Depuis la vue détaillée d'un conteneur, **Terminal** attache un shell (Castor tente `/bin/sh`, puis se rabat sur une alternative si nécessaire) et vous donne une invite interactive streamée via WebSocket. **Journaux** ouvre un suivi en direct de stdout/stderr dans la même vue." },
          { kind: "p", text: "Pour un **pod multi-conteneurs** (tâche Kubernetes / Swarm comportant plusieurs conteneurs), Castor vous laisse **choisir le conteneur** auquel attacher le shell ou dont lire les journaux — sélectionnez-le avant l'ouverture de la session." },
          { kind: "callout", tone: "info", text: "Toute session exec est **auditée** : qui a ouvert un shell, sur quel conteneur et quand est enregistré. Le terminal est un outil puissant, son usage reste donc toujours traçable." },
        ],
      },
      {
        title: "Pourquoi Castor me redemande-t-il la 2FA ?",
        blocks: [
          { kind: "p", text: "Ouvrir un shell est une **action de niveau mutation** : depuis l'intérieur d'un conteneur, vous pouvez lire des secrets, modifier des fichiers ou exécuter des commandes arbitraires — potentiellement **équivalent root**. Donc si la double authentification est activée sur votre compte, Castor effectue un **step-up TOTP (AAL2)** avant d'attacher le terminal." },
          { kind: "callout", tone: "warn", text: "Cette redemande est **une protection, pas un bug**. Un step-up est **toujours exigé** pour ouvrir un terminal exec, même si vous vous êtes déjà connecté avec la 2FA plus tôt — il confirme que c'est bien vous au moment d'une action à fort impact, et grave ce fait dans le journal d'audit." },
          { kind: "note", text: "Si le réglage **« 2FA requise pour les mutations »** est activé, d'autres actions d'écriture (démarrer, arrêter, supprimer…) peuvent aussi demander un code. Le terminal exec, lui, exige toujours le step-up, indépendamment de ce réglage." },
        ],
      },
      {
        title: "Permissions & prérequis",
        blocks: [
          { kind: "list", items: [
            "**Terminal (exec) :** il faut la permission **`docker.container.exec`** — typiquement un rôle **operator** ou **admin**. Un **viewer** ne peut pas ouvrir de shell.",
            "**Journaux :** il faut la permission **`docker.container.logs`** — disponible dès le rôle viewer.",
            "**Mode du socket :** l'exec nécessite une connexion **cycle de vie** du conteneur, donc le socket Docker doit être monté en **`:rw`**. Avec le socket en lecture seule (`:ro`, par défaut), vous pouvez lire les journaux mais le terminal est désactivé.",
            "**2FA :** avec la double authentification activée, attendez-vous à un step-up TOTP à chaque ouverture du terminal (voir ci-dessus).",
          ] },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Si le terminal **se ferme**, Castor affiche le **code de sortie** du shell — un indice rapide pour savoir si vous êtes sorti proprement (`0`) ou si le processus/conteneur est mort.",
            "Tapez `exit` (ou `Ctrl-D`) pour fermer le shell proprement plutôt que de simplement fermer le panneau.",
            "Privilégiez les **journaux** pour un diagnostic rapide ; ne dégainez le **terminal** que lorsque vous devez réellement inspecter ou modifier l'état à l'intérieur du conteneur.",
            "Sur une image distroless / minimale, il peut n'y avoir **aucun shell** à attacher — l'exec échouera. Utilisez les journaux, ou déployez une image de debug.",
            "Évitez les changements persistants depuis un shell exec : ils disparaissent au prochain redéploiement. Corrigez plutôt l'image ou la configuration.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/container/exec/", label: "docker container exec — référence officielle" },
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/container/logs/", label: "docker container logs — référence officielle" },
        ],
      },
    ],
  },
};
