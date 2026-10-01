// Castor by IT Leonard
// ui/src/help/cards/swarm.ts — Docker Swarm setup & usage help card.
import type { HelpCard } from "../types";

export const swarmCard: HelpCard = {
  id: "swarm",
  title: { en: "Docker Swarm — setup guide", fr: "Docker Swarm — guide de configuration" },

  en: {
    summary: "Docker's built-in orchestrator: turn several Docker hosts into one cluster and run replicated services across them.",
    sections: [
      {
        title: "What is Docker Swarm?",
        blocks: [
          { kind: "p", text: "Swarm is Docker's native orchestrator: it federates several Docker hosts into a single cluster and schedules **services** (replicated containers) across them. Simpler to operate than Kubernetes, it is a great fit for **small-to-medium** multi-host fleets when you want high availability without K8s complexity." },
        ],
      },
      {
        title: "Enable Swarm on a single node",
        blocks: [
          { kind: "p", text: "On the host that will become the manager, initialise the cluster:" },
          { kind: "cmd", command: "docker swarm init" },
          { kind: "note", text: "On a machine with several network interfaces, specify the address to advertise:" },
          { kind: "cmd", command: "docker swarm init --advertise-addr <IP>" },
          { kind: "p", text: "Castor then immediately shows the manager node and lets you deploy services." },
        ],
      },
      {
        title: "Add nodes (workers / managers)",
        blocks: [
          { kind: "p", text: "On the manager, get the join command for the role you want:" },
          { kind: "cmd", command: "docker swarm join-token worker" },
          { kind: "cmd", command: "docker swarm join-token manager" },
          { kind: "p", text: "Then run the printed command on the other host:" },
          { kind: "cmd", command: "docker swarm join --token <TOKEN> <MANAGER-IP>:2377" },
        ],
      },
      {
        title: "Verify",
        blocks: [
          { kind: "p", text: "From a manager, nodes should appear Ready / Active:" },
          { kind: "cmd", command: "docker node ls" },
        ],
      },
      {
        title: "Using it in Castor",
        blocks: [
          { kind: "p", text: "Once Swarm is active, the Swarm page lets you **deploy** a service (image, replicas, published ports), **scale** it, **update** it (rolling update), **restart** it, **remove** it, and **drain / re-activate** nodes." },
        ],
      },
      {
        title: "Best practices (production)",
        blocks: [
          { kind: "list", items: [
            "Use an **odd** number of managers (3 or 5) for quorum / HA.",
            "Keep managers dedicated by draining workloads off them: `docker node update --availability drain <mgr>`.",
            "Use **overlay** networks for service-to-service communication.",
            "Store credentials in **Docker secrets**, never in environment variables: `docker secret create <name> <file>`.",
            "Pin image tags (avoid `:latest`).",
            "Set `--limit-cpu` / `--limit-memory` and healthchecks.",
            "Expose services behind an ingress / reverse-proxy.",
            "Open between nodes: `2377/tcp` (cluster management), `7946/tcp+udp` (node discovery), `4789/udp` (overlay VXLAN).",
          ] },
        ],
      },
      {
        title: "Disable / leave",
        blocks: [
          { kind: "p", text: "To make a node leave the swarm (single-node included):" },
          { kind: "cmd", command: "docker swarm leave --force" },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/engine/swarm/", label: "Docker Swarm — official documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "L'orchestrateur natif de Docker : fédérez plusieurs hôtes Docker en un cluster et exécutez des services répliqués à travers eux.",
    sections: [
      {
        title: "Qu'est-ce que Docker Swarm ?",
        blocks: [
          { kind: "p", text: "Swarm est l'orchestrateur natif de Docker : il fédère plusieurs hôtes Docker en un seul cluster et planifie des **services** (conteneurs répliqués) à travers eux. Plus simple à exploiter que Kubernetes, c'est un excellent choix pour un parc **petit à moyen** multi-hôtes lorsque vous voulez de la haute disponibilité sans la complexité de K8s." },
        ],
      },
      {
        title: "Activer Swarm sur un seul nœud",
        blocks: [
          { kind: "p", text: "Sur l'hôte qui deviendra le manager, initialisez le cluster :" },
          { kind: "cmd", command: "docker swarm init" },
          { kind: "note", text: "Sur une machine à plusieurs interfaces réseau, précisez l'adresse à publier :" },
          { kind: "cmd", command: "docker swarm init --advertise-addr <IP>" },
          { kind: "p", text: "Castor affiche alors immédiatement le nœud manager et vous permet de déployer des services." },
        ],
      },
      {
        title: "Ajouter des nœuds (workers / managers)",
        blocks: [
          { kind: "p", text: "Sur le manager, récupérez la commande de jointure pour le rôle voulu :" },
          { kind: "cmd", command: "docker swarm join-token worker" },
          { kind: "cmd", command: "docker swarm join-token manager" },
          { kind: "p", text: "Puis exécutez sur l'autre hôte la commande affichée :" },
          { kind: "cmd", command: "docker swarm join --token <TOKEN> <MANAGER-IP>:2377" },
        ],
      },
      {
        title: "Vérifier",
        blocks: [
          { kind: "p", text: "Depuis un manager, les nœuds doivent apparaître Ready / Active :" },
          { kind: "cmd", command: "docker node ls" },
        ],
      },
      {
        title: "Utilisation dans Castor",
        blocks: [
          { kind: "p", text: "Dès que Swarm est actif, la page Swarm permet de **déployer** un service (image, réplicas, ports publiés), de le **scaler**, de le **mettre à jour** (rolling update), de le **redémarrer**, de le **supprimer**, et de **drainer / réactiver** les nœuds." },
        ],
      },
      {
        title: "Bonnes pratiques (production)",
        blocks: [
          { kind: "list", items: [
            "Utilisez un nombre **impair** de managers (3 ou 5) pour le quorum / la HA.",
            "Gardez les managers dédiés en drainant les charges qui s'y trouvent : `docker node update --availability drain <mgr>`.",
            "Utilisez des réseaux **overlay** pour la communication service-à-service.",
            "Stockez les identifiants dans des **secrets Docker**, jamais en variables d'environnement : `docker secret create <name> <file>`.",
            "Épinglez les tags d'image (évitez `:latest`).",
            "Définissez `--limit-cpu` / `--limit-memory` et des healthchecks.",
            "Exposez les services via un ingress / reverse-proxy.",
            "Ouvrez entre les nœuds : `2377/tcp` (gestion du cluster), `7946/tcp+udp` (découverte des nœuds), `4789/udp` (overlay VXLAN).",
          ] },
        ],
      },
      {
        title: "Désactiver / quitter",
        blocks: [
          { kind: "p", text: "Pour qu'un nœud quitte le swarm (mono-nœud inclus) :" },
          { kind: "cmd", command: "docker swarm leave --force" },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/engine/swarm/", label: "Docker Swarm — documentation officielle" },
        ],
      },
    ],
  },
};
