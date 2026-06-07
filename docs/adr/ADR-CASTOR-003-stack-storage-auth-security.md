# ADR-CASTOR-003 — Stack, Storage, Auth & Security Model

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** Security Auditor + System Architect (P0 foundations)
- **Supersedes:** none
- **Related:** ADR-CASTOR-001 (transport & scalability), ADR-CASTOR-002 (Provider abstraction & V1 orchestrator scope)
- **Covers planning decisions:** **D2** (agent — autonomous, deferred to V2) and **D4** (server stack + DB), plus the dedicated security model & threat model.

---

## 1. Context

Castor is a from-scratch, open-source (Apache-2.0), self-hosted, multi-host container
orchestration UI by LEONARD-IT/GTEK-IT. It manages **Docker** (full read+write), **Docker Swarm**
(read-only) and **Kubernetes** (read-only) under one modern dark UI.

This ADR locks the **technology stack**, the **persistence layer & schema**, the
**authentication / authorization / audit** design, and the **threat model** with default
mitigations. Two scoping constraints from the project charter bound every decision here and
are treated as **locked inputs, not open questions**:

1. **100 % from scratch, zero reuse of CGM/CyberGuard code.** No import of, or dependency on,
   any other repository. Where the orchestration plan mentioned "forking the CGM agent", that
   is explicitly **rejected** for Castor — see §2 (D2).
2. **V1 deployment model = single self-contained container.** Castor runs in its **own one
   container** and talks to the **local** Docker engine through the bind-mounted unix socket
   `/var/run/docker.sock`; Kubernetes through a bind-mounted kubeconfig. **Multi-host Go agents
   are V2.** The Provider interface (ADR-002) is designed so a `RemoteAgentProvider` can be
   added later without rework, but **no agent is built now**.

These constraints make the build environment relevant: **Go is not installed on the host**, so
all Go compilation happens **inside the Docker multi-stage build** (a `golang` builder stage).
This is the single strongest technical driver behind the storage choice in §3 (we need a
**pure-Go, CGo-free** binary so the final stage can be `scratch`/distroless and cross-compile to
amd64 + arm64 trivially).

> **Scope note on D2 (agent).** The agent decision *is* part of this ADR per the P0 plan.
> Decision: **defer the agent entirely to V2 and do not fork anything.** Rationale is in §2.
> Everything else in this ADR (stack, storage, auth, security) targets the V1 single-container
> server, which is the only artifact V1 ships.

---

## 2. Decision D2 — Agent: build none in V1, design for it in V2 (no fork)

| Option | Verdict |
|---|---|
| Fork the existing CGM Go agent into Castor | **Rejected** — violates "100 % from scratch, zero CGM reuse". Also drags in CGM's mTLS/tenant model we do not want. |
| Write a new Go agent now (V1) | **Rejected for V1** — out of scope; V1 ships a single container against the local socket. Building a remote agent + enrollment + transport now is wasted effort before the UI exists. |
| **No agent in V1; clean `Provider` seam so a `RemoteAgentProvider` slots in for V2** | **Accepted** |

**Consequence for builders:** the backend talks to Docker via a local `DockerProvider`
(ADR-002) that wraps the official `github.com/docker/docker/client` over the mounted socket.
The `Provider` interface is the *only* place that knows "local vs remote", so V2 can add an
agent-backed provider without touching handlers, RBAC, or audit.

---

## 3. Decision D4 — Stack & Storage

### 3.1 Backend: Go + chi

- **Language:** Go (single static binary; consistent with the container-tooling ecosystem,
  excellent cross-compilation, ships as one file in a `scratch`/distroless image).
- **HTTP router:** **`github.com/go-chi/chi/v5`** (v5.2.x). Chosen over `net/http`-only
  (we want sub-router grouping + idiomatic middleware chaining for the auth/RBAC/audit
  pipeline) and over heavier frameworks (gin/echo) which pull more transitive deps and a
  custom context model. Chi is `net/http`-native, stdlib `context`-based, MIT-licensed, tiny.
- **One binary, one port.** The same process serves the JSON API **and** the embedded UI on a
  single port (**default `8080`**, override `CASTOR_HTTP_ADDR`). No separate web server.

### 3.2 Frontend: React + Vite + TypeScript, embedded via `embed.FS`

