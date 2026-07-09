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
          { kind: "callout", tone: "info", text: "**GitOps isn't here yet.** Stacks are edited and deployed from Castor directly; binding a stack to a git repository (auto-deploy on push) is planned but not available today." },
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
          { kind: "callout", tone: "info", text: "**Le GitOps n'est pas encore là.** Les stacks s'éditent et se déploient directement depuis Castor ; lier une stack à un dépôt git (auto-déploiement au push) est prévu mais pas disponible aujourd'hui." },
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
