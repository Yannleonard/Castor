// ui/src/i18n/locales/mktDeployTemplate.ts
//
// Locale dictionary for the marketplace one-click deploy modal
// (ui/src/views/marketplace/DeployTemplateModal.tsx). Follows the audit.ts model:
// one dictionary per view, camelCase keys namespaced by UI zone (title.*, form.*,
// section.*, hint.*, banner.*, action.*, tooltip.*, toast.*). Interpolations use
// {token}. Technical identifiers rendered verbatim from data (paths, image, slug,
// HTTP status literals, docker.sock, KEY/TOKEN/SECRET/PASSWORD) are NOT translated.

import { defineDict } from "../core";

export const mktDeployTemplateDict = defineDict({
  en: {
    // Modal title
    "title.deploy": "Deploy {name}",

    // Footer actions
    "action.cancel": "Cancel",
    "action.deploy": "Deploy",

    // Submit-disabled tooltips
    "tooltip.invalidName": "Invalid container name",
    "tooltip.fillRequired": "Fill required: {fields}",
    "tooltip.removeProtected": "Remove the protected host path mount to deploy",
    "tooltip.needAdmin": "Host path mounts require an administrator",
    "tooltip.tickAllow": "Tick “Allow host path mounts” to deploy with a host bind",

    // Container name field
    "form.nameLabel": "Container name",
    "form.nameError": "Use letters, digits, and _ . - (must start alphanumeric).",
    "form.nameHint": "Leave blank to let Docker assign a random name.",

    // Section labels
    "section.ports": "Port mappings",
    "section.env": "Environment",
    "section.volumes": "Volumes",
    "section.resources": "Resources",

    // Section hints / errors
    "hint.ports": "host : container — leave host blank to publish on a random port.",
    "hint.envMasked": "Values for KEY/TOKEN/SECRET/PASSWORD names are masked.",
    "form.envRequiredError": "Required variables need a value: {fields}.",
    "hint.volumes":
      "Source is a named volume (auto-created) or an absolute host path; target is the in-container path.",

    // Blocked host-bind banner
    "banner.protectedTitle": "Protected host path.",
    "banner.protectedBefore": "Mounting",
    "banner.protectedAfter":
      "is never allowed — it would grant the container control of the host. Remove it to deploy.",

    // Non-admin host-bind banner
    "banner.nonAdminBefore": "This deploy uses a host path mount (",
    "banner.nonAdminMiddle":
      "). Host binds are root-equivalent, so only an administrator may use them — the server will reject this with a",
    "banner.nonAdminAfter": ". Use a named volume instead.",

    // Admin opt-in card
    "banner.adminTitle": "Host path mount detected",
    "banner.adminBody":
      "Binding a host path ({paths}) gives the container access to the host filesystem. As an administrator you may opt in; protected paths (docker.sock, /, /etc, …) stay blocked regardless.",
    "banner.adminCheckbox": "Allow host path mounts for this deploy",

    // Toasts
    "toast.deployingTitle": "Deploying",
    "toast.deployingBody": "{name} is starting from {image}.",
    "toast.failedTitle": "Deploy failed",
  },
  fr: {
    // Titre de la fenêtre
    "title.deploy": "Déployer {name}",

    // Actions du pied de page
    "action.cancel": "Annuler",
    "action.deploy": "Déployer",

    // Infobulles de bouton désactivé
    "tooltip.invalidName": "Nom de conteneur invalide",
    "tooltip.fillRequired": "Renseignez les champs requis : {fields}",
    "tooltip.removeProtected": "Retirez le montage de chemin hôte protégé pour déployer",
    "tooltip.needAdmin": "Les montages de chemin hôte nécessitent un administrateur",
    "tooltip.tickAllow": "Cochez « Autoriser les montages de chemin hôte » pour déployer avec un bind hôte",

    // Champ nom du conteneur
    "form.nameLabel": "Nom du conteneur",
    "form.nameError": "Utilisez lettres, chiffres et _ . - (doit commencer par un alphanumérique).",
    "form.nameHint": "Laissez vide pour que Docker attribue un nom aléatoire.",

    // Libellés de section
    "section.ports": "Mappages de ports",
    "section.env": "Environnement",
    "section.volumes": "Volumes",
    "section.resources": "Ressources",

    // Indications / erreurs de section
    "hint.ports": "hôte : conteneur — laissez l'hôte vide pour publier sur un port aléatoire.",
    "hint.envMasked": "Les valeurs des noms KEY/TOKEN/SECRET/PASSWORD sont masquées.",
    "form.envRequiredError": "Les variables requises ont besoin d'une valeur : {fields}.",
    "hint.volumes":
      "La source est un volume nommé (créé automatiquement) ou un chemin hôte absolu ; la cible est le chemin dans le conteneur.",

    // Bannière de bind hôte bloqué
    "banner.protectedTitle": "Chemin hôte protégé.",
    "banner.protectedBefore": "Monter",
    "banner.protectedAfter":
      "n'est jamais autorisé — cela donnerait au conteneur le contrôle de l'hôte. Retirez-le pour déployer.",

    // Bannière de bind hôte (non-administrateur)
    "banner.nonAdminBefore": "Ce déploiement utilise un montage de chemin hôte (",
    "banner.nonAdminMiddle":
      "). Les binds hôte sont équivalents à root, donc seul un administrateur peut les utiliser — le serveur rejettera cette requête avec un",
    "banner.nonAdminAfter": ". Utilisez plutôt un volume nommé.",

    // Carte d'opt-in administrateur
    "banner.adminTitle": "Montage de chemin hôte détecté",
    "banner.adminBody":
      "Lier un chemin hôte ({paths}) donne au conteneur l'accès au système de fichiers de l'hôte. En tant qu'administrateur vous pouvez l'autoriser ; les chemins protégés (docker.sock, /, /etc, …) restent bloqués quoi qu'il arrive.",
    "banner.adminCheckbox": "Autoriser les montages de chemin hôte pour ce déploiement",

    // Toasts
    "toast.deployingTitle": "Déploiement",
    "toast.deployingBody": "{name} démarre à partir de {image}.",
    "toast.failedTitle": "Échec du déploiement",
  },
});