- UI is **React + Vite + TypeScript**, built (`vite build`) to static assets, then **embedded
  into the Go binary** with the standard library **`embed.FS`**. The Go process serves those
  assets and SPA-fallbacks unknown non-`/api` routes to `index.html`.
- This is why the multi-stage Docker build has **two builder stages**: a `node:24` stage that
  produces `ui/dist`, copied into the `golang` stage so `go:embed` captures it before the final
  scratch/distroless stage. (Exact Dockerfile is owned by the packaging ADR; this ADR only
  fixes that the UI is embedded, not sidecar-served.)

### 3.3 Storage: SQLite via **`modernc.org/sqlite`** (pure Go, CGo-free)

**Decision: SQLite, accessed through the pure-Go driver `modernc.org/sqlite` (v1.49.x,
bundles SQLite 3.53.x).** Registered as the `database/sql` driver name `"sqlite"`.

**Why SQLite (vs Postgres):** Castor is single-container self-hosted. An embedded, zero-admin,
single-file database (`/data/castor.db`) is the right fit: no extra container, no connection
string to configure, trivial backup (copy one file). Our write volume (users, sessions, audit,
settings) is tiny; live container/cluster **state is never persisted** — it is fetched on demand
from the Provider and cached in memory (ADR-001). SQLite is not a bottleneck for this workload.

**Why `modernc.org/sqlite` (vs `github.com/mattn/go-sqlite3`) — this is load-bearing:**

| Driver | cgo? | Consequence for Castor |
|---|---|---|
| `github.com/mattn/go-sqlite3` | **Requires cgo** (links libsqlite3 C) | Needs a C toolchain in the builder, `CGO_ENABLED=1`, and a libc in the **final** image — kills `scratch`/`distroless:static`, complicates arm64 cross-compile. **Rejected.** |
| **`modernc.org/sqlite`** | **No cgo** (SQLite C transpiled to Go via ccgo) | Builds with `CGO_ENABLED=0`, links into a fully static binary, cross-compiles to amd64+arm64 with no C cross-toolchain, runs in `scratch`/distroless. **Chosen.** |

Given the locked "static binary + scratch/distroless + multi-arch" target and "Go compiled
inside Docker", a CGo dependency would directly break the build/packaging goals. `modernc.org/sqlite`
is the only way to satisfy all of them at once. License is BSD-3-Clause-ish (modernc/cznic
terms) — permissive, compatible with Apache-2.0 distribution.

**Pragma / connection policy (builders MUST apply on open):**

```
?_pragma=journal_mode(WAL)        -- concurrent readers + single writer
&_pragma=busy_timeout(5000)       -- 5s wait instead of immediate SQLITE_BUSY
&_pragma=foreign_keys(ON)         -- enforce FKs (off by default in SQLite)
&_pragma=synchronous(NORMAL)      -- safe with WAL, faster than FULL
```

Open with `sql.Open("sqlite", "file:/data/castor.db?"+pragmas)`. Set
`db.SetMaxOpenConns(1)` for the **writer** path is *not* required with WAL, but because
modernc+WAL still serializes writes, keep mutations short and wrapped in transactions. The
`/data` directory is a **named volume / bind mount** so the DB survives container recreation.

---

## 4. Database schema (SQL DDL)

Single SQLite file. All timestamps are **Unix epoch seconds (INTEGER)** in UTC to avoid
timezone ambiguity and keep comparisons trivial. IDs are application-generated UUIDv4 strings
(TEXT) except where a monotonic rowid is useful (audit). Migrations run on startup, versioned
in `schema_migrations`.

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

**Seed data applied by migrations (idempotent):**

- `roles`: `admin` (`permissions='["*"]'`, `is_builtin=1`), `operator`
  (Docker read + lifecycle/exec/logs, **no** delete-protected / no user-mgmt), `viewer`
  (read-only everywhere). Exact permission lists in §6.3.
- `registered_hosts`: one row `id='local'`, `kind='docker'`, `connection='local-socket'`,
  `endpoint='/var/run/docker.sock'`.
- `settings`: `bootstrap.completed=false`, `instance.id=<uuid>`.

---

## 5. Authentication

### 5.1 Password hashing — argon2id

- **Library:** `golang.org/x/crypto/argon2`, function **`argon2.IDKey`** (the *id* variant —
  RFC 9106 recommended for password hashing).
