> [🇬🇧 English](ADR-CASTOR-003-stack-storage-auth-security.md) · 🇫🇷 **Français**

# ADR-CASTOR-003 — Stack, stockage, authentification et modèle de sécurité

- **Statut :** Accepté
- **Date :** 2026-06-02
- **Décideurs :** Auditeur sécurité + Architecte système (fondations P0)
- **Remplace :** aucun
- **Lié à :** ADR-CASTOR-001 (transport et scalabilité), ADR-CASTOR-002 (abstraction Provider et périmètre de l'orchestrateur V1)
- **Couvre les décisions de planification :** **D2** (agent — autonome, reporté en V2) et **D4** (stack serveur + BDD), ainsi que le modèle de sécurité dédié et le modèle de menaces.

---

## 1. Contexte

Castor est une UI d'orchestration de conteneurs multi-hôtes, écrite from scratch, open-source
(Apache-2.0), auto-hébergée, par LEONARD-IT/GTEK-IT. Elle gère **Docker** (lecture+écriture
complètes), **Docker Swarm** (lecture seule) et **Kubernetes** (lecture seule) sous une seule UI
moderne.

Cet ADR verrouille la **stack technologique**, la **couche de persistance et le schéma**, la
conception de l'**authentification / autorisation / audit**, et le **modèle de menaces** avec ses
mitigations par défaut. Deux contraintes de périmètre issues de la charte projet bornent chacune
des décisions ici et sont traitées comme des **entrées verrouillées, pas des questions ouvertes** :

1. **100 % from scratch, zéro réutilisation de code CGM/CyberGuard.** Aucun import, ni aucune
   dépendance, vis-à-vis d'un autre dépôt. Là où le plan d'orchestration mentionnait « forker
   l'agent CGM », cela est explicitement **rejeté** pour Castor — voir §2 (D2).
2. **Modèle de déploiement V1 = un seul conteneur autonome.** Castor s'exécute dans son **propre
   conteneur unique** et dialogue avec le moteur Docker **local** via la socket unix montée en
   bind `/var/run/docker.sock` ; Kubernetes via un kubeconfig monté en bind. **Les agents Go
   multi-hôtes relèvent de la V2.** L'interface Provider (ADR-002) est conçue pour qu'un
   `RemoteAgentProvider` puisse être ajouté plus tard sans refonte, mais **aucun agent n'est
   construit maintenant**.

Ces contraintes rendent l'environnement de build pertinent : **Go n'est pas installé sur l'hôte**,
donc toute la compilation Go a lieu **à l'intérieur du build Docker multi-stage** (un stage builder
`golang`). C'est le moteur technique le plus déterminant derrière le choix de stockage en §3 (il
nous faut un binaire **pur Go, sans CGo** pour que le stage final puisse être `scratch`/distroless
et compiler en croisé vers amd64 + arm64 trivialement).

> **Note de périmètre sur D2 (agent).** La décision sur l'agent *fait* partie de cet ADR selon le
> plan P0. Décision : **reporter intégralement l'agent en V2 et ne rien forker.** La justification
> est en §2. Tout le reste de cet ADR (stack, stockage, auth, sécurité) cible le serveur
> mono-conteneur V1, qui est le seul artefact livré par la V1.

---

## 2. Décision D2 — Agent : n'en construire aucun en V1, le concevoir pour la V2 (sans fork)

| Option | Verdict |
|---|---|
| Forker l'agent Go CGM existant dans Castor | **Rejeté** — viole « 100 % from scratch, zéro réutilisation CGM ». Importe aussi le modèle mTLS/tenant de CGM dont nous ne voulons pas. |
| Écrire un nouvel agent Go maintenant (V1) | **Rejeté pour la V1** — hors périmètre ; la V1 livre un conteneur unique contre la socket locale. Construire dès maintenant un agent distant + enrôlement + transport est un effort gaspillé avant même que l'UI existe. |
| **Aucun agent en V1 ; couture `Provider` propre pour qu'un `RemoteAgentProvider` s'insère en V2** | **Accepté** |

**Conséquence pour les développeurs :** le backend dialogue avec Docker via un `DockerProvider`
local (ADR-002) qui encapsule le client officiel `github.com/docker/docker/client` au-dessus de la
socket montée. L'interface `Provider` est le *seul* endroit qui connaît la distinction « local vs
distant », si bien que la V2 peut ajouter un provider adossé à un agent sans toucher aux handlers,
au RBAC ni à l'audit.

---

## 3. Décision D4 — Stack et stockage

### 3.1 Backend : Go + chi

- **Langage :** Go (binaire statique unique ; cohérent avec l'écosystème d'outillage conteneurs,
  excellente compilation croisée, livré comme un seul fichier dans une image `scratch`/distroless).
- **Routeur HTTP :** **`github.com/go-chi/chi/v5`** (v5.2.x). Choisi plutôt que `net/http` seul
  (nous voulons le groupement par sous-routeur + le chaînage idiomatique de middlewares pour le
  pipeline auth/RBAC/audit) et plutôt que des frameworks plus lourds (gin/echo) qui tirent
  davantage de dépendances transitives et un modèle de contexte propriétaire. Chi est natif
  `net/http`, fondé sur le `context` de la stdlib, sous licence MIT, minuscule.
