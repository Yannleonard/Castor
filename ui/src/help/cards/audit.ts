// ui/src/help/cards/audit.ts — Audit log: filtering & reading results help card.
import type { HelpCard } from "../types";

export const auditCard: HelpCard = {
  id: "audit",
  title: { en: "Audit log", fr: "Journal d'audit" },

  en: {
    summary: "An append-only record of every mutating action: who did what, on which target, when, and whether it succeeded, was denied, or errored.",
    sections: [
      {
        title: "What it's for",
        blocks: [
          { kind: "p", text: "The audit log records **every mutating action** performed through Castor. Each entry captures **who** (the actor plus their IP address), **what** (the action, e.g. `docker.container.remove`), **on what** (the target — a container, image, network…), **when**, and the **result**." },
          { kind: "p", text: "It is an **append-only** journal: entries are never modified or deleted by the application. This gives you a tamper-evident trail for **traceability and compliance**, and a way to answer \"who changed this, and when?\" after the fact." },
        ],
      },
      {
        title: "How it works in Castor",
        blocks: [
          { kind: "p", text: "Read-only operations (listing, inspecting, viewing logs) are **not** recorded — the log is deliberately focused on changes. Every lifecycle action, permission-sensitive request, and refused attempt lands here, whether it went through or not." },
          { kind: "p", text: "Viewing the log requires the **`audit.read`** permission, granted to **admin** by default. Operators and viewers don't see it unless a role explicitly gives them that permission." },
        ],
      },
      {
        title: "Filtering the log",
        blocks: [
          { kind: "p", text: "Use the filter controls at the top of the Audit view to narrow the list. You can filter by:" },
          { kind: "list", items: [
            "**Action** — the operation, e.g. `docker.container.start` or `docker.image.remove`.",
            "**Actor** — the user who triggered it.",
            "**Target type** — the kind of object acted on (container, image, network, volume…).",
            "**Result** — `success`, `denied`, or `error`.",
          ] },
          { kind: "p", text: "Click any row to open its **full JSON detail**. **Secrets are always redacted** in that detail — sealed values never appear in the audit log." },
        ],
      },
      {
        title: "Reading the result",
        blocks: [
          { kind: "p", text: "Each entry ends in one of three results:" },
          { kind: "list", items: [
            "**`success`** — the action ran and completed.",
            "**`denied`** — the action was **refused before running**, by RBAC (the actor lacked the permission) or by a guard-rail (e.g. deleting a protected container without a reason). Useful for spotting **unauthorized attempts**.",
            "**`error`** — the action was allowed but **failed technically** (the Docker engine returned an error, a timeout, etc.).",
          ] },
          { kind: "callout", tone: "info", text: "`denied` is not a bug — it means Castor **correctly stopped** something the actor wasn't allowed to do. The attempt is still logged, which is exactly the point." },
        ],
      },
      {
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "**Watch for repeated `denied` results** for the same actor: it usually signals a **permissions problem** (someone needs a role adjustment) or an **unauthorized attempt** worth investigating.",
            "Filter by **Result = `denied`** periodically as a lightweight security check.",
            "Remember the log covers **mutations only** — don't expect to find read/inspect activity here.",
            "Grant **`audit.read` sparingly**: the log reveals who does what across the whole system.",
          ] },
          { kind: "note", text: "CSV / JSON export of the audit log is **not available yet** — for now, review and filter entries directly in the view." },
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
    summary: "Un journal en ajout seul de chaque action modifiante : qui a fait quoi, sur quelle cible, quand, et si l'action a réussi, a été refusée ou a échoué.",
    sections: [
      {
        title: "À quoi ça sert",
        blocks: [
          { kind: "p", text: "Le journal d'audit enregistre **chaque action modifiante** effectuée via Castor. Chaque entrée capture **qui** (l'acteur et son adresse IP), **quoi** (l'action, ex. `docker.container.remove`), **sur quoi** (la cible — un conteneur, une image, un réseau…), **quand**, et le **résultat**." },
          { kind: "p", text: "C'est un journal en **ajout seul** (append-only) : les entrées ne sont jamais modifiées ni supprimées par l'application. Vous disposez ainsi d'une trace inviolable pour la **traçabilité et la conformité**, et d'un moyen de répondre après coup à « qui a changé ça, et quand ? »." },
        ],
      },
      {
        title: "Comment ça marche dans Castor",
        blocks: [
          { kind: "p", text: "Les opérations en lecture seule (lister, inspecter, consulter les logs) ne sont **pas** enregistrées — le journal se concentre volontairement sur les changements. Toute action de cycle de vie, toute requête sensible en permission et toute tentative refusée y figurent, qu'elles aient abouti ou non." },
          { kind: "p", text: "Consulter le journal requiert la permission **`audit.read`**, accordée par défaut à l'**admin**. Les operators et viewers ne le voient pas, sauf si un rôle leur donne explicitement cette permission." },
        ],
      },
      {
        title: "Filtrer le journal",
        blocks: [
          { kind: "p", text: "Utilisez les filtres en haut de la vue Audit pour restreindre la liste. Vous pouvez filtrer par :" },
          { kind: "list", items: [
            "**Action** — l'opération, ex. `docker.container.start` ou `docker.image.remove`.",
            "**Acteur** — l'utilisateur à l'origine de l'action.",
            "**Type de cible** — la nature de l'objet visé (conteneur, image, réseau, volume…).",
            "**Résultat** — `success`, `denied` ou `error`.",
          ] },
          { kind: "p", text: "Cliquez sur une ligne pour ouvrir son **détail JSON complet**. Les **secrets y sont toujours expurgés** — les valeurs scellées n'apparaissent jamais dans le journal d'audit." },
        ],
      },
      {
        title: "Lire le résultat",
        blocks: [
          { kind: "p", text: "Chaque entrée se termine par l'un des trois résultats :" },
          { kind: "list", items: [
            "**`success`** — l'action s'est exécutée et a abouti.",
            "**`denied`** — l'action a été **refusée avant exécution**, par le RBAC (l'acteur n'avait pas la permission) ou par un garde-fou (ex. suppression d'un conteneur protégé sans raison). Utile pour repérer des **tentatives non autorisées**.",
            "**`error`** — l'action était autorisée mais a **échoué techniquement** (le moteur Docker a renvoyé une erreur, un timeout, etc.).",
          ] },
          { kind: "callout", tone: "info", text: "`denied` n'est pas un bug : cela signifie que Castor a **correctement bloqué** une action que l'acteur n'avait pas le droit de faire. La tentative reste journalisée, et c'est tout l'intérêt." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "**Surveillez les `denied` répétés** pour un même acteur : c'est souvent le signe d'un **problème de permissions** (un rôle à ajuster) ou d'une **tentative non autorisée** à investiguer.",
            "Filtrez périodiquement sur **Résultat = `denied`** comme contrôle de sécurité léger.",
            "Rappelez-vous que le journal ne couvre **que les mutations** — n'y cherchez pas l'activité de lecture / inspection.",
            "Accordez **`audit.read` avec parcimonie** : le journal révèle qui fait quoi sur l'ensemble du système.",
          ] },
          { kind: "note", text: "L'export CSV / JSON du journal d'audit n'est **pas encore disponible** — pour l'instant, consultez et filtrez les entrées directement dans la vue." },
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