- **Default parameters (OWASP 2026 baseline):** `memory = 19456 KiB (19 MiB)`, `iterations
  (time) = 2`, `parallelism = 1`, `saltLen = 16`, `keyLen = 32`. A higher-memory profile
  (`memory = 47104, time = 1`) is acceptable; the chosen profile is recorded **inside the PHC
  string** so verification is self-describing and parameters can be bumped later without a
  migration.
- **Storage format:** standard PHC string in `users.password_hash`:
  `$argon2id$v=19$m=19456,t=2,p=1$<base64-salt>$<base64-hash>`. Salt is 16 random bytes from
  `crypto/rand` per user. Verification re-derives with the params parsed from the stored string
  and compares with `crypto/subtle.ConstantTimeCompare`.

### 5.2 Sessions — server-side, cookie-bound

- On successful auth the server creates a `sessions` row and returns an **opaque 256-bit random
  session id** (base64url, from `crypto/rand`) in a cookie named **`castor_session`**.
- **Cookie flags (mandatory):** `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` **when the
  request is HTTPS** (auto-detected; behind a TLS-terminating reverse proxy honor
  `X-Forwarded-Proto` only if `CASTOR_TRUST_PROXY=true`). No JS ever reads the session.
- **At rest:** store `SHA-256(session_id)` as `sessions.id`; the raw value lives only in the
  cookie. A DB leak therefore yields no usable cookies.
- **Lifetime:** default `expires_at = now + 12h` (`session.ttl_seconds` setting), sliding via
  `last_seen_at`; absolute cap 24h. Logout sets `revoked_at`. Expired/revoked sessions are
  rejected and periodically reaped.

### 5.3 TOTP 2FA

- **Library:** `github.com/pquerna/otp` + `github.com/pquerna/otp/totp` (Google-Authenticator
  compatible; Apache-2.0).
- **Enrollment:** `totp.Generate{Issuer:"Castor", AccountName:username}` → secret + otpauth URL
  → UI renders QR. Secret is stored **encrypted** (`totp_secret_enc`, AES-256-GCM) using a key
  derived from `CASTOR_SECRET_KEY` (required env; refuse to start without it). User must submit
  one valid code to **confirm** (`totp_confirmed_at`, `totp_enabled=1`); at confirmation we mint
  **10 one-time recovery codes** (shown once, stored argon2id-hashed in `recovery_codes`).
- **Login flow / AAL:** password verify → if `totp_enabled`, session is created with
  `amr='pwd'` and is **not** authorized for protected actions until a TOTP (or recovery) code is
  verified, which upgrades the session to `amr='pwd+totp'`. `totp.Validate` with a ±1 step
  (30 s) skew window. Recovery code consumes one row (`used_at`).

### 5.4 First-run admin bootstrap

- If `settings.bootstrap.completed != true` **and** `users` is empty, the server enters
  **bootstrap mode**: every API route except the bootstrap endpoint returns `409
  bootstrap_required`; the UI shows a create-admin screen.
- `POST /api/v1/bootstrap` (allowed exactly once) creates the first user with the built-in
  `admin` role binding (global scope), `must_change_pw=0`, then flips
  `settings.bootstrap.completed=true`. TOTP enrollment for the admin is offered immediately
  after and **strongly recommended** (configurable to *required* via
  `security.totp_required_for_mutations`).
- **Bootstrap is single-shot and idempotently guarded** by the `bootstrap.completed` flag in a
  transaction to prevent a race creating two admins. An optional `CASTOR_BOOTSTRAP_TOKEN` env
  can gate the endpoint for unattended installs.

---

## 6. Authorization — resource-scoped RBAC

### 6.1 Model

- **Permission vocabulary** is dotted `domain.resource.verb`, e.g.
  `docker.container.start`, `docker.container.remove`, `docker.image.delete`,
  `swarm.service.read`, `k8s.pod.read`, `rbac.user.create`, `audit.read`. `*` = superuser.
- A user's **effective permissions** = union of `roles.permissions` over all their
  `role_bindings` whose `(scope_type, scope_id)` matches the target resource's scope (a
  `global` binding matches everything; a `host`/`cluster` binding matches only that host).
- V1 has exactly one host (`local`), so scoping is effectively global, but the **check is
  written scope-aware** so V2 multi-host needs no rewrite.

### 6.2 Enforcement point (server-side, single choke point)

Authorization is enforced in **one** place: a chi middleware + a `RequirePermission(perm,
scopeFromReq)` helper applied to every mutating route group. **No handler performs a Docker
mutation without first passing this gate.** Read-only Swarm/K8s routes require only the
matching `*.read` permission. The middleware order is fixed:

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