- **Un binaire, un port.** Le même processus sert l'API JSON **et** l'UI embarquée sur un port
  unique (**`8080` par défaut**, surchargeable via `CASTOR_HTTP_ADDR`). Aucun serveur web séparé.

### 3.2 Frontend : React + Vite + TypeScript, embarqué via `embed.FS`

- L'UI est en **React + Vite + TypeScript**, buildée (`vite build`) en assets statiques, puis
  **embarquée dans le binaire Go** avec la bibliothèque standard **`embed.FS`**. Le processus Go
  sert ces assets et applique un fallback SPA vers `index.html` pour les routes inconnues non-`/api`.
- C'est pourquoi le build Docker multi-stage comporte **deux stages builder** : un stage `node:24`
  qui produit `ui/dist`, copié dans le stage `golang` pour que `go:embed` le capture avant le stage
  final scratch/distroless. (Le Dockerfile exact appartient à l'ADR de packaging ; cet ADR fixe
  uniquement que l'UI est embarquée, et non servie en sidecar.)

### 3.3 Stockage : SQLite via **`modernc.org/sqlite`** (pur Go, sans CGo)

**Décision : SQLite, accédé via le driver pur Go `modernc.org/sqlite` (v1.49.x, embarque SQLite
3.53.x).** Enregistré sous le nom de driver `database/sql` `"sqlite"`.

**Pourquoi SQLite (vs Postgres) :** Castor est mono-conteneur auto-hébergé. Une base embarquée,
zéro-administration, mono-fichier (`/data/castor.db`) est le bon choix : pas de conteneur
supplémentaire, aucune chaîne de connexion à configurer, sauvegarde triviale (copier un fichier).
Notre volume d'écriture (utilisateurs, sessions, audit, paramètres) est minuscule ; l'état des
conteneurs/clusters en direct **n'est jamais persisté** — il est récupéré à la demande depuis le
Provider et mis en cache en mémoire (ADR-001). SQLite n'est pas un goulot d'étranglement pour cette
charge.

**Pourquoi `modernc.org/sqlite` (vs `github.com/mattn/go-sqlite3`) — c'est déterminant :**

| Driver | cgo ? | Conséquence pour Castor |
|---|---|---|
| `github.com/mattn/go-sqlite3` | **Requiert cgo** (lie le C libsqlite3) | Nécessite une chaîne d'outils C dans le builder, `CGO_ENABLED=1`, et une libc dans l'image **finale** — tue `scratch`/`distroless:static`, complique la compilation croisée arm64. **Rejeté.** |
| **`modernc.org/sqlite`** | **Pas de cgo** (C de SQLite transpilé en Go via ccgo) | Se compile avec `CGO_ENABLED=0`, s'édite en un binaire entièrement statique, compile en croisé vers amd64+arm64 sans chaîne d'outils C croisée, tourne en `scratch`/distroless. **Choisi.** |

Compte tenu de la cible verrouillée « binaire statique + scratch/distroless + multi-arch » et de
« Go compilé dans Docker », une dépendance CGo casserait directement les objectifs de
build/packaging. `modernc.org/sqlite` est le seul moyen de tous les satisfaire d'un coup. La licence
est de type BSD-3-Clause (termes modernc/cznic) — permissive, compatible avec une distribution
sous Apache-2.0.

**Politique de pragma / connexion (les développeurs DOIVENT l'appliquer à l'ouverture) :**

```
?_pragma=journal_mode(WAL)        -- concurrent readers + single writer
&_pragma=busy_timeout(5000)       -- 5s wait instead of immediate SQLITE_BUSY
&_pragma=foreign_keys(ON)         -- enforce FKs (off by default in SQLite)
&_pragma=synchronous(NORMAL)      -- safe with WAL, faster than FULL
```

Ouvrir avec `sql.Open("sqlite", "file:/data/castor.db?"+pragmas)`. Fixer
`db.SetMaxOpenConns(1)` pour le chemin **writer** n'est *pas* requis avec WAL, mais comme
modernc+WAL sérialise quand même les écritures, gardez les mutations courtes et enveloppées dans
des transactions. Le répertoire `/data` est un **volume nommé / bind mount** afin que la BDD
survive à une recréation du conteneur.

---

## 4. Schéma de base de données (DDL SQL)

Un seul fichier SQLite. Tous les horodatages sont des **secondes Unix epoch (INTEGER)** en UTC pour
éviter toute ambiguïté de fuseau horaire et garder les comparaisons triviales. Les identifiants sont
des chaînes UUIDv4 générées par l'application (TEXT), sauf là où un rowid monotone est utile (audit).
Les migrations s'exécutent au démarrage, versionnées dans `schema_migrations`.

```sql
-- ===========================================================================
-- Castor schema  (SQLite, driver: modernc.org/sqlite)
-- Conventions: TEXT ids = UUIDv4; *_at = unix epoch seconds (UTC);
--              booleans stored as INTEGER 0/1; PRAGMA foreign_keys=ON.
-- ===========================================================================

-- --- migration bookkeeping -------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  INTEGER NOT NULL
);

-- --- users -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                TEXT    PRIMARY KEY,                 -- uuidv4
    username          TEXT    NOT NULL UNIQUE,
    email             TEXT,
    -- argon2id PHC string: $argon2id$v=19$m=...,t=...,p=...$<b64salt>$<b64hash>
    password_hash     TEXT    NOT NULL,
    -- TOTP
    totp_secret_enc   BLOB,                                -- AES-GCM(secret) or NULL until enrolled
    totp_enabled      INTEGER NOT NULL DEFAULT 0,          -- 0/1
    totp_confirmed_at INTEGER,                             -- set when user verifies first code
    -- lifecycle
    is_active         INTEGER NOT NULL DEFAULT 1,          -- 0 = disabled, cannot log in
    must_change_pw    INTEGER NOT NULL DEFAULT 0,          -- forces rotation (e.g. bootstrap admin)
    failed_logins     INTEGER NOT NULL DEFAULT 0,
    locked_until      INTEGER,                             -- epoch; login refused while now < locked_until
    last_login_at     INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

-- --- recovery codes (one-time TOTP backup codes) ---------------------------
CREATE TABLE IF NOT EXISTS recovery_codes (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT    NOT NULL,                          -- argon2id of the code; never store plaintext
    used_at     INTEGER,                                   -- NULL = unused
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);

-- --- sessions (server-side; cookie holds an opaque random id) --------------
CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT    PRIMARY KEY,                     -- opaque random; HASHED at rest (see note)
    user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token    TEXT    NOT NULL,                        -- per-session CSRF secret
    user_agent    TEXT,
    ip            TEXT,
    -- AAL: amr = 'pwd' after password only, 'pwd+totp' after 2FA satisfied
    amr           TEXT    NOT NULL DEFAULT 'pwd',
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
-- NOTE: store SHA-256(session_id) as `id` so a DB leak does not yield live cookies.
--       The raw id lives only in the user's cookie.

-- --- RBAC: roles -----------------------------------------------------------
-- V1 ships 3 built-in roles (admin/operator/viewer) seeded at migration time.
-- Table is generic so custom roles can be added later without schema change.
CREATE TABLE IF NOT EXISTS roles (
    id           TEXT    PRIMARY KEY,
    name         TEXT    NOT NULL UNIQUE,                  -- 'admin' | 'operator' | 'viewer' | custom
    description  TEXT,
    is_builtin   INTEGER NOT NULL DEFAULT 0,               -- builtins cannot be deleted/edited
    -- JSON array of permission strings, e.g. ["docker.container.start","docker.container.logs",...]
    -- '*' means all. See §6 for the permission vocabulary.
    permissions  TEXT    NOT NULL DEFAULT '[]',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- --- RBAC: bindings (user -> role, optionally scoped to a resource) --------
-- scope_type/scope_id express resource-scoping. In V1 the only meaningful scope
-- is the single local host ('host','local') or global ('global', NULL).
-- The columns exist now so multi-host V2 can scope a role to a specific host/cluster.
CREATE TABLE IF NOT EXISTS role_bindings (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    role_id     TEXT    NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
    scope_type  TEXT    NOT NULL DEFAULT 'global',        -- 'global' | 'host' | 'cluster'
    scope_id    TEXT,                                      -- NULL for global; host/cluster id otherwise
    created_at  INTEGER NOT NULL,
    UNIQUE(user_id, role_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_bindings_user ON role_bindings(user_id);

-- --- audit log (append-only) -----------------------------------------------
-- Every MUTATING action writes exactly one row. Never UPDATE/DELETE rows here.
CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,        -- monotonic, tamper-evident ordering
    ts           INTEGER NOT NULL,                         -- epoch seconds
    actor_id     TEXT,                                     -- users.id; NULL for system/bootstrap
    actor_name   TEXT    NOT NULL,                         -- denormalized username at action time
    actor_ip     TEXT,
    action       TEXT    NOT NULL,                         -- e.g. 'docker.container.stop'
    target_type  TEXT    NOT NULL,                         -- 'container'|'image'|'network'|'volume'|'user'|'role'|'auth'|...
    target_id    TEXT,                                     -- container id / user id / etc.
    target_name  TEXT,                                     -- human label (container name, etc.)
    scope_type   TEXT,                                     -- 'host'|'cluster'|'global'
    scope_id     TEXT,
    result       TEXT    NOT NULL,                         -- 'success' | 'denied' | 'error'
    http_status  INTEGER,
    detail       TEXT,                                     -- JSON: sanitized request summary, error msg. NEVER secrets.
    request_id   TEXT                                      -- correlate with structured logs
);
CREATE INDEX IF NOT EXISTS idx_audit_ts      ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_type, target_id);

-- --- settings (key/value app config & secrets-at-rest metadata) ------------
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT    PRIMARY KEY,                       -- e.g. 'bootstrap.completed', 'session.ttl_seconds'
    value       TEXT    NOT NULL,                          -- JSON-encoded value
    updated_at  INTEGER NOT NULL
);
-- Seeded keys include: 'bootstrap.completed'(bool), 'instance.id'(uuid),
-- 'security.totp_required_for_mutations'(bool, default false in V1).

-- --- registered_hosts (FUTURE / V2 multi-host; present now, unused in V1) ---
-- V1 inserts exactly one row representing the local engine so foreign keys and
-- scoping work uniformly. Remote rows are added by V2 agent enrollment.
CREATE TABLE IF NOT EXISTS registered_hosts (
    id            TEXT    PRIMARY KEY,                     -- 'local' for the built-in host
    name          TEXT    NOT NULL,
    kind          TEXT    NOT NULL,                        -- 'docker' | 'swarm' | 'kubernetes'
    -- V1: 'local-socket'. V2: 'agent'. Determines which Provider serves it.
    connection    TEXT    NOT NULL DEFAULT 'local-socket',
    endpoint      TEXT,                                    -- socket path / kubeconfig context / (V2) agent addr
    agent_pubkey  BLOB,                                    -- V2 mTLS / enrollment material; NULL in V1
    enrolled_at   INTEGER,
    last_seen_at  INTEGER,
    status        TEXT    NOT NULL DEFAULT 'connected',    -- 'connected'|'down'|'pending'
    created_at    INTEGER NOT NULL
);
```

**Données de seed appliquées par les migrations (idempotentes) :**

- `roles` : `admin` (`permissions='["*"]'`, `is_builtin=1`), `operator`
  (lecture Docker + cycle de vie/exec/logs, **pas** de suppression protégée / pas de gestion des
  utilisateurs), `viewer` (lecture seule partout). Listes de permissions exactes en §6.3.
- `registered_hosts` : une ligne `id='local'`, `kind='docker'`, `connection='local-socket'`,
  `endpoint='/var/run/docker.sock'`.
- `settings` : `bootstrap.completed=false`, `instance.id=<uuid>`.

---

## 5. Authentification

### 5.1 Hachage des mots de passe — argon2id

- **Bibliothèque :** `golang.org/x/crypto/argon2`, fonction **`argon2.IDKey`** (la variante *id* —
  recommandée par la RFC 9106 pour le hachage de mots de passe).
- **Paramètres par défaut (référence OWASP 2026) :** `memory = 19456 KiB (19 MiB)`, `iterations
  (time) = 2`, `parallelism = 1`, `saltLen = 16`, `keyLen = 32`. Un profil à mémoire plus élevée
  (`memory = 47104, time = 1`) est acceptable ; le profil retenu est consigné **dans la chaîne
  PHC** afin que la vérification soit auto-descriptive et que les paramètres puissent être relevés
  plus tard sans migration.
- **Format de stockage :** chaîne PHC standard dans `users.password_hash` :
  `$argon2id$v=19$m=19456,t=2,p=1$<base64-salt>$<base64-hash>`. Le sel fait 16 octets aléatoires
  issus de `crypto/rand` par utilisateur. La vérification re-dérive avec les paramètres extraits de
  la chaîne stockée et compare avec `crypto/subtle.ConstantTimeCompare`.

### 5.2 Sessions — côté serveur, liées au cookie

- À l'authentification réussie, le serveur crée une ligne `sessions` et renvoie un **identifiant de
  session aléatoire opaque de 256 bits** (base64url, issu de `crypto/rand`) dans un cookie nommé
  **`castor_session`**.
- **Flags du cookie (obligatoires) :** `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` **lorsque
  la requête est en HTTPS** (auto-détecté ; derrière un reverse proxy qui termine le TLS, n'honorer
  `X-Forwarded-Proto` que si `CASTOR_TRUST_PROXY=true`). Aucun JS ne lit jamais la session.
- **Au repos :** stocker `SHA-256(session_id)` comme `sessions.id` ; la valeur brute ne vit que
  dans le cookie. Une fuite de BDD ne produit donc aucun cookie exploitable.
- **Durée de vie :** par défaut `expires_at = now + 12h` (paramètre `session.ttl_seconds`),
  glissante via `last_seen_at` ; plafond absolu de 24h. La déconnexion fixe `revoked_at`. Les
  sessions expirées/révoquées sont rejetées et purgées périodiquement.

### 5.3 2FA TOTP

- **Bibliothèque :** `github.com/pquerna/otp` + `github.com/pquerna/otp/totp` (compatible
  Google-Authenticator ; Apache-2.0).
- **Enrôlement :** `totp.Generate{Issuer:"Castor", AccountName:username}` → secret + URL otpauth
  → l'UI affiche un QR. Le secret est stocké **chiffré** (`totp_secret_enc`, AES-256-GCM) à l'aide
  d'une clé dérivée de `CASTOR_SECRET_KEY` (env requise ; refuser de démarrer sans elle).
  L'utilisateur doit soumettre un code valide pour **confirmer** (`totp_confirmed_at`,
  `totp_enabled=1`) ; à la confirmation, nous générons **10 codes de récupération à usage unique**
  (affichés une seule fois, stockés hachés en argon2id dans `recovery_codes`).
