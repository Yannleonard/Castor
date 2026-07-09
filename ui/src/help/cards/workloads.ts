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
          { kind: "p", text: "For a Docker container you can **start**, **stop**, **restart** and **remove** it directly from the row or the detail drawer. These are the day-to-day lifecycle actions." },
          { kind: "p", text: "Removing a container that is **still running** returns a clear error rather than force-killing it silently. Either **stop it first**, or tick **Force** in the remove dialog to stop-and-remove in one step." },
        ],
      },
      {
        title: "Why an action is greyed out",
        blocks: [
          { kind: "p", text: "Castor follows a **\"grey out before you click\"** principle: if an action can't succeed, the button is disabled instead of failing after the fact. **Hover the disabled button** and it tells you exactly why. There are three common reasons:" },
          { kind: "list", items: [
            "**The provider is read-only.** Swarm tasks and Kubernetes pods are managed by their orchestrator, not mutated one-by-one. Those rows show a **Read-only** marker — you scale or update the *service* / *deployment*, you don't start/stop an individual task or pod here.",
            "**You lack the RBAC permission.** Lifecycle actions map to dotted permissions such as `docker.container.start` or `docker.container.remove`. If your role (**admin** / **operator** / **viewer**) doesn't grant it, the button explains that on hover. A **viewer** sees everything but can mutate nothing.",
            "**The socket is mounted read-only.** By default Castor mounts the Docker socket **:ro**, which allows read operations only — **list**, **inspect**, **logs**, **stats**. Mutating actions (**start / stop / restart / remove / exec**) require the socket to be mounted **:rw**.",
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
          { kind: "p", text: "Pour un conteneur Docker, vous pouvez le **démarrer**, l'**arrêter**, le **redémarrer** et le **supprimer** directement depuis la ligne ou le panneau de détail. Ce sont les actions de cycle de vie du quotidien." },
          { kind: "p", text: "Supprimer un conteneur **encore en cours d'exécution** renvoie une erreur claire plutôt que de le tuer en silence. **Arrêtez-le d'abord**, ou cochez **Force** dans la boîte de suppression pour l'arrêter-puis-supprimer en une seule étape." },
        ],
      },
      {
        title: "Pourquoi une action est grisée",
        blocks: [
          { kind: "p", text: "Castor applique le principe **« griser avant de cliquer »** : si une action ne peut pas aboutir, le bouton est désactivé au lieu d'échouer après coup. **Survolez le bouton désactivé** et il vous dit exactement pourquoi. Trois raisons reviennent :" },
          { kind: "list", items: [
            "**Le provider est en lecture seule.** Les tâches Swarm et les pods Kubernetes sont pilotés par leur orchestrateur, pas modifiés un par un. Ces lignes affichent un marqueur **Read-only** — vous scalez ou mettez à jour le *service* / le *deployment*, vous ne démarrez/arrêtez pas une tâche ou un pod individuel ici.",
            "**Il vous manque la permission RBAC.** Les actions de cycle de vie correspondent à des permissions dottées comme `docker.container.start` ou `docker.container.remove`. Si votre rôle (**admin** / **operator** / **viewer**) ne l'accorde pas, le bouton l'explique au survol. Un **viewer** voit tout mais ne peut rien muter.",
            "**Le socket est monté en lecture seule.** Par défaut, Castor monte le socket Docker en **:ro**, ce qui n'autorise que la lecture — **list**, **inspect**, **logs**, **stats**. Les actions de mutation (**start / stop / restart / remove / exec**) exigent que le socket soit monté en **:rw**.",
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
