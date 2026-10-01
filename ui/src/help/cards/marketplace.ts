// Castor by IT Leonard
// ui/src/help/cards/marketplace.ts — Marketplace (1-click deploy) help card.
import type { HelpCard } from "../types";

export const marketplaceCard: HelpCard = {
  id: "marketplace",
  title: { en: "Marketplace", fr: "Marketplace" },

  en: {
    summary: "A catalogue of 50+ ready-to-deploy apps you launch in one click, tuning ports, environment variables and volumes before the container is created.",
    sections: [
      {
        title: "What it's for",
        blocks: [
          { kind: "p", text: "The **Marketplace** is a curated catalogue of **50+ ready-to-run applications** — Postgres, Redis, Nginx, Grafana and many more — each shown with its official logo. Instead of hand-writing a `docker run` command or a Compose file, you pick an app, review a short form, and let Castor create the container for you." },
          { kind: "p", text: "Use the search box to find an app by name, or filter by **category** (databases, web servers, monitoring, and so on) to narrow the list." },
        ],
      },
      {
        title: "What a 1-click deploy does",
        blocks: [
          { kind: "p", text: "Clicking **Deploy** on a card opens a dialog pre-filled from the template. You review and adjust three things before creating the container:" },
          { kind: "list", items: [
            "**Ports** — the host ports to publish, so the app is reachable without clashing with something already running.",
            "**Environment variables** — configuration values. Some are **required** (for example a database password) and are clearly marked; others are optional with sensible defaults.",
            "**Volumes** — where persistent data lives, so it survives a container restart or recreate.",
          ] },
          { kind: "p", text: "When you confirm, Castor pulls the image if needed and creates the container with exactly those settings. It then appears in your normal Containers view like any other workload." },
          { kind: "callout", tone: "info", text: "A 1-click deploy is not magic under the hood — it produces a standard Docker container. You can inspect, log, stop, restart or remove it afterwards exactly like a container you created by hand." },
        ],
      },
      {
        title: "Custom templates & your own catalogue",
        blocks: [
          { kind: "p", text: "Beyond the built-in apps, you can grow the Marketplace two ways:" },
          { kind: "list", items: [
            "**Custom templates** (admin) — define your own reusable app template, with its image, default ports, variables and volumes, so your team deploys it in one click too.",
            "**Remote catalogues** — in the **Catalogs** view, add the URL of an external JSON catalogue. Its templates are merged into the Marketplace alongside the built-in ones.",
          ] },
          { kind: "note", text: "A remote catalogue is just an HTTP(S) URL returning a JSON list of templates. Point Castor at a URL you trust — its entries become deployable cards for everyone." },
        ],
      },
      {
        title: "Private registries",
        blocks: [
          { kind: "p", text: "If a template pulls from a **private registry**, first configure the credentials in the **Registries** view. Castor uses those stored, sealed credentials to authenticate the pull — you don't retype a password at deploy time." },
        ],
      },
      {
        title: "Permissions & pitfalls",
        blocks: [
          { kind: "list", items: [
            "Deploying requires the **`docker.container.create`** permission — a **viewer** cannot deploy; ask an operator or admin.",
            "Always fill in the **required** variables (the marked ones): if a required value like a DB password is left blank, the container creation **fails**.",
            "Pick **host ports that are free** — a port already in use will make the deploy fail.",
            "Map a **volume** for any app that stores data (databases especially), otherwise its data is lost when the container is recreated.",
            "If mutations require 2FA in your setup, you'll be asked to confirm with your TOTP code before the container is created.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://github.com/Yannleonard/Castor", label: "Castor — project repository & documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Un catalogue de 50+ applications prêtes à déployer que vous lancez en un clic, en ajustant ports, variables d'environnement et volumes avant la création du conteneur.",
    sections: [
      {
        title: "À quoi ça sert",
        blocks: [
          { kind: "p", text: "Le **Marketplace** est un catalogue de **50+ applications prêtes à l'emploi** — Postgres, Redis, Nginx, Grafana et bien d'autres — chacune affichée avec son logo officiel. Plutôt que d'écrire à la main une commande `docker run` ou un fichier Compose, vous choisissez une app, relisez un court formulaire, et laissez Castor créer le conteneur pour vous." },
          { kind: "p", text: "Utilisez le champ de recherche pour trouver une app par son nom, ou filtrez par **catégorie** (bases de données, serveurs web, monitoring, etc.) pour affiner la liste." },
        ],
      },
      {
        title: "Ce que fait un déploiement 1-clic",
        blocks: [
          { kind: "p", text: "Cliquer sur **Déployer** sur une carte ouvre une fenêtre pré-remplie à partir du template. Vous relisez et ajustez trois choses avant de créer le conteneur :" },
          { kind: "list", items: [
            "**Ports** — les ports de l'hôte à publier, pour que l'app soit accessible sans entrer en conflit avec un service déjà lancé.",
            "**Variables d'environnement** — les valeurs de configuration. Certaines sont **requises** (par exemple un mot de passe de base de données) et sont clairement signalées ; d'autres sont optionnelles avec des valeurs par défaut raisonnables.",
            "**Volumes** — où sont stockées les données persistantes, pour qu'elles survivent à un redémarrage ou une recréation du conteneur.",
          ] },
          { kind: "p", text: "Une fois validé, Castor télécharge l'image si besoin et crée le conteneur avec exactement ces réglages. Il apparaît ensuite dans votre vue Conteneurs habituelle, comme n'importe quelle autre charge de travail." },
          { kind: "callout", tone: "info", text: "Un déploiement 1-clic n'a rien de magique en coulisses : il produit un conteneur Docker standard. Vous pouvez ensuite l'inspecter, consulter ses logs, l'arrêter, le redémarrer ou le supprimer exactement comme un conteneur créé à la main." },
        ],
      },
      {
        title: "Templates custom & votre propre catalogue",
        blocks: [
          { kind: "p", text: "Au-delà des apps intégrées, vous pouvez enrichir le Marketplace de deux façons :" },
          { kind: "list", items: [
            "**Templates custom** (admin) — définissez votre propre template d'app réutilisable, avec son image, ses ports par défaut, ses variables et ses volumes, pour que votre équipe le déploie aussi en un clic.",
            "**Catalogues distants** — dans la vue **Catalogs**, ajoutez l'URL d'un catalogue JSON externe. Ses templates viennent s'ajouter au Marketplace, aux côtés des templates intégrés.",
          ] },
          { kind: "note", text: "Un catalogue distant est simplement une URL HTTP(S) renvoyant une liste JSON de templates. Pointez Castor vers une URL de confiance : ses entrées deviennent des cartes déployables pour tout le monde." },
        ],
      },
      {
        title: "Registres privés",
        blocks: [
          { kind: "p", text: "Si un template tire son image depuis un **registre privé**, configurez d'abord les identifiants dans la vue **Registres**. Castor utilise ces identifiants stockés et scellés pour s'authentifier lors du pull — vous n'avez pas à retaper de mot de passe au moment du déploiement." },
        ],
      },
      {
        title: "Permissions & pièges",
        blocks: [
          { kind: "list", items: [
            "Déployer requiert la permission **`docker.container.create`** — un **viewer** ne peut pas déployer ; demandez à un operator ou un admin.",
            "Renseignez toujours les variables **requises** (celles signalées) : si une valeur requise comme un mot de passe de DB reste vide, la création du conteneur **échoue**.",
            "Choisissez des **ports d'hôte libres** — un port déjà utilisé fera échouer le déploiement.",
            "Mappez un **volume** pour toute app qui stocke des données (les bases de données surtout), sinon ses données sont perdues à la recréation du conteneur.",
            "Si votre configuration exige la 2FA pour les mutations, un code TOTP vous sera demandé avant la création du conteneur.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://github.com/Yannleonard/Castor", label: "Castor — dépôt du projet & documentation" },
        ],
      },
    ],
  },
};
