// ui/src/help/cards/images.ts — Docker images (list / pull / prune / delete) help card.
import type { HelpCard } from "../types";

export const imagesCard: HelpCard = {
  id: "images",
  title: { en: "Images", fr: "Images" },

  en: {
    summary: "Browse the images available on the host, pull new ones (including from private registries), and reclaim disk space by removing unused layers.",
    sections: [
      {
        title: "What this view is for",
        blocks: [
          { kind: "p", text: "An **image** is the read-only template a container is created from (a base OS layer plus your app and its dependencies). The Images page lists every image already present on the Docker host, lets you **pull** new ones from a registry, and lets you **remove** the ones you no longer need to free up disk space." },
          { kind: "note", text: "Images are pulled once and cached on the host: several containers can share the same image without re-downloading it." },
        ],
      },
      {
        title: "Reading the image list",
        blocks: [
          { kind: "p", text: "Each row shows the image **repository:tag** (e.g. `nginx:1.27`), its short **image ID**, its **size** on disk, and its **creation date**. An image with no tag appears as `<none>` — these are usually leftover intermediate or superseded layers ('dangling' images) and are the first things a prune reclaims." },
          { kind: "p", text: "Listing works with the socket mounted read-only (`:ro`); it needs the `docker.image.list` permission, granted to **viewers, operators and admins**." },
        ],
      },
      {
        title: "Pulling an image (Pull)",
        blocks: [
          { kind: "p", text: "Click **Pull**, then type a valid image reference — repository plus tag, for example `nginx:1.27` or `ghcr.io/org/app:1.4.0`. If you omit the tag, Docker assumes `:latest`, which is discouraged in production (see below). Castor streams the download **progress live through the event feed**, layer by layer, so you can watch it complete without leaving the page." },
          { kind: "callout", tone: "info", text: "To pull from a **private registry**, first add its credentials in the **Registries** view (Marketplace). Once the registry is authenticated there, Pull can fetch private references such as `ghcr.io/your-org/private-app:tag` transparently — no need to paste a token here." },
          { kind: "p", text: "Pulling is a mutation, so it requires the `docker.image.pull` permission (**operator** or **admin**). If '2FA required for mutations' is enabled, you will be asked for your TOTP code first." },
        ],
      },
      {
        title: "Removing an image & pruning",
        blocks: [
          { kind: "p", text: "**Delete** removes a single image; it needs the `docker.image.delete` permission, which is **often restricted to admins**. If the image is still in use by a container, the deletion is refused — tick **force** to remove it anyway (any stopped container still referencing it will lose its base image)." },
          { kind: "p", text: "**Prune** is a bulk cleanup: it reclaims disk space by deleting **unused** images in one go. By default it targets only dangling `<none>` layers; the aggressive variant also removes any image not currently used by a container. It never touches an image that a running or stopped container depends on." },
          { kind: "callout", tone: "warn", text: "Prune is irreversible and repository-wide — a removed image must be re-pulled. Run it during a maintenance window, and be aware that pruning 'all unused' images can delete tags you were keeping for a future rollback." },
        ],
      },
      {
        title: "Pitfalls & good practices",
        blocks: [
          { kind: "list", items: [
            "**Pin your tags** in production (`nginx:1.27`, `ghcr.io/org/app:1.4.0`) — avoid `:latest`, which silently drifts and makes deployments non-reproducible.",
            "Prefer an **immutable digest** (`image@sha256:…`) when you need a byte-for-byte guarantee.",
            "Configure private-registry credentials in **Registries (Marketplace)** *before* the first private pull, not during an incident.",
            "Use **force delete** deliberately: it can pull the base image out from under a stopped container.",
            "**Prune regularly** to keep disk usage down, but never blindly on a host where old tags are your rollback path.",
            "Building, tagging and pushing images **locally is not part of Castor V1** — build in your CI pipeline and push to a registry, then Pull here.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/engine/manage-resources/pruning/", label: "Docker — pruning unused objects (images)" },
        ],
      },
    ],
  },

  fr: {
    summary: "Parcourez les images présentes sur l'hôte, tirez-en de nouvelles (y compris depuis des registres privés) et récupérez de l'espace disque en supprimant les couches inutilisées.",
    sections: [
      {
        title: "À quoi sert cette vue",
        blocks: [
          { kind: "p", text: "Une **image** est le modèle en lecture seule à partir duquel un conteneur est créé (une couche de base OS, plus votre application et ses dépendances). La page Images liste toutes les images déjà présentes sur l'hôte Docker, permet d'en **tirer** de nouvelles depuis un registre, et de **supprimer** celles dont vous n'avez plus besoin pour libérer de l'espace disque." },
          { kind: "note", text: "Une image n'est tirée qu'une fois puis mise en cache sur l'hôte : plusieurs conteneurs peuvent partager la même image sans la retélécharger." },
        ],
      },
      {
        title: "Lire la liste des images",
        blocks: [
          { kind: "p", text: "Chaque ligne affiche le **dépôt:tag** de l'image (ex. `nginx:1.27`), son **ID** court, sa **taille** sur disque et sa **date de création**. Une image sans tag apparaît comme `<none>` — ce sont généralement des couches intermédiaires ou remplacées (images « dangling »), et ce sont les premières que le prune récupère." },
          { kind: "p", text: "Le listage fonctionne avec le socket monté en lecture seule (`:ro`) ; il requiert la permission `docker.image.list`, accordée aux **viewers, operators et admins**." },
        ],
      },
      {
        title: "Tirer une image (Pull)",
        blocks: [
          { kind: "p", text: "Cliquez sur **Pull**, puis saisissez une référence d'image valide — dépôt et tag, par exemple `nginx:1.27` ou `ghcr.io/org/app:1.4.0`. Si vous omettez le tag, Docker suppose `:latest`, ce qui est déconseillé en production (voir plus bas). Castor diffuse la **progression du téléchargement en direct via le flux d'événements**, couche par couche, pour la suivre jusqu'au bout sans quitter la page." },
          { kind: "callout", tone: "info", text: "Pour tirer depuis un **registre privé**, ajoutez d'abord ses identifiants dans la vue **Registres** (Marketplace). Une fois le registre authentifié là-bas, Pull peut récupérer de façon transparente des références privées comme `ghcr.io/votre-org/app-privee:tag` — inutile de coller un token ici." },
          { kind: "p", text: "Le pull est une mutation : il requiert la permission `docker.image.pull` (**operator** ou **admin**). Si « 2FA requise pour les mutations » est activée, votre code TOTP vous sera demandé au préalable." },
        ],
      },
      {
        title: "Supprimer une image & prune",
        blocks: [
          { kind: "p", text: "**Delete** supprime une image ; cela requiert la permission `docker.image.delete`, **souvent réservée aux admins**. Si l'image est encore utilisée par un conteneur, la suppression est refusée — cochez **force** pour la retirer malgré tout (tout conteneur arrêté qui la référence encore perdra son image de base)." },
          { kind: "p", text: "**Prune** est un nettoyage groupé : il récupère de l'espace disque en supprimant d'un coup les images **inutilisées**. Par défaut, il ne vise que les couches `<none>` (dangling) ; la variante agressive supprime aussi toute image non utilisée par un conteneur. Il ne touche jamais à une image dont dépend un conteneur en cours ou arrêté." },
          { kind: "callout", tone: "warn", text: "Le prune est irréversible et s'applique à tout le dépôt — une image supprimée devra être re-tirée. Lancez-le pendant une fenêtre de maintenance, et gardez à l'esprit que purger « toutes les images inutilisées » peut effacer des tags que vous conserviez pour un rollback futur." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "**Épinglez vos tags** en production (`nginx:1.27`, `ghcr.io/org/app:1.4.0`) — évitez `:latest`, qui dérive silencieusement et rend les déploiements non reproductibles.",
            "Préférez un **digest immuable** (`image@sha256:…`) quand vous voulez une garantie octet par octet.",
            "Configurez les identifiants de registre privé dans **Registres (Marketplace)** *avant* le premier pull privé, pas en plein incident.",
            "Utilisez **force delete** à bon escient : cela peut retirer l'image de base sous un conteneur arrêté.",
            "**Prunez régulièrement** pour maîtriser l'espace disque, mais jamais à l'aveugle sur un hôte où d'anciens tags sont votre chemin de rollback.",
            "La construction, le tag et le push d'images **localement ne font pas partie de Castor V1** — construisez dans votre pipeline CI et poussez vers un registre, puis faites un Pull ici.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/engine/manage-resources/pruning/", label: "Docker — purger les objets inutilisés (images)" },
        ],
      },
    ],
  },
};
