// Castor by IT Leonard
// ui/src/help/cards/registries.ts — Image registries & remote catalogs help card.
import type { HelpCard } from "../types";

export const registriesCard: HelpCard = {
  id: "registries",
  title: { en: "Image registries & catalogs", fr: "Registres d'images & catalogues" },

  en: {
    summary: "Store credentials to pull images from private registries (GHCR, ECR, GitLab…), and add remote catalogs to enrich the template marketplace.",
    sections: [
      {
        title: "Two different things",
        blocks: [
          { kind: "p", text: "This page holds **two distinct settings** that are easy to confuse:" },
          { kind: "list", items: [
            "**Image registries** — credentials Castor uses to **pull images** from a private registry (private Docker Hub, GHCR, Amazon ECR, GitLab Container Registry…). Without them, pulling a private image fails with an authentication error.",
            "**Remote catalogs** — URLs pointing to external **lists of templates** that extend the marketplace, so your team sees curated one-click apps beyond the built-ins.",
          ] },
          { kind: "callout", tone: "info", text: "Both are **admin-only** and require the `marketplace.registry.*` permission." },
        ],
      },
      {
        title: "Adding a private registry",
        blocks: [
          { kind: "p", text: "Click **Add registry** and fill in four fields:" },
          { kind: "list", items: [
            "**Name** — a label for you (e.g. `GHCR prod`). Purely cosmetic.",
            "**Registry URL** — the registry host, without a scheme. Examples below.",
            "**Username** — the account used to authenticate.",
            "**Password / token** — the secret. It is **encrypted at rest (AES-256-GCM)** and never shown again.",
          ] },
          { kind: "p", text: "Typical **Registry URL** values:" },
          { kind: "code", code: "ghcr.io                                # GitHub Container Registry\nregistry.gitlab.com                    # GitLab Container Registry\n<account-id>.dkr.ecr.<region>.amazonaws.com   # Amazon ECR\nregistry-1.docker.io                   # Docker Hub (private repos)" },
          { kind: "note", text: "Enter the **host only** — no `https://`, no image path, no tag. Castor prepends this host when it pulls." },
        ],
      },
      {
        title: "How the secret is handled",
        blocks: [
          { kind: "p", text: "Once saved, the password field shows a **'•••• set'** pill instead of the value — the secret is sealed and cannot be read back, even by admins. To **keep** the existing secret when editing, leave the field **empty**; type a new value only to **replace** it." },
          { kind: "p", text: "Use the **Test** button to have Castor attempt a real connection to the registry with the stored credentials. A green result confirms the URL, username and secret are valid before you rely on them for a deployment." },
        ],
      },
      {
        title: "GHCR & ECR specifics",
        blocks: [
          { kind: "list", items: [
            "**GHCR (`ghcr.io`)** — **Username** = your GitHub account, **Password** = a **Personal Access Token** scoped with `read:packages` (not your GitHub password).",
            "**Amazon ECR** — credentials are **temporary**: the ECR login token **expires** (typically after 12 h). A static username/password will stop working. Prefer a refresh mechanism (IAM-based, or re-run `aws ecr get-login-password` on a schedule) rather than pasting a one-off token here.",
          ] },
          { kind: "callout", tone: "warn", text: "A registry Test that suddenly fails after working is often an **expired ECR token** — regenerate it and update the secret." },
        ],
      },
      {
        title: "Remote catalogs",
        blocks: [
          { kind: "p", text: "A catalog is a **JSON URL** exposing a list of templates in **Castor's format** (or a compatible one). Add its URL, and the templates appear in the marketplace alongside the built-in ones." },
          { kind: "p", text: "The **Refresh** button re-fetches the JSON so new or updated templates show up. Point catalogs only at **sources you trust** — a template can prescribe images, ports and environment for one-click deploys." },
        ],
      },
      {
        title: "Pitfalls & good practices",
        blocks: [
          { kind: "list", items: [
            "Only **admins** can view or edit registries and catalogs — this is intentional, since a registry secret grants pull access to private images.",
            "Prefer **scoped tokens** (read-only, `read:packages`) over full-access credentials or account passwords.",
            "If a private pull fails, **Test** the registry first — a stale secret or wrong host is the usual cause.",
            "For **ECR**, plan for token rotation; don't treat the pasted token as permanent.",
            "Catalog URLs must return valid **JSON**; a 404 or HTML page will make Refresh fail.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/login/", label: "docker login — registry authentication (Docker docs)" },
        ],
      },
    ],
  },

  fr: {
    summary: "Enregistrez les identifiants pour tirer des images depuis des registres privés (GHCR, ECR, GitLab…) et ajoutez des catalogues distants pour enrichir le marketplace de templates.",
    sections: [
      {
        title: "Deux notions distinctes",
        blocks: [
          { kind: "p", text: "Cette page regroupe **deux réglages distincts** qu'on confond facilement :" },
          { kind: "list", items: [
            "**Registres d'images** — les identifiants que Castor utilise pour **tirer des images** depuis un registre privé (Docker Hub privé, GHCR, Amazon ECR, GitLab Container Registry…). Sans eux, tirer une image privée échoue avec une erreur d'authentification.",
            "**Catalogues distants** — des URLs pointant vers des **listes de templates** externes qui étendent le marketplace, pour que votre équipe voie des applications en un clic au-delà de celles intégrées.",
          ] },
          { kind: "callout", tone: "info", text: "Les deux sont **réservés aux admins** et requièrent la permission `marketplace.registry.*`." },
        ],
      },
      {
        title: "Ajouter un registre privé",
        blocks: [
          { kind: "p", text: "Cliquez sur **Ajouter un registre** et renseignez quatre champs :" },
          { kind: "list", items: [
            "**Nom** — un libellé pour vous (ex. `GHCR prod`). Purement cosmétique.",
            "**URL du registre** — l'hôte du registre, sans schéma. Exemples ci-dessous.",
            "**Username** — le compte utilisé pour s'authentifier.",
            "**Password / token** — le secret. Il est **chiffré au repos (AES-256-GCM)** et jamais réaffiché.",
          ] },
          { kind: "p", text: "Valeurs typiques d'**URL du registre** :" },
          { kind: "code", code: "ghcr.io                                # GitHub Container Registry\nregistry.gitlab.com                    # GitLab Container Registry\n<id-compte>.dkr.ecr.<region>.amazonaws.com   # Amazon ECR\nregistry-1.docker.io                   # Docker Hub (dépôts privés)" },
          { kind: "note", text: "Saisissez **l'hôte seul** — pas de `https://`, pas de chemin d'image, pas de tag. Castor préfixe cet hôte lors du pull." },
        ],
      },
      {
        title: "Comment le secret est géré",
        blocks: [
          { kind: "p", text: "Une fois enregistré, le champ mot de passe affiche une pastille **'•••• défini'** au lieu de la valeur — le secret est scellé et ne peut plus être relu, même par un admin. Pour **conserver** le secret existant lors d'une modification, laissez le champ **vide** ; saisissez une nouvelle valeur uniquement pour le **remplacer**." },
          { kind: "p", text: "Le bouton **Test** demande à Castor de tenter une vraie connexion au registre avec les identifiants stockés. Un résultat vert confirme que l'URL, le username et le secret sont valides avant de vous y fier pour un déploiement." },
        ],
      },
      {
        title: "Spécificités GHCR & ECR",
        blocks: [
          { kind: "list", items: [
            "**GHCR (`ghcr.io`)** — **Username** = votre compte GitHub, **Password** = un **Personal Access Token** avec le scope `read:packages` (pas votre mot de passe GitHub).",
            "**Amazon ECR** — les identifiants sont **temporaires** : le token de connexion ECR **expire** (typiquement après 12 h). Un couple username/password statique cessera de fonctionner. Préférez un mécanisme de refresh (basé IAM, ou relancer `aws ecr get-login-password` régulièrement) plutôt que de coller ici un token éphémère.",
          ] },
          { kind: "callout", tone: "warn", text: "Un Test de registre qui échoue soudainement après avoir marché est souvent un **token ECR expiré** — régénérez-le et mettez à jour le secret." },
        ],
      },
      {
        title: "Catalogues distants",
        blocks: [
          { kind: "p", text: "Un catalogue est une **URL JSON** exposant une liste de templates au **format Castor** (ou compatible). Ajoutez son URL, et les templates apparaissent dans le marketplace aux côtés de ceux intégrés." },
          { kind: "p", text: "Le bouton **Refresh** re-télécharge le JSON pour faire apparaître les templates nouveaux ou mis à jour. Ne pointez que vers des **sources de confiance** — un template peut prescrire images, ports et variables d'environnement pour un déploiement en un clic." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Seuls les **admins** peuvent voir ou modifier les registres et catalogues — c'est voulu, car un secret de registre donne accès en lecture aux images privées.",
            "Préférez des **tokens à scope restreint** (lecture seule, `read:packages`) aux identifiants pleins pouvoirs ou aux mots de passe de compte.",
            "Si un pull privé échoue, **Testez** d'abord le registre — un secret périmé ou un mauvais hôte en est la cause habituelle.",
            "Pour **ECR**, prévoyez la rotation du token ; ne considérez pas le token collé comme permanent.",
            "Les URLs de catalogue doivent renvoyer du **JSON** valide ; un 404 ou une page HTML fera échouer le Refresh.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/reference/cli/docker/login/", label: "docker login — authentification aux registres (doc Docker)" },
        ],
      },
    ],
  },
};
