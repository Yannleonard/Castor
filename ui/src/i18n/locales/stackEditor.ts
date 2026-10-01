// Castor by IT Leonard
// ui/src/i18n/locales/stackEditor.ts
//
// Locale dictionary for the compose Stack editor view (ui/src/views/StackEditor.tsx),
// including its co-located subcomponents (GitSection, GitStackPanel, StackDiffView,
// WebhookSecretModal, ValidationSummary, BuilderForm, ServiceCard).
//
// Key zones (camelCase, namespaced):
//   header.*    page header (title/subtitle) + back action
//   tab.*       YAML / Builder tab labels
//   form.*      stack name + compose document fields, placeholders, hints
//   action.*    Validate / Deploy / Generate buttons + their tooltips
//   git.*       GitOps create-mode section (fields, hints) + view-mode panel
//   diff.*      compose diff rendering
//   webhook.*   one-time webhook-secret reveal modal
//   validation.* validation summary panel + table headers
//   bind.*      host-bind security warnings
//   containers.* view-mode live containers table
//   builder.*   builder form + service card labels
//   toast.*     toast titles + bodies (support {vars} interpolation)
//
// DO NOT translate technical identifiers rendered verbatim: permission strings
// (docker.container.create), header names (X-Castor-Token), URL/path examples,
// compose YAML samples, product names (Docker, Git, GitHub, GitLab, Castor).

import { defineDict } from "../core";

