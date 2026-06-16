> [🇬🇧 English](security.md) · 🇫🇷 **Français**

# Castor — Sécurité & Modèle de menaces (synthèse)

Ce runbook synthétise la posture de sécurité de Castor à l'intention des opérateurs. La conception
faisant autorité est **ADR-CASTOR-003 §5–§7** ([`../adr/ADR-CASTOR-003-stack-storage-auth-security.md`](../adr/ADR-CASTOR-003-stack-storage-auth-security.md)).

> **Prémisse fondamentale.** L'accès à `/var/run/docker.sock` est **équivalent à root sur l'hôte** : un
> conteneur qui monte la socket en bind mount (ou le système de fichiers de l'hôte) peut s'évader vers
> root. Castor ne laisse donc **pas** un non-administrateur créer un tel conteneur — le **garde-fou
> host-mount** (T2 ci-dessous) rejette par défaut les bind mounts de l'hôte (y compris la socket) ;
> seuls les volumes nommés sont autorisés, et les chemins socket / racine de l'hôte sont refusés même
> aux administrateurs via l'API. Un utilisateur disposant d'un accès brut à l'OS/la socket en dehors de
> Castor peut toujours contourner Castor entièrement. Tout ce qui suit maintient un rayon d'impact
> réduit et rend chaque action attribuable ; le garde-fou des conteneurs protégés défend contre une
> destruction *accidentelle*, pas contre un adversaire déterminé disposant de root sur l'hôte (qui peut
> piloter la socket directement).

---

## 1. Authentification

- **Mots de passe :** hachés avec **argon2id** (`golang.org/x/crypto/argon2`, `IDKey`), paramètres
  encodés dans une chaîne PHC auto-descriptive ; vérifiés en temps constant.
- **Sessions :** côté serveur, liées à un cookie. Le cookie `castor_session` contient un identifiant
  aléatoire opaque de 256 bits ; seul `SHA-256(id)` est stocké au repos (une fuite de la base de
  données ne livre aucun cookie actif). Indicateurs du cookie : `HttpOnly`, `SameSite=Strict`,
  `Path=/`, et `Secure` lorsque la requête est en HTTPS (derrière un proxy, uniquement lorsque
  `CASTOR_TRUST_PROXY=true`). TTL glissant de 12 h, plafond absolu de 24 h ; la déconnexion et le
  changement de mot de passe révoquent les sessions.
- **2FA TOTP :** `github.com/pquerna/otp`. Le secret TOTP est **scellé en AES-256-GCM** sous
  `CASTOR_SECRET_KEY`. La confirmation de l'enrôlement génère **10 codes de récupération à usage
  unique** (affichés une seule fois, stockés hachés en argon2id). La connexion se fait en deux étapes :
  mot de passe → `amr=pwd` ; un code TOTP/de récupération valide élève la session à `amr=pwd+totp`
  (AAL2).
- **L'élévation (step-up) pour les mutations est OPT-IN et DÉSACTIVÉE par défaut.** Le paramètre
  `security.totp_required_for_mutations` (`SettingTOTPRequiredForMut`) **vaut `false` par défaut** —
  par défaut, une session avec mot de passe uniquement peut effectuer des mutations. Lorsqu'un
  opérateur l'**active** (interface Settings, ou le paramètre persisté), chaque route REST mutante
  (middleware `RequireAAL`) **et** le **WebSocket exec** interactif exigent `amr=pwd+totp` pour tout
  utilisateur ayant le TOTP activé ; un tel utilisateur disposant seulement de `amr=pwd` est rejeté
  (`aal_required`, 403) jusqu'à ce qu'il complète le TOTP. Les utilisateurs sans TOTP enrôlé ne sont
  pas affectés par ce drapeau (il n'y a rien vers quoi s'élever) — imposez l'enrôlement de façon
  opérationnelle si vous exigez l'AAL2 sur l'ensemble de la flotte.
