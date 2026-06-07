# Castor — Security & Threat Model (summary)

This runbook summarizes Castor's security posture for operators. The authoritative design is
**ADR-CASTOR-003 §5–§7** ([`../adr/ADR-CASTOR-003-stack-storage-auth-security.md`](../adr/ADR-CASTOR-003-stack-storage-auth-security.md)).

> **Core premise.** Access to `/var/run/docker.sock` is **root-equivalent on the host**: a container
> that bind-mounts the socket (or the host filesystem) can escape to root. Castor therefore does
> **not** let a non-admin create such a container — the **host-mount guard** (T2 below) rejects host
> bind mounts (incl. the socket) by default; only named volumes are allowed, and the socket / host-root
> paths are denied even for admins through the API. A user who holds raw OS/socket access outside
> Castor can still bypass Castor entirely. Everything below keeps the blast radius small and every
> action attributable; the protected-containers guard defends against *accidental* destruction, not a
> determined host-root adversary (who can drive the socket directly).

---

## 1. Authentication

- **Passwords:** hashed with **argon2id** (`golang.org/x/crypto/argon2`, `IDKey`), parameters encoded
  in a self-describing PHC string; verified in constant time.
- **Sessions:** server-side, cookie-bound. The cookie `castor_session` holds an opaque 256-bit random
  id; only `SHA-256(id)` is stored at rest (a DB leak yields no live cookies). Cookie flags:
  `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` when the request is HTTPS (behind a proxy,
  only when `CASTOR_TRUST_PROXY=true`). Sliding 12h TTL, 24h absolute cap; logout & password change
  revoke sessions.
- **TOTP 2FA:** `github.com/pquerna/otp`. The TOTP secret is **AES-256-GCM-sealed** under
  `CASTOR_SECRET_KEY`. Confirming enrollment mints **10 one-time recovery codes** (shown once,
  stored argon2id-hashed). Login is two-step: password → `amr=pwd`; a valid TOTP/recovery code
  upgrades the session to `amr=pwd+totp` (AAL2).
- **Step-up for mutations is OPT-IN and OFF by default.** The setting
  `security.totp_required_for_mutations` (`SettingTOTPRequiredForMut`) **defaults to `false`** — out
  of the box a password-only session can perform mutations. When an operator turns it **on** (Settings
  UI, or the persisted setting), every mutating REST route (`RequireAAL` middleware) **and** the
  interactive **exec WebSocket** require `amr=pwd+totp` for any user who has TOTP enabled; such a user
  with only `amr=pwd` is rejected (`aal_required`, 403) until they complete TOTP. Users without TOTP
  enrolled are unaffected by this flag (there is nothing to step up to) — enforce enrollment
  operationally if you require AAL2 fleet-wide.
- **Bootstrap:** first run (empty users + `bootstrap.completed != true`) opens a single-shot
  create-admin endpoint; all other routes return `409 bootstrap_required`. Optionally gated by
  `CASTOR_BOOTSTRAP_TOKEN` for unattended installs.

---

## 2. Authorization (resource-scoped RBAC)

- Permissions are dotted `domain.resource.verb` (e.g. `docker.container.start`,
  `docker.container.remove`, `docker.image.delete`, `swarm.service.read`, `k8s.pod.read`,
  `audit.read`); `*` = superuser.
- Enforced at **one server-side choke point** — a fixed chi middleware chain
  (`RequestID → RealIP → Recoverer → SecurityHeaders → SessionAuth → CSRF → RequireAAL →
  RequirePermission → AuditWrap → handler`). **No handler performs a Docker mutation without passing
  this gate.** Denials return `403` and are audited.
- **Built-in roles:** `admin` (`*`), `operator` (Docker read + lifecycle [start/stop/restart/
  pause/unpause] / exec / logs / image pull, **no** container **create**, remove / image-delete /
  volume-remove / user-mgmt / protected-container actions), `viewer` (read-only; no exec, no logs by
  default). Checks are scope-aware so V2 multi-host needs no rewrite.
- **`docker.container.create` is admin / explicit-grant only.** It is the single privilege-escalation
  vector (the only verb that can request a host bind mount), so it is **not** in the operator default
  grant — only `admin`'s `*` satisfies it. It remains a real, assignable permission: an admin can add
  it to a custom role (and the host-mount guard below still applies to whoever holds it).
- **Grant-only-what-you-hold.** Creating/updating a role or creating a role-binding rejects (403,
  audited) any permission the **acting** user does not themselves hold at the target scope — including
  `*` and domain wildcards (`docker.*`). For a binding, the actor must hold every permission the bound
  role carries at the binding's scope. This closes RBAC self-escalation (e.g. a user with
  `rbac.binding.create` but only narrow perms cannot bind themselves the `*` admin role).

---

## 3. Threats & default mitigations

