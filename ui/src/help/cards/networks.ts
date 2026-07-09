// ui/src/help/cards/networks.ts — Docker networks help card.
import type { HelpCard } from "../types";

export const networksCard: HelpCard = {
  id: "networks",
  title: { en: "Networks", fr: "Réseaux" },

  en: {
    summary: "How your containers talk to each other and to the outside world — and which driver (bridge, host, overlay) to pick.",
    sections: [
      {
        title: "What networks are for",
        blocks: [
          { kind: "p", text: "A Docker **network** is the plumbing that decides who can talk to whom. It controls how containers reach **each other**, how they reach **the host and the internet**, and whether they get their own isolated IP space. Every container is attached to at least one network — pick the right **driver** and you get isolation, name-based service discovery and clean port mapping for free." },
        ],
      },
      {
        title: "How it works in Castor",
        blocks: [
          { kind: "p", text: "The Networks view lists every network Docker knows about, with its **name**, **driver** (how it's implemented), **scope** (`local` = one host, `swarm` = cluster-wide) and whether it is **internal** (no outbound access to the host / internet)." },
          { kind: "p", text: "Castor also **flags the system networks** — `bridge`, `host` and `none` — which Docker creates automatically. These are load-bearing defaults: they cannot be removed and you rarely touch them directly." },
          { kind: "note", text: "Reads (list / inspect) work with the socket mounted read-only. Removing a network is a mutation and needs the socket in read-write mode plus the `docker.network.delete` permission." },
        ],
      },
      {
        title: "Which driver do I choose?",
        blocks: [
          { kind: "list", items: [
            "**bridge** — the default, and the right answer most of the time. Creates an isolated private network **on a single host**; containers on the same bridge reach each other by IP, and on a *custom* bridge, by **name**. Ports you want to expose are published to the host explicitly.",
            "**host** — the container **shares the host's network stack** directly: no isolation, no port mapping, a container port *is* the host port. Fastest, but two containers can't both claim the same port and there's no network boundary. Use only when you truly need it (raw performance, low-level networking).",
            "**none** — **no networking at all**. The container is fully isolated on the network side. Handy for one-shot jobs or maximum lockdown.",
            "**overlay** — a **multi-host** network spanning a Swarm cluster, so services on different nodes talk as if on one LAN, with **encrypted service-to-service** traffic. This is the driver to reach for in Swarm; it's meaningless on a single standalone host.",
          ] },
        ],
      },
      {
        title: "Removing a network",
        blocks: [
          { kind: "p", text: "Select a user-created network and remove it (`docker.network.delete`). The equivalent CLI is:" },
          { kind: "cmd", command: "docker network rm <network>" },
          { kind: "callout", tone: "warn", text: "A network **cannot be removed while containers are still attached** to it. Stop or disconnect those containers first. The three system networks (`bridge`, `host`, `none`) can never be deleted." },
        ],
      },
      {
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "Create **one dedicated bridge network per stack / app** instead of piling everything onto the default `bridge`. You isolate apps from each other and unlock **DNS resolution by service name** (`db`, `api`, `cache`…) instead of brittle IPs.",
            "The **default** `bridge` network does *not* give you name resolution — only custom bridge networks do. That alone is a reason to always create your own.",
            "Mark a network **internal** when a group of containers should talk to each other but have **no route to the internet** (e.g. a database tier).",
            "Reach for **host** networking sparingly — it removes the isolation boundary and makes port conflicts easy to hit.",
            "For multi-host, remember **overlay** only works once Swarm is initialised (see the Swarm help card).",
          ] },
          { kind: "callout", tone: "info", text: "Creating custom networks from the Castor UI is on the way. V1 covers **reading and removing** networks — for now, create them with `docker network create <name>` (bridge is the default driver) and Castor will list them immediately." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/network/", label: "Docker networking — official documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Comment vos conteneurs communiquent entre eux et avec l'extérieur — et quel driver (bridge, host, overlay) choisir.",
    sections: [
      {
        title: "À quoi servent les réseaux",
        blocks: [
          { kind: "p", text: "Un **réseau** Docker, c'est la tuyauterie qui décide qui peut parler à qui. Il gouverne la façon dont les conteneurs se joignent **entre eux**, atteignent **l'hôte et internet**, et disposent ou non de leur propre espace d'adressage isolé. Chaque conteneur est rattaché à au moins un réseau — choisissez le bon **driver** et vous obtenez gratuitement l'isolation, la résolution des services par nom et un mapping de ports propre." },
        ],
      },
      {
        title: "Comment ça marche dans Castor",
        blocks: [
          { kind: "p", text: "La vue Réseaux liste tous les réseaux connus de Docker, avec leur **name** (nom), leur **driver** (comment il est implémenté), leur **scope** (`local` = un seul hôte, `swarm` = tout le cluster) et le fait qu'ils soient **internal** (sans accès sortant vers l'hôte / internet)." },
          { kind: "p", text: "Castor **repère aussi les réseaux système** — `bridge`, `host` et `none` — que Docker crée automatiquement. Ce sont des valeurs par défaut structurantes : ils ne peuvent pas être supprimés et vous n'y touchez que rarement." },
          { kind: "note", text: "Les lectures (lister / inspecter) fonctionnent avec le socket monté en lecture seule. Supprimer un réseau est une mutation : cela nécessite le socket en lecture-écriture et la permission `docker.network.delete`." },
        ],
      },
      {
        title: "Quel driver choisir ?",
        blocks: [
          { kind: "list", items: [
            "**bridge** — le défaut, et le bon choix la plupart du temps. Crée un réseau privé isolé **sur un seul hôte** ; les conteneurs d'un même bridge se joignent par IP, et sur un bridge *personnalisé*, par **nom**. Les ports à exposer sont publiés explicitement vers l'hôte.",
            "**host** — le conteneur **partage directement la pile réseau de l'hôte** : aucune isolation, aucun mapping de ports, un port du conteneur *est* un port de l'hôte. Le plus rapide, mais deux conteneurs ne peuvent pas réclamer le même port et il n'y a plus de frontière réseau. À réserver aux vrais besoins (performance brute, réseau bas niveau).",
            "**none** — **aucun réseau du tout**. Le conteneur est totalement isolé côté réseau. Pratique pour des jobs ponctuels ou un cloisonnement maximal.",
            "**overlay** — un réseau **multi-hôtes** qui s'étend sur un cluster Swarm : des services sur des nœuds différents communiquent comme sur un même LAN, avec un trafic **service-à-service chiffré**. C'est le driver à privilégier en Swarm ; il n'a aucun sens sur un hôte unique isolé.",
          ] },
        ],
      },
      {
        title: "Supprimer un réseau",
        blocks: [
          { kind: "p", text: "Sélectionnez un réseau créé par un utilisateur et supprimez-le (`docker.network.delete`). L'équivalent en ligne de commande :" },
          { kind: "cmd", command: "docker network rm <réseau>" },
          { kind: "callout", tone: "warn", text: "Un réseau **ne peut pas être supprimé tant que des conteneurs y sont encore attachés**. Arrêtez ou déconnectez d'abord ces conteneurs. Les trois réseaux système (`bridge`, `host`, `none`) ne peuvent jamais être supprimés." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Créez **un réseau bridge dédié par stack / application** plutôt que de tout entasser sur le `bridge` par défaut. Vous isolez les applications les unes des autres et débloquez la **résolution DNS par nom de service** (`db`, `api`, `cache`…) au lieu d'IP fragiles.",
            "Le réseau `bridge` **par défaut** ne fournit *pas* la résolution par nom — seuls les bridges personnalisés le font. À lui seul, c'est une raison de toujours créer le vôtre.",
            "Marquez un réseau **internal** quand un groupe de conteneurs doit communiquer entre eux mais **sans route vers internet** (par ex. une couche base de données).",
            "N'utilisez le réseau **host** qu'avec parcimonie — il supprime la frontière d'isolation et rend les conflits de ports faciles à provoquer.",
            "Pour le multi-hôtes, rappelez-vous qu'**overlay** ne fonctionne qu'une fois Swarm initialisé (voir la fiche d'aide Swarm).",
          ] },
          { kind: "callout", tone: "info", text: "La création de réseaux personnalisés depuis l'UI de Castor arrive bientôt. La V1 couvre la **lecture et la suppression** des réseaux — pour l'instant, créez-les avec `docker network create <nom>` (bridge est le driver par défaut) et Castor les listera immédiatement." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/network/", label: "Réseaux Docker — documentation officielle" },
        ],
      },
    ],
  },
};
