// ui/src/help/cards/settings.ts — Instance settings (security) help card.
import type { HelpCard } from "../types";

export const settingsCard: HelpCard = {
  id: "settings",
  title: { en: "Instance settings", fr: "Réglages de l'instance" },

  en: {
    summary: "Instance-wide security controls (admin only): require TOTP for mutations, define protected labels, and set the session inactivity window.",
    sections: [
      {
        title: "What this page is for",
        blocks: [
          { kind: "p", text: "The **Settings** page holds the instance-wide security controls. They are **admin-only**: a change here applies to **every** user on this Castor instance, not just to you. From here you decide how strict the instance is about **step-up authentication**, which containers are **hard to delete by accident**, and how long a session stays alive." },
          { kind: "p", text: "The page also shows read-only **instance metadata** — Castor **version** and **build** — handy when reporting an issue or checking you are on the release you expect." },
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
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "If the instance is **exposed to the Internet**, turn **\"Require 2FA for mutations\"** on — but pair it with **enforced 2FA enrolment**, otherwise non-enrolled users slip through.",
            "**Label your critical containers** (`io.castor.protected=true`) before you need the safety net, not after a near-miss.",
            "Keep `session.ttl_seconds` **short on shared machines**; a long window on a public host is a hijack risk.",
            "Every setting here is **instance-wide** — announce changes to your team so a sudden TOTP prompt or session drop does not surprise them.",
            "These are **admin** actions; **operator** and **viewer** roles cannot change them.",
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
    summary: "Contrôles de sécurité au niveau de l'instance (admin uniquement) : exiger un code TOTP pour les mutations, définir les labels protégés et régler la fenêtre d'inactivité des sessions.",
    sections: [
      {
        title: "À quoi sert cette page",
        blocks: [
          { kind: "p", text: "La page **Réglages** regroupe les contrôles de sécurité au niveau de l'instance. Ils sont **réservés à l'admin** : un changement ici s'applique à **tous** les utilisateurs de cette instance Castor, pas seulement à vous. C'est ici que vous décidez de la sévérité de l'instance en matière d'**authentification renforcée** (step-up), des conteneurs **difficiles à supprimer par accident**, et de la durée de vie d'une session." },
          { kind: "p", text: "La page affiche aussi des **métadonnées d'instance** en lecture seule — **version** et **build** de Castor — pratiques pour signaler un incident ou vérifier que vous êtes bien sur la version attendue." },
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
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Si l'instance est **exposée à Internet**, activez **« 2FA requise pour les mutations »** — mais couplez-la à un **enrôlement 2FA imposé**, sinon les utilisateurs non enrôlés passent au travers.",
            "**Labellisez vos conteneurs critiques** (`io.castor.protected=true`) avant d'en avoir besoin, pas après un incident évité de justesse.",
            "Gardez `session.ttl_seconds` **court sur les machines partagées** ; une fenêtre longue sur un hôte public est un risque de détournement de session.",
            "Chaque réglage ici est **valable pour toute l'instance** — prévenez votre équipe pour qu'une demande TOTP soudaine ou une session coupée ne la surprenne pas.",
            "Ce sont des actions **admin** ; les rôles **operator** et **viewer** ne peuvent pas les modifier.",
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
