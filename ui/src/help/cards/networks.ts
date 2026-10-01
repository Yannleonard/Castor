// Castor by IT Leonard
// ui/src/help/cards/networks.ts — Docker networks help card.
//
// Covers what the Networks feature really does in Castor: creating networks
// (drivers, flags), IP addressing (IPAM pools), attaching / detaching a
// container, linking two networks through a multi-homed container, and how
// networks are chosen at deploy time (template modal, compose stacks).
import type { HelpCard } from "../types";

const COMPOSE_NETWORKS_EXAMPLE = `networks:
  backend:
    driver: bridge
    internal: true
    ipam:
      config:
        - subnet: 10.20.0.0/24
          gateway: 10.20.0.1
          ip_range: 10.20.0.128/25
  edge:
    external: true
    name: proxy-net

services:
  app:
    image: my/app:1.4
    networks:
      backend:
        ipv4_address: 10.20.0.10
        aliases: [app, app-v1]
  proxy:
    image: caddy:2
    ports: ["443:443"]
    networks:
      - backend
      - edge`;

export const networksCard: HelpCard = {
  id: "networks",
  title: { en: "Networks", fr: "Réseaux" },

  en: {
    summary: "Create networks with their own IP addressing, attach containers to one or several of them, and link two networks through a shared container.",
    sections: [
      {
        title: "What networks are for",
        blocks: [
          { kind: "p", text: "A Docker **network** decides which containers can talk to each other, how they reach the host and the internet, and which IP addresses they get. Every container sits on at least one network. Putting an app's containers on their **own network** isolates them from everything else on the host: a container only reaches containers that share a network with it." },
          { kind: "p", text: "On a network **you create** (a *user-defined* network), Docker runs an embedded DNS: containers reach each other **by name** (`db`, `api`, `cache`…) and by any extra **alias** you register — no IP to hard-code. The default `bridge` network Docker ships with does **not** resolve names: containers on it only see each other by IP. That alone is a reason to always create your own networks." },
          { kind: "note", text: "The Networks view lists every network on the selected host with its driver, scope (`local` = this host, `swarm` = cluster-wide), subnets, flags (internal, attachable, IPv6) and the number of attached containers. Opening a network shows its IPAM pools, driver options and each attached container with the addresses it was given. The three system networks (`bridge`, `host`, `none`) are flagged and can never be removed." },
        ],
      },
      {
        title: "Creating a network",
        blocks: [
          { kind: "p", text: "Click **Create network** (permission `docker.network.create`, granted to the **operator** and **admin** roles). The name must start with a letter or digit and contain only letters, digits, `_`, `.` or `-`. Then pick a **driver**:" },
          { kind: "list", items: [
            "**bridge** — the default and the right choice on a single host. Containers on the same bridge reach each other by name; only the ports you publish are visible from outside. Create one bridge per app or stack.",
            "**overlay** — spans several hosts of a **Swarm** cluster, so services on different nodes talk as if on one LAN. It only works once Swarm is initialised (see the Swarm help card) and is pointless on a standalone host.",
            "**macvlan / ipvlan** — plug the container **directly on your physical LAN** through a parent interface of the host (driver option `parent=eth0`): it gets an address of the LAN itself, like a machine on the switch (macvlan with its own MAC address; ipvlan sharing the host's MAC, for switches that reject several MACs per port). Handy for appliances that must be reachable on the LAN (DNS, DHCP, home automation…).",
          ] },
          { kind: "callout", tone: "warn", text: "macvlan, ipvlan and any driver with a `parent` option are **reserved to administrators** (global superuser): the container bypasses Docker's NAT and firewall rules and lands straight on the host's network segment. Anyone else gets a `403` and the attempt is written to the audit log. The same rule applies to a stack that declares such a network." },
          { kind: "p", text: "Options on the form:" },
          { kind: "list", items: [
            "**Internal (no outbound access)** — containers on this network talk to each other but have **no route to the host network or the internet**. Ideal for a database tier.",
            "**Attachable** — lets standalone containers join an **overlay** network (by default only Swarm services can). A bridge is always attachable.",
            "**Enable IPv6** — gives the network an IPv6 pool alongside IPv4; add an IPv6 subnet in the addressing section to control it.",
          ] },
          { kind: "p", text: "The CLI equivalent:" },
          { kind: "cmd", command: "docker network create --driver bridge [--internal] [--attachable] [--ipv6] <name>" },
          { kind: "note", text: "Creating a network needs the Docker socket in read-write mode. A name already taken answers `network_exists`: pick another name or remove the existing network first." },
        ],
      },
      {
        title: "IP addressing (IPAM)",
        blocks: [
          { kind: "p", text: "Leave the addressing section empty and Docker picks a free subnet from its default pools (usually inside `172.17.0.0/12`). Define one yourself when you want **predictable addresses** — a static IP for a container, firewall rules that refer to a fixed range — or when you must **avoid a clash with your LAN or VPN** ranges, which Docker knows nothing about." },
          { kind: "p", text: "An IPAM pool has four fields:" },
          { kind: "list", items: [
            "**Subnet** (required) — the address block in CIDR notation, e.g. `10.20.0.0/24`. Everything else must fall inside it.",
            "**Gateway** — the address containers use as default route; Docker takes the first usable address of the subnet when left empty.",
            "**IP range** — a smaller CIDR inside the subnet from which Docker allocates *dynamic* addresses (e.g. `10.20.0.128/25`). Keep the rest of the subnet for your static IPs so the two never collide.",
            "**Auxiliary addresses** — named addresses (`router=10.20.0.2`) Docker must never hand out because another device already uses them. Mostly needed with macvlan/ipvlan, where the subnet is your real LAN.",
          ] },
          { kind: "p", text: "Castor checks every value before calling Docker and names the field at fault (`invalid_network_config`): a subnet that is not a CIDR, a gateway or range outside the subnet, an auxiliary address outside it. The CLI equivalent:" },
          { kind: "cmd", command: "docker network create --subnet 10.20.0.0/24 --gateway 10.20.0.1 --ip-range 10.20.0.128/25 <name>" },
          { kind: "callout", tone: "warn", text: "**\"This subnet overlaps an existing network's address space\"** (`subnet_overlap`) means another network on this host already uses part of that range — Docker cannot route two networks over the same addresses. Open the other networks to see their subnets, pick a different block, or leave IPAM empty and let Docker choose. The same check applies to a stack whose compose file declares an `ipam` subnet." },
        ],
      },
      {
        title: "Attaching a container to a network",
        blocks: [
          { kind: "p", text: "A container can belong to **several networks** at once and gets one interface and one address on each. Attach it either from the **network's page** (**Connect a container**: pick the container) or from the **container's page** (**Connect to network**: pick the network). Permissions `docker.network.connect` / `docker.network.disconnect` (operator and admin). The CLI equivalent:" },
          { kind: "cmd", command: "docker network connect [--ip 10.20.0.10] [--alias api] <network> <container>" },
          { kind: "p", text: "Options when connecting:" },
          { kind: "list", items: [
            "**Static IPv4 / IPv6** — a fixed address for this container on that network. It only works on a **user-defined network with a configured subnet**: Castor refuses it up front on the default `bridge` (`static_ip_unsupported`), and Docker refuses it on any network without an IPAM subnet. An address already taken answers `ip_in_use`; an address outside the subnet is rejected. Leave it empty and Docker assigns a free one.",
            "**Aliases** — extra DNS names the other containers on that network resolve for this one (`api`, `api-v1`…), on top of the container name. Aliases are per network.",
          ] },
          { kind: "p", text: "**Disconnect** removes the container from that network only; its other networks are untouched. A container already on the network answers `already_connected`: disconnect it first to change its address or aliases. **Force** also clears a stale attachment Docker still holds for a container that is gone." },
          { kind: "callout", tone: "info", text: "The **Castor container itself** and containers marked **protected** are never rewired: connect and disconnect are refused on them, exactly like the other destructive actions. The target must also be a container Castor knows on this host (by id or name), otherwise `404`." },
          { kind: "note", text: "Connecting a **running** container takes effect immediately, without a restart: the new interface appears inside it and names on that network resolve right away. An application that resolved names once at start-up may still need a restart to notice." },
        ],
      },
      {
        title: "Linking two networks (\"peering\")",
        blocks: [
          { kind: "callout", tone: "info", text: "Docker has **no peering** between two bridge networks: there is no route, and no option, to make network A reach network B as a whole — each bridge is isolated on purpose. The native way to link them is to **attach one container to both networks**: it is then reachable from each side and can act as the gateway, proxy or bridge between them." },
          { kind: "p", text: "Typical example — a reverse proxy in front of a private application:" },
          { kind: "list", items: [
            "Create two networks: `frontend` (where traffic comes in) and `backend` (marked **internal**, no internet).",
            "Deploy the application (`app`) on `backend` only. It is invisible from `frontend` and from the host.",
            "Deploy the reverse proxy on **both** `frontend` and `backend`, and publish its port `443`. It reaches the app by name (`http://app:8080`) over `backend` and serves the outside over `frontend`.",
            "Result: `app` never touches the internet, and the proxy is the only path between the two worlds.",
          ] },
          { kind: "p", text: "The same pattern serves a database shared by two stacks (attach the database — or better, a proxy — to both stack networks) or a monitoring agent that must scrape containers on several networks. For a container that already runs, use **Connect to network** to add it to the second network: no redeploy needed." },
          { kind: "note", text: "To join a **physical** network rather than another Docker network — make a container part of your office LAN, or reachable by a VPN peer — use **macvlan / ipvlan** (administrators only, see above). Routing between two Docker subnets at the IP level would need forwarding and custom firewall rules on the host, outside Castor's scope." },
        ],
      },
      {
        title: "Networks at deploy time",
        blocks: [
          { kind: "p", text: "**From a template** (Marketplace): the deploy form lets you pick the **networks** the container joins, each with an optional **static IPv4** and **aliases**. The first network is the container's primary one (its default gateway); the others are connected before the container starts. Leave the list empty to stay on the default `bridge`. The networks must already exist — create them in the Networks view first." },
          { kind: "p", text: "**In a compose stack**: declare the networks at top level and reference them per service. The list form (`networks: [backend]`) is a plain attachment; the mapping form adds a static address and aliases:" },
          { kind: "code", code: COMPOSE_NETWORKS_EXAMPLE },
          { kind: "p", text: "What Castor does with it:" },
          { kind: "list", items: [
            "A declared network is created at deploy with its `driver`, `internal`, `attachable`, `enable_ipv6`, `driver_opts` and `ipam` pools (`subnet`, `gateway`, `ip_range`, `aux_addresses`), named `<project>_<key>`, and removed with the stack. An existing network with that name is **reused as-is** — its settings are not changed.",
            "`external: true` (with `name:` for its real name) **joins** an existing network and never creates or deletes it. The deploy fails with a clear message if it does not exist on the host.",
            "`ipv4_address` / `ipv6_address` require the network to declare an `ipam` subnet of that family — checked when the file is parsed, before anything is created (on an external network, Docker does the check).",
            "Every service also joins the stack's default project network with its **service name** as alias, so `db`, `api`… always resolve inside the stack.",
            "A stack declaring `macvlan` / `ipvlan` or a `parent` option follows the same **administrator-only** rule as the create form.",
          ] },
        ],
      },
      {
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "Create **one dedicated network per app or stack** instead of piling everything onto the default `bridge`: isolation and DNS by name come for free.",
            "Give a **static IP** only to what really needs one (a DNS server, a device other systems point at by address). For everything else rely on names and aliases — they survive re-creation, IPs do not.",
            "When you set a subnet, reserve an **IP range** for dynamic allocation and keep your static addresses outside it.",
            "Pick private ranges that **do not overlap** your LAN, VPN or the other Docker hosts you route to. A clash makes the LAN unreachable from the containers — silently.",
            "Mark a data tier **internal**, and put a proxy on two networks rather than opening the data tier to the outside.",
            "Use **host** networking sparingly: no isolation, no port mapping, and port conflicts as soon as two containers want the same port.",
            "**overlay** needs Swarm; **macvlan / ipvlan** need an administrator and a parent interface that really exists on the host.",
          ] },
          { kind: "p", text: "Cleaning up: **Remove** (permission `docker.network.delete`, **admin** only) deletes one network and is refused while containers are still attached (`network_in_use`) — disconnect them first. **Prune** (`docker.system.prune`, operator and admin) deletes every network with no attached container in one pass, after a confirmation." },
          { kind: "cmd", command: "docker network rm <network>" },
          { kind: "cmd", command: "docker network prune" },
          { kind: "callout", tone: "warn", text: "Prune is **not selective** and cannot be undone: any custom network without a container is removed, including the ones you were keeping for later. The system networks (`bridge`, `host`, `none`) are never touched." },
          { kind: "doc", href: "https://docs.docker.com/engine/network/", label: "Docker networking — official documentation" },
          { kind: "doc", href: "https://docs.docker.com/engine/network/drivers/macvlan/", label: "macvlan driver — official documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Créez des réseaux avec leur propre adressage IP, rattachez des conteneurs à un ou plusieurs d'entre eux, et reliez deux réseaux via un conteneur partagé.",
    sections: [
      {
        title: "À quoi servent les réseaux",
        blocks: [
          { kind: "p", text: "Un **réseau** Docker décide quels conteneurs peuvent se parler, comment ils atteignent l'hôte et internet, et quelles adresses IP ils reçoivent. Chaque conteneur est rattaché à au moins un réseau. Placer les conteneurs d'une application sur **leur propre réseau** les isole de tout le reste de l'hôte : un conteneur ne joint que les conteneurs qui partagent un réseau avec lui." },
          { kind: "p", text: "Sur un réseau **que vous créez** (un réseau *user-defined*), Docker fournit un DNS intégré : les conteneurs se joignent **par nom** (`db`, `api`, `cache`…) et par tout **alias** supplémentaire que vous enregistrez — aucune IP à coder en dur. Le réseau `bridge` par défaut livré avec Docker ne résout **pas** les noms : les conteneurs qui s'y trouvent ne se voient que par IP. À lui seul, c'est une raison de toujours créer vos propres réseaux." },
          { kind: "note", text: "La vue Réseaux liste tous les réseaux de l'hôte sélectionné avec leur driver, leur scope (`local` = cet hôte, `swarm` = tout le cluster), leurs sous-réseaux, leurs drapeaux (internal, attachable, IPv6) et le nombre de conteneurs rattachés. Ouvrir un réseau affiche ses pools IPAM, ses options de driver et chaque conteneur rattaché avec les adresses qu'il a reçues. Les trois réseaux système (`bridge`, `host`, `none`) sont signalés et ne peuvent jamais être supprimés." },
        ],
      },
      {
        title: "Créer un réseau",
        blocks: [
          { kind: "p", text: "Cliquez sur **Create network** (permission `docker.network.create`, accordée aux rôles **operator** et **admin**). Le nom doit commencer par une lettre ou un chiffre et ne contenir que des lettres, chiffres, `_`, `.` ou `-`. Choisissez ensuite un **driver** :" },
          { kind: "list", items: [
            "**bridge** — le défaut, et le bon choix sur un hôte unique. Les conteneurs d'un même bridge se joignent par nom ; seuls les ports que vous publiez sont visibles de l'extérieur. Créez un bridge par application ou par stack.",
            "**overlay** — s'étend sur plusieurs hôtes d'un cluster **Swarm** : des services sur des nœuds différents communiquent comme sur un même LAN. Il ne fonctionne qu'une fois Swarm initialisé (voir la fiche d'aide Swarm) et n'a aucun intérêt sur un hôte isolé.",
            "**macvlan / ipvlan** — branchent le conteneur **directement sur votre LAN physique** via une interface parente de l'hôte (option de driver `parent=eth0`) : il reçoit une adresse du LAN lui-même, comme une machine sur le switch (macvlan avec sa propre adresse MAC ; ipvlan en partageant la MAC de l'hôte, pour les switches qui refusent plusieurs MAC par port). Utile pour les services qui doivent être joignables sur le LAN (DNS, DHCP, domotique…).",
          ] },
          { kind: "callout", tone: "warn", text: "macvlan, ipvlan et tout driver avec une option `parent` sont **réservés aux administrateurs** (superuser global) : le conteneur contourne le NAT et les règles de pare-feu de Docker et atterrit directement sur le segment réseau de l'hôte. Toute autre personne reçoit un `403` et la tentative est inscrite dans le journal d'audit. La même règle s'applique à une stack qui déclare un tel réseau." },
          { kind: "p", text: "Options du formulaire :" },
          { kind: "list", items: [
            "**Internal (no outbound access)** — les conteneurs de ce réseau se parlent entre eux mais n'ont **aucune route vers le réseau de l'hôte ni vers internet**. Idéal pour une couche base de données.",
            "**Attachable** — autorise des conteneurs autonomes à rejoindre un réseau **overlay** (par défaut, seuls les services Swarm le peuvent). Un bridge est toujours attachable.",
            "**Enable IPv6** — donne au réseau un pool IPv6 en plus de l'IPv4 ; ajoutez un sous-réseau IPv6 dans la section adressage pour le maîtriser.",
          ] },
          { kind: "p", text: "L'équivalent en ligne de commande :" },
          { kind: "cmd", command: "docker network create --driver bridge [--internal] [--attachable] [--ipv6] <nom>" },
          { kind: "note", text: "Créer un réseau nécessite le socket Docker en lecture-écriture. Un nom déjà pris répond `network_exists` : choisissez un autre nom ou supprimez d'abord le réseau existant." },
        ],
      },
      {
        title: "Adressage IP (IPAM)",
        blocks: [
          { kind: "p", text: "Laissez la section adressage vide et Docker choisit un sous-réseau libre dans ses pools par défaut (généralement dans `172.17.0.0/12`). Définissez-en un vous-même quand vous voulez des **adresses prévisibles** — une IP statique pour un conteneur, des règles de pare-feu qui visent une plage fixe — ou quand vous devez **éviter un chevauchement avec votre LAN ou votre VPN**, dont Docker ignore tout." },
          { kind: "p", text: "Un pool IPAM comporte quatre champs :" },
          { kind: "list", items: [
            "**Subnet** (obligatoire) — le bloc d'adresses en notation CIDR, ex. `10.20.0.0/24`. Tout le reste doit s'y trouver.",
            "**Gateway** — l'adresse que les conteneurs utilisent comme route par défaut ; Docker prend la première adresse utilisable du sous-réseau si le champ est vide.",
            "**IP range** — un CIDR plus petit à l'intérieur du sous-réseau, dans lequel Docker alloue les adresses *dynamiques* (ex. `10.20.0.128/25`). Gardez le reste du sous-réseau pour vos IP statiques afin que les deux n'entrent jamais en collision.",
            "**Auxiliary addresses** — des adresses nommées (`router=10.20.0.2`) que Docker ne doit jamais distribuer parce qu'un autre équipement les utilise déjà. Surtout utile avec macvlan/ipvlan, où le sous-réseau est votre vrai LAN.",
          ] },
          { kind: "p", text: "Castor vérifie chaque valeur avant d'appeler Docker et désigne le champ fautif (`invalid_network_config`) : un sous-réseau qui n'est pas un CIDR, une passerelle ou une plage hors du sous-réseau, une adresse auxiliaire en dehors. L'équivalent en ligne de commande :" },
          { kind: "cmd", command: "docker network create --subnet 10.20.0.0/24 --gateway 10.20.0.1 --ip-range 10.20.0.128/25 <nom>" },
          { kind: "callout", tone: "warn", text: "**« Ce sous-réseau chevauche la plage d'adresses d'un réseau existant »** (`subnet_overlap`) signifie qu'un autre réseau de cet hôte utilise déjà une partie de cette plage — Docker ne peut pas router deux réseaux sur les mêmes adresses. Ouvrez les autres réseaux pour voir leurs sous-réseaux, choisissez un autre bloc, ou laissez l'IPAM vide et laissez Docker choisir. La même vérification s'applique à une stack dont le fichier compose déclare un sous-réseau `ipam`." },
        ],
      },
      {
        title: "Rattacher un conteneur à un réseau",
        blocks: [
          { kind: "p", text: "Un conteneur peut appartenir à **plusieurs réseaux** à la fois et reçoit une interface et une adresse sur chacun. Rattachez-le soit depuis la **fiche du réseau** (**Connect a container** : choisissez le conteneur), soit depuis la **fiche du conteneur** (**Connect to network** : choisissez le réseau). Permissions `docker.network.connect` / `docker.network.disconnect` (operator et admin). L'équivalent en ligne de commande :" },
          { kind: "cmd", command: "docker network connect [--ip 10.20.0.10] [--alias api] <réseau> <conteneur>" },
          { kind: "p", text: "Options à la connexion :" },
          { kind: "list", items: [
            "**IP statique IPv4 / IPv6** — une adresse fixe pour ce conteneur sur ce réseau. Elle ne fonctionne que sur un **réseau user-defined avec un sous-réseau configuré** : Castor la refuse d'emblée sur le `bridge` par défaut (`static_ip_unsupported`), et Docker la refuse sur tout réseau sans sous-réseau IPAM. Une adresse déjà prise répond `ip_in_use` ; une adresse hors du sous-réseau est rejetée. Laissez le champ vide et Docker en attribue une libre.",
            "**Alias** — des noms DNS supplémentaires que les autres conteneurs de ce réseau résolvent vers celui-ci (`api`, `api-v1`…), en plus du nom du conteneur. Les alias sont propres à chaque réseau.",
          ] },
          { kind: "p", text: "**Disconnect** retire le conteneur de ce réseau uniquement ; ses autres réseaux sont intacts. Un conteneur déjà sur le réseau répond `already_connected` : déconnectez-le d'abord pour changer son adresse ou ses alias. **Force** efface aussi un rattachement fantôme que Docker conserve pour un conteneur disparu." },
          { kind: "callout", tone: "info", text: "Le **conteneur Castor lui-même** et les conteneurs marqués **protégés** ne sont jamais recâblés : connexion et déconnexion y sont refusées, exactement comme les autres actions destructives. La cible doit aussi être un conteneur que Castor connaît sur cet hôte (par id ou par nom), sinon `404`." },
          { kind: "note", text: "Connecter un conteneur **en cours d'exécution** prend effet immédiatement, sans redémarrage : la nouvelle interface apparaît à l'intérieur et les noms de ce réseau se résolvent aussitôt. Une application qui a résolu ses noms une fois au démarrage peut tout de même avoir besoin d'un redémarrage pour s'en apercevoir." },
        ],
      },
      {
        title: "Relier deux réseaux (« peering »)",
        blocks: [
          { kind: "callout", tone: "info", text: "Docker n'a **pas de peering** entre deux réseaux bridge : il n'existe ni route ni option pour que le réseau A atteigne le réseau B dans son ensemble — chaque bridge est isolé à dessein. Le mécanisme natif pour les relier est de **rattacher un conteneur aux deux réseaux** : il est alors joignable depuis chacun et peut jouer le rôle de passerelle, de proxy ou de pont entre eux." },
          { kind: "p", text: "Exemple typique — un reverse-proxy devant une application privée :" },
          { kind: "list", items: [
            "Créez deux réseaux : `frontend` (par où le trafic entre) et `backend` (marqué **internal**, sans internet).",
            "Déployez l'application (`app`) sur `backend` uniquement. Elle est invisible depuis `frontend` et depuis l'hôte.",
            "Déployez le reverse-proxy sur `frontend` **et** `backend`, et publiez son port `443`. Il joint l'application par son nom (`http://app:8080`) via `backend` et sert l'extérieur via `frontend`.",
            "Résultat : `app` ne touche jamais internet, et le proxy est le seul chemin entre les deux mondes.",
          ] },
          { kind: "p", text: "Le même schéma sert pour une base de données partagée par deux stacks (rattachez la base — ou mieux, un proxy — aux réseaux des deux stacks) ou pour un agent de supervision qui doit interroger des conteneurs sur plusieurs réseaux. Pour un conteneur déjà en marche, utilisez **Connect to network** afin de l'ajouter au second réseau : aucun redéploiement nécessaire." },
          { kind: "note", text: "Pour rejoindre un réseau **physique** plutôt qu'un autre réseau Docker — intégrer un conteneur au LAN du bureau, ou le rendre joignable par un pair VPN — utilisez **macvlan / ipvlan** (administrateurs uniquement, voir plus haut). Router deux sous-réseaux Docker au niveau IP exigerait d'activer le forwarding et des règles de pare-feu sur mesure sur l'hôte, hors du périmètre de Castor." },
        ],
      },
      {
        title: "Réseaux au déploiement",
        blocks: [
          { kind: "p", text: "**Depuis un modèle** (Marketplace) : le formulaire de déploiement permet de choisir les **réseaux** que le conteneur rejoint, chacun avec une **IP statique IPv4** et des **alias** facultatifs. Le premier réseau est le réseau principal du conteneur (sa passerelle par défaut) ; les autres sont connectés avant le démarrage. Laissez la liste vide pour rester sur le `bridge` par défaut. Les réseaux doivent déjà exister — créez-les d'abord dans la vue Réseaux." },
          { kind: "p", text: "**Dans une stack compose** : déclarez les réseaux au niveau racine et référencez-les par service. La forme liste (`networks: [backend]`) est un rattachement simple ; la forme mapping ajoute une adresse statique et des alias :" },
          { kind: "code", code: COMPOSE_NETWORKS_EXAMPLE },
          { kind: "p", text: "Ce que Castor en fait :" },
          { kind: "list", items: [
            "Un réseau déclaré est créé au déploiement avec ses `driver`, `internal`, `attachable`, `enable_ipv6`, `driver_opts` et ses pools `ipam` (`subnet`, `gateway`, `ip_range`, `aux_addresses`), nommé `<projet>_<clé>`, et supprimé avec la stack. Un réseau existant portant ce nom est **réutilisé tel quel** — ses réglages ne sont pas modifiés.",
            "`external: true` (avec `name:` pour son vrai nom) **rejoint** un réseau existant et ne le crée ni ne le supprime jamais. Le déploiement échoue avec un message clair s'il n'existe pas sur l'hôte.",
            "`ipv4_address` / `ipv6_address` exigent que le réseau déclare un sous-réseau `ipam` de la même famille — vérifié à la lecture du fichier, avant toute création (sur un réseau external, c'est Docker qui vérifie).",
            "Chaque service rejoint aussi le réseau projet par défaut de la stack avec son **nom de service** comme alias : `db`, `api`… se résolvent toujours à l'intérieur de la stack.",
            "Une stack qui déclare `macvlan` / `ipvlan` ou une option `parent` suit la même règle **réservée aux administrateurs** que le formulaire de création.",
          ] },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Créez **un réseau dédié par application ou par stack** plutôt que de tout entasser sur le `bridge` par défaut : l'isolation et le DNS par nom sont offerts.",
            "N'attribuez une **IP statique** qu'à ce qui en a vraiment besoin (un serveur DNS, un équipement que d'autres systèmes visent par adresse). Pour tout le reste, fiez-vous aux noms et aux alias — ils survivent à une recréation, pas les IP.",
            "Quand vous fixez un sous-réseau, réservez une **plage d'IP** pour l'allocation dynamique et gardez vos adresses statiques en dehors.",
            "Choisissez des plages privées qui **ne chevauchent pas** votre LAN, votre VPN ni les autres hôtes Docker que vous routez. Un conflit rend le LAN injoignable depuis les conteneurs — silencieusement.",
            "Marquez une couche de données **internal**, et placez un proxy sur deux réseaux plutôt que d'ouvrir la couche de données vers l'extérieur.",
            "N'utilisez le réseau **host** qu'avec parcimonie : aucune isolation, aucun mapping de ports, et des conflits de ports dès que deux conteneurs veulent le même port.",
            "**overlay** exige Swarm ; **macvlan / ipvlan** exigent un administrateur et une interface parente qui existe réellement sur l'hôte.",
          ] },
          { kind: "p", text: "Nettoyage : **Remove** (permission `docker.network.delete`, réservée au rôle **admin**) supprime un réseau et est refusé tant que des conteneurs y sont encore rattachés (`network_in_use`) — déconnectez-les d'abord. **Prune** (`docker.system.prune`, operator et admin) supprime en une passe tous les réseaux sans conteneur rattaché, après confirmation." },
          { kind: "cmd", command: "docker network rm <réseau>" },
          { kind: "cmd", command: "docker network prune" },
          { kind: "callout", tone: "warn", text: "Le prune n'est **pas sélectif** et ne peut pas être annulé : tout réseau personnalisé sans conteneur est supprimé, y compris ceux que vous gardiez pour plus tard. Les réseaux système (`bridge`, `host`, `none`) ne sont jamais touchés." },
          { kind: "doc", href: "https://docs.docker.com/engine/network/", label: "Réseaux Docker — documentation officielle" },
          { kind: "doc", href: "https://docs.docker.com/engine/network/drivers/macvlan/", label: "Driver macvlan — documentation officielle" },
        ],
      },
    ],
  },
};
