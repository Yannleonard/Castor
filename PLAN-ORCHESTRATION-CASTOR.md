# CASTOR — Plan d'orchestration multi-agents

> **Castor** — *Gérer • Déployer • Orchestrer*
> Plateforme open-source de gestion & orchestration de conteneurs multi-hôtes
> (Docker · Docker Swarm · Kubernetes). Distribuée en image Docker, gratuite,
> communautaire. Éditée par **LEONARD-IT/GTEK-IT**.
>
> Statut : **PLAN / cadrage** — aucun code produit. Document de pilotage.
> Date : 2026-06-02

---

## 1. Vision & positionnement

| Axe | Décision |
|---|---|
| **Nature** | Produit **open-source autonome** (PAS un module de CGM). Repo séparé. |
| **Licence** | **Apache-2.0** (permissif + clause brevets, adoption entreprise, copyright LEONARD-IT/GTEK-IT, édition Business future possible) |
| **Distribution** | **Image Docker** (`docker run` / `docker compose up` en < 2 min). Self-hosted. |
| **Cible** | Homelabbers, PME, MSSP, équipes DevOps — quiconque gère des conteneurs sur 1..N serveurs |
| **Promesse** | « Portainer en mieux » : multi-hôtes natif, design moderne, Docker **+ Swarm + Kubernetes** dès la V1 |
| **Modèle communauté** | Gratuit, ouvert aux contributions, vitrine technique LEONARD-IT/GTEK-IT. CGM pourra *optionnellement* consommer Castor plus tard (jamais l'inverse). |
| **Ambition concurrentielle** | Portainer (Docker+K8s), Komodo (GPL), Dockge (compose only), Rancher (K8s only). Castor = les 3 orchestrateurs + UX supérieure + FOSS permissif. |

### Pourquoi « le mieux » se gagne sur (différenciateurs vs Portainer)
1. **Vue multi-hôtes unifiée première-classe** (le pain point #1 : savoir QUEL conteneur sur QUEL serveur).
2. **Design moderne** (dark, mascotte, temps réel fluide) vs UI Portainer datée.
3. **3 orchestrateurs sous une seule UX cohérente** (Docker/Swarm/K8s) sans changer d'outil.
4. **Installation triviale** + agent ultra-léger (Go).
5. **Sécurité par défaut** (mTLS, RBAC, 2FA, audit) — héritage de l'ADN cyber LEONARD-IT/GTEK-IT.
6. **Templates/marketplace** d'apps en un clic (réutilise le catalogue Docker Apps de CGM).

---

## 2. Décisions structurantes À TRANCHER (jalons du plan, pas figées ici)

Ces points sont **délégués aux agents experts** dans les phases ci-dessous :

| # | Question ouverte | Agent décideur | Phase |
|---|---|---|---|
| D1 | **Transport & scalabilité** : snapshot périodique (Portainer-like) vs RPC interactif ? Push agent→serveur vs pull ? Tenue à centaines de conteneurs / dizaines d'hôtes | architect + docker-swarm-k8s-expert | P0 |
| D2 | **Agent** : forker l'agent Go CGM existant (réutilise list/inspect/stats/logs/exec/events) en projet autonome, ou repartir neuf ? | architect + docker-swarm-k8s-expert | P0 |
| D3 | **Abstraction multi-orchestrateur** : une interface commune (Provider) Docker/Swarm/K8s, ou 3 backends séparés ? | architect | P0 |
| D4 | **Stack serveur** : Go (cohérent agent) ou Node/TS (cohérent CGM/réutilise composants React) ? DB (Postgres ? SQLite embarqué pour le self-host léger ?) | architect | P0 |
| D5 | **K8s** : client-go natif vs Helm wrapping ; périmètre V1 K8s (read + actions de base vs full) | docker-swarm-k8s-expert | P0/P2 |

---

## 3. Architecture cible (proposition initiale, à valider en P0)

```
                       ┌──────────────────────────────────────────┐
                       │              CASTOR SERVER                 │
                       │  (UI React + API + orchestrateur d'agents) │
                       │  - Auth (local + OIDC/OAuth2 + TOTP)       │
                       │  - RBAC resource-scoped                    │
                       │  - Cache d'état (snapshots) + DB           │
                       │  - Provider abstraction:                   │
                       │      DockerProvider / SwarmProvider /      │
                       │      K8sProvider                           │
                       └───────────────▲────────────────────────────┘
                                       │  connexion SORTANTE agent→serveur
                                       │  (mTLS, tunnel inversé, snapshots push
                                       │   + commandes pull, stats on-demand)
             ┌─────────────────────────┼─────────────────────────┐
             │                         │                         │
      ┌──────┴──────┐           ┌──────┴──────┐           ┌──────┴──────┐
      │ Agent Go     │           │ Agent Go     │           │ Agent Go     │
      │ HÔTE 1       │           │ HÔTE 2       │           │ HÔTE 3 / K8s │
      │ Docker sock  │           │ Swarm mgr    │           │ kubeconfig   │
      └──────────────┘           └──────────────┘           └──────────────┘
```

**Principes** :
- **Agent unique léger** (Go) déployé par hôte ; détecte le mode (Docker / Swarm node / K8s) et expose les capacités correspondantes.
- **Connexion sortante** (agent initie) → pas de port entrant à ouvrir, traverse NAT/firewall (clé pour le self-host grand public).
- **État de flotte par snapshot** (léger, périodique) + **stats live à la demande** (un seul conteneur ouvert à la fois) → tient la charge.
- **Sécurité** : mTLS auto-rotation, allowlist d'opérations par agent (héritée de l'agent CGM), RBAC côté serveur, audit log de toute action.
- **Garde-fous** : conteneurs "système/protégés" marqués (ex. un utilisateur ne supprime pas l'agent Castor lui-même par accident) — héritage de la philosophie anti-régression CGM.

---

## 4. Équipe d'agents experts mobilisés

| Agent | Rôle sur Castor |
|---|---|
| **architect** | ADR fondateurs (transport, abstraction multi-orchestrateur, stack, DB), cohérence système, arbitrages D1-D5 |
| **docker-swarm-k8s-expert** | Cœur métier : modèle Docker/Swarm/K8s, client-go, scalabilité agent, benchmark snapshot vs stream |
| **(frontend/design)** *(via claude + charte)* | UX/UI moderne, design system Castor (charte logo), maquettes → composants React, temps réel |
| **security-auditor / compliance-expert** | mTLS, RBAC, 2FA, audit, threat model (un outil qui contrôle Docker = surface critique), licences des deps |
| **qa-engineer** | Stratégie de test (unit Go + e2e UI), tests de charge (centaines de conteneurs simulés), CI |
| **backup-sync-expert / docker-apps-expert** | Packaging image Docker, compose de déploiement, marketplace/templates, distribution communauté |
| **project-manager** | Roadmap V1/V2, jalons, découpage issues, gestion communauté (CONTRIBUTING, gouvernance) |
| **bmad-orchestrator** | Coordination des sessions multi-agents, persistance artifacts/handoffs |

---

## 5. Phases d'exécution (orchestration)

### **P0 — Fondations & décisions d'archi** (architect + docker-swarm-k8s-expert)
- ADR-CASTOR-001 : transport & scalabilité (D1) — benchmark snapshot/push vs RPC ; cible chiffrée (ex. 500 conteneurs / 20 hôtes, < X% CPU agent, < Y s latence UI).
- ADR-CASTOR-002 : abstraction Provider multi-orchestrateur (D3) + périmètre Docker/Swarm/K8s V1 (D5).
- ADR-CASTOR-003 : stack serveur + DB + agent (D2, D4) — décision fork agent Go.
- Livrable : repo Castor scaffoldé (structure mono-repo : `/server`, `/agent`, `/ui`, `/deploy`, `/docs`), licence Apache-2.0, README, CONTRIBUTING, charte de marque.

### **P1 — Agent + transport (le socle qui scale)** (docker-swarm-k8s-expert + qa)
- Extraire/forker l'agent Go (list/inspect/start/stop/restart/remove/logs/stats/exec/events/images/networks/volumes — déjà existants).
- Implémenter le **transport sortant + snapshot périodique + stats on-demand** décidé en P0.
- Provider Docker complet + Swarm (services, nodes, tasks).
- Tests de charge (centaines de conteneurs).

### **P2 — Serveur + API + multi-hôtes** (architect + backend)
- Orchestrateur d'agents (enrôlement, état, RBAC, audit).
- API REST/WS, auth (local + OIDC + TOTP).
- K8s Provider (périmètre V1 défini en P0).

### **P3 — UI moderne** (frontend/design)
- Design system Castor (à partir de la maquette validée).
- Vues : Hôtes/Clusters, Conteneurs par hôte, Détail (logs/terminal/stats/inspect), Stacks/Compose, Services Swarm, Workloads K8s, Marketplace, Audit, RBAC/Users.
- Temps réel (snapshots + live stats).

### **P4 — Packaging, sécurité, communauté** (security + devrel/packaging + pm)
- Image Docker multi-arch (amd64/arm64), `docker-compose.yml` de déploiement 1-commande.
- Threat model + audit sécu + scan deps.
- Docs (install, configuration, sécurité), site/landing, gouvernance open-source, premiers "good first issues".
- Release v0.1 publique.

### **P5 — Boucle communauté & V2**
- K8s avancé (Helm, manifests), CI/CD push-to-deploy, marketplace étendu, intégration optionnelle CGM.

---

## 6. Ce qui est réutilisable de l'existant (gain de temps)

| Brique CGM existante | Réutilisation Castor |
|---|---|
| **Agent Go** (`infrastructure/dockerapps-agent`) | Base de l'agent Castor — 25+ méthodes RPC Docker déjà implémentées (container/image/network/volume/exec/logs/stats/events) |
| **Composants React** (ContainerManagerTab, DockerTerminal, Sparkline, StatusDot, ResourcesTab…) | Base des composants UI Castor (à réskinner charte Castor) |
| **Catalogue Docker Apps** (`shared/docker-apps-catalog.ts`) | Base du marketplace de templates Castor |
| **Patterns mTLS / allowlist / tenant-isolation** | Modèle de sécurité Castor (adapté multi-utilisateurs au lieu de multi-tenant) |
| **Expérience scalabilité** (flap WS, snapshot stats) | Leçons directes pour le choix de transport P0 |

> ⚠️ **Attention découplage** : Castor étant autonome, on EXTRAIT/copie ces briques dans le repo Castor ; on ne crée PAS de dépendance Castor→CGM.

---

## 7. Risques & garde-fous

| Risque | Mitigation |
|---|---|
| **K8s triple l'effort** (logo l'annonce, V1 ambitieuse) | P0 définit un périmètre K8s V1 réaliste (read + actions de base), full en V2. Le logo reste honnête (3 orchestrateurs présents). |
| **Scalabilité agent** (centaines de conteneurs) | Décision transport P0 + tests de charge P1 AVANT de bâtir l'UI dessus. |
| **Surface de sécurité** (un outil qui contrôle Docker = cible) | Threat model dédié, mTLS, RBAC, audit, agent en lecture par défaut + élévation explicite. |
| **Sur-couplage à CGM** | Repo séparé, extraction (pas import), CI indépendante. |
| **Confusion infra CGM ↔ produit** | Castor ne gère JAMAIS automatiquement l'infra CGM ; si GTEK l'utilise en interne, c'est une instance Castor scopée, séparée. |

---

## 8. Prochaines étapes immédiates
1. ✅ Logo & charte (fait — marine #0A2540, Docker #2496ED, sarcelle #13A688, brun castor)
2. ⏳ **Maquette interactive** (proposition graphique cliquable) — en cours
3. ⏳ Validation Yann du plan + de la maquette
4. ⏳ Lancement P0 (workflow multi-agents : ADR fondateurs + scaffolding repo)
