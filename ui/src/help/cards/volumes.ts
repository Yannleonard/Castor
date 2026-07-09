// ui/src/help/cards/volumes.ts — Volumes & backups help card.
import type { HelpCard } from "../types";

export const volumesCard: HelpCard = {
  id: "volumes",
  title: { en: "Volumes & backups", fr: "Volumes & sauvegardes" },

  en: {
    summary: "Persistent container storage: back it up to tar.gz archives, restore it where you need, and delete it with care.",
    sections: [
      {
        title: "What volumes are for",
        blocks: [
          { kind: "p", text: "A **volume** is where a container keeps data that must **survive the container itself**: database files, uploads, application state. Delete or recreate a container and its volumes stay put — that is exactly what makes them the right place for anything you cannot afford to lose." },
          { kind: "note", text: "Volumes are managed by Docker, independently of the container that uses them. Several containers can share one, and a volume can outlive every container that ever mounted it." },
        ],
      },
      {
        title: "How it works in Castor",
        blocks: [
          { kind: "p", text: "The **Volumes** view lists every volume with its **name**, **driver**, **mountpoint** (where Docker stores it on the host) and **size**. From there you can back up a volume, restore one, or remove it." },
          { kind: "p", text: "Backups produced from this view live in the **Backups** view, where you can see each archive, restore it, or clean it up." },
        ],
      },
      {
        title: "Backing up a volume",
        blocks: [
          { kind: "p", text: "Select a volume and click **Backup**. Castor streams its contents into a compressed **`tar.gz`** archive that then appears in the **Backups** view — no shell, no manual `docker run` gymnastics." },
          { kind: "callout", tone: "info", text: "For a **strictly consistent** backup of a database, stop the container first. A live database can be mid-write when the archive is taken, which may leave the snapshot inconsistent. For quiet volumes (static assets, configs) a hot backup is fine." },
        ],
      },
      {
        title: "Restoring from a backup",
        blocks: [
          { kind: "p", text: "Open the **Backups** view, pick an archive and click **Restore**. Castor asks for the **destination volume** — it defaults to the **original** volume, but you can restore into a different one (handy to clone data or test a restore without touching production)." },
          { kind: "callout", tone: "warn", text: "Restoring **overwrites** the destination volume's contents with the archive. Double-check the target before you confirm." },
        ],
      },
      {
        title: "Deleting a volume",
        blocks: [
          { kind: "p", text: "Removing a volume calls `docker.volume.remove` and **destroys its data permanently** — there is no undo. Only volumes not currently in use by a container can be removed." },
          { kind: "callout", tone: "warn", text: "The **`castor-data`** volume — which holds Castor's own database and user accounts — is **auto-protected** and **cannot be deleted from the UI**. This prevents you from locking yourself out of Castor by accident." },
          { kind: "note", text: "Deletion is a mutation, so it obeys the usual guardrails: the `docker.volume.remove` permission (RBAC), and TOTP step-up if **2FA required for mutations** is enabled." },
        ],
      },
      {
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "**Back up database volumes regularly** — they are the data you would most regret losing.",
            "**Test your restores.** A backup you have never restored is a hope, not a guarantee — restore into a throwaway volume periodically to confirm the archive is good.",
            "For a **consistent** database snapshot, **stop the container** (or quiesce writes) before the backup.",
            "Restoring into the **original** volume overwrites it — restore into a **new** volume when you only want to inspect old data.",
            "Store important `tar.gz` archives **off-host** as well; a backup that lives only on the same machine as the data is not disaster-proof.",
          ] },
          { kind: "callout", tone: "info", text: "**Scheduled automatic backups are not available yet.** For now, run backups manually from this view, or drive them on a schedule from an external **cron** job. Recurring backups are on the roadmap." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/storage/volumes/", label: "Docker volumes — official documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Le stockage persistant des conteneurs : sauvegardez-le en archives tar.gz, restaurez-le où vous voulez, et supprimez-le avec précaution.",
    sections: [
      {
        title: "À quoi servent les volumes",
        blocks: [
          { kind: "p", text: "Un **volume** est l'endroit où un conteneur conserve les données qui doivent **survivre au conteneur lui-même** : fichiers de base de données, fichiers déposés, état applicatif. Supprimez ou recréez un conteneur, ses volumes restent en place — c'est précisément ce qui en fait le bon endroit pour tout ce que vous ne pouvez pas vous permettre de perdre." },
          { kind: "note", text: "Les volumes sont gérés par Docker, indépendamment du conteneur qui les utilise. Plusieurs conteneurs peuvent en partager un, et un volume peut survivre à tous les conteneurs qui l'ont un jour monté." },
        ],
      },
      {
        title: "Comment ça marche dans Castor",
        blocks: [
          { kind: "p", text: "La vue **Volumes** liste chaque volume avec son **nom**, son **driver**, son **point de montage** (où Docker le stocke sur l'hôte) et sa **taille**. De là, vous pouvez sauvegarder un volume, en restaurer un, ou le supprimer." },
          { kind: "p", text: "Les sauvegardes produites depuis cette vue sont consultables dans la vue **Backups**, où vous retrouvez chaque archive pour la restaurer ou la nettoyer." },
        ],
      },
      {
        title: "Sauvegarder un volume",
        blocks: [
          { kind: "p", text: "Sélectionnez un volume et cliquez sur **Backup**. Castor exporte son contenu dans une archive compressée **`tar.gz`** qui apparaît ensuite dans la vue **Backups** — pas de shell, pas de `docker run` à assembler à la main." },
          { kind: "callout", tone: "info", text: "Pour une sauvegarde **strictement cohérente** d'une base de données, arrêtez d'abord le conteneur. Une base en fonctionnement peut être en pleine écriture au moment de l'archivage, ce qui risque de rendre le cliché incohérent. Pour les volumes calmes (assets statiques, configs), une sauvegarde à chaud convient." },
        ],
      },
      {
        title: "Restaurer depuis une sauvegarde",
        blocks: [
          { kind: "p", text: "Ouvrez la vue **Backups**, choisissez une archive et cliquez sur **Restore**. Castor demande le **volume de destination** — par défaut le volume **d'origine**, mais vous pouvez restaurer vers un autre (pratique pour cloner des données ou tester une restauration sans toucher à la production)." },
          { kind: "callout", tone: "warn", text: "La restauration **écrase** le contenu du volume de destination avec celui de l'archive. Vérifiez bien la cible avant de confirmer." },
        ],
      },
      {
        title: "Supprimer un volume",
        blocks: [
          { kind: "p", text: "Supprimer un volume appelle `docker.volume.remove` et **détruit ses données définitivement** — il n'y a pas d'annulation. Seuls les volumes non utilisés par un conteneur peuvent être supprimés." },
          { kind: "callout", tone: "warn", text: "Le volume **`castor-data`** — qui contient la base de Castor et les comptes utilisateurs — est **auto-protégé** et **ne peut PAS être supprimé via l'UI**. Cela vous évite de vous verrouiller hors de Castor par accident." },
          { kind: "note", text: "La suppression est une mutation, elle suit donc les garde-fous habituels : la permission `docker.volume.remove` (RBAC), et le step-up TOTP si le réglage **2FA requise pour les mutations** est activé." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "**Sauvegardez régulièrement les volumes de bases de données** — ce sont les données que vous regretteriez le plus de perdre.",
            "**Testez vos restaurations.** Une sauvegarde jamais restaurée est un espoir, pas une garantie — restaurez périodiquement vers un volume jetable pour confirmer que l'archive est bonne.",
            "Pour un cliché **cohérent** d'une base, **arrêtez le conteneur** (ou suspendez les écritures) avant la sauvegarde.",
            "Restaurer vers le volume **d'origine** l'écrase — restaurez vers un **nouveau** volume quand vous voulez seulement inspecter d'anciennes données.",
            "Conservez aussi les archives `tar.gz` importantes **hors de l'hôte** ; une sauvegarde qui ne vit que sur la même machine que les données n'est pas à l'épreuve d'un sinistre.",
          ] },
          { kind: "callout", tone: "info", text: "**Les sauvegardes planifiées automatiques ne sont pas encore disponibles.** Pour l'instant, lancez les sauvegardes manuellement depuis cette vue, ou pilotez-les sur un rythme régulier via un **cron** externe. Les sauvegardes récurrentes sont prévues." },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://docs.docker.com/storage/volumes/", label: "Volumes Docker — documentation officielle" },
        ],
      },
    ],
  },
};
