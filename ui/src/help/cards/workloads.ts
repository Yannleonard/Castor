// ui/src/help/cards/workloads.ts — Unified workloads (containers / tasks / pods) help card.
import type { HelpCard } from "../types";

export const workloadsCard: HelpCard = {
  id: "workloads",
  title: {
    en: "Workloads — containers, tasks & pods",
    fr: "Workloads — conteneurs, tâches & pods",
  },

  en: {
    summary: "One unified list for everything that runs: Docker containers, Swarm tasks and Kubernetes pods — with actions that grey out before you click when they can't work.",
    sections: [
      {
        title: "What this view is for",
        blocks: [
          { kind: "p", text: "The **Workloads** view is your single pane of glass over everything that is running, whatever the provider. Plain **Docker containers**, **Swarm service tasks** and **Kubernetes pods** all appear in the *same* list, each row tagged with its **kind**, so you don't have to jump between tools to see the whole fleet." },
          { kind: "p", text: "Every row shows its name, kind, current state (running, exited, pending…), the group it belongs to and quick health at a glance. Click any row to open the detail drawer." },
        ],
      },
      {
        title: "Finding what you need — filters",
        blocks: [
          { kind: "p", text: "Above the list, four controls narrow it down:" },
          { kind: "list", items: [
            "**Kind** — show only Docker containers, only Swarm tasks, or only K8s pods.",
            "**State** — running, stopped/exited, paused, pending, etc.",
            "**Group** — the stack, Compose project or namespace the workload belongs to.",
            "**Text search** — match on name or image.",
          ] },
          { kind: "note", text: "Filters combine: for example *kind = Docker* + *state = running* + a search term. Clear a filter to widen the list again." },
        ],
      },
      {
        title: "Actions on Docker containers",
        blocks: [
          { kind: "p", text: "For a Docker container you can **start**, **stop**, **restart** and **remove** it directly from the row or the detail drawer. These are the day-to-day lifecycle actions. Running containers can additionally be **paused** from the list row — see *Pause & unpause* below." },
          { kind: "p", text: "Removing a container that is **still running** returns a clear error rather than force-killing it silently. Either **stop it first**, or tick **Force** in the remove dialog to stop-and-remove in one step." },
        ],
      },
      {
        title: "Pause & unpause",
        blocks: [
          { kind: "p", text: "A **running** container also offers a **pause** button on its row. Pausing freezes every process in the container through the kernel's **cgroup freezer** (the effect of a `SIGSTOP`): nothing gets scheduled any more, but the container **keeps its memory, its network endpoints and all its state** — nothing shuts down and no SIGTERM is sent." },
          { kind: "p", text: "A **paused** container swaps the start/stop pair for a single **unpause** button (play icon); **restart** and **remove** stay available. Unpausing resumes every process exactly where it stopped — no restart, nothing lost." },
          { kind: "note", text: "Set the **State** filter to *Paused* to find frozen containers again. Pause and unpause map to the `docker.container.pause` and `docker.container.unpause` permissions, granted to the **admin** and **operator** roles." },
          { kind: "callout", tone: "info", text: "Pause is handy for temporarily freeing CPU (a runaway batch job, a noisy neighbour during a debug session) without losing in-memory state — but the container's **memory stays allocated** while it is frozen." },
        ],
      },
      {
        title: "Why an action is greyed out",
        blocks: [
          { kind: "p", text: "Castor follows a **\"grey out before you click\"** principle: if an action can't succeed, the button is disabled instead of failing after the fact. **Hover the disabled button** and it tells you exactly why. There are three common reasons:" },
          { kind: "list", items: [
            "**The provider is read-only.** Swarm tasks and Kubernetes pods are managed by their orchestrator, not mutated one-by-one. Those rows show a **Read-only** marker — you scale or update the *service* / *deployment*, you don't start/stop an individual task or pod here.",
            "**You lack the RBAC permission.** Lifecycle actions map to dotted permissions such as `docker.container.start` or `docker.container.remove`. If your role (**admin** / **operator** / **viewer**) doesn't grant it, the button explains that on hover. A **viewer** sees everything but can mutate nothing.",
            "**The socket is mounted read-only.** By default Castor mounts the Docker socket **:ro**, which allows read operations only — **list**, **inspect**, **logs**, **stats**. Mutating actions (**start / stop / restart / pause / remove / exec**) require the socket to be mounted **:rw**.",
          ] },
          { kind: "callout", tone: "info", text: "The button copy on hover tells you which of the three it is — read-only provider, missing permission, or read-only socket — so you know whether to change a role, remount the socket, or act on the parent service instead." },
        ],
      },
      {
        title: "Protected containers & the exec terminal",
        blocks: [
          { kind: "p", text: "Containers labelled `io.castor.protected=true` — and the Castor container itself — **cannot be removed on a whim**. The remove dialog asks for an explicit **confirmation and a reason** before it will proceed. This is a guardrail against wiping out the very thing managing your fleet." },
          { kind: "callout", tone: "warn", text: "If your instance requires **2FA for mutations**, start/stop/restart/remove prompt for a TOTP code. Opening the **exec terminal** on a container **always** demands a fresh 2FA step-up (AAL), independent of that setting." },
        ],
      },
      {
        title: "Keeping images up to date",
        blocks: [
          { kind: "p", text: "Castor checks registries **server-side** on a regular schedule: when a container's image tag resolves to a **newer digest** than the one it runs, the row shows a blue **update** pill next to the name (hover it to see which image is concerned)." },
          { kind: "list", items: [
            "**Check updates** (page header) — runs an on-demand sweep: every image is re-checked against its registry and the badges refresh as soon as it finishes. Needs the `docker.image.pull` permission.",
            "**Update** (download icon on the row, or the **Update now** banner at the top of the container's detail page) — pulls the newest image and **recreates the container with the exact same configuration**: env, mounts, networks, name. Needs `docker.container.update`, granted to **admin** and **operator**.",
          ] },
          { kind: "p", text: "The swap causes a **brief downtime**: a confirmation dialog recaps what will happen, then the old container gets a 10-second graceful stop and the new one starts under the same name." },
          { kind: "callout", tone: "info", text: "**Automatic rollback:** if the new container fails to create or to start, Castor renames the old one back and restarts it if it was running — an update can fail, but it can't leave you with nothing." },
          { kind: "note", text: "**Protected** containers refuse the update (button disabled — *Protected, cannot be recreated*), and only standalone **Docker** containers update in place; Swarm tasks and pods are updated through their orchestrator. The recreated container gets a **new id**, so after an update from the detail page you are returned to the list." },
        ],
      },
      {
        title: "Prune stopped — host-wide cleanup",
        blocks: [
          { kind: "p", text: "The **Prune stopped** button in the page header removes **every stopped container on the host** in one go. Their writable layers are deleted; **images and named volumes are kept**." },
          { kind: "p", text: "Because this is irreversible and host-wide, a **confirmation dialog always** stands in the way — there is no one-click prune. Afterwards a toast reports **how many containers** were removed and **how much disk space** was reclaimed." },
          { kind: "note", text: "Prune requires the `docker.system.prune` permission, granted to **admin** and **operator** — it only ever touches containers that are already stopped. Removing a *specific* container stays governed by `docker.container.remove` (admin)." },
        ],
      },
      {
        title: "Opening a workload's detail",
        blocks: [
          { kind: "p", text: "Clicking a row opens the detail drawer, which works for **all** kinds (containers, tasks, pods). From there you can read **logs**, watch live **stats** (CPU / memory / network), open an interactive **terminal** (exec, where allowed), and view the full **inspect** (config, mounts, env, labels)." },
          { kind: "note", text: "These read views (logs, stats, inspect) work even with a `:ro` socket and for a **viewer** — they don't mutate anything, so they're never greyed out for lack of write access." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/container/", label: "Docker — container lifecycle commands" },
        ],
      },
    ],
  },

  fr: {
    summary: "Une liste unique pour tout ce qui tourne : conteneurs Docker, tâches Swarm et pods Kubernetes — avec des actions qui se grisent avant le clic quand elles ne peuvent pas aboutir.",
    sections: [
      {
        title: "À quoi sert cette vue",
        blocks: [
          { kind: "p", text: "La vue **Workloads** est votre point de vue unique sur tout ce qui s'exécute, quel que soit le provider. Les simples **conteneurs Docker**, les **tâches de service Swarm** et les **pods Kubernetes** apparaissent tous dans la *même* liste, chaque ligne étiquetée par son **kind**, pour ne plus avoir à jongler entre plusieurs outils afin de voir l'ensemble du parc." },
          { kind: "p", text: "Chaque ligne affiche son nom, son kind, son état courant (running, exited, pending…), le groupe auquel elle appartient et un aperçu de santé. Cliquez sur une ligne pour ouvrir le panneau de détail." },
        ],
      },
      {
        title: "Trouver ce qu'il vous faut — les filtres",
        blocks: [
          { kind: "p", text: "Au-dessus de la liste, quatre contrôles la restreignent :" },
          { kind: "list", items: [
            "**Kind** — n'afficher que les conteneurs Docker, que les tâches Swarm, ou que les pods K8s.",
            "**État** — running, arrêté/exited, en pause, pending, etc.",
            "**Groupe** — la stack, le projet Compose ou le namespace auquel le workload appartient.",
            "**Recherche texte** — sur le nom ou l'image.",
          ] },
          { kind: "note", text: "Les filtres se combinent : par exemple *kind = Docker* + *état = running* + un terme de recherche. Effacez un filtre pour ré-élargir la liste." },
        ],
      },
      {
        title: "Actions sur les conteneurs Docker",
        blocks: [
          { kind: "p", text: "Pour un conteneur Docker, vous pouvez le **démarrer**, l'**arrêter**, le **redémarrer** et le **supprimer** directement depuis la ligne ou le panneau de détail. Ce sont les actions de cycle de vie du quotidien. Les conteneurs en cours d'exécution peuvent en plus être **mis en pause** depuis la ligne de la liste — voir *Pause & unpause* ci-dessous." },
          { kind: "p", text: "Supprimer un conteneur **encore en cours d'exécution** renvoie une erreur claire plutôt que de le tuer en silence. **Arrêtez-le d'abord**, ou cochez **Force** dans la boîte de suppression pour l'arrêter-puis-supprimer en une seule étape." },
        ],
      },
      {
        title: "Pause & unpause",
        blocks: [
          { kind: "p", text: "Un conteneur **running** propose aussi un bouton **pause** sur sa ligne. La mise en pause gèle tous les processus du conteneur via le **cgroup freezer** du noyau (l'effet d'un `SIGSTOP`) : plus rien n'est ordonnancé, mais le conteneur **conserve sa mémoire, ses points de terminaison réseau et tout son état** — rien ne s'éteint et aucun SIGTERM n'est envoyé." },
          { kind: "p", text: "Un conteneur **paused** remplace la paire start/stop par un unique bouton **unpause** (icône play) ; **restart** et **remove** restent disponibles. La reprise relance chaque processus exactement là où il s'était arrêté — pas de redémarrage, rien de perdu." },
          { kind: "note", text: "Réglez le filtre **État** sur *Paused* pour retrouver les conteneurs gelés. Pause et unpause correspondent aux permissions `docker.container.pause` et `docker.container.unpause`, accordées aux rôles **admin** et **operator**." },
          { kind: "callout", tone: "info", text: "La pause est pratique pour libérer temporairement du CPU (un batch qui s'emballe, un voisin bruyant pendant une session de debug) sans perdre l'état en mémoire — mais la **mémoire du conteneur reste allouée** tant qu'il est gelé." },
        ],
      },
      {
        title: "Pourquoi une action est grisée",
        blocks: [
          { kind: "p", text: "Castor applique le principe **« griser avant de cliquer »** : si une action ne peut pas aboutir, le bouton est désactivé au lieu d'échouer après coup. **Survolez le bouton désactivé** et il vous dit exactement pourquoi. Trois raisons reviennent :" },
          { kind: "list", items: [
            "**Le provider est en lecture seule.** Les tâches Swarm et les pods Kubernetes sont pilotés par leur orchestrateur, pas modifiés un par un. Ces lignes affichent un marqueur **Read-only** — vous scalez ou mettez à jour le *service* / le *deployment*, vous ne démarrez/arrêtez pas une tâche ou un pod individuel ici.",
            "**Il vous manque la permission RBAC.** Les actions de cycle de vie correspondent à des permissions dottées comme `docker.container.start` ou `docker.container.remove`. Si votre rôle (**admin** / **operator** / **viewer**) ne l'accorde pas, le bouton l'explique au survol. Un **viewer** voit tout mais ne peut rien muter.",
            "**Le socket est monté en lecture seule.** Par défaut, Castor monte le socket Docker en **:ro**, ce qui n'autorise que la lecture — **list**, **inspect**, **logs**, **stats**. Les actions de mutation (**start / stop / restart / pause / remove / exec**) exigent que le socket soit monté en **:rw**.",
          ] },
          { kind: "callout", tone: "info", text: "Le libellé du bouton au survol vous dit laquelle des trois raisons s'applique — provider en lecture seule, permission manquante, ou socket en lecture seule — afin de savoir s'il faut changer un rôle, remonter le socket, ou agir sur le service parent." },
        ],
      },
      {
        title: "Conteneurs protégés & terminal exec",
        blocks: [
          { kind: "p", text: "Les conteneurs portant le label `io.castor.protected=true` — ainsi que le conteneur Castor lui-même — **ne peuvent pas être supprimés à la légère**. La boîte de suppression réclame une **confirmation explicite et une raison** avant de procéder. C'est un garde-fou contre l'effacement de l'outil qui gère votre parc." },
          { kind: "callout", tone: "warn", text: "Si votre instance exige la **2FA pour les mutations**, start/stop/restart/remove demandent un code TOTP. Ouvrir le **terminal exec** sur un conteneur exige **toujours** une élévation 2FA fraîche (step-up AAL), indépendamment de ce réglage." },
        ],
      },
      {
        title: "Garder les images à jour",
        blocks: [
          { kind: "p", text: "Castor interroge les registres **côté serveur** à intervalle régulier : quand le tag d'image d'un conteneur résout vers un **digest plus récent** que celui qu'il exécute, la ligne affiche une pastille bleue **update** à côté du nom (survolez-la pour voir l'image concernée)." },
          { kind: "list", items: [
            "**Check updates** (en-tête de la page) — lance une vérification à la demande : chaque image est re-comparée à son registre et les badges se rafraîchissent dès la fin. Requiert la permission `docker.image.pull`.",
            "**Update** (icône de téléchargement sur la ligne, ou le bandeau **Update now** en haut de la page de détail du conteneur) — tire l'image la plus récente et **recrée le conteneur avec exactement la même configuration** : env, montages, réseaux, nom. Requiert `docker.container.update`, accordée à **admin** et **operator**.",
          ] },
          { kind: "p", text: "La bascule provoque une **brève interruption** : une boîte de confirmation récapitule ce qui va se passer, puis l'ancien conteneur reçoit un arrêt gracieux de 10 secondes et le nouveau démarre sous le même nom." },
          { kind: "callout", tone: "info", text: "**Rollback automatique :** si le nouveau conteneur échoue à se créer ou à démarrer, Castor rend son nom à l'ancien et le redémarre s'il tournait — une mise à jour peut échouer, mais elle ne peut pas vous laisser sans rien." },
          { kind: "note", text: "Les conteneurs **protégés** refusent la mise à jour (bouton désactivé — *Protected, cannot be recreated*), et seuls les conteneurs **Docker** autonomes se mettent à jour sur place ; les tâches Swarm et les pods se mettent à jour via leur orchestrateur. Le conteneur recréé reçoit un **nouvel id** : après une mise à jour depuis la page de détail, vous revenez à la liste." },
        ],
      },
      {
        title: "Prune stopped — grand ménage sur l'hôte",
        blocks: [
          { kind: "p", text: "Le bouton **Prune stopped** de l'en-tête supprime **tous les conteneurs arrêtés de l'hôte** en une seule action. Leurs couches en écriture sont effacées ; **les images et les volumes nommés sont conservés**." },
          { kind: "p", text: "Comme c'est irréversible et à l'échelle de l'hôte, une **boîte de confirmation** s'interpose **systématiquement** — pas de prune en un clic. Ensuite, un toast indique **combien de conteneurs** ont été supprimés et **combien d'espace disque** a été récupéré." },
          { kind: "note", text: "Le prune requiert la permission `docker.system.prune`, accordée à **admin** et **operator** — il ne touche jamais que des conteneurs déjà arrêtés. Supprimer un conteneur *précis* reste régi par `docker.container.remove` (admin)." },
        ],
      },
      {
        title: "Ouvrir le détail d'un workload",
        blocks: [
          { kind: "p", text: "Cliquer sur une ligne ouvre le panneau de détail, qui fonctionne pour **tous** les kinds (conteneurs, tâches, pods). De là, vous consultez les **logs**, suivez les **stats** en direct (CPU / mémoire / réseau), ouvrez un **terminal** interactif (exec, là où c'est permis) et affichez l'**inspect** complet (config, montages, env, labels)." },
          { kind: "note", text: "Ces vues de lecture (logs, stats, inspect) fonctionnent même avec un socket en `:ro` et pour un **viewer** — elles ne mutent rien, donc elles ne sont jamais grisées par manque de droits d'écriture." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/container/", label: "Docker — commandes de cycle de vie des conteneurs" },
        ],
      },
    ],
  },
};