export const stackEditorDict = defineDict({
  en: {
    // Page header
    "header.stack": "Stack",
    "header.deploy": "Deploy stack",
    "header.subtitle": "Define a compose document, validate it, then deploy.",
    "header.back": "Back to stacks",

    // Tabs
    "tab.yaml": "YAML",
    "tab.builder": "Builder",

    // Stack name + compose document
    "form.nameLabel": "Stack name",
    "form.namePlaceholder": "my-app",
    "form.nameError": "Letters, digits, space, dot, dash, underscore (max 63).",
    "form.nameHint": "Used to derive the compose project name.",
    "form.composeLabel": "Compose document",
    "form.composeReadonlyGit": "Tracked from Git — sync to redeploy.",
    "form.composeReadonly": "Read-only — deploy from a new stack.",
    "form.composeOptionalGit": "Optional — pulled from the repo on first sync.",

    // Actions + deploy tooltips
    "action.validate": "Validate",
    "action.deploy": "Deploy",
    "action.createFromGit": "Create from Git",
    "action.tooltipNeedCreate": "Requires docker.container.create",
    "action.tooltipNeedUrl": "Enter a valid repository URL (https:// or git@…)",
    "action.tooltipNeedName": "Enter a stack name",
    "action.tooltipBlockedBind": "Remove the protected host path mount to deploy",
    "action.tooltipBindAdmin": "Host path mounts require an administrator",
    "action.tooltipBindOptIn": "Tick “Allow host path mounts” to deploy with a host bind",

    // Validation error panel
    "validation.invalidTitle": "Invalid compose document",
    "validation.validTitle": "Valid — {count} service(s)",
    "validation.deployOrder": "Deploy order:",
    "validation.colService": "Service",
    "validation.colImage": "Image",
    "validation.colPorts": "Ports",
    "validation.colVolumes": "Volumes",
    "validation.colRestart": "Restart",

    // Host-bind security warnings
    "bind.protectedTitle": "Protected host path.",
    "bind.protectedBody": ", which is never allowed (it would grant the container control of the host). Remove it to deploy.",
    "bind.protectedPrefix": "A service binds",
    "bind.optInNonAdminPrefix": "This stack mounts a host path ({paths}). Host binds are root-equivalent, so only an administrator may deploy them — the server will reject this with a",
    "bind.optInNonAdminSuffix": ". Use named volumes instead.",
    "bind.optInTitle": "Host path mount detected",
    "bind.optInBody": "A service binds a host path ({paths}), giving the container access to the host filesystem. As an administrator you may opt in; protected paths (docker.sock, /, /etc, …) stay blocked regardless.",
    "bind.optInCheckbox": "Allow host path mounts for this stack",

    // View-mode live containers
    "containers.label": "Containers ({count})",
    "containers.empty": "No live containers for this stack.",
    "containers.colService": "Service",
    "containers.colName": "Name",
    "containers.colState": "State",
    "containers.created": "Created {ago}.",

    // GitOps create-mode section
    "git.sectionTitle": "Deploy from Git (GitOps)",
    "git.badgeOn": "on",
    "git.intro": "Track a compose file in a git repository. Castor pulls it on the first sync and can redeploy on demand — or automatically on push, via a webhook.",
    "git.repoUrlLabel": "Repository URL",
    "git.repoUrlPlaceholder": "https://github.com/acme/infra.git",
    "git.repoUrlError": "Use https://…, git@…, or ssh://…",
    "git.repoUrlHint": "HTTPS or SSH clone URL of the repo holding your compose file.",
    "git.refLabel": "Branch / ref",
    "git.refPlaceholder": "main",
    "git.refHint": "Branch, tag, or commit to pin.",
    "git.pathLabel": "Compose path",
    "git.pathPlaceholder": "docker-compose.yml",
    "git.pathHint": "Path to the compose file within the repo.",
    "git.tokenLabel": "Git token (optional)",
    "git.tokenPlaceholder": "ghp_…",
    "git.tokenHint": "Read-only PAT for a private repo. Sent once, never returned.",
    "git.autoDeploy": "Auto-deploy on push (webhook)",
    "git.autoDeployHint": "A redeploy webhook secret will be generated and shown once after the stack is created.",

    // GitOps view-mode panel
    "git.panelTitle": "GitOps",
    "git.lastSynced": "Last synced commit {commit}",
    "git.notSynced": "not yet synced",
    "git.repo": "Repo",
    "git.ref": "Ref",
    "git.path": "Path",
    "git.syncNow": "Sync now",
    "git.syncTooltip": "Pull the pinned ref and redeploy",
    "git.viewDiff": "View diff",
    "git.hideDiff": "Hide diff",

    // Diff rendering
    "diff.title": "Diff (current → incoming)",
    "diff.incoming": "incoming {commit}",
    "diff.upToDate": "Up to date — the stored compose matches the repo.",

    // Webhook-secret reveal modal
    "webhook.modalTitle": "Save your webhook secret",
    "webhook.confirm": "I've saved the webhook secret",
    "webhook.warningPrefix": "Copy this secret now — it is shown only once. Auto-deploy is enabled for",
    "webhook.warningHost": "host",
    "webhook.urlLabel": "Webhook URL (POST)",
    "webhook.copyUrl": "Copy URL",
    "webhook.copyUrlAria": "Copy webhook URL",
    "webhook.secretLabelPrefix": "Secret — send it in the",
    "webhook.secretLabelSuffix": "request header",
    "webhook.copySecret": "Copy secret",
    "webhook.copySecretAria": "Copy webhook secret",
    "webhook.whereTitle": "Where to paste it",
    "webhook.whereBody1": "In your repo's webhook settings (GitHub:",
    "webhook.whereBody2": "; GitLab:",
    "webhook.whereBody3": "), set the",
    "webhook.wherePayloadUrl": "Payload URL",
    "webhook.whereBody4": "to the URL above and add a request header",
    "webhook.whereBody5": "with the secret as its value. Choose the",
    "webhook.wherePush": "push",
    "webhook.whereBody6": "event. Castor redeploys the stack from the pinned ref on each matching push.",

    // Builder form + service card
    "builder.intro": "Build services visually, then generate a compose document. The YAML tab remains the deploy source of truth.",
    "builder.addService": "Add service",
    "builder.generate": "Generate YAML",
    "builder.serviceN": "Service {n}",
    "builder.removeService": "Remove service",
    "builder.removeServiceDisabled": "A stack needs at least one service",
    "builder.removeServiceAria": "Remove service",
    "builder.nameLabel": "Name",
    "builder.namePlaceholder": "web",
    "builder.imageLabel": "Image",
    "builder.imagePlaceholder": "nginx:latest",
    "builder.restartLabel": "Restart",
    "builder.restartDefault": "(default)",
    "builder.ports": "Ports",
    "builder.portHost": "host",
    "builder.portContainer": "container",
    "builder.portHostAria": "Host port",
    "builder.portContainerAria": "Container port",
    "builder.protoAria": "Protocol",
    "builder.removePortAria": "Remove port",
    "builder.addPort": "Add port",
    "builder.env": "Environment",
    "builder.envKeyAria": "Env key",
    "builder.envValuePlaceholder": "value",
    "builder.envValueAria": "Env value",
    "builder.removeEnvAria": "Remove env var",
    "builder.addVariable": "Add variable",
    "builder.volumes": "Volumes",
    "builder.volumeSourcePlaceholder": "source (named or /host/path)",
    "builder.volumeSourceAria": "Volume source",
    "builder.volumeTargetPlaceholder": "/container/path",
    "builder.volumeTargetAria": "Volume target",
    "builder.removeVolumeAria": "Remove volume",
    "builder.addVolume": "Add volume",
    "builder.dependsOnLabel": "Depends on",
    "builder.dependsOnPlaceholder": "db cache",
    "builder.dependsOnHint": "Other service names this one starts after (space or comma separated).",

    // Loading
    "loading.stack": "Loading stack…",

    // Toasts
    "toast.composeValidTitle": "Compose valid",
    "toast.composeValidBody": "{count} service(s).",
    "toast.validationFailed": "Validation failed",
    "toast.stackCreatedTitle": "Stack created",
    "toast.stackCreatedSaveSecret": "{name} — save the webhook secret.",
    "toast.stackCreatedFromGitTitle": "Stack created from Git",
    "toast.stackDeployedTitle": "Stack deployed",
    "toast.stackDeployedBody": "{name} — {count} service(s).",
    "toast.deployFailed": "Deploy failed",
    "toast.incompleteTitle": "Incomplete services",
    "toast.incompleteBody": "Every service needs a name and an image.",
    "toast.yamlGeneratedTitle": "YAML generated",
    "toast.yamlGeneratedBody": "Review it in the YAML tab, then validate and deploy.",
    "toast.generateFailed": "Generate failed",
    "toast.syncedTitle": "Synced from Git",
    "toast.syncedDeployed": "Deployed {commit} — {count} service(s).",
    "toast.syncedBody": "{count} service(s).",
    "toast.syncFailed": "Sync failed",
    "toast.diffFailed": "Diff failed",
    "toast.urlCopied": "Webhook URL copied",
    "toast.tokenCopied": "Token copied",
    "toast.copyFailed": "Copy failed",
  },
  fr: {
    // En-tête de page
    "header.stack": "Stack",
    "header.deploy": "Déployer une stack",
    "header.subtitle": "Définissez un document compose, validez-le, puis déployez.",
    "header.back": "Retour aux stacks",

    // Onglets
    "tab.yaml": "YAML",
    "tab.builder": "Assistant",

    // Nom de stack + document compose
    "form.nameLabel": "Nom de la stack",
    "form.namePlaceholder": "mon-app",
    "form.nameError": "Lettres, chiffres, espace, point, tiret, underscore (max 63).",
    "form.nameHint": "Sert à dériver le nom du projet compose.",
    "form.composeLabel": "Document compose",
    "form.composeReadonlyGit": "Suivi depuis Git — synchronisez pour redéployer.",
    "form.composeReadonly": "Lecture seule — déployez depuis une nouvelle stack.",
    "form.composeOptionalGit": "Facultatif — récupéré depuis le dépôt à la première synchronisation.",

    // Actions + infobulles de déploiement
    "action.validate": "Valider",
    "action.deploy": "Déployer",
    "action.createFromGit": "Créer depuis Git",
    "action.tooltipNeedCreate": "Nécessite docker.container.create",
    "action.tooltipNeedUrl": "Saisissez une URL de dépôt valide (https:// ou git@…)",
    "action.tooltipNeedName": "Saisissez un nom de stack",
    "action.tooltipBlockedBind": "Retirez le montage de chemin hôte protégé pour déployer",
    "action.tooltipBindAdmin": "Les montages de chemin hôte nécessitent un administrateur",
    "action.tooltipBindOptIn": "Cochez « Autoriser les montages de chemin hôte » pour déployer avec un bind hôte",

    // Panneau d'erreur de validation
    "validation.invalidTitle": "Document compose invalide",
    "validation.validTitle": "Valide — {count} service(s)",
    "validation.deployOrder": "Ordre de déploiement :",
    "validation.colService": "Service",
    "validation.colImage": "Image",
    "validation.colPorts": "Ports",
    "validation.colVolumes": "Volumes",
    "validation.colRestart": "Redémarrage",

    // Avertissements de sécurité sur les binds hôte
    "bind.protectedTitle": "Chemin hôte protégé.",
    "bind.protectedBody": ", ce qui n'est jamais autorisé (cela donnerait au conteneur le contrôle de l'hôte). Retirez-le pour déployer.",
    "bind.protectedPrefix": "Un service monte",
    "bind.optInNonAdminPrefix": "Cette stack monte un chemin hôte ({paths}). Les binds hôte équivalent aux droits root, donc seul un administrateur peut les déployer — le serveur rejettera cette requête avec un",
    "bind.optInNonAdminSuffix": ". Utilisez plutôt des volumes nommés.",
    "bind.optInTitle": "Montage de chemin hôte détecté",
    "bind.optInBody": "Un service monte un chemin hôte ({paths}), donnant au conteneur l'accès au système de fichiers de l'hôte. En tant qu'administrateur, vous pouvez l'autoriser ; les chemins protégés (docker.sock, /, /etc, …) restent bloqués quoi qu'il arrive.",
    "bind.optInCheckbox": "Autoriser les montages de chemin hôte pour cette stack",

    // Conteneurs en cours (mode consultation)
    "containers.label": "Conteneurs ({count})",
    "containers.empty": "Aucun conteneur actif pour cette stack.",
    "containers.colService": "Service",
    "containers.colName": "Nom",
    "containers.colState": "État",
    "containers.created": "Créée {ago}.",

    // Section GitOps (mode création)
    "git.sectionTitle": "Déployer depuis Git (GitOps)",
    "git.badgeOn": "actif",
    "git.intro": "Suivez un fichier compose dans un dépôt git. Castor le récupère à la première synchronisation et peut redéployer à la demande — ou automatiquement à chaque push, via un webhook.",
    "git.repoUrlLabel": "URL du dépôt",
    "git.repoUrlPlaceholder": "https://github.com/acme/infra.git",
    "git.repoUrlError": "Utilisez https://…, git@… ou ssh://…",
    "git.repoUrlHint": "URL de clonage HTTPS ou SSH du dépôt contenant votre fichier compose.",
    "git.refLabel": "Branche / ref",
    "git.refPlaceholder": "main",
    "git.refHint": "Branche, tag ou commit à épingler.",
    "git.pathLabel": "Chemin du compose",
    "git.pathPlaceholder": "docker-compose.yml",
    "git.pathHint": "Chemin du fichier compose dans le dépôt.",
    "git.tokenLabel": "Token Git (facultatif)",
    "git.tokenPlaceholder": "ghp_…",
    "git.tokenHint": "PAT en lecture seule pour un dépôt privé. Envoyé une seule fois, jamais renvoyé.",
    "git.autoDeploy": "Déploiement auto à chaque push (webhook)",
    "git.autoDeployHint": "Un secret de webhook de redéploiement sera généré et affiché une seule fois après la création de la stack.",

    // Panneau GitOps (mode consultation)
    "git.panelTitle": "GitOps",
    "git.lastSynced": "Dernier commit synchronisé {commit}",
    "git.notSynced": "pas encore synchronisé",
    "git.repo": "Dépôt",
    "git.ref": "Ref",
    "git.path": "Chemin",
    "git.syncNow": "Synchroniser",
    "git.syncTooltip": "Récupérer la ref épinglée et redéployer",
    "git.viewDiff": "Voir le diff",
    "git.hideDiff": "Masquer le diff",

    // Rendu du diff
    "diff.title": "Diff (actuel → entrant)",
    "diff.incoming": "entrant {commit}",
    "diff.upToDate": "À jour — le compose stocké correspond au dépôt.",

    // Fenêtre de révélation du secret webhook
    "webhook.modalTitle": "Enregistrez votre secret de webhook",
    "webhook.confirm": "J'ai enregistré le secret de webhook",
    "webhook.warningPrefix": "Copiez ce secret maintenant — il n'est affiché qu'une seule fois. Le déploiement auto est activé pour",
    "webhook.warningHost": "hôte",
    "webhook.urlLabel": "URL du webhook (POST)",
    "webhook.copyUrl": "Copier l'URL",
    "webhook.copyUrlAria": "Copier l'URL du webhook",
    "webhook.secretLabelPrefix": "Secret — envoyez-le dans l'en-tête de requête",
    "webhook.secretLabelSuffix": "",
    "webhook.copySecret": "Copier le secret",
    "webhook.copySecretAria": "Copier le secret du webhook",
    "webhook.whereTitle": "Où le coller",
    "webhook.whereBody1": "Dans les paramètres de webhook de votre dépôt (GitHub :",
    "webhook.whereBody2": " ; GitLab :",
    "webhook.whereBody3": "), définissez le",
    "webhook.wherePayloadUrl": "Payload URL",
    "webhook.whereBody4": "sur l'URL ci-dessus et ajoutez un en-tête de requête",
    "webhook.whereBody5": "avec le secret comme valeur. Choisissez l'événement",
    "webhook.wherePush": "push",
    "webhook.whereBody6": ". Castor redéploie la stack depuis la ref épinglée à chaque push correspondant.",

    // Assistant + carte de service
    "builder.intro": "Construisez vos services visuellement, puis générez un document compose. L'onglet YAML reste la source de vérité pour le déploiement.",
    "builder.addService": "Ajouter un service",
    "builder.generate": "Générer le YAML",
    "builder.serviceN": "Service {n}",
    "builder.removeService": "Retirer le service",
    "builder.removeServiceDisabled": "Une stack a besoin d'au moins un service",
    "builder.removeServiceAria": "Retirer le service",
    "builder.nameLabel": "Nom",
    "builder.namePlaceholder": "web",
    "builder.imageLabel": "Image",
    "builder.imagePlaceholder": "nginx:latest",
    "builder.restartLabel": "Redémarrage",
    "builder.restartDefault": "(par défaut)",
    "builder.ports": "Ports",
    "builder.portHost": "hôte",
    "builder.portContainer": "conteneur",
    "builder.portHostAria": "Port hôte",
    "builder.portContainerAria": "Port du conteneur",
    "builder.protoAria": "Protocole",
    "builder.removePortAria": "Retirer le port",
    "builder.addPort": "Ajouter un port",
    "builder.env": "Environnement",
    "builder.envKeyAria": "Clé d'environnement",
    "builder.envValuePlaceholder": "valeur",
    "builder.envValueAria": "Valeur d'environnement",
    "builder.removeEnvAria": "Retirer la variable",
    "builder.addVariable": "Ajouter une variable",
    "builder.volumes": "Volumes",
    "builder.volumeSourcePlaceholder": "source (nommé ou /chemin/hote)",
    "builder.volumeSourceAria": "Source du volume",
    "builder.volumeTargetPlaceholder": "/chemin/conteneur",
    "builder.volumeTargetAria": "Cible du volume",
    "builder.removeVolumeAria": "Retirer le volume",
    "builder.addVolume": "Ajouter un volume",
    "builder.dependsOnLabel": "Dépend de",
    "builder.dependsOnPlaceholder": "db cache",
    "builder.dependsOnHint": "Noms des autres services après lesquels celui-ci démarre (séparés par espace ou virgule).",

    // Chargement
    "loading.stack": "Chargement de la stack…",

    // Toasts
    "toast.composeValidTitle": "Compose valide",
    "toast.composeValidBody": "{count} service(s).",
    "toast.validationFailed": "Échec de la validation",
    "toast.stackCreatedTitle": "Stack créée",
    "toast.stackCreatedSaveSecret": "{name} — enregistrez le secret de webhook.",
    "toast.stackCreatedFromGitTitle": "Stack créée depuis Git",
    "toast.stackDeployedTitle": "Stack déployée",
    "toast.stackDeployedBody": "{name} — {count} service(s).",
    "toast.deployFailed": "Échec du déploiement",
    "toast.incompleteTitle": "Services incomplets",
    "toast.incompleteBody": "Chaque service doit avoir un nom et une image.",
    "toast.yamlGeneratedTitle": "YAML généré",
    "toast.yamlGeneratedBody": "Vérifiez-le dans l'onglet YAML, puis validez et déployez.",
    "toast.generateFailed": "Échec de la génération",
    "toast.syncedTitle": "Synchronisé depuis Git",
    "toast.syncedDeployed": "Déployé {commit} — {count} service(s).",
    "toast.syncedBody": "{count} service(s).",
    "toast.syncFailed": "Échec de la synchronisation",
    "toast.diffFailed": "Échec du diff",
    "toast.urlCopied": "URL du webhook copiée",
    "toast.tokenCopied": "Token copié",
    "toast.copyFailed": "Échec de la copie",
  },
});