- **Bootstrap :** au premier lancement (utilisateurs vides + `bootstrap.completed != true`), un endpoint
  à usage unique de création d'administrateur est ouvert ; toutes les autres routes renvoient
  `409 bootstrap_required`. Optionnellement protégé par `CASTOR_BOOTSTRAP_TOKEN` pour les installations
  non assistées.

---

## 2. Autorisation (RBAC à portée de ressource)

- Les permissions sont en notation pointée `domain.resource.verb` (p. ex. `docker.container.start`,
  `docker.container.remove`, `docker.image.delete`, `swarm.service.read`, `k8s.pod.read`,
  `audit.read`) ; `*` = superutilisateur.
- Imposées en **un seul point de passage côté serveur** — une chaîne de middleware chi fixe
  (`RequestID → RealIP → Recoverer → SecurityHeaders → SessionAuth → CSRF → RequireAAL →
  RequirePermission → AuditWrap → handler`). **Aucun handler n'effectue de mutation Docker sans
  franchir ce point de contrôle.** Les refus renvoient `403` et sont audités.
- **Rôles intégrés :** `admin` (`*`), `operator` (lecture Docker + cycle de vie [start/stop/restart/
  pause/unpause] / exec / logs / pull d'image, **pas** de **création** de conteneur, ni
  suppression / suppression d'image / suppression de volume / gestion des utilisateurs / actions sur
  conteneurs protégés), `viewer` (lecture seule ; pas d'exec, pas de logs par défaut). Les contrôles
  sont conscients de la portée, de sorte que le multi-hôte V2 ne nécessite aucune réécriture.
- **`docker.container.create` est réservé à admin / octroi explicite.** C'est l'unique vecteur
  d'élévation de privilèges (le seul verbe qui peut demander un bind mount de l'hôte), il n'est donc
  **pas** dans l'octroi par défaut de l'operator — seul le `*` de `admin` le satisfait. Il reste une
  permission réelle et attribuable : un administrateur peut l'ajouter à un rôle personnalisé (et le
  garde-fou host-mount ci-dessous s'applique toujours à qui la détient).
- **N'octroyer que ce que l'on détient.** Créer/mettre à jour un rôle ou créer une liaison de rôle
  (role-binding) rejette (403, audité) toute permission que l'utilisateur **agissant** ne détient pas
  lui-même à la portée cible — y compris `*` et les jokers de domaine (`docker.*`). Pour une liaison,
  l'acteur doit détenir chaque permission que porte le rôle lié à la portée de la liaison. Cela ferme
  l'auto-élévation RBAC (p. ex. un utilisateur disposant de `rbac.binding.create` mais seulement de
  permissions étroites ne peut pas se lier lui-même le rôle admin `*`).

---

## 3. Menaces & mitigations par défaut

