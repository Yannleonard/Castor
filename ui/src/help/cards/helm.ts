// ui/src/help/cards/helm.ts — Helm (Kubernetes package manager) help card.
import type { HelpCard } from "../types";

export const helmCard: HelpCard = {
  id: "helm",
  title: { en: "Helm", fr: "Helm" },

  en: {
    summary: "Kubernetes' package manager: add chart repositories, install packaged apps (charts), then upgrade, roll back or uninstall the resulting releases.",
    sections: [
      {
        title: "What Helm is for",
        blocks: [
          { kind: "p", text: "Helm is the **package manager for Kubernetes**. Instead of applying dozens of raw manifests by hand, you install a **chart** — a versioned, parameterisable bundle that describes a full application (Deployments, Services, ConfigMaps, and so on). Each install produces a **release**: a named, tracked instance you can later upgrade, roll back or remove." },
          { kind: "callout", tone: "info", text: "Helm requires a **connected Kubernetes cluster**. If Castor has no K8s context configured, the Helm view stays empty — connect a cluster first." },
        ],
      },
      {
        title: "How it works in Castor",
        blocks: [
          { kind: "p", text: "The Helm view is organised into **three tabs** that map onto the natural workflow:" },
          { kind: "list", items: [
            "**Repositories** — the chart sources you have added. Each row shows the repo name and URL, with actions to **refresh** its index and **remove** it.",
            "**Charts** — a searchable catalogue built from your indexed repositories. Pick a chart to open the **Install** dialog.",
            "**Releases** — everything you have installed. Each release exposes **upgrade**, **rollback**, **uninstall**, plus its **history** (revisions) and current **values**.",
          ] },
        ],
      },
      {
        title: "Add a repository",
        blocks: [
          { kind: "p", text: "In the **Repositories** tab, add a chart repository by giving it a name and its index URL, for example `https://charts.bitnami.com/bitnami`. Castor fetches the index so the repo's charts become searchable. Use **Refresh** to pull newly published chart versions, and **Remove** to drop a source you no longer use." },
          { kind: "note", text: "The equivalent CLI actions, if you prefer the terminal, are `helm repo add` and `helm repo update`:" },
          { kind: "cmd", command: "helm repo add bitnami https://charts.bitnami.com/bitnami && helm repo update" },
        ],
      },
      {
        title: "Install a chart",
        blocks: [
          { kind: "p", text: "The flow is always the same: **add a repo → find the chart → Install**. Open the **Charts** tab, search for the chart you want, and click **Install**. The install dialog asks for:" },
          { kind: "list", items: [
            "**Release name** — the identifier for this installation (must be unique in the namespace).",
            "**Namespace** — where the resources are created; prefer a dedicated namespace per app.",
            "**Chart version** — pin an explicit version rather than always taking the latest.",
            "**Values (YAML)** — your overrides of the chart's defaults, e.g. replica count, image tag, resources.",
          ] },
          { kind: "code", code: "# Values (YAML) — overrides applied on top of the chart defaults\nreplicaCount: 2\nimage:\n  tag: \"1.27.0\"\nresources:\n  limits:\n    cpu: \"500m\"\n    memory: \"256Mi\"" },
        ],
      },
      {
        title: "Upgrade & roll back",
        blocks: [
          { kind: "p", text: "To change a running app — new chart version or new values — open the **Releases** tab and use **Upgrade**; this creates a new **revision** in the release history." },
          { kind: "p", text: "If an upgrade goes wrong, **rollback** is one click away: in **Releases**, open the release's **history** and pick an earlier **revision** to restore. Helm re-applies exactly what that revision contained. You can also inspect the **values** stored with any revision to understand what changed." },
          { kind: "callout", tone: "warn", text: "There is **no diff / preview before an upgrade** yet — Castor does not show you what will change ahead of time. Review your values carefully, and keep a known-good revision to roll back to." },
        ],
      },
      {
        title: "Permissions & good practices",
        blocks: [
          { kind: "list", items: [
            "Repository actions require the **`helm.repo.*`** permissions; installing, upgrading, rolling back and uninstalling require **`helm.release.*`**. A **viewer** can browse; an **operator** manages releases.",
            "**Version-control your values files** — treat them as code so every install is reproducible and reviewable.",
            "**Test in a dedicated namespace** before touching a shared or production one.",
            "**Pin chart versions** instead of always taking the latest, so upgrades are deliberate.",
            "If mutations require **2FA** in your Castor settings, install / upgrade / rollback / uninstall will prompt for your TOTP code.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://helm.sh/docs/", label: "Helm — official documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Le gestionnaire de paquets de Kubernetes : ajoutez des dépôts de charts, installez des applications packagées (charts), puis mettez à jour, faites un rollback ou désinstallez les releases obtenues.",
    sections: [
      {
        title: "À quoi sert Helm",
        blocks: [
          { kind: "p", text: "Helm est le **gestionnaire de paquets de Kubernetes**. Plutôt que d'appliquer à la main des dizaines de manifests, vous installez un **chart** — un paquet versionné et paramétrable qui décrit une application complète (Deployments, Services, ConfigMaps, etc.). Chaque installation produit une **release** : une instance nommée et suivie, que vous pourrez ensuite mettre à jour, restaurer (rollback) ou supprimer." },
          { kind: "callout", tone: "info", text: "Helm nécessite un **cluster Kubernetes connecté**. Si aucun contexte K8s n'est configuré dans Castor, la vue Helm reste vide — connectez d'abord un cluster." },
        ],
      },
      {
        title: "Comment ça marche dans Castor",
        blocks: [
          { kind: "p", text: "La vue Helm s'organise en **trois onglets** qui suivent le déroulé naturel :" },
          { kind: "list", items: [
            "**Dépôts** — les sources de charts que vous avez ajoutées. Chaque ligne affiche le nom et l'URL du dépôt, avec des actions pour **rafraîchir** son index et le **supprimer**.",
            "**Charts** — un catalogue de recherche construit à partir de vos dépôts indexés. Choisissez un chart pour ouvrir la fenêtre d'**installation**.",
            "**Releases** — tout ce que vous avez installé. Chaque release propose **upgrade**, **rollback**, **désinstaller**, ainsi que son **historique** (révisions) et ses **valeurs** actuelles.",
          ] },
        ],
      },
      {
        title: "Ajouter un dépôt",
        blocks: [
          { kind: "p", text: "Dans l'onglet **Dépôts**, ajoutez un dépôt de charts en indiquant son nom et l'URL de son index, par exemple `https://charts.bitnami.com/bitnami`. Castor récupère l'index pour que les charts du dépôt deviennent cherchables. Utilisez **Rafraîchir** pour tirer les nouvelles versions de charts publiées, et **Supprimer** pour retirer une source que vous n'utilisez plus." },
          { kind: "note", text: "Les commandes CLI équivalentes, si vous préférez le terminal, sont `helm repo add` et `helm repo update` :" },
          { kind: "cmd", command: "helm repo add bitnami https://charts.bitnami.com/bitnami && helm repo update" },
        ],
      },
      {
        title: "Installer un chart",
        blocks: [
          { kind: "p", text: "Le déroulé est toujours le même : **ajouter un dépôt → chercher le chart → Installer**. Ouvrez l'onglet **Charts**, cherchez le chart voulu, puis cliquez sur **Installer**. La fenêtre d'installation demande :" },
          { kind: "list", items: [
            "**Nom de release** — l'identifiant de cette installation (unique dans le namespace).",
            "**Namespace** — où les ressources sont créées ; privilégiez un namespace dédié par application.",
            "**Version du chart** — épinglez une version explicite plutôt que de prendre systématiquement la dernière.",
            "**Valeurs (YAML)** — vos surcharges des valeurs par défaut du chart, ex. nombre de réplicas, tag d'image, ressources.",
          ] },
          { kind: "code", code: "# Valeurs (YAML) — surcharges appliquées par-dessus les défauts du chart\nreplicaCount: 2\nimage:\n  tag: \"1.27.0\"\nresources:\n  limits:\n    cpu: \"500m\"\n    memory: \"256Mi\"" },
        ],
      },
      {
        title: "Mettre à jour & faire un rollback",
        blocks: [
          { kind: "p", text: "Pour modifier une application en place — nouvelle version de chart ou nouvelles valeurs — ouvrez l'onglet **Releases** et utilisez **Upgrade** ; cela crée une nouvelle **révision** dans l'historique de la release." },
          { kind: "p", text: "Si une mise à jour tourne mal, le **rollback** est à portée de clic : dans **Releases**, ouvrez l'**historique** de la release et choisissez une **révision** antérieure à restaurer. Helm réapplique exactement ce que cette révision contenait. Vous pouvez aussi inspecter les **valeurs** stockées avec chaque révision pour comprendre ce qui a changé." },
          { kind: "callout", tone: "warn", text: "Le **diff / la prévisualisation avant upgrade n'existe pas encore** — Castor ne vous montre pas à l'avance ce qui va changer. Relisez vos valeurs attentivement et gardez une révision saine vers laquelle revenir." },
        ],
      },
      {
        title: "Permissions & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Les actions sur les dépôts requièrent les permissions **`helm.repo.*`** ; installer, mettre à jour, faire un rollback et désinstaller requièrent **`helm.release.*`**. Un **viewer** peut parcourir ; un **operator** gère les releases.",
            "**Versionnez vos fichiers de valeurs** — traitez-les comme du code pour que chaque installation soit reproductible et relisible.",
            "**Testez dans un namespace dédié** avant de toucher à un namespace partagé ou de production.",
            "**Épinglez les versions de chart** au lieu de prendre toujours la dernière, pour que les mises à jour restent volontaires.",
            "Si les mutations exigent la **2FA** dans vos réglages Castor, installer / mettre à jour / rollback / désinstaller demandera votre code TOTP.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://helm.sh/docs/", label: "Helm — documentation officielle" },
        ],
      },
    ],
  },
};
