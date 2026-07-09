// ui/src/help/cards/settings.ts — Instance settings (security) help card.
import type { HelpCard } from "../types";

export const settingsCard: HelpCard = {
  id: "settings",
  title: { en: "Instance settings", fr: "Réglages de l'instance" },

  en: {
    summary: "Instance-wide security controls (admin only) — TOTP for mutations, protected labels, session window — plus outbound notification channels (Discord, Slack, ntfy, webhook).",
    sections: [
      {
        title: "What this page is for",
        blocks: [
          { kind: "p", text: "The **Settings** page holds the instance-wide security controls. They are **admin-only**: a change here applies to **every** user on this Castor instance, not just to you. From here you decide how strict the instance is about **step-up authentication**, which containers are **hard to delete by accident**, and how long a session stays alive." },
          { kind: "p", text: "The page also shows read-only **instance metadata** — Castor **version** and **build** — handy when reporting an issue or checking you are on the release you expect. Finally, it hosts the **Notifications** card, where you wire Castor to the outside world: alert channels for container and image-update events. That part is the exception to \"admin-only\" — **operators** can manage channels too." },
        ],
      },
      {
        title: "\"Require 2FA for mutations\"",
        blocks: [
          { kind: "p", text: "Setting `security.totp_required_for_mutations` — **OFF by default**. When you turn it **on**, any user who has 2FA enabled must enter a **TOTP code** to perform **any state-changing action** (start, stop, remove, deploy, scale, update…) and to open a terminal." },
          { kind: "p", text: "It **strengthens** the instance but adds a TOTP prompt to everyday work. Turn it **on** if the instance is reachable from the Internet; leave it **off** on a trusted, isolated network where the friction is not worth it." },
          { kind: "callout", tone: "warn", text: "This setting only bites users who **already have 2FA enrolled**. A user **without** 2FA has nothing to step up, so they are **not** blocked or affected. If you want the requirement to be real for everyone, **enforce 2FA enrolment separately** — this toggle alone will not force anyone to enrol." },
          { kind: "note", text: "Opening an **exec terminal** always demands a fresh TOTP code (step-up AAL), regardless of this setting. This toggle only extends that same step-up to all other mutations." },
        ],
      },
      {
        title: "Protected labels",
        blocks: [
          { kind: "p", text: "A list of labels — default `io.castor.protected` — that mark a workload as **protected**. Any container or pod carrying one of these labels **refuses deletion** unless you **confirm and give a reason**, so a stray click can never wipe it out." },
          { kind: "p", text: "Use it to shield your **infrastructure** workloads — database, reverse-proxy, message broker — from accidental removal. Label the critical container with `io.castor.protected=true` (or add your own label to the list) and Castor guards it from then on." },
          { kind: "note", text: "The Castor container itself is always protected, whatever this list says — Castor never lets you delete the tool you are working from without an explicit confirmation." },
        ],
      },
      {
        title: "Session lifetime",
        blocks: [
          { kind: "p", text: "Setting `session.ttl_seconds` — the **sliding inactivity window**. Each request resets the timer; after this much time **with no activity** the session expires and the user must sign in again. Accepted range: **300 s (5 min) to 24 h**." },
          { kind: "p", text: "Shorten it for a shared or exposed instance; lengthen it for a trusted workstation where re-authenticating all day is pure friction." },
        ],
      },
      {
        title: "Notifications",
        blocks: [
          { kind: "p", text: "The **Notifications** card manages outbound alert **channels**. A channel is a named destination — **Discord**, **Slack**, **ntfy** or a **generic webhook** — subscribed to one or more events. Click **Add channel**, give it a **Name**, pick a **Type**, paste the **Webhook URL** and tick the events you want it to receive." },
          { kind: "list", items: [
            "**Container went down** (`container.down`) — fires when a running container stops unexpectedly. The event is **debounced**, so a container flapping during a restart does not flood the channel.",
            "**Image update available** (`update.available`) — fires when Castor detects that a newer image is available for a running container.",
          ] },
          { kind: "p", text: "The **webhook URL is a secret**: it is **sealed with AES-256-GCM** on the server and **never displayed again** — neither in the UI nor through the API. When you edit a channel, the URL field shows the placeholder `•••••• (unchanged)`: **leave it blank to keep** the stored URL, or type a new one to replace it." },
          { kind: "p", text: "Each channel row carries an **enable/disable toggle**, a **Test** button that fires a test notification at the stored URL — the surest way to verify it before you depend on it — an **Edit** button, and a **delete** (trash) icon guarded by a confirmation. Alerts routed to a deleted channel stop immediately." },
          { kind: "callout", tone: "info", text: "Unlike the security settings above, channel changes apply **immediately** — they do **not** go through the page-level **Save changes** button." },
          { kind: "note", text: "Managing channels requires the **`notifications.manage`** permission, granted to both **admin** and **operator** roles. Users without it see the section but cannot list or change channels." },
        ],
      },
      {
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "If the instance is **exposed to the Internet**, turn **\"Require 2FA for mutations\"** on — but pair it with **enforced 2FA enrolment**, otherwise non-enrolled users slip through.",
            "**Label your critical containers** (`io.castor.protected=true`) before you need the safety net, not after a near-miss.",
            "Keep `session.ttl_seconds` **short on shared machines**; a long window on a public host is a hijack risk.",
            "Every setting here is **instance-wide** — announce changes to your team so a sudden TOTP prompt or session drop does not surprise them.",
            "The security settings are **admin** actions (`settings.update`); notification channels are the exception — **operator** can manage them too (`notifications.manage`).",
            "**Test a channel right after creating it** — the URL is never shown again, so a typo only surfaces through a failed **Test**.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://github.com/Yannleonard/Castor", label: "Castor — repository & documentation" },
        ],
      },
    ],
  },

  fr: {
    summary: "Contrôles de sécurité au niveau de l'instance (admin uniquement) — TOTP pour les mutations, labels protégés, fenêtre de session — plus les canaux de notification sortants (Discord, Slack, ntfy, webhook).",
    sections: [
      {
        title: "À quoi sert cette page",
        blocks: [
          { kind: "p", text: "La page **Réglages** regroupe les contrôles de sécurité au niveau de l'instance. Ils sont **réservés à l'admin** : un changement ici s'applique à **tous** les utilisateurs de cette instance Castor, pas seulement à vous. C'est ici que vous décidez de la sévérité de l'instance en matière d'**authentification renforcée** (step-up), des conteneurs **difficiles à supprimer par accident**, et de la durée de vie d'une session." },
          { kind: "p", text: "La page affiche aussi des **métadonnées d'instance** en lecture seule — **version** et **build** de Castor — pratiques pour signaler un incident ou vérifier que vous êtes bien sur la version attendue. Enfin, elle héberge la carte **Notifications**, où vous reliez Castor au monde extérieur : des canaux d'alerte pour les événements conteneurs et mises à jour d'images. C'est l'exception au « admin uniquement » — les **operators** peuvent aussi gérer les canaux." },
        ],
      },
      {
        title: "« 2FA requise pour les mutations »",
        blocks: [
          { kind: "p", text: "Réglage `security.totp_required_for_mutations` — **OFF par défaut**. Une fois **activé**, tout utilisateur ayant la 2FA activée doit saisir un **code TOTP** pour **toute action modifiante** (démarrer, arrêter, supprimer, déployer, scaler, mettre à jour…) et pour ouvrir un terminal." },
          { kind: "p", text: "Ce réglage **renforce** l'instance mais ajoute une demande de code TOTP au quotidien. **Activez-le** si l'instance est joignable depuis Internet ; **laissez-le désactivé** sur un réseau isolé et de confiance où la friction n'en vaut pas la peine." },
          { kind: "callout", tone: "warn", text: "Ce réglage ne concerne que les utilisateurs ayant **déjà enrôlé la 2FA**. Un utilisateur **sans** 2FA n'a rien à renforcer : il n'est donc **ni bloqué ni affecté**. Pour que l'exigence soit réelle pour tout le monde, **imposez l'enrôlement de la 2FA séparément** — ce seul interrupteur ne forcera personne à s'enrôler." },
          { kind: "note", text: "Ouvrir un **terminal exec** exige toujours un nouveau code TOTP (step-up AAL), quel que soit ce réglage. Cet interrupteur ne fait qu'étendre ce même step-up à toutes les autres mutations." },
        ],
      },
      {
        title: "Labels protégés",
        blocks: [
          { kind: "p", text: "Une liste de labels — par défaut `io.castor.protected` — qui marquent une charge comme **protégée**. Tout conteneur ou pod portant l'un de ces labels **refuse la suppression** tant que vous ne **confirmez pas en donnant une raison**, de sorte qu'un clic malencontreux ne peut jamais l'effacer." },
          { kind: "p", text: "Utilisez-le pour protéger vos charges d'**infrastructure** — base de données, reverse-proxy, broker de messages — d'une suppression accidentelle. Labellisez le conteneur critique avec `io.castor.protected=true` (ou ajoutez votre propre label à la liste) et Castor le garde à l'œil dès lors." },
          { kind: "note", text: "Le conteneur Castor lui-même est toujours protégé, quoi que dise cette liste — Castor ne vous laisse jamais supprimer l'outil depuis lequel vous travaillez sans confirmation explicite." },
        ],
      },
      {
        title: "Durée de session",
        blocks: [
          { kind: "p", text: "Réglage `session.ttl_seconds` — la **fenêtre glissante d'inactivité**. Chaque requête réarme le compteur ; après ce délai **sans activité**, la session expire et l'utilisateur doit se reconnecter. Plage acceptée : **300 s (5 min) à 24 h**." },
          { kind: "p", text: "Raccourcissez-la pour une instance partagée ou exposée ; allongez-la sur un poste de confiance où se réauthentifier toute la journée n'est que de la friction." },
        ],
      },
      {
        title: "Notifications",
        blocks: [
          { kind: "p", text: "La carte **Notifications** gère les **canaux** d'alerte sortants. Un canal est une destination nommée — **Discord**, **Slack**, **ntfy** ou un **webhook générique** — abonnée à un ou plusieurs événements. Cliquez sur **Add channel**, donnez-lui un **nom**, choisissez un **type**, collez l'**URL du webhook** et cochez les événements qu'il doit recevoir." },
          { kind: "list", items: [
            "**Conteneur tombé** (`container.down`) — se déclenche quand un conteneur en marche s'arrête de façon inattendue. L'événement est **débouncé** : un conteneur qui clignote pendant un redémarrage n'inonde pas le canal.",
            "**Mise à jour d'image disponible** (`update.available`) — se déclenche quand Castor détecte qu'une image plus récente existe pour un conteneur en marche.",
          ] },
          { kind: "p", text: "L'**URL du webhook est un secret** : elle est **scellée en AES-256-GCM** côté serveur et **jamais réaffichée** — ni dans l'interface, ni via l'API. Quand vous éditez un canal, le champ URL affiche le placeholder `•••••• (unchanged)` : **laissez-le vide pour conserver** l'URL stockée, ou saisissez-en une nouvelle pour la remplacer." },
          { kind: "p", text: "Chaque ligne de canal porte un **interrupteur activer/désactiver**, un bouton **Test** qui envoie une notification de test à l'URL stockée — le moyen le plus sûr de la vérifier avant d'en dépendre —, un bouton **Edit**, et une icône **corbeille** de suppression protégée par une confirmation. Les alertes routées vers un canal supprimé cessent immédiatement." },
          { kind: "callout", tone: "info", text: "Contrairement aux réglages de sécurité ci-dessus, les changements de canaux s'appliquent **immédiatement** — ils ne passent **pas** par le bouton **Save changes** de la page." },
          { kind: "note", text: "Gérer les canaux exige la permission **`notifications.manage`**, accordée aux rôles **admin** et **operator**. Un utilisateur qui ne l'a pas voit la section mais ne peut ni lister ni modifier les canaux." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Si l'instance est **exposée à Internet**, activez **« 2FA requise pour les mutations »** — mais couplez-la à un **enrôlement 2FA imposé**, sinon les utilisateurs non enrôlés passent au travers.",
            "**Labellisez vos conteneurs critiques** (`io.castor.protected=true`) avant d'en avoir besoin, pas après un incident évité de justesse.",
            "Gardez `session.ttl_seconds` **court sur les machines partagées** ; une fenêtre longue sur un hôte public est un risque de détournement de session.",
            "Chaque réglage ici est **valable pour toute l'instance** — prévenez votre équipe pour qu'une demande TOTP soudaine ou une session coupée ne la surprenne pas.",
            "Les réglages de sécurité sont des actions **admin** (`settings.update`) ; les canaux de notification font exception — **operator** peut aussi les gérer (`notifications.manage`).",
            "**Testez un canal juste après l'avoir créé** — l'URL n'est jamais réaffichée, donc une faute de frappe ne se révèle que par un **Test** en échec.",
          ] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          { kind: "doc", href: "https://github.com/Yannleonard/Castor", label: "Castor — dépôt & documentation" },
        ],
      },
    ],
  },
};