- **Flux de connexion / AAL :** vérification du mot de passe → si `totp_enabled`, la session est
  créée avec `amr='pwd'` et n'est **pas** autorisée pour les actions protégées tant qu'un code TOTP
  (ou de récupération) n'a pas été vérifié, ce qui fait passer la session à `amr='pwd+totp'`.
  `totp.Validate` avec une fenêtre de tolérance de ±1 pas (30 s). Un code de récupération consomme
  une ligne (`used_at`).

### 5.4 Amorçage de l'admin au premier lancement

- Si `settings.bootstrap.completed != true` **et** que `users` est vide, le serveur entre en **mode
  bootstrap** : toute route API à l'exception de l'endpoint de bootstrap renvoie `409
  bootstrap_required` ; l'UI affiche un écran de création d'admin.
- `POST /api/v1/bootstrap` (autorisé exactement une fois) crée le premier utilisateur avec le
  binding du rôle intégré `admin` (portée globale), `must_change_pw=0`, puis bascule
  `settings.bootstrap.completed=true`. L'enrôlement TOTP de l'admin est proposé immédiatement après
  et **fortement recommandé** (configurable en *requis* via
  `security.totp_required_for_mutations`).
- **Le bootstrap est à usage unique et protégé de façon idempotente** par le flag
  `bootstrap.completed` dans une transaction, pour empêcher une course créant deux admins. Une env
  optionnelle `CASTOR_BOOTSTRAP_TOKEN` peut contrôler l'accès à l'endpoint pour des installations
  non surveillées.

