// Castor by IT Leonard
// ui/src/help/cards/stacks.ts — Compose stacks (deploy a group of containers together) help card.
import type { HelpCard } from "../types";

export const stacksCard: HelpCard = {
  id: "stacks",
  title: { en: "Compose stacks", fr: "Stacks Compose" },

  en: {
    summary: "Describe a group of containers in one Compose file — an app, its database, a reverse proxy — and deploy them together as a single stack.",
    sections: [
      {
        title: "What a stack is for",
        blocks: [
          { kind: "p", text: "A **stack** is a group of containers described together in a `docker-compose` file and deployed as one unit. Instead of creating each container by hand, you declare the whole thing — for example an **app**, its **database**, and a **reverse proxy** — and Castor brings them all up with their networks and volumes wired in." },
          { kind: "p", text: "A stack is the right tool when several containers belong together: they share a lifecycle, talk to each other, and you want to bring them up or tear them down as a set." },
        ],
      },
      {
        title: "Editor or Builder — two ways to create one",
        blocks: [
          { kind: "p", text: "The Stacks page gives you two ways in, and you can switch between them:" },
          { kind: "list", items: [
            "**YAML editor** — paste or write a `compose.yaml` directly. Best when you already have a Compose file or you're comfortable with the syntax. Full control, nothing hidden.",
            "**Builder** — a structured form: add services one by one and fill in image, ports, environment variables, volumes and restart policy. Castor generates the YAML for you. Best when you'd rather not hand-write Compose.",
          ] },
          { kind: "note", text: "The Builder is just a front-end for the same YAML. Whatever you assemble in the form, you can review as Compose before deploying — the two views describe the same stack." },
        ],
      },
      {
        title: "Naming, validating, deploying",
        blocks: [
          { kind: "p", text: "Give the stack a **name** first. It must be simple: letters, digits, spaces and `. _ -`, up to **63** characters. The name groups the containers and lets you find the stack again later." },
          { kind: "p", text: "**Validate** analyses the stack **without deploying anything**: it parses the Compose, reports errors, and shows a summary of what would be created (services, ports, volumes). Run it first — it's the cheap way to catch mistakes." },
          { kind: "p", text: "**Deploy** creates and starts the containers. This needs the `docker.container.create` permission, which is **admin-only**: creating containers is the main privilege-escalation vector (bind mounts, capabilities…), so it isn't handed to operators or viewers." },
          { kind: "p", text: "**Bring down** stops and removes the stack's containers — it's the inverse of Deploy." },
        ],
      },
      {
        title: "Wiring a service to a secret",
        blocks: [
          { kind: "p", text: "Don't paste passwords into environment variables in plain YAML. Castor stores secrets **sealed with AES-256-GCM**; a service reads a secret at runtime rather than carrying it in its definition." },
          { kind: "p", text: "In Compose terms, you declare the secret at the top level, then reference it from the service under `secrets:` — the value is mounted into the container (by default at `/run/secrets/<name>`), not baked into the environment:" },
          { kind: "code", code: "services:\n  db:\n    image: postgres:16\n    secrets:\n      - db_password\n    environment:\n      POSTGRES_PASSWORD_FILE: /run/secrets/db_password\n\nsecrets:\n  db_password:\n    external: true" },
          { kind: "note", text: "`external: true` means the secret already exists in Castor — you create it once in the secrets area and reference it by name from any stack, instead of copying its value into the Compose file." },
        ],
      },
      {
        title: "Deploy from Git (GitOps)",
        blocks: [
          { kind: "p", text: "Instead of pasting YAML, you can point a stack at a **git repository** so the Compose file stays versioned in your repo and Castor deploys from it. In the create screen, expand the **Deploy from Git (GitOps)** section — a badge marks it **on** once expanded." },
          { kind: "list", items: [
            "**Repository URL** — the HTTPS or SSH clone URL of the repo holding your Compose file (e.g. `https://github.com/acme/infra.git`, `git@…`, `ssh://…`).",
            "**Branch / ref** — the branch, tag or commit to pin (defaults to `main`). Castor always deploys exactly this ref.",
            "**Compose path** — the path to the Compose file inside the repo (defaults to `docker-compose.yml`).",
            "**Git token (optional)** — a **read-only** personal access token for a **private** repo. It's sealed with **AES-256-GCM**, sent once and **never shown again** — leave it blank for public repos.",
          ] },
          { kind: "p", text: "With a repo set, the **compose textarea becomes optional**: the deploy source is the repo. Click **Create from Git** — Castor clones the ref, reads the Compose at the given path, and deploys it." },
          { kind: "p", text: "Once created, opening a git-backed stack shows a **GitOps** panel with the repo, ref and path, plus a **last-synced-commit** badge (short SHA). Two actions live here:" },
          { kind: "list", items: [
            "**Sync now** — `git pull` the pinned ref and **redeploy** the stack from it. Same admin gate as a normal deploy (`docker.container.create`).",
            "**View diff** — compares the Compose **currently deployed** against the incoming Compose at the repo's ref, line by line (additions in green, removals in red). If nothing changed, it says so — a cheap way to preview a sync before running it.",
          ] },
          { kind: "note", text: "The Compose is read-only for a git-backed stack: the repo is the source of truth. Edit the file in git, then **Sync now** (or push, with the webhook below)." },
        ],
      },
      {
        title: "Push-to-deploy (webhook)",
        blocks: [
          { kind: "p", text: "Tick **Auto-deploy on push (webhook)** in the Git section and, when the stack is created, Castor generates a **webhook secret** and shows it **exactly once** in a modal you can't dismiss by accident. Copy it then — it is never displayed again." },
          { kind: "p", text: "The modal gives you two things to paste into your git host:" },
          { kind: "list", items: [
            "The **webhook URL** — a `POST` to `/api/v1/hooks/stacks/<id>/redeploy` on your Castor origin.",
            "The **secret**, sent in the `X-Castor-Token` request header.",
          ] },
          { kind: "p", text: "In GitHub go to **Settings → Webhooks → Add webhook**; in GitLab **Settings → Webhooks**. Set the **Payload URL** to the webhook URL, add the `X-Castor-Token` header with the secret as its value, and choose the **push** event. From then on, every matching push makes the stack **re-sync and redeploy** from the pinned ref — no manual step." },
          { kind: "callout", tone: "warn", text: "The webhook endpoint is **public**, but it only acts on a request carrying the correct `X-Castor-Token` secret — treat that secret like a password. And the repo's Compose must stay within the **subset of Compose that Castor supports**: an unsupported file fails **validation** with a clear error and **nothing is deployed**, rather than a broken stack going live." },
        ],
      },
      {
        title: "Pitfalls & good practices",
        blocks: [
          { kind: "list", items: [
            "**Bind mounts to the host are refused by default** (host-mount guard). Mounting a host path into a container is how a container can reach the host filesystem, so only **named volumes** are allowed for non-admins — declare volumes in the `volumes:` section rather than pointing at `/etc`, `/var/run`, etc.",
            "Always **Validate before Deploy** — it turns a syntax mistake into a readable error instead of a half-created stack.",
            "**Pin image tags** (avoid `:latest`) so a redeploy gives you the same versions.",
            "Prefer `POSTGRES_PASSWORD_FILE` / `*_FILE` env vars pointing at a mounted secret over inline passwords.",
            "**Deploy is admin-gated** — if you're an operator or viewer, `docker.container.create` is denied and Deploy is disabled; ask an admin to deploy the stack.",
            "If **2FA required for mutations** is enabled, expect a TOTP step-up before Deploy or Bring down goes through.",
          ] },
          { kind: "callout", tone: "info", text: "**GitOps is available.** A stack can be edited and deployed from Castor directly, or bound to a **git repository** and redeployed on demand (**Sync now**) or **automatically on push** via a webhook — see the two GitOps sections above." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/compose/compose-file/", label: "Compose file reference — official documentation" },
          { kind: "doc", href: "https://docs.docker.com/compose/how-tos/use-secrets/", label: "Use secrets in Compose — official documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Décrivez un groupe de conteneurs dans un seul fichier Compose — une app, sa base, un reverse-proxy — et déployez-les ensemble comme une seule stack.",
    sections: [
      {
        title: "À quoi sert une stack",
        blocks: [
          { kind: "p", text: "Une **stack** est un groupe de conteneurs décrits ensemble dans un fichier `docker-compose` et déployés d'un bloc. Au lieu de créer chaque conteneur à la main, vous décrivez l'ensemble — par exemple une **app**, sa **base de données** et un **reverse-proxy** — et Castor les démarre tous, avec leurs réseaux et volumes reliés." },
          { kind: "p", text: "C'est l'outil adapté quand plusieurs conteneurs vont de pair : ils partagent un cycle de vie, communiquent entre eux, et vous voulez les monter ou les démonter comme un ensemble." },
        ],
      },
      {
        title: "Éditeur ou Builder — deux façons d'en créer une",
        blocks: [
          { kind: "p", text: "La page Stacks propose deux entrées, et vous pouvez passer de l'une à l'autre :" },
          { kind: "list", items: [
            "**Éditeur YAML** — collez ou écrivez directement un `compose.yaml`. Idéal si vous avez déjà un fichier Compose ou êtes à l'aise avec la syntaxe. Contrôle total, rien de caché.",
            "**Builder** — un formulaire structuré : ajoutez les services un par un et renseignez image, ports, variables d'environnement, volumes et restart policy. Castor génère le YAML pour vous. Idéal si vous préférez ne pas écrire le Compose à la main.",
          ] },
          { kind: "note", text: "Le Builder n'est qu'une interface au-dessus du même YAML. Ce que vous assemblez dans le formulaire, vous pouvez le relire en Compose avant de déployer — les deux vues décrivent la même stack." },
        ],
      },
      {
        title: "Nommer, valider, déployer",
        blocks: [
          { kind: "p", text: "Donnez d'abord un **nom** à la stack. Il doit rester simple : lettres, chiffres, espaces et `. _ -`, jusqu'à **63** caractères. Le nom regroupe les conteneurs et permet de retrouver la stack plus tard." },
          { kind: "p", text: "**Valider** analyse la stack **sans rien déployer** : le Compose est parsé, les erreurs sont remontées, et un résumé montre ce qui serait créé (services, ports, volumes). À lancer en premier — c'est le moyen économique d'attraper les fautes." },
          { kind: "p", text: "**Déployer** crée et démarre les conteneurs. Cela requiert la permission `docker.container.create`, **réservée aux admins** : la création de conteneurs est le principal vecteur d'escalade (bind mounts, capabilities…), elle n'est donc pas accordée aux operators ni aux viewers." },
          { kind: "p", text: "**Bring down** arrête et supprime les conteneurs de la stack — c'est l'inverse de Déployer." },
        ],
      },
      {
        title: "Relier un service à un secret",
        blocks: [
          { kind: "p", text: "Ne collez pas de mots de passe dans des variables d'environnement en clair dans le YAML. Castor stocke les secrets **scellés en AES-256-GCM** ; un service lit un secret au runtime plutôt que de le porter dans sa définition." },
          { kind: "p", text: "Côté Compose, on déclare le secret au niveau racine, puis on le référence dans le service sous `secrets:` — la valeur est montée dans le conteneur (par défaut sous `/run/secrets/<name>`), pas figée dans l'environnement :" },
          { kind: "code", code: "services:\n  db:\n    image: postgres:16\n    secrets:\n      - db_password\n    environment:\n      POSTGRES_PASSWORD_FILE: /run/secrets/db_password\n\nsecrets:\n  db_password:\n    external: true" },
          { kind: "note", text: "`external: true` signifie que le secret existe déjà dans Castor — vous le créez une fois dans l'espace secrets et le référencez par son nom depuis n'importe quelle stack, au lieu de recopier sa valeur dans le Compose." },
        ],
      },
      {
        title: "Déployer depuis Git (GitOps)",
        blocks: [
          { kind: "p", text: "Plutôt que de coller du YAML, vous pouvez pointer une stack vers un **dépôt git** : le fichier Compose reste versionné dans votre dépôt et Castor déploie à partir de lui. À la création, dépliez la section **Déployer depuis Git (GitOps)** — un badge indique **actif** une fois dépliée." },
          { kind: "list", items: [
            "**URL du dépôt** — l'URL de clonage HTTPS ou SSH du dépôt contenant votre fichier Compose (ex. `https://github.com/acme/infra.git`, `git@…`, `ssh://…`).",
            "**Branche / ref** — la branche, le tag ou le commit à épingler (`main` par défaut). Castor déploie toujours exactement cette ref.",
            "**Chemin du compose** — le chemin du fichier Compose dans le dépôt (`docker-compose.yml` par défaut).",
            "**Token Git (facultatif)** — un token d'accès personnel en **lecture seule** pour un dépôt **privé**. Il est scellé en **AES-256-GCM**, envoyé une seule fois et **jamais réaffiché** — laissez-le vide pour un dépôt public.",
          ] },
          { kind: "p", text: "Une fois le dépôt renseigné, la **zone de texte compose devient facultative** : la source du déploiement est le dépôt. Cliquez sur **Créer depuis Git** — Castor clone la ref, lit le Compose au chemin indiqué et le déploie." },
          { kind: "p", text: "Après création, ouvrir une stack adossée à git affiche un panneau **GitOps** avec le dépôt, la ref et le chemin, plus un badge du **dernier commit synchronisé** (SHA court). Deux actions y vivent :" },
          { kind: "list", items: [
            "**Synchroniser** — fait un `git pull` de la ref épinglée et **redéploie** la stack à partir d'elle. Même verrou admin qu'un déploiement normal (`docker.container.create`).",
            "**Voir le diff** — compare le Compose **actuellement déployé** au Compose entrant à la ref du dépôt, ligne par ligne (ajouts en vert, suppressions en rouge). Si rien n'a changé, il le dit — un moyen économique de prévisualiser une synchro avant de la lancer.",
          ] },
          { kind: "note", text: "Le Compose est en lecture seule pour une stack adossée à git : le dépôt fait foi. Éditez le fichier dans git, puis **Synchroniser** (ou poussez, avec le webhook ci-dessous)." },
        ],
      },
      {
        title: "Déploiement au push (webhook)",
        blocks: [
          { kind: "p", text: "Cochez **Déploiement auto à chaque push (webhook)** dans la section Git : à la création de la stack, Castor génère un **secret de webhook** et l'affiche **une seule fois** dans une fenêtre qu'on ne peut pas fermer par accident. Copiez-le à ce moment — il n'est plus jamais réaffiché." },
          { kind: "p", text: "La fenêtre vous donne deux éléments à coller dans votre hébergeur git :" },
          { kind: "list", items: [
            "L'**URL du webhook** — un `POST` vers `/api/v1/hooks/stacks/<id>/redeploy` sur l'origine de votre Castor.",
            "Le **secret**, envoyé dans l'en-tête de requête `X-Castor-Token`.",
          ] },
          { kind: "p", text: "Sur GitHub, allez dans **Settings → Webhooks → Add webhook** ; sur GitLab, **Settings → Webhooks**. Renseignez la **Payload URL** avec l'URL du webhook, ajoutez l'en-tête `X-Castor-Token` avec le secret comme valeur, et choisissez l'événement **push**. Dès lors, chaque push correspondant fait **re-synchroniser et redéployer** la stack depuis la ref épinglée — sans geste manuel." },
          { kind: "callout", tone: "warn", text: "Le point d'entrée du webhook est **public**, mais il n'agit que sur une requête portant le bon secret `X-Castor-Token` — traitez ce secret comme un mot de passe. Et le Compose du dépôt doit rester dans le **sous-ensemble de Compose supporté par Castor** : un fichier non supporté échoue à la **validation** avec une erreur claire et **rien n'est déployé**, plutôt qu'une stack cassée mise en ligne." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "**Les bind mounts vers l'hôte sont refusés par défaut** (host-mount guard). Monter un chemin de l'hôte dans un conteneur, c'est justement par là qu'un conteneur atteint le système de fichiers hôte ; seuls les **volumes nommés** sont autorisés aux non-admins — déclarez vos volumes dans la section `volumes:` plutôt que de pointer vers `/etc`, `/var/run`, etc.",
            "**Validez toujours avant de Déployer** — cela transforme une faute de syntaxe en erreur lisible au lieu d'une stack à moitié créée.",
            "**Épinglez les tags d'image** (évitez `:latest`) pour qu'un redéploiement rejoue les mêmes versions.",
            "Préférez les variables `POSTGRES_PASSWORD_FILE` / `*_FILE` pointant vers un secret monté aux mots de passe en clair.",
            "**Déployer est réservé aux admins** — en tant qu'operator ou viewer, `docker.container.create` est refusé et Déployer est désactivé ; demandez à un admin de déployer la stack.",
            "Si **2FA requise pour les mutations** est activée, attendez-vous à un step-up TOTP avant que Déployer ou Bring down n'aboutisse.",
          ] },
          { kind: "callout", tone: "info", text: "**Le GitOps est disponible.** Une stack peut s'éditer et se déployer directement depuis Castor, ou être adossée à un **dépôt git** et redéployée à la demande (**Synchroniser**) ou **automatiquement au push** via un webhook — voir les deux sections GitOps ci-dessus." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/compose/compose-file/", label: "Référence du fichier Compose — documentation officielle" },
          { kind: "doc", href: "https://docs.docker.com/compose/how-tos/use-secrets/", label: "Utiliser des secrets dans Compose — documentation officielle" },
        ],
      },
    ],
  },
};