`RequirePermission` returns **403** with `result='denied'` (and an audit row) when the
effective permission set does not include the route's required permission for the target's
scope. The function signature builders implement:

```go
// in package authz
func RequirePermission(perm string, scope ScopeFunc) func(http.Handler) http.Handler
type ScopeFunc func(r *http.Request) Scope            // extracts {Type, ID} from path/query
type Scope struct{ Type, ID string }

// Effective-permission resolver (cached per request after SessionAuth):
func (u *User) Can(perm string, s Scope) bool
```

### 6.3 Built-in roles (seeded)

| Role | Permissions (summary) |
|---|---|
| **admin** | `["*"]` — everything incl. user/role mgmt, audit read, all Docker mutations. |
| **operator** | All `*.read`; Docker lifecycle `docker.container.{start,stop,restart,pause,unpause}`, `docker.container.{logs,stats,exec}`, `docker.{image.pull,network.read,volume.read}`. **Excludes** `docker.container.remove`, `docker.image.delete`, `docker.volume.remove`, all `rbac.*`, and any action on **protected** containers (see §7.4). |
| **viewer** | All `*.read` (Docker/Swarm/K8s) + `audit.read` only if explicitly granted; **no** mutations, no exec, no logs-follow if logs are deemed sensitive (logs gated behind `docker.container.logs` which viewer lacks by default). |

---

## 7. Threat model & default mitigations

> **Core premise: access to `/var/run/docker.sock` is root-equivalent on the host.** Any
> principal who can create/modify containers through that socket can mount the host filesystem,
> run privileged containers, and escape to root. Castor is therefore a **high-value target**:
> compromising the Castor UI ≈ compromising the host. The entire model below exists to keep the
> blast radius small and every action attributable.

### T1 — Docker socket exposure / SSRF to the socket
- **Threat:** the socket is reachable by anything inside the Castor container; an RCE in Castor,
  a malicious dependency, or an SSRF that can reach a unix socket = host takeover.
- **Mitigations (default):**
  - The socket is **only** ever touched through the `DockerProvider`; no user-supplied string is
    ever interpolated into a raw socket/HTTP call. Use the typed `docker/docker/client`.
  - **No outbound-URL features** in V1 (no "pull from arbitrary registry URL via server",
    no webhook fetch) that could be turned into SSRF against the socket.
  - Document and recommend running Castor behind a **socket proxy** (e.g. a read-scoped
    `docker-socket-proxy`) for hardened deployments; expose `CASTOR_DOCKER_HOST` so a proxy can
    be substituted for the raw socket. (Recommendation, not mandatory in V1.)
  - Run the container as **non-root** where possible (see T7); the socket group is granted via
    `--group-add` to the docker GID rather than running as uid 0.

### T2 — Privilege escalation via container create/modify
- **Threat:** an authenticated lower-privileged user (or hijacked session) creates a container
  with `--privileged`, host bind mounts (`/:/host`), `--pid=host`, or adds dangerous
  capabilities → host root.
- **Mitigations:**
  - Container **create/run with dangerous options is gated** behind admin-only permissions and,
    by policy, **V1 does not expose arbitrary `--privileged` / host-mount create through the UI**
    for non-admins. The create payload is validated server-side against an allowlist of fields;
    privileged/host-namespace/host-mount requests from non-admins are rejected (`403`, audited).
  - All destructive verbs (`remove`, `delete`, `prune`) require operator-excluded / admin
    permissions and pass the **protected-resource** check (§7.4).

### T3 — Log & exec abuse (data exfiltration, lateral movement)
- **Threat:** `exec` into a container = arbitrary command execution inside it; `logs` may leak
  secrets printed by apps. A viewer should not silently get a root shell.
- **Mitigations:**
  - `docker.container.exec` is a **distinct permission**, granted to operator/admin only,
    **always audited** (records container target; command args summarized, not full stdin/stdout).
  - `docker.container.logs` is its own permission; **viewer lacks it by default**.
  - Exec/attach/log streams run over the **same authenticated, CSRF/Origin-checked WebSocket**;
    the WS upgrade re-validates the session and permission **at connect time** (not just at page
    load) and the connection is closed if the session is revoked.