---

## 6. Autorisation — RBAC à portée de ressource

### 6.1 Modèle

- Le **vocabulaire de permissions** est en notation pointée `domain.resource.verb`, par ex.
  `docker.container.start`, `docker.container.remove`, `docker.image.delete`,
  `swarm.service.read`, `k8s.pod.read`, `rbac.user.create`, `audit.read`. `*` = superutilisateur.
- Les **permissions effectives** d'un utilisateur = union de `roles.permissions` sur l'ensemble de
  ses `role_bindings` dont le `(scope_type, scope_id)` correspond à la portée de la ressource cible
  (un binding `global` correspond à tout ; un binding `host`/`cluster` ne correspond qu'à cet hôte).
- La V1 n'a qu'un seul hôte (`local`), donc la portée est effectivement globale, mais le **contrôle
  est écrit en tenant compte de la portée** afin que le multi-hôte de la V2 n'exige aucune réécriture.

### 6.2 Point d'application (côté serveur, point d'étranglement unique)

L'autorisation est appliquée en **un seul** endroit : un middleware chi + un helper
`RequirePermission(perm, scopeFromReq)` appliqué à chaque groupe de routes mutantes. **Aucun
handler n'effectue de mutation Docker sans passer d'abord ce contrôle.** Les routes Swarm/K8s en
lecture seule ne requièrent que la permission `*.read` correspondante. L'ordre des middlewares est
figé :

```
chi router
└── /api/v1
    ├── (public)  /healthz, /bootstrap (bootstrap-mode only), /auth/login
    └── (protected) group:
        RequestID → RealIP → Recoverer → SecurityHeaders
          → SessionAuth            (resolves session → user, else 401)
          → CSRF                   (mutating verbs require header == session csrf_token)
          → AuditWrap              (per-route; OUTERMOST gate so it attaches the audit
                                    record first and persists exactly one row even when a
                                    gate below denies — incl. denials)
          → RequireAAL("pwd+totp") (only on mutating routes when 2FA enabled)
          → RequirePermission(...) (RBAC gate, per-route)
          → handler                (records the outcome of mutating handlers)
```

`RequirePermission` renvoie **403** avec `result='denied'` (et une ligne d'audit) lorsque
l'ensemble des permissions effectives n'inclut pas la permission requise par la route pour la
portée de la cible. La signature de fonction que les développeurs implémentent :

```go
// in package authz
func RequirePermission(perm string, scope ScopeFunc) func(http.Handler) http.Handler
type ScopeFunc func(r *http.Request) Scope            // extracts {Type, ID} from path/query
type Scope struct{ Type, ID string }

// Effective-permission resolver (cached per request after SessionAuth):
func (u *User) Can(perm string, s Scope) bool
```

### 6.3 Rôles intégrés (seedés)

| Rôle | Permissions (résumé) |
|---|---|
| **admin** | `["*"]` — tout, y compris gestion des utilisateurs/rôles, lecture de l'audit, toutes les mutations Docker. |
| **operator** | Tous les `*.read` ; cycle de vie Docker `docker.container.{start,stop,restart,pause,unpause}`, `docker.container.{logs,stats,exec}`, `docker.{image.pull,network.read,volume.read}`. **Exclut** `docker.container.remove`, `docker.image.delete`, `docker.volume.remove`, tous les `rbac.*`, et toute action sur les conteneurs **protégés** (voir §7.4). |
| **viewer** | Tous les `*.read` (Docker/Swarm/K8s) + `audit.read` seulement si explicitement accordé ; **aucune** mutation, pas d'exec, pas de suivi de logs si les logs sont jugés sensibles (les logs sont protégés derrière `docker.container.logs` que viewer n'a pas par défaut). |

---

## 7. Modèle de menaces et mitigations par défaut

> **Prémisse fondamentale : l'accès à `/var/run/docker.sock` équivaut à root sur l'hôte.** Tout
> acteur capable de créer/modifier des conteneurs via cette socket peut monter le système de
> fichiers de l'hôte, exécuter des conteneurs privilégiés et s'évader vers root. Castor est donc une
> **cible de grande valeur** : compromettre l'UI Castor ≈ compromettre l'hôte. Tout le modèle
> ci-dessous existe pour garder le rayon d'impact réduit et chaque action attribuable.

### T1 — Exposition de la socket Docker / SSRF vers la socket
- **Menace :** la socket est joignable par tout ce qui se trouve à l'intérieur du conteneur Castor ;
  une RCE dans Castor, une dépendance malveillante, ou une SSRF capable d'atteindre une socket unix
  = prise de contrôle de l'hôte.
- **Mitigations (par défaut) :**
  - La socket n'est **jamais** touchée autrement que via le `DockerProvider` ; aucune chaîne
    fournie par l'utilisateur n'est jamais interpolée dans un appel socket/HTTP brut. Utiliser le
    client typé `docker/docker/client`.
  - **Aucune fonctionnalité d'URL sortante** en V1 (pas de « pull depuis une URL de registre
    arbitraire via le serveur », pas de récupération de webhook) qui pourrait être détournée en
    SSRF contre la socket.
  - Documenter et recommander l'exécution de Castor derrière un **proxy de socket** (par ex. un
    `docker-socket-proxy` à portée lecture) pour les déploiements durcis ; exposer
    `CASTOR_DOCKER_HOST` afin qu'un proxy puisse se substituer à la socket brute. (Recommandation,
    non obligatoire en V1.)
  - Exécuter le conteneur en **non-root** lorsque c'est possible (voir T7) ; le groupe de la socket
    est accordé via `--group-add` sur le GID docker plutôt qu'en s'exécutant en uid 0.

