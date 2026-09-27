> 🇬🇧 **English** · [🇫🇷 Français](security.fr.md)

# Security overview

This page describes what Castor does to protect your deployment and what you should do on your side.
Deployment commands are in [`install.md`](install.md).

## What Castor provides

**HTTPS by default.** Castor serves the UI and the API over HTTPS with a self-signed certificate
out of the box. You can import your own certificate (PEM certificate, key and chain) or enable
Let's Encrypt from **Settings → HTTPS & certificates**; certificates are applied without a restart
and HSTS is sent with CA-issued certificates.

**Accounts and 2FA.** Local accounts use argon2id password hashing; TOTP 2FA is available for every
user, with one-time recovery codes. TOTP secrets and imported private keys are encrypted at rest
with AES-256-GCM under `CASTOR_SECRET_KEY`. SSO through LDAP and OIDC is supported. Login is
throttled, and sessions are server-side, cookie-bound and revoked on logout and password change.

**Role-based access control.** Every action goes through a server-side permission check.

| Role | What it allows |
|---|---|
| `admin` | Everything, including container creation, removals, users, roles and the audit log. |
| `operator` | Docker read access plus start, stop, restart, pause, exec, logs and image pull. |
| `viewer` | Read-only access to containers, images, networks, volumes and stats. |

Custom roles can be created; a user can only grant permissions they hold themselves.

**Audit log.** Every state-changing action writes one append-only record: actor, IP, action, target,
result and request id, with secrets redacted. Reading the log requires `audit.read`.

**API tokens.** Personal Access Tokens authenticate API calls and the Prometheus `/metrics`
endpoint with `Authorization: Bearer`; they carry the permissions of their owner.

**Protected containers.** Castor's own container and its `/data` volume cannot be removed from the
UI or the API, by anyone. Containers labelled `io.castor.protected="true"` require an admin and an
explicit confirmation with a reason, recorded in the audit log.

**Hardened image.** Distroless, non-root user (uid 65532), read-only root filesystem, all
capabilities dropped and `no-new-privileges`. Dependencies are checked with `govulncheck` on every
push.

## The Docker socket

The Docker socket gives complete access to the Docker engine and therefore to the host. Mount it
`:rw` only on a host you trust Castor with, or point `CASTOR_DOCKER_HOST` at a docker-socket-proxy
that exposes only the endpoints you need.

## Deployment recommendations

- Enable 2FA for every account, starting with the admin; enable
  `security.totp_required_for_mutations` in Settings to require it for state-changing actions.
- Serve a trusted certificate: imported, Let's Encrypt, or TLS terminated by your reverse proxy.
- Keep `CASTOR_SECRET_KEY` in a secret manager and back up `/data` regularly.
- Update Castor as new releases are published (`docker compose pull && docker compose up -d`).
- When Castor is reachable from the internet, put it behind a reverse proxy and restrict who can
  reach ports 8443 and 8080.

## Reporting a vulnerability

Report security issues privately through **Security → Report a vulnerability** on the GitHub
repository (see [`SECURITY.md`](../../SECURITY.md)), not in a public issue.