### T4 — CSRF
- **Threat:** because auth is a cookie, a malicious page could trigger state-changing requests.
- **Mitigations:**
  - **`SameSite=Strict`** session cookie (primary defense).
  - **Double-submit / per-session CSRF token**: every mutating request (POST/PUT/PATCH/DELETE)
    must send header `X-Castor-CSRF` equal to `sessions.csrf_token`; mismatch → `403`. The token
    is delivered to the SPA via a non-HttpOnly companion cookie or a `/api/v1/auth/me` field.
  - **Origin/Referer allowlist** on mutating requests and on the WS upgrade
    (`Sec-WebSocket`/`Origin` must match the configured public origin).

### T5 — Secret leakage (in logs, audit, responses, DB)
- **Threat:** passwords, TOTP secrets, session ids, env vars, or registry creds end up in app
  logs, the audit `detail`, or API responses.
- **Mitigations:**
  - **No secrets in logs/audit, ever.** `audit_log.detail` stores a **sanitized** JSON summary;
    a deny-list redactor strips `password`, `token`, `secret`, `authorization`, `*_key`, env
    values, and request bodies of auth endpoints before anything is logged.
  - `password_hash`, `totp_secret_enc`, `recovery_codes.code_hash`, raw session ids are **never**
    serialized to any API response (struct-level `json:"-"`).
  - TOTP secret encrypted at rest (AES-GCM via `CASTOR_SECRET_KEY`); session id stored hashed.
  - Container **env vars / inspect output** may contain app secrets → masking applied in the
    inspect view (values for env keys matching the secret deny-list are redacted unless the user
    holds an explicit `docker.container.inspect.secrets` permission; admin-only).

