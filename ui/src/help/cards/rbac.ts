// ui/src/help/cards/rbac.ts — Users, roles & permissions (RBAC) help card.
import type { HelpCard } from "../types";

export const rbacCard: HelpCard = {
  id: "rbac",
  title: { en: "Users, roles & permissions (RBAC)", fr: "Utilisateurs, rôles & permissions (RBAC)" },

  en: {
    summary: "Role-Based Access Control decides who can do what in Castor — from read-only supervision to full administration.",
    sections: [
      {
        title: "What RBAC is for",
        blocks: [
          { kind: "p", text: "RBAC (**Role-Based Access Control**) governs **who can do what** in Castor. Every user is assigned one or more **roles**, and each role is a bundle of **permissions**. Before any action runs — starting a container, reading logs, scaling a service — Castor checks that the caller holds the matching permission. No permission, no action." },
          { kind: "p", text: "This lets a small team share one Castor instance safely: operators run day-to-day operations, on-call staff just watch, and only administrators touch the dangerous levers." },
        ],
      },
      {
        title: "The three built-in roles",
        blocks: [
          { kind: "p", text: "Castor ships with three ready-to-use roles, from most to least privileged:" },
          { kind: "list", items: [
            "**admin** — everything, via the wildcard `*`. Manages users and roles, creates containers, deletes images/volumes. Reserve it for the people who run the platform.",
            "**operator** — everyday operations: start / stop / restart, logs, stats, **exec**, image pull, backup, Swarm/K8s scale, and `helm install / upgrade / rollback`. Notably does **NOT** create containers, delete images or volumes, or manage users.",
            "**viewer** — read-only. List and inspect containers, services, pods; read logs and the audit trail. Perfect for supervision dashboards and on-call visibility with zero mutation risk.",
          ] },
          { kind: "note", text: "`docker.container.create` is deliberately **admin-only** — see \"Pitfalls\" below." },
        ],
      },
      {
        title: "How permissions are named",
        blocks: [
          { kind: "p", text: "Permissions use a **dotted** `domain.resource.verb` shape, so they read almost like plain English:" },
          { kind: "list", items: [
            "`docker.container.start` — start a container.",
            "`k8s.pod.read` — list / read pods.",
            "`audit.read` — view the audit log.",
          ] },
          { kind: "p", text: "The **domain** is the area (`docker`, `k8s`, `helm`, `audit`, `users`…), the **resource** is the object (`container`, `pod`, `image`…), and the **verb** is the action (`read`, `start`, `create`, `delete`…). The `*` wildcard held by **admin** matches every permission at once." },
        ],
      },
      {
        title: "Creating roles & assigning them",
        blocks: [
          { kind: "p", text: "In the **Users & roles** view you can:" },
          { kind: "list", items: [
            "**Create a custom role** by ticking exactly the permissions it should grant — start from the built-in roles and narrow down.",
            "**Assign a role to a user** together with a **scope**: either **global** (all hosts) or **restricted to one host**, so an operator can manage a single machine and nothing else.",
            "Give a user **several roles**; their effective permissions are the union.",
          ] },
          { kind: "callout", tone: "warn", text: "You can only grant permissions you already hold yourself — Castor blocks **privilege self-escalation**. An operator cannot mint a role that hands out `docker.container.create` because they don't have it to give." },
        ],
      },
      {
        title: "Pitfalls & best practices",
        blocks: [
          { kind: "list", items: [
            "Follow the **principle of least privilege**: hand out the narrowest role that still lets the job get done.",
            "Use **operator** for day-to-day running of the fleet, **viewer** for monitoring and on-call visibility, and keep **admin** to a tiny trusted circle.",
            "`docker.container.create` is **admin-only** on purpose: creating a container lets you mount arbitrary **host paths** (bind mounts), which is a direct host-escalation vector. Treat it like root.",
            "Prefer **host-scoped** assignments over global ones when a user only needs one machine.",
            "Remember mutations may require **2FA (TOTP)** when \"2FA required for mutations\" is enabled, and opening an **exec terminal always** demands a step-up 2FA challenge — RBAC and 2FA stack.",
            "Audit changes via `audit.read`: every role and assignment change is logged.",
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
    summary: "Le contrôle d'accès basé sur les rôles décide qui peut faire quoi dans Castor — de la supervision en lecture seule à l'administration complète.",
    sections: [
      {
        title: "À quoi sert le RBAC",
        blocks: [
          { kind: "p", text: "Le RBAC (**contrôle d'accès basé sur les rôles**) régit **qui peut faire quoi** dans Castor. Chaque utilisateur se voit attribuer un ou plusieurs **rôles**, et chaque rôle regroupe un ensemble de **permissions**. Avant toute action — démarrer un conteneur, lire des logs, scaler un service — Castor vérifie que l'appelant détient la permission correspondante. Pas de permission, pas d'action." },
          { kind: "p", text: "Cela permet à une petite équipe de partager une même instance Castor en toute sécurité : les opérateurs gèrent l'exploitation quotidienne, l'astreinte se contente d'observer, et seuls les administrateurs touchent aux leviers dangereux." },
        ],
      },
      {
        title: "Les trois rôles intégrés",
        blocks: [
          { kind: "p", text: "Castor fournit trois rôles prêts à l'emploi, du plus au moins privilégié :" },
          { kind: "list", items: [
            "**admin** — tout, via le wildcard `*`. Gère les utilisateurs et les rôles, crée des conteneurs, supprime images et volumes. À réserver aux personnes qui exploitent la plateforme.",
            "**operator** — les opérations du quotidien : start / stop / restart, logs, stats, **exec**, pull d'image, backup, scale Swarm/K8s et `helm install / upgrade / rollback`. Ne peut notamment **PAS** créer de conteneur, ni supprimer d'image ou de volume, ni gérer les utilisateurs.",
            "**viewer** — lecture seule. Lister et inspecter conteneurs, services, pods ; lire les logs et le journal d'audit. Idéal pour les tableaux de supervision et la visibilité d'astreinte, sans aucun risque de mutation.",
          ] },
          { kind: "note", text: "`docker.container.create` est volontairement **réservé à l'admin** — voir « Pièges » plus bas." },
        ],
      },
      {
        title: "Comment les permissions sont nommées",
        blocks: [
          { kind: "p", text: "Les permissions suivent une forme **dottée** `domaine.ressource.verbe`, si bien qu'elles se lisent presque en langage courant :" },
          { kind: "list", items: [
            "`docker.container.start` — démarrer un conteneur.",
            "`k8s.pod.read` — lister / lire les pods.",
            "`audit.read` — consulter le journal d'audit.",
          ] },
          { kind: "p", text: "Le **domaine** est le périmètre (`docker`, `k8s`, `helm`, `audit`, `users`…), la **ressource** est l'objet (`container`, `pod`, `image`…) et le **verbe** est l'action (`read`, `start`, `create`, `delete`…). Le wildcard `*` que détient **admin** englobe d'un coup toutes les permissions." },
        ],
      },
      {
        title: "Créer des rôles & les assigner",
        blocks: [
          { kind: "p", text: "Dans la vue **Utilisateurs & rôles**, vous pouvez :" },
          { kind: "list", items: [
            "**Créer un rôle personnalisé** en cochant exactement les permissions à accorder — partez des rôles intégrés et restreignez.",
            "**Assigner un rôle à un utilisateur** avec une **portée** : soit **globale** (tous les hôtes), soit **limitée à un hôte**, afin qu'un opérateur ne gère qu'une seule machine et rien d'autre.",
            "Attribuer **plusieurs rôles** à un utilisateur ; ses permissions effectives sont l'union des rôles.",
          ] },
          { kind: "callout", tone: "warn", text: "Vous ne pouvez accorder que des permissions que vous détenez déjà vous-même — Castor bloque l'**auto-escalade de privilèges**. Un operator ne peut pas fabriquer un rôle distribuant `docker.container.create` puisqu'il ne le possède pas lui-même." },
        ],
      },
      {
        title: "Pièges & bonnes pratiques",
        blocks: [
          { kind: "list", items: [
            "Appliquez le **principe du moindre privilège** : donnez le rôle le plus étroit qui permet encore de faire le travail.",
            "Utilisez **operator** pour l'exploitation quotidienne du parc, **viewer** pour la supervision et la visibilité d'astreinte, et gardez **admin** pour un tout petit cercle de confiance.",
            "`docker.container.create` est **réservé à l'admin** à dessein : créer un conteneur permet de monter des **chemins hôtes** arbitraires (bind mounts), ce qui est un vecteur direct d'escalade sur l'hôte. Traitez-le comme du root.",
            "Préférez des assignations **limitées à un hôte** plutôt que globales quand un utilisateur n'a besoin que d'une machine.",
            "N'oubliez pas que les mutations peuvent exiger la **2FA (TOTP)** lorsque « 2FA requise pour les mutations » est activée, et qu'ouvrir un **terminal exec exige toujours** un challenge 2FA de step-up — RBAC et 2FA se cumulent.",
            "Auditez les changements via `audit.read` : chaque modification de rôle ou d'assignation est journalisée.",
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
