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
          { kind: "note", text: "Reads (list / inspect) work with the socket mounted read-only. Creating, removing or pruning networks are mutations: they need the socket in read-write mode plus the matching permission (`docker.network.create`, `docker.network.delete`, `docker.system.prune`)." },
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
            "**macvlan / ipvlan** — put containers **directly on your physical LAN** with their own IP, as if each were a machine plugged into the switch (macvlan gives each container its own MAC address; ipvlan shares the host's MAC, for networks that reject multiple MACs per port). Niche but handy for appliances that must be reachable on the LAN (DNS, DHCP, home automation…) — they require matching network configuration on the host.",
          ] },
        ],
      },
      {
        title: "Creating a network",
        blocks: [
          { kind: "p", text: "Click **Create network** (permission `docker.network.create` — granted to the **admin** and **operator** roles). A dialog asks for:" },
          { kind: "list", items: [
            "**Name** — must start with a letter or digit, followed by letters, digits, `_`, `.` or `-`. The field validates as you type and the backend re-validates on submit.",
            "**Driver** — `bridge` by default, the right choice on a single host; `overlay`, `macvlan` and `ipvlan` are also available — see the driver guide above.",
            "**Internal network (no outbound access)** — tick this checkbox when the containers should talk to each other but have **no route to the host network or the internet** (typical for a database tier).",
          ] },
          { kind: "p", text: "The new network shows up in the list immediately. The CLI equivalent:" },
          { kind: "cmd", command: "docker network create --driver bridge [--internal] <name>" },
        ],
      },
      {
        title: "Removing a network",
        blocks: [
          { kind: "p", text: "Select a user-created network and remove it (`docker.network.delete` — **admin** only). The equivalent CLI is:" },
          { kind: "cmd", command: "docker network rm <network>" },
          { kind: "callout", tone: "warn", text: "A network **cannot be removed while containers are still attached** to it. Stop or disconnect those containers first. The three system networks (`bridge`, `host`, `none`) can never be deleted." },
        ],
      },
      {
        title: "Pruning unused networks",
        blocks: [
          { kind: "p", text: "The **Prune** button removes **every network not used by at least one container** in one pass (permission `docker.system.prune` — granted to the **admin** and **operator** roles). A confirmation dialog states the scope before anything is deleted, and a toast reports how many networks were removed." },
          { kind: "cmd", command: "docker network prune" },
          { kind: "callout", tone: "warn", text: "Prune is **not selective** and cannot be undone: any custom network with no attached container is removed — including ones you were keeping for later. The system networks (`bridge`, `host`, `none`) are never touched." },
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
          { kind: "callout", tone: "info", text: "Prefer the targeted **Remove** on a single network when you know exactly what you are cleaning up; keep **Prune** for periodic housekeeping after tearing down stacks." },
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
          { kind: "note", text: "Les lectures (lister / inspecter) fonctionnent avec le socket monté en lecture seule. Créer, supprimer ou purger des réseaux sont des mutations : cela nécessite le socket en lecture-écriture et la permission correspondante (`docker.network.create`, `docker.network.delete`, `docker.system.prune`)." },
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
            "**macvlan / ipvlan** — placent les conteneurs **directement sur votre LAN physique** avec leur propre IP, comme si chacun était une machine branchée au switch (macvlan donne une adresse MAC propre à chaque conteneur ; ipvlan partage la MAC de l'hôte, pour les réseaux qui refusent plusieurs MAC par port). Un usage de niche mais précieux pour les services qui doivent être joignables sur le LAN (DNS, DHCP, domotique…) — ils exigent une configuration réseau adaptée côté hôte.",
          ] },
        ],
      },
      {
        title: "Créer un réseau",
        blocks: [
          { kind: "p", text: "Cliquez sur **Create network** (permission `docker.network.create` — accordée aux rôles **admin** et **operator**). Une boîte de dialogue demande :" },
          { kind: "list", items: [
            "**Name** — doit commencer par une lettre ou un chiffre, suivi de lettres, chiffres, `_`, `.` ou `-`. Le champ est validé pendant la saisie et le backend re-valide à l'envoi.",
            "**Driver** — `bridge` par défaut, le bon choix sur un hôte unique ; `overlay`, `macvlan` et `ipvlan` sont également proposés — voir le guide des drivers ci-dessus.",
            "**Internal network (no outbound access)** — cochez cette case quand les conteneurs doivent communiquer entre eux mais **sans route vers le réseau de l'hôte ni internet** (typique d'une couche base de données).",
          ] },
          { kind: "p", text: "Le nouveau réseau apparaît immédiatement dans la liste. L'équivalent en ligne de commande :" },
          { kind: "cmd", command: "docker network create --driver bridge [--internal] <nom>" },
        ],
      },
      {
        title: "Supprimer un réseau",
        blocks: [
          { kind: "p", text: "Sélectionnez un réseau créé par un utilisateur et supprimez-le (`docker.network.delete` — réservé au rôle **admin**). L'équivalent en ligne de commande :" },
          { kind: "cmd", command: "docker network rm <réseau>" },
          { kind: "callout", tone: "warn", text: "Un réseau **ne peut pas être supprimé tant que des conteneurs y sont encore attachés**. Arrêtez ou déconnectez d'abord ces conteneurs. Les trois réseaux système (`bridge`, `host`, `none`) ne peuvent jamais être supprimés." },
        ],
      },
      {
        title: "Purger les réseaux inutilisés",
        blocks: [
          { kind: "p", text: "Le bouton **Prune** supprime en une passe **tous les réseaux qui ne sont utilisés par aucun conteneur** (permission `docker.system.prune` — accordée aux rôles **admin** et **operator**). Une boîte de dialogue de confirmation rappelle la portée avant toute suppression, et un toast indique combien de réseaux ont été retirés." },
          { kind: "cmd", command: "docker network prune" },
          { kind: "callout", tone: "warn", text: "Le prune n'est **pas sélectif** et ne peut pas être annulé : tout réseau personnalisé sans conteneur attaché est supprimé — y compris ceux que vous gardiez pour plus tard. Les réseaux système (`bridge`, `host`, `none`) ne sont jamais touchés." },
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
          { kind: "callout", tone: "info", text: "Préférez la suppression ciblée (**Remove**) d'un réseau précis quand vous savez exactement ce que vous nettoyez ; gardez **Prune** pour le ménage périodique après avoir démonté des stacks." },
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