| Menace | Mitigation par défaut |
|---|---|
| **T1 — Exposition de la socket / SSRF vers la socket** | La socket n'est touchée **que** via le `DockerProvider` typé ; aucune chaîne utilisateur n'est interpolée dans les appels à la socket ; **aucune fonctionnalité d'URL sortante côté serveur** en V1 ; conteneur non-root + socket-proxy recommandés (`CASTOR_DOCKER_HOST`). |
| **T2 — Élévation de privilèges via création de conteneur / évasion par host-mount** | `docker.container.create` est **réservé à admin / octroi explicite** (pas un défaut de l'operator). Les références d'image sont validées côté serveur. Le **garde-fou host-mount** s'exécute côté serveur avant `ContainerCreate` (déploiement en un clic **et** stacks compose) : un **bind mount de l'hôte est rejeté par défaut (403, audité)** pour les non-administrateurs — seuls les **volumes nommés** sont autorisés. Un superutilisateur global peut choisir (`allowHostMounts`) de monter un chemin hôte *ordinaire*, mais un ensemble fixe de chemins de prise de contrôle de l'hôte — `/var/run/docker.sock`, `/`, `/etc`, `/root`, `/home`, `/boot`, `/var/lib/docker`, `/run`, `/proc`, `/sys`, `/dev` (et les chemins imbriqués) — est **refusé en dur pour tout le monde via l'API**. Le garde-fou est imposé à nouveau à l'intérieur du provider en défense en profondeur, de sorte qu'aucun chemin de code ne peut créer un conteneur avec un bind mount hôte interdit. |
| **T3 — Abus d'exec / de logs** | `docker.container.exec` et `docker.container.logs` sont des permissions **distinctes, contrôlées, toujours auditées** ; le WebSocket exec/logs **revalide la session + la permission au moment de la connexion** et se ferme si la session est révoquée. La souscription **exec** impose en outre le même contrôle d'**élévation TOTP (AAL)** que les mutations REST — ouvrir un shell capable d'agir en root ne peut pas contourner l'élévation (voir la note du §1 sur `security.totp_required_for_mutations`). |
| **T4 — CSRF** | Cookie `SameSite=Strict` + un **jeton CSRF par session** requis dans `X-Castor-CSRF` sur chaque requête mutante + une **liste blanche Origin/Referer** sur les mutations et l'upgrade WS. |
| **T5 — Fuite de secrets** | Un redacteur à liste de refus retire les valeurs `password`/`token`/`secret`/`authorization`/`*_key`/des variables d'environnement avant que quoi que ce soit ne soit journalisé ou écrit dans `audit_log.detail` ; `password_hash`, `totp_secret_enc`, les hachés des codes de récupération et les identifiants de session bruts portent `json:"-"` ; l'inspection de conteneur masque les valeurs d'environnement à allure de secret sauf si un administrateur détient une permission explicite. |
| **T6 — Session / force brute** | Nouvel identifiant de session aléatoire à la connexion (pas de fixation) ; haché au repos ; limitation/verrouillage des connexions (`failed_logins` + `locked_until`) ; comparaison de mot de passe en temps constant ; messages d'erreur uniformes (pas d'énumération d'utilisateurs) ; codes de récupération à usage unique ; fenêtre TOTP de ±1 pas. |
| **T7 — Chaîne d'approvisionnement de Castor / durcissement du conteneur** | Distroless `static:nonroot` (uid 65532), sans shell ni libc, rootfs en lecture seule + `cap_drop: ALL` + `no-new-privileges` en compose ; jeu de dépendances épinglé et restreint ; la CI exécute `govulncheck` + une construction d'image ; **en-têtes de sécurité** stricts (CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, HSTS en HTTPS, `Cache-Control: no-store` sur `/api`). |
| **T8 — Destruction accidentelle d'infrastructure critique** | Le **garde-fou des conteneurs protégés** (ci-dessous). |

---

## 4. Garde-fou des conteneurs protégés (anti-foot-gun)

Évalué **avant** tout verbe Docker destructif (`stop`/`kill`/`restart`/`remove`/`rename`/
`recreate`/`prune`), via `GuardDestructive(ctx, target, actor)` :

1. **Auto-protection (toujours active, ne peut pas être désactivée).** Castor identifie l'identifiant
   de **son propre** conteneur au démarrage (`/proc/self/cgroup` + `CASTOR_SELF_CONTAINER_ID`,
   recoupé via inspect). Les actions destructives visant le propre conteneur de Castor **ou le volume
   contenant `/data`** sont **refusées en dur (`409 protected_resource`)** pour **tout le monde, y
   compris les administrateurs**, via l'UI/l'API.
2. **Protection par label.** Les conteneurs étiquetés **`io.castor.protected="true"`** (ou
   correspondant au paramètre configurable `security.protected_labels`) sont refusés aux
   non-administrateurs et exigent une **confirmation explicite + un motif** (écrit dans le journal
   d'audit) pour les administrateurs. Étiquetez en conséquence vos conteneurs de base de données, de
   reverse proxy et autres conteneurs d'infrastructure.
3. **Refus par défaut en cas d'ambiguïté.** Si Castor ne peut pas confirmer positivement que la cible
   n'est *pas* lui-même (p. ex. l'inspect échoue), l'action destructive est **refusée**, et non
   autorisée.

> Ce garde-fou empêche l'auto-destruction *accidentelle* depuis l'UI. Ce n'est **pas** une frontière
> contre un opérateur disposant de root sur l'hôte, qui peut toujours contourner Castor via la
> CLI/socket Docker.

---

## 5. La clé secrète

`CASTOR_SECRET_KEY` (32 octets, 64 caractères hex issus de `openssl rand -hex 32`) scelle les secrets
TOTP au repos. Responsabilités de l'opérateur :

- La stocker dans un **gestionnaire de secrets** ; ne jamais la committer ; ne jamais la journaliser.
- **La perdre rend la 2FA enrôlée irrécupérable** — la 2FA des utilisateurs affectés doit être
  réinitialisée hors bande.
- La faire tourner invalide les secrets TOTP scellés existants (prévoyez un ré-enrôlement).

---

## 6. Journal d'audit

- Chaque action **mutante** écrit exactement **une ligne en ajout seul** (`audit_log`) : acteur, IP,
  action, cible, portée, résultat (`success`/`denied`/`error`), statut HTTP, détail assaini,
  identifiant de requête.
- Les lignes ne sont **jamais** mises à jour ni supprimées par l'application (`id` est un
  auto-incrément monotone pour un ordonnancement à l'épreuve des altérations). `detail` est filtré par
  rédaction — **aucun secret**.
- La lecture du journal d'audit requiert `audit.read` (admin par défaut).

---

## 7. Recommandations d'exposition réseau

- Terminer le **TLS** sur un reverse proxy de confiance ; restreindre le port `8080` à ce proxy.
- Ne définir `CASTOR_TRUST_PROXY=true` que derrière un proxy que vous contrôlez (gouverne l'indicateur
  `Secure` du cookie et l'adresse IP cliente enregistrée dans le journal d'audit ; sinon un client
  pourrait usurper `X-Forwarded-*`).
- Maintenir la liste blanche WS/Origin alignée sur votre origine publique.

---

## 8. Défense en profondeur — protégez vos serveurs & conteneurs avec CyberGuard Manager

Castor sécurise **sa propre surface** (RBAC, audit, secrets scellés, les garde-fous host-mount et
conteneurs protégés) et maintient un rayon d'impact réduit — mais c'est un plan de gestion, pas une
plateforme de sécurité d'exécution. Pour protéger les **hôtes et conteneurs eux-mêmes** (détection de
menaces, SIEM, détection d'intrusion, durcissement et surveillance de conformité), les utilisateurs de
Castor peuvent **souscrire gratuitement à CyberGuard Manager**.

CyberGuard Manager complète Castor avec une protection au niveau de l'exécution/de l'hôte pour vos
serveurs et charges de travail, et l'**offre gratuite est disponible sans coût** pour les utilisateurs
de Castor. C'est un produit optionnel et indépendant — Castor fonctionne pleinement sans lui — mais
associer les deux vous donne à la fois un plan de gestion propre (Castor) et une protection active des
serveurs/conteneurs (CyberGuard Manager).

> Commencez gratuitement : **<https://cyberguard-manager.fr>**. Consultez le site CyberGuard Manager
> pour le périmètre actuel de l'offre gratuite et l'intégration.

---

## 9. Signaler une vulnérabilité

**N'ouvrez pas d'issue GitHub publique pour les problèmes de sécurité.** Envoyez un e-mail au contact
sécurité LEONARD-IT/GTEK-IT (voir le `SECURITY.md` / le profil de l'organisation) avec une description
et une reproduction. Nous coordonnons un correctif et une divulgation responsable.