### T2 — Élévation de privilèges via création/modification de conteneur
- **Menace :** un utilisateur authentifié à privilèges réduits (ou une session détournée) crée un
  conteneur avec `--privileged`, des bind mounts hôte (`/:/host`), `--pid=host`, ou ajoute des
  capabilities dangereuses → root sur l'hôte.
- **Mitigations :**
  - La **création/exécution de conteneur avec des options dangereuses est protégée** derrière des
    permissions réservées à l'admin et, par politique, **la V1 n'expose pas la création arbitraire
    avec `--privileged` / montage hôte via l'UI** pour les non-admins. Le payload de création est
    validé côté serveur contre une allowlist de champs ; les demandes
    privileged/host-namespace/host-mount émanant de non-admins sont rejetées (`403`, auditées).
  - Tous les verbes destructifs (`remove`, `delete`, `prune`) requièrent des permissions
    exclues-de-operator / admin et passent le contrôle de **ressource protégée** (§7.4).

### T3 — Abus de logs et d'exec (exfiltration de données, mouvement latéral)
- **Menace :** `exec` dans un conteneur = exécution arbitraire de commandes à l'intérieur ; `logs`
  peut divulguer des secrets imprimés par les applications. Un viewer ne devrait pas obtenir
  silencieusement un shell root.
