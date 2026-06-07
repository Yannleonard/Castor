# Security Policy

Castor is built **security-first**. This document describes how we handle
vulnerabilities, how to report one, and the (small, fully justified) set of
upstream advisories we have assessed as **not applicable** to Castor.

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories
(**Security → Report a vulnerability** on the repository) rather than opening a
public issue. We aim to acknowledge reports within 72 hours.

## Our baseline

- The server runs as a **non-root** user (uid 65532) in a **distroless** image
  (no shell, no package manager, no libc).
- Secrets are sealed with **AES-256-GCM**; secret *values* are never returned by
  the API.
- All state-changing actions are **audited**; access is **RBAC**, resource-scoped.
- CI runs `govulncheck` on every push and **fails the build on any vulnerability**
  except the explicitly-justified, non-applicable advisories listed below. The
  gate is implemented in [`scripts/govulncheck-gate.sh`](scripts/govulncheck-gate.sh):
  it parses govulncheck's JSON output and re-fails for **anything** not on the
  allow-list, so a newly-introduced or newly-disclosed vulnerability still breaks
  CI.

## Dependency hygiene

We keep the Go toolchain and dependencies current to absorb upstream fixes.
As of the latest release this includes Go 1.25.11 (standard-library CVE fixes),
Helm v3.18.5, containerd v1.7.29, and moby/spdystream v0.5.1 — collectively
resolving every actionable `govulncheck` finding.

## Assessed-not-applicable advisories (govulncheck allow-list)

The following advisories are reported by `govulncheck` against the
`github.com/docker/docker` **client** library that Castor links, but they affect
the Docker/Moby **daemon's** plugin subsystem — code paths Castor does not use.
There is **no fixed version** of `github.com/docker/docker` for either (the fix
lives only in the separate `github.com/moby/moby/v2` engine module). They are
therefore allow-listed in the CI gate, with the justification recorded here.

### GO-2026-4887 — CVE-2026-34040 (AuthZ plugin bypass via oversized request body)
- **Affected component:** the daemon's **authorization-plugin** (`AuthZ`)
  request-handling path.
- **Why it does not apply to Castor:** Castor is a **client** of the Docker API
  over the mounted socket. It does **not** run a Docker daemon, does **not**
  register or rely on AuthZ plugins, and exposes no path that forwards arbitrary
  oversized bodies into a daemon AuthZ plugin. Castor enforces its own
  authorization (RBAC + audit) in-process, independent of Docker AuthZ plugins.
- **Upstream fix status:** none for `github.com/docker/docker` (engine-only fix in
  `moby/moby/v2`).

### GO-2026-4883 — CVE-2026-33997 (off-by-one in legacy-plugin privilege validation)
- **Affected component:** the daemon's **legacy plugin** privilege-validation
  logic.
- **Why it does not apply to Castor:** Castor does not install, enable, or
  validate Docker **plugins** (legacy or otherwise). The vulnerable validation
  code is never reached through any Castor code path.
- **Upstream fix status:** none for `github.com/docker/docker` (engine-only fix in
  `moby/moby/v2`).

We re-review this allow-list whenever dependencies are updated. If an upstream fix
becomes available in the client library, we will adopt it and remove the entry.
