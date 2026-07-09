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
        title: "Removing an image (Delete)",
        blocks: [
          { kind: "p", text: "The **trash icon** at the end of a row deletes that image after a **confirmation dialog**; it needs the `docker.image.delete` permission, reserved for **admins**. If the image is still in use by a container, the deletion is refused — remove that container first." },
        ],
      },
      {
        title: "Pruning unused images (Prune)",
        blocks: [
          { kind: "p", text: "**Prune**, in the page header next to **Pull image**, is a bulk cleanup that reclaims disk space in one go. It requires the `docker.system.prune` permission, granted to **operators and admins**, and **always opens a confirmation dialog** — nothing is deleted until you confirm." },
          { kind: "p", text: "By default the prune removes only **dangling** images — the untagged `<none>` layers no tag references anymore — which frees space without touching images you may still run. Tick **'Also remove all unused images (not just dangling)'** for an aggressive cleanup that also deletes every image not currently used by a container. The box is unticked each time the dialog opens, so the aggressive mode is always an explicit choice." },
          { kind: "p", text: "When the prune completes, a notification shows **how many images were removed and how much disk space was reclaimed**, and the list refreshes automatically." },
          { kind: "callout", tone: "warn", text: "Prune is irreversible and host-wide — a removed image must be re-pulled. Run it during a maintenance window, and be aware that pruning 'all unused' images can delete tags you were keeping for a future rollback." },
        ],
      },
      {
        title: "Pitfalls & good practices",
        blocks: [
          { kind: "list", items: [
            "**Pin your tags** in production (`nginx:1.27`, `ghcr.io/org/app:1.4.0`) — avoid `:latest`, which silently drifts and makes deployments non-reproducible.",
            "Prefer an **immutable digest** (`image@sha256:…`) when you need a byte-for-byte guarantee.",
            "Configure private-registry credentials in **Registries (Marketplace)** *before* the first private pull, not during an incident.",
            "Deleting from the UI never forces: an image still used by a container is refused — remove the container first (a **force** removal only exists at the API level).",
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
        title: "Supprimer une image (Delete)",
        blocks: [
          { kind: "p", text: "L'**icône corbeille** en bout de ligne supprime cette image après une **boîte de confirmation** ; cela requiert la permission `docker.image.delete`, réservée aux **admins**. Si l'image est encore utilisée par un conteneur, la suppression est refusée — supprimez d'abord ce conteneur." },
        ],
      },
      {
        title: "Purger les images inutilisées (Prune)",
        blocks: [
          { kind: "p", text: "**Prune**, dans l'en-tête de la page à côté de **Pull image**, est un nettoyage groupé qui récupère de l'espace disque en une fois. Il requiert la permission `docker.system.prune`, accordée aux **operators et admins**, et **ouvre toujours une boîte de confirmation** — rien n'est supprimé tant que vous n'avez pas confirmé." },
          { kind: "p", text: "Par défaut, le prune ne supprime que les images **dangling** — les couches `<none>` sans tag, que plus aucun tag ne référence — ce qui libère de l'espace sans toucher aux images que vous exécutez peut-être encore. Cochez **« Also remove all unused images (not just dangling) »** pour un nettoyage agressif qui supprime aussi toute image non utilisée par un conteneur. La case est décochée à chaque ouverture de la boîte : le mode agressif reste un choix explicite." },
          { kind: "p", text: "Une fois le prune terminé, une notification indique **combien d'images ont été supprimées et combien d'espace disque a été récupéré**, puis la liste se rafraîchit automatiquement." },
          { kind: "callout", tone: "warn", text: "Le prune est irréversible et s'applique à tout l'hôte — une image supprimée devra être re-tirée. Lancez-le pendant une fenêtre de maintenance, et gardez à l'esprit que purger « toutes les images inutilisées » peut effacer des tags que vous conserviez pour un rollback futur." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "**Épinglez vos tags** en production (`nginx:1.27`, `ghcr.io/org/app:1.4.0`) — évitez `:latest`, qui dérive silencieusement et rend les déploiements non reproductibles.",
            "Préférez un **digest immuable** (`image@sha256:…`) quand vous voulez une garantie octet par octet.",
            "Configurez les identifiants de registre privé dans **Registres (Marketplace)** *avant* le premier pull privé, pas en plein incident.",
            "La suppression depuis l'interface ne force jamais : une image encore utilisée par un conteneur est refusée — supprimez d'abord le conteneur (le retrait **force** n'existe qu'au niveau de l'API).",
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