| Threat | Default mitigation |
|---|---|
| **T1 — Socket exposure / SSRF to the socket** | Socket touched **only** via the typed `DockerProvider`; no user string is interpolated into socket calls; **no server-side outbound-URL features** in V1; non-root container + socket-proxy recommended (`CASTOR_DOCKER_HOST`). |
| **T2 — Priv-esc via container create / host-mount escape** | `docker.container.create` is **admin / explicit-grant only** (not an operator default). Image refs are validated server-side. The **host-mount guard** runs server-side before `ContainerCreate` (one-click deploy **and** compose stacks): a **host bind mount is rejected by default (403, audited)** for non-admins — only **named volumes** are allowed. A global superuser may opt in (`allowHostMounts`) to mount an *ordinary* host path, but a fixed set of host-takeover paths — `/var/run/docker.sock`, `/`, `/etc`, `/root`, `/home`, `/boot`, `/var/lib/docker`, `/run`, `/proc`, `/sys`, `/dev` (and nested paths) — is **hard-rejected for everyone through the API**. The guard is enforced again inside the provider as defense-in-depth, so no code path can create a container with a forbidden host bind. |
| **T3 — Exec / log abuse** | `docker.container.exec` and `docker.container.logs` are **distinct, gated, always-audited** permissions; the exec/logs WebSocket **re-validates the session + permission at connect time** and closes if the session is revoked. The **exec** subscription additionally enforces the same **TOTP step-up (AAL)** check as REST mutations — opening a root-capable shell cannot bypass step-up (see §1 note on `security.totp_required_for_mutations`). |
| **T4 — CSRF** | `SameSite=Strict` cookie + a **per-session CSRF token** required in `X-Castor-CSRF` on every mutating request + an **Origin/Referer allowlist** on mutations and the WS upgrade. |
| **T5 — Secret leakage** | A deny-list redactor strips `password`/`token`/`secret`/`authorization`/`*_key`/env values before anything is logged or written to `audit_log.detail`; `password_hash`, `totp_secret_enc`, recovery-code hashes, and raw session ids carry `json:"-"`; container inspect masks secret-like env values unless an admin holds an explicit permission. |
| **T6 — Session / brute-force** | New random session id on login (no fixation); hashed at rest; login throttling/lockout (`failed_logins` + `locked_until`); constant-time password compare; uniform error messages (no user enumeration); one-time recovery codes; ±1-step TOTP window. |
| **T7 — Castor supply-chain / container hardening** | Distroless `static:nonroot` (uid 65532), no shell/libc, read-only rootfs + `cap_drop: ALL` + `no-new-privileges` in compose; pinned, small dependency set; CI runs `govulncheck` + an image build; strict **security headers** (CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, HSTS on HTTPS, `Cache-Control: no-store` on `/api`). |
| **T8 — Accidental destruction of critical infra** | The **protected-containers guard** (below). |

---

## 4. Protected-containers guard (anti-foot-gun)

Evaluated **before** any destructive Docker verb (`stop`/`kill`/`restart`/`remove`/`rename`/
`recreate`/`prune`), via `GuardDestructive(ctx, target, actor)`:

1. **Self-protection (always on, cannot be disabled).** Castor identifies its **own** container id at
   startup (`/proc/self/cgroup` + `CASTOR_SELF_CONTAINER_ID`, cross-checked via inspect). Destructive
   actions targeting Castor's own container **or the volume holding `/data`** are **hard-denied
   (`409 protected_resource`)** for **everyone, including admins**, through the UI/API.
2. **Label-based protection.** Containers labelled **`io.castor.protected="true"`** (or matching the
   configurable `security.protected_labels` setting) are denied for non-admins and require an
   **explicit confirm + reason** (written to the audit log) for admins. Label your DB, reverse proxy,
   and other infra containers accordingly.
3. **Default-deny on ambiguity.** If Castor cannot positively confirm the target is *not* itself
   (e.g. inspect fails), the destructive action is **denied**, not allowed.

> This guard prevents *accidental* self-destruction from the UI. It is **not** a boundary against a
> host-root operator, who can always bypass Castor via the Docker CLI/socket.

---

## 5. The secret key

`CASTOR_SECRET_KEY` (32 bytes, 64 hex chars from `openssl rand -hex 32`) seals TOTP secrets at rest.
Operator responsibilities:

- Store it in a **secret manager**; never commit it; never log it.
- **Losing it makes enrolled 2FA unrecoverable** — affected users must have 2FA reset out-of-band.
- Rotating it invalidates existing sealed TOTP secrets (plan a re-enrollment).

---

## 6. Audit log

- Every **mutating** action writes exactly **one append-only row** (`audit_log`): actor, IP, action,
  target, scope, result (`success`/`denied`/`error`), HTTP status, sanitized detail, request id.
- Rows are **never** updated or deleted by the application (`id` is a monotonic autoincrement for
  tamper-evident ordering). `detail` is redaction-filtered — **no secrets**.
- Reading the audit log requires `audit.read` (admin by default).

---

## 7. Network exposure recommendations

- Terminate **TLS** at a trusted reverse proxy; restrict port `8080` to that proxy.
- Set `CASTOR_TRUST_PROXY=true` only behind a proxy you control (governs the `Secure` cookie flag and
  the client IP recorded in the audit log; otherwise a client could spoof `X-Forwarded-*`).
- Keep the WS/Origin allowlist aligned with your public origin.

---

## 8. Reporting a vulnerability

**Do not open a public GitHub issue for security problems.** Email the LEONARD-IT/GTEK-IT security contact (see
the org `SECURITY.md` / profile) with a description and reproduction. We coordinate a fix and
responsible disclosure.