### T6 — Session/auth attacks (fixation, brute force, replay)
- **Mitigations:**
  - New random session id issued **on login** (no fixation); session invalidated on logout and
    on password change (all of a user's sessions revoked).
  - **Login throttling / lockout:** `failed_logins` + `locked_until` (e.g. exponential backoff,
    lock after N failures); constant-time password compare; uniform error messages (no
    user-enumeration via timing or distinct "no such user" vs "bad password").
  - TOTP code reuse window minimized (±1 step); recovery codes one-time.

### T7 — Container / supply-chain hardening of Castor itself
- **Mitigations (defaults):**
  - Final image is **distroless/scratch**, **non-root user** (`USER 65532`), read-only root
    filesystem where feasible, no shell, minimal attack surface; only `/data` (DB) and the
    Docker socket are mounted.
  - **Pinned dependencies** (`go.sum`), small dependency set (chi, x/crypto, otp,
    modernc/sqlite, docker client, client-go); CI runs `govulncheck` + image scan (owned by the
    packaging/QA ADRs, mandated here as policy).
  - **Security headers** on every response (see §7.4 mechanism): `Content-Security-Policy`
    (default-src 'self'; no inline except hashed), `X-Content-Type-Options: nosniff`,
    `X-Frame-Options: DENY` (+ CSP `frame-ancestors 'none'`), `Referrer-Policy:
    same-origin`, `Strict-Transport-Security` when HTTPS, `Cache-Control: no-store` on API.

### T8 — Accidental destruction of critical infrastructure (protected containers)
- **Threat:** a user stops/removes a container that the host depends on — including **Castor's
  own container**, the database, or a reverse proxy — and locks themselves (or the host) out.
- **Mitigation = the protected-containers mechanism (§7.4 below).**

### Threat → mitigation matrix (summary)

| Threat | Primary default mitigation |
|---|---|
| T1 socket exposure / SSRF | Provider-only access, no server-side URL fetch, non-root + socket proxy recommended |
| T2 priv-esc via create | Server-side create allowlist, privileged/host-mount admin-gated |
| T3 exec/log abuse | Distinct gated+audited `exec`/`logs` perms; WS re-auth at connect |
| T4 CSRF | SameSite=Strict + per-session CSRF token + Origin check |
| T5 secret leakage | Redaction in logs/audit, `json:"-"`, encrypted-at-rest, inspect masking |
| T6 session/brute-force | Random id on login, hashed at rest, lockout, constant-time compare |
| T7 Castor hardening | Distroless non-root, pinned deps, govulncheck, security headers/CSP |
| T8 accidental destruction | **Protected-containers guard** (§7.4) |

### 7.4 Protected-containers mechanism (the anti-foot-gun guard)

A single server-side guard, evaluated **before** any destructive Docker verb
(`stop`/`kill`/`restart`/`remove`/`rename`/`recreate`/`prune` affecting it):

1. **Self-protection (always on, cannot be disabled).** Castor identifies its **own**
   container id at startup. It reads `/proc/self/cgroup` / the hostname (container id) and
   matches against the Docker `inspect` to find itself. Any destructive action targeting
   Castor's own container, **or** the volume holding `/data`, is **hard-denied** (`409
   protected_resource`, audited) for **everyone, including admin**, via the API/UI. (Admins
   still have CLI/`docker` access on the host — this guard is about preventing *accidental* UI
   self-destruction, not about restraining a determined root.)
2. **Label-based protection.** Any container carrying the label
   **`io.castor.protected="true"`** (or matching a configurable name/label allowlist in
   `settings`, key `security.protected_labels`) is treated as protected: destructive verbs are
   **denied for non-admins** and require an **explicit confirm + reason** for admins (the reason
   is written to `audit_log.detail`). System/infra containers (db, reverse proxy) should carry
   this label by convention.
3. **Default-deny on ambiguity.** If Castor cannot positively determine whether the target is
   itself (e.g. inspect fails), the destructive action is **denied**, not allowed.

Builders implement this as `func GuardDestructive(ctx, target ContainerRef, actor *User)
error` called at the top of every destructive Docker handler, *after* `RequirePermission` and
*before* touching the Provider. The check result is folded into the audit record
(`result='denied', detail='protected_resource:self'`).

---

## 8. Consequences

**Positive**
- One small static binary, one port, one DB file → "docker run / compose up in < 2 min" is
  achievable; multi-arch (amd64+arm64) is trivial because the whole binary (incl. SQLite) is
  pure Go with `CGO_ENABLED=0`.
- Security is centralized: auth, CSRF, RBAC, audit, and the protected-resource guard live in a
  fixed middleware chain with single choke points, which is auditable and hard to bypass.
- The schema and Provider seam already carry the (unused) multi-host columns, so V2 agents land
  without migrations or handler rewrites.

**Negative / trade-offs**
- SQLite serializes writes; fine for our auth/audit volume but means Castor is **single-writer /
  single-instance** in V1 (no horizontal scaling of the server). Accepted: V1 is one container.
- `modernc.org/sqlite` is a transpiled SQLite; marginally slower than the cgo `mattn` driver and
  carries the modernc toolchain as a (permissive-licensed) dependency. Accepted — correctness and
  static-binary portability dominate over raw DB throughput for this workload.
- The self-protection guard is best-effort against *accidental* destruction, not a security
  boundary against a host-root adversary (who can bypass via the socket directly). This is
  documented, not hidden.
- Storing argon2id-hashed recovery codes + encrypted TOTP secrets means **losing
  `CASTOR_SECRET_KEY` makes 2FA unrecoverable**; documented as an operator backup
  responsibility.

**Follow-ups (other ADRs / phases)**
- Exact Dockerfile (two builder stages, distroless final, non-root, multi-arch) → packaging ADR.
- `govulncheck` + image scanning in CI → QA/packaging ADR.
- V2 `RemoteAgentProvider` + agent enrollment + mTLS → future ADR-CASTOR-00x (uses the
  `registered_hosts` columns reserved here).

---

## 9. Locked module paths (for builders)

| Concern | Module path | Notes |
|---|---|---|
| HTTP router | `github.com/go-chi/chi/v5` (+ `/v5/middleware`) | v5.2.x, MIT |
| Password hash | `golang.org/x/crypto/argon2` (`argon2.IDKey`) | argon2id, PHC string |
| Constant-time compare | `crypto/subtle` (stdlib) | hash verify |
| TOTP 2FA | `github.com/pquerna/otp` + `github.com/pquerna/otp/totp` | Apache-2.0, GA-compatible |
| SQLite driver | `modernc.org/sqlite` | **pure Go / CGo-free**, v1.49.x, SQLite 3.53.x, driver name `"sqlite"` |
| DB access | `database/sql` (stdlib) | with the WAL/busy_timeout/foreign_keys pragmas in §3.3 |
| UI embed | `embed` (stdlib `embed.FS`) | React+Vite+TS `dist` embedded |
| Docker | `github.com/docker/docker/client` | local socket, via `DockerProvider` (ADR-002) |
| Kubernetes | `k8s.io/client-go` | read-only, kubeconfig (ADR-002) |
| Randomness | `crypto/rand` | session ids, salts |