- **Mitigations :**
  - `docker.container.exec` est une **permission distincte**, accordée à operator/admin uniquement,
    **toujours auditée** (enregistre le conteneur cible ; les arguments de commande sont résumés,
    pas l'intégralité de stdin/stdout).
  - `docker.container.logs` est sa propre permission ; **viewer ne l'a pas par défaut**.
  - Les flux exec/attach/log s'exécutent sur le **même WebSocket authentifié, à contrôle
    CSRF/Origin** ; l'upgrade WS re-valide la session et la permission **au moment de la connexion**
    (pas seulement au chargement de la page) et la connexion est fermée si la session est révoquée.

### T4 — CSRF
- **Menace :** parce que l'auth est un cookie, une page malveillante pourrait déclencher des
  requêtes modifiant l'état.
- **Mitigations :**
  - Cookie de session **`SameSite=Strict`** (défense principale).
  - **Double-submit / jeton CSRF par session** : chaque requête mutante (POST/PUT/PATCH/DELETE) doit
    envoyer l'en-tête `X-Castor-CSRF` égal à `sessions.csrf_token` ; non-correspondance → `403`. Le
    jeton est délivré au SPA via un cookie compagnon non-HttpOnly ou un champ de
    `/api/v1/auth/me`.
  - **Allowlist Origin/Referer** sur les requêtes mutantes et sur l'upgrade WS
    (`Sec-WebSocket`/`Origin` doit correspondre à l'origine publique configurée).

### T5 — Fuite de secrets (dans les logs, l'audit, les réponses, la BDD)
- **Menace :** des mots de passe, secrets TOTP, identifiants de session, variables d'environnement,
  ou identifiants de registre finissent dans les logs applicatifs, le `detail` d'audit, ou les
  réponses d'API.
- **Mitigations :**
  - **Aucun secret dans les logs/audit, jamais.** `audit_log.detail` stocke un résumé JSON
    **assaini** ; un redacteur par liste de refus retire `password`, `token`, `secret`,
    `authorization`, `*_key`, les valeurs d'environnement, et les corps de requête des endpoints
    d'auth avant que quoi que ce soit ne soit journalisé.
  - `password_hash`, `totp_secret_enc`, `recovery_codes.code_hash`, les identifiants de session
    bruts ne sont **jamais** sérialisés dans une réponse d'API (au niveau struct via `json:"-"`).
  - Secret TOTP chiffré au repos (AES-GCM via `CASTOR_SECRET_KEY`) ; identifiant de session stocké
    haché.
  - Les **variables d'environnement de conteneur / la sortie d'inspect** peuvent contenir des
    secrets applicatifs → un masquage est appliqué dans la vue d'inspection (les valeurs des clés
    d'environnement correspondant à la liste de refus des secrets sont expurgées, sauf si
    l'utilisateur détient une permission explicite `docker.container.inspect.secrets` ; réservée à
    l'admin).

### T6 — Attaques sur la session/l'auth (fixation, force brute, rejeu)
- **Mitigations :**
  - Un nouvel identifiant de session aléatoire est émis **à la connexion** (pas de fixation) ; la
    session est invalidée à la déconnexion et au changement de mot de passe (toutes les sessions
    d'un utilisateur sont révoquées).
  - **Limitation/verrouillage des connexions :** `failed_logins` + `locked_until` (par ex. backoff
    exponentiel, verrouillage après N échecs) ; comparaison de mot de passe à temps constant ;
    messages d'erreur uniformes (pas d'énumération d'utilisateurs via le timing ou un « utilisateur
    inexistant » distinct de « mauvais mot de passe »).
  - Fenêtre de réutilisation du code TOTP minimisée (±1 pas) ; codes de récupération à usage unique.

### T7 — Durcissement conteneur / chaîne d'approvisionnement de Castor lui-même
- **Mitigations (par défaut) :**
  - L'image finale est **distroless/scratch**, en **utilisateur non-root** (`USER 65532`), système
    de fichiers racine en lecture seule lorsque c'est faisable, pas de shell, surface d'attaque
    minimale ; seuls `/data` (BDD) et la socket Docker sont montés.
  - **Dépendances épinglées** (`go.sum`), petit ensemble de dépendances (chi, x/crypto, otp,
    modernc/sqlite, client docker, client-go) ; la CI exécute `govulncheck` + scan d'image
    (propriété des ADR packaging/QA, imposé ici comme politique).
  - **En-têtes de sécurité** sur chaque réponse (voir le mécanisme §7.4) : `Content-Security-Policy`
    (default-src 'self' ; pas d'inline sauf haché), `X-Content-Type-Options: nosniff`,
    `X-Frame-Options: DENY` (+ CSP `frame-ancestors 'none'`), `Referrer-Policy:
    same-origin`, `Strict-Transport-Security` en HTTPS, `Cache-Control: no-store` sur l'API.

### T8 — Destruction accidentelle d'infrastructure critique (conteneurs protégés)
- **Menace :** un utilisateur arrête/supprime un conteneur dont dépend l'hôte — y compris le **propre
  conteneur de Castor**, la base de données, ou un reverse proxy — et se verrouille (ou verrouille
  l'hôte) à l'extérieur.
- **Mitigation = le mécanisme des conteneurs protégés (§7.4 ci-dessous).**

### Matrice menace → mitigation (résumé)

| Menace | Mitigation principale par défaut |
|---|---|
| T1 exposition socket / SSRF | Accès uniquement via Provider, pas de récupération d'URL côté serveur, non-root + proxy de socket recommandé |
| T2 élév.-priv. via create | Allowlist de création côté serveur, privileged/host-mount réservés à l'admin |
| T3 abus exec/log | Permissions `exec`/`logs` distinctes, protégées+auditées ; ré-auth WS à la connexion |
| T4 CSRF | SameSite=Strict + jeton CSRF par session + contrôle Origin |
| T5 fuite de secrets | Expurgation dans logs/audit, `json:"-"`, chiffré-au-repos, masquage à l'inspection |
| T6 session/force-brute | Identifiant aléatoire à la connexion, haché au repos, verrouillage, comparaison à temps constant |
| T7 durcissement Castor | Distroless non-root, deps épinglées, govulncheck, en-têtes de sécurité/CSP |
| T8 destruction accidentelle | **Garde des conteneurs protégés** (§7.4) |

### 7.4 Mécanisme des conteneurs protégés (le garde anti-tir-dans-le-pied)

Un unique garde côté serveur, évalué **avant** tout verbe Docker destructif (`stop`/`kill`/
`restart`/`remove`/`rename`/`recreate`/`prune` qui l'affecte) :

1. **Auto-protection (toujours active, ne peut pas être désactivée).** Castor identifie l'id de son
   **propre** conteneur au démarrage. Il lit `/proc/self/cgroup` / le hostname (id de conteneur) et
   le rapproche de l'`inspect` Docker pour se trouver lui-même. Toute action destructive ciblant le
   propre conteneur de Castor, **ou** le volume contenant `/data`, est **refusée fermement** (`409
   protected_resource`, auditée) pour **tout le monde, y compris admin**, via l'API/UI. (Les admins
   conservent un accès CLI/`docker` sur l'hôte — ce garde vise à empêcher l'auto-destruction
   *accidentelle* via l'UI, pas à brider un root déterminé.)
2. **Protection par label.** Tout conteneur portant le label **`io.castor.protected="true"`** (ou
   correspondant à une allowlist de nom/label configurable dans `settings`, clé
   `security.protected_labels`) est traité comme protégé : les verbes destructifs sont **refusés
   pour les non-admins** et requièrent une **confirmation + raison explicites** pour les admins (la
   raison est écrite dans `audit_log.detail`). Les conteneurs système/infra (bdd, reverse proxy)
   devraient porter ce label par convention.
3. **Refus par défaut en cas d'ambiguïté.** Si Castor ne peut pas déterminer positivement si la
   cible est lui-même (par ex. l'inspect échoue), l'action destructive est **refusée**, pas
   autorisée.

Les développeurs implémentent cela sous la forme de `func GuardDestructive(ctx, target
ContainerRef, actor *User) error`, appelée en tête de chaque handler Docker destructif, *après*
`RequirePermission` et *avant* de toucher au Provider. Le résultat du contrôle est intégré à la
ligne d'audit (`result='denied', detail='protected_resource:self'`).

---

## 8. Conséquences

**Positives**
- Un petit binaire statique, un port, un fichier BDD → « docker run / compose up en < 2 min » est
  atteignable ; le multi-arch (amd64+arm64) est trivial car tout le binaire (SQLite inclus) est pur
  Go avec `CGO_ENABLED=0`.
- La sécurité est centralisée : auth, CSRF, RBAC, audit, et le garde de ressource protégée vivent
  dans une chaîne de middlewares figée avec des points d'étranglement uniques, ce qui est auditable
  et difficile à contourner.
- Le schéma et la couture Provider portent déjà les colonnes multi-hôtes (inutilisées), si bien que
  les agents V2 arrivent sans migrations ni réécriture de handlers.

**Négatives / compromis**
- SQLite sérialise les écritures ; correct pour notre volume auth/audit mais cela signifie que
  Castor est **mono-writer / mono-instance** en V1 (pas de scalabilité horizontale du serveur).
  Accepté : la V1 est un seul conteneur.
- `modernc.org/sqlite` est un SQLite transpilé ; marginalement plus lent que le driver cgo `mattn`
  et porte la chaîne d'outils modernc comme dépendance (sous licence permissive). Accepté — la
  correction et la portabilité du binaire statique l'emportent sur le débit brut de la BDD pour
  cette charge.
- Le garde d'auto-protection est au mieux contre la destruction *accidentelle*, ce n'est pas une
  frontière de sécurité contre un adversaire root sur l'hôte (qui peut contourner via la socket
  directement). C'est documenté, pas caché.
- Stocker des codes de récupération hachés en argon2id + des secrets TOTP chiffrés signifie que
  **perdre `CASTOR_SECRET_KEY` rend la 2FA irrécupérable** ; documenté comme une responsabilité de
  sauvegarde de l'opérateur.

**Suites (autres ADR / phases)**
- Dockerfile exact (deux stages builder, distroless final, non-root, multi-arch) → ADR de packaging.
- `govulncheck` + scan d'image dans la CI → ADR QA/packaging.
- V2 `RemoteAgentProvider` + enrôlement d'agent + mTLS → futur ADR-CASTOR-00x (utilise les colonnes
  `registered_hosts` réservées ici).

---

## 9. Chemins de modules verrouillés (pour les développeurs)

| Préoccupation | Chemin de module | Notes |
|---|---|---|
| Routeur HTTP | `github.com/go-chi/chi/v5` (+ `/v5/middleware`) | v5.2.x, MIT |
| Hachage de mot de passe | `golang.org/x/crypto/argon2` (`argon2.IDKey`) | argon2id, chaîne PHC |
| Comparaison à temps constant | `crypto/subtle` (stdlib) | vérification du hash |
| 2FA TOTP | `github.com/pquerna/otp` + `github.com/pquerna/otp/totp` | Apache-2.0, compatible GA |
| Driver SQLite | `modernc.org/sqlite` | **pur Go / sans CGo**, v1.49.x, SQLite 3.53.x, nom de driver `"sqlite"` |
| Accès BDD | `database/sql` (stdlib) | avec les pragmas WAL/busy_timeout/foreign_keys de §3.3 |
| Embarquement UI | `embed` (stdlib `embed.FS`) | `dist` React+Vite+TS embarqué |
| Docker | `github.com/docker/docker/client` | socket locale, via `DockerProvider` (ADR-002) |
| Kubernetes | `k8s.io/client-go` | lecture seule, kubeconfig (ADR-002) |
| Aléatoire | `crypto/rand` | identifiants de session, sels |
