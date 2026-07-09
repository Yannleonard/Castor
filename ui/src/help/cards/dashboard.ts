// ui/src/help/cards/dashboard.ts — Dashboard (host analytics) help card.
import type { HelpCard } from "../types";

export const dashboardCard: HelpCard = {
  id: "dashboard",
  title: { en: "Dashboard — reading your metrics", fr: "Tableau de bord — lire vos métriques" },

  en: {
    summary: "A real-time analytics view of the selected host: key counters, live charts and recent audit activity — your first stop to see whether everything is healthy.",
    sections: [
      {
        title: "What the dashboard is for",
        blocks: [
          { kind: "p", text: "The dashboard is the **landing view** for the host you selected. It gives you a real-time snapshot of the Docker engine — how many containers run, how much CPU and memory the host burns, and what changed recently — without you having to open each detail page. Think of it as the health cockpit: glance at it, and you know if anything needs attention." },
        ],
      },
      {
        title: "The KPI tiles",
        blocks: [
          { kind: "p", text: "A row of counters summarises the host at a glance:" },
          { kind: "list", items: [
            "**Containers** — shown as **running / total** (e.g. `7 / 12`). The gap tells you how many are stopped, paused or exited.",
            "**CPU %** — total CPU load across all running containers on this host.",
            "**Memory** — RAM currently consumed by containers, versus the host's total.",
            "**Images** — number of images pulled or built locally (disk footprint).",
            "**Volumes** — persistent data volumes present on the host.",
            "**Networks** — Docker networks defined on the host (bridge, overlay, custom…).",
          ] },
          { kind: "note", text: "Every KPI tile is **clickable** and takes you straight to the matching detail view (Containers, Images, Volumes, Networks…), pre-scoped to this host." },
        ],
      },
      {
        title: "The charts",
        blocks: [
          { kind: "p", text: "Below the tiles, live charts turn the raw numbers into something you can read in a second:" },
          { kind: "list", items: [
            "**Container states donut** — running / stopped / paused split, so an unexpected slice jumps out.",
            "**Top containers by CPU** and **by memory** — the heaviest consumers, ranked, to spot a runaway workload fast.",
            "**CPU / RAM gauges** — host-level utilisation dials that fill up as pressure rises.",
          ] },
          { kind: "p", text: "The charts refresh on their own from the live stats stream, so they follow the host in near real time." },
        ],
      },
      {
        title: "Orchestrators & Recent activity",
        blocks: [
          { kind: "p", text: "The **Orchestrators** panel shows what Castor detected on this host — plain **Docker**, **Swarm** (with node/service counts) or **Kubernetes** — so you immediately know which orchestration features are available." },
          { kind: "p", text: "The **Recent activity** feed is the **audit log**: who did what and when (started, stopped, removed a container, changed a setting…). It only appears if your role has the **`audit.read`** permission — a **viewer** without it simply won't see this panel." },
        ],
      },
      {
        title: "The 'degraded' banner",
        blocks: [
          { kind: "callout", tone: "warn", text: "A **degraded** banner appears at the top when a host or provider is unhealthy. The most common cause is the **Docker socket not being reachable** (engine down, socket not mounted, or permissions). Numbers may be stale or partial until it clears — fix the underlying host before trusting the figures." },
        ],
      },
      {
        title: "What to watch",
        blocks: [
          { kind: "list", items: [
            "**Sustained high CPU or RAM** — a brief spike is normal; a gauge pinned near the top for minutes signals an overloaded host or a leaking container.",
            "**Unexpected stopped containers** — if running/total drops without a deploy, something crashed or was killed; open Containers to check.",
            "**A degraded banner** — treat it as a first-class alert: the metrics can't be trusted while it's up.",
            "**A skewed states donut** — a growing 'stopped' slice often means restart loops worth investigating.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/system/df/", label: "docker system df — disk usage (images, volumes, containers)" },
        ],
      },
    ],
  },

  fr: {
    summary: "Une vue analytique temps réel de l'hôte sélectionné : compteurs clés, graphiques en direct et activité d'audit récente — votre premier réflexe pour vérifier que tout va bien.",
    sections: [
      {
        title: "À quoi sert le tableau de bord",
        blocks: [
          { kind: "p", text: "Le tableau de bord est la **vue d'accueil** de l'hôte que vous avez sélectionné. Il donne un aperçu temps réel du moteur Docker — combien de conteneurs tournent, combien de CPU et de mémoire l'hôte consomme, et ce qui a changé récemment — sans avoir à ouvrir chaque page de détail. C'est le cockpit de santé : un coup d'œil suffit à savoir si quelque chose demande votre attention." },
        ],
      },
      {
        title: "Les tuiles KPI",
        blocks: [
          { kind: "p", text: "Une rangée de compteurs résume l'hôte d'un coup d'œil :" },
          { kind: "list", items: [
            "**Conteneurs** — affichés en **actifs / total** (ex. `7 / 12`). L'écart indique combien sont arrêtés, en pause ou terminés.",
            "**CPU %** — charge CPU totale de tous les conteneurs actifs sur cet hôte.",
            "**Mémoire** — RAM actuellement consommée par les conteneurs, rapportée au total de l'hôte.",
            "**Images** — nombre d'images tirées ou construites localement (empreinte disque).",
            "**Volumes** — volumes de données persistantes présents sur l'hôte.",
            "**Réseaux** — réseaux Docker définis sur l'hôte (bridge, overlay, personnalisés…).",
          ] },
          { kind: "note", text: "Chaque tuile KPI est **cliquable** et vous mène directement à la vue de détail correspondante (Conteneurs, Images, Volumes, Réseaux…), déjà filtrée sur cet hôte." },
        ],
      },
      {
        title: "Les graphiques",
        blocks: [
          { kind: "p", text: "Sous les tuiles, des graphiques en direct transforment les chiffres bruts en lecture immédiate :" },
          { kind: "list", items: [
            "**Donut des états de conteneurs** — répartition actifs / arrêtés / en pause, pour qu'une part inattendue saute aux yeux.",
            "**Top conteneurs par CPU** et **par mémoire** — les plus gros consommateurs, classés, pour repérer vite une charge qui s'emballe.",
            "**Jauges CPU / RAM** — cadrans d'utilisation au niveau de l'hôte qui se remplissent quand la pression monte.",
          ] },
          { kind: "p", text: "Les graphiques se rafraîchissent seuls depuis le flux de stats en direct : ils suivent l'hôte quasiment en temps réel." },
        ],
      },
      {
        title: "Orchestrateurs & Activité récente",
        blocks: [
          { kind: "p", text: "Le panneau **Orchestrateurs** montre ce que Castor a détecté sur cet hôte — **Docker** simple, **Swarm** (avec le nombre de nœuds/services) ou **Kubernetes** — pour savoir immédiatement quelles fonctions d'orchestration sont disponibles." },
          { kind: "p", text: "Le flux **Activité récente** est le **journal d'audit** : qui a fait quoi et quand (démarrage, arrêt, suppression d'un conteneur, changement d'un réglage…). Il n'apparaît que si votre rôle possède la permission **`audit.read`** — un **viewer** qui ne l'a pas ne verra tout simplement pas ce panneau." },
        ],
      },
      {
        title: "Le bandeau « degraded »",
        blocks: [
          { kind: "callout", tone: "warn", text: "Un bandeau **degraded** (dégradé) s'affiche en haut quand un hôte ou un provider est en souffrance. La cause la plus fréquente est le **socket Docker inaccessible** (moteur arrêté, socket non monté, ou droits insuffisants). Les chiffres peuvent alors être périmés ou partiels jusqu'à résolution — corrigez l'hôte sous-jacent avant de vous fier aux valeurs affichées." },
        ],
      },
      {
        title: "Que surveiller",
        blocks: [
          { kind: "list", items: [
            "**CPU ou RAM élevés et soutenus** — un pic bref est normal ; une jauge collée en haut pendant plusieurs minutes signale un hôte surchargé ou un conteneur qui fuit.",
            "**Conteneurs arrêtés inattendus** — si le ratio actifs/total baisse sans déploiement, quelque chose a planté ou a été tué ; ouvrez Conteneurs pour vérifier.",
            "**Un bandeau degraded** — traitez-le comme une alerte à part entière : les métriques ne sont pas fiables tant qu'il est présent.",
            "**Un donut d'états déséquilibré** — une part « arrêtés » qui grossit trahit souvent des boucles de redémarrage à investiguer.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/system/df/", label: "docker system df — utilisation disque (images, volumes, conteneurs)" },
        ],
      },
    ],
  },
};
