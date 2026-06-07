# Contributing to Castor

Thanks for your interest in Castor — the open-source, multi-host container orchestration platform
by LEONARD-IT/GTEK-IT. Contributions of all kinds are welcome: bug reports, docs, tests, and code.

Castor is **100% from scratch and self-contained** — it depends on no other repository. Please keep
it that way: do not introduce a dependency on any external/internal proprietary codebase.

---

## Ground rules

- **License:** by contributing you agree your work is licensed under [Apache-2.0](LICENSE).
- **Security first:** Castor controls the Docker socket, which is root-equivalent on the host. Any
  change touching auth, RBAC, the audit log, the protected-resource guard, the Docker/K8s providers,
  or the Dockerfile/compose hardening gets extra scrutiny. When in doubt, open an issue first.
- **No secrets in code, logs, or the audit log.** Ever. (See [`docs/runbooks/security.md`](docs/runbooks/security.md).)

---

## Repository layout

```
server/   Go backend (single static binary). Module: github.com/gtek-it/castor
  cmd/castor/        main + the `healthcheck` subcommand
  web/               embed bridge: //go:embed dist  (server/web/embed.go)
  internal/...       config, provider (docker/swarm/kube), cache, store, authz, api, version
ui/       React + Vite + TypeScript. Built to ../server/web/dist and embedded in the binary.
deploy/   docker-compose.yml (+ kube overlay) and env.example — the 1-command deploy.
docs/     ADRs + runbooks (install, security).
Dockerfile .dockerignore Makefile build.sh build.ps1 .github/workflows/  — packaging & CI.
```

**Ownership boundaries** (to avoid merge churn):

| Tree | Owner area |
|---|---|
| `/server`, `go.mod`, `go.sum` | Backend |
| `/ui` | Frontend |
| `/deploy`, root `Dockerfile`/`.dockerignore`/`Makefile`/`build.*`, `.github/workflows`, root `docker-compose.yml` | Packaging / DevOps |

### The embed-path contract (do not break it)

The UI is embedded into the Go binary. Three things MUST agree:

1. `ui/vite.config.ts` → `build.outDir = "../server/web/dist"`
2. `server/web/embed.go` → `//go:embed dist`
3. `Dockerfile` → copies the built dist into `server/web/dist` **before** `go build`

A placeholder `server/web/dist/index.html` is committed so a bare `go build` never fails the embed.
`server/web/dist/` is otherwise `.gitignore`d. If you change any one of the three, change all three.

---

## Development setup

You need **Docker** (with Compose). For local (non-Docker) backend/UI dev you additionally need
**Go 1.23+** and **Node 24+**.

```bash
git clone https://github.com/gtek-it/castor.git
cd castor

# Fast path — build & run the real image (no local Go needed):
export CASTOR_SECRET_KEY=$(openssl rand -hex 32)
./build.sh build && ./build.sh run        # Windows: ./build.ps1 build; ./build.ps1 run

# Local dev with hot-reload UI (needs Go + Node):
./build.sh dev
#   -> Go backend on :8080, vite dev server on :5173 (proxies /api and /ws to :8080)
```

`make` targets (Unix, local toolchain):

| Target | What it does |
|---|---|
| `make embed` | `npm ci` + `vite build` into `server/web/dist` |
| `make build` | embed + build the static CGO-free Go binary |
| `make test` | `go test -race ./...` |
| `make ui-test` | `vitest` |
| `make lint` | `golangci-lint run ./...` |
| `make govulncheck` | `govulncheck ./...` |
| `make verify` | lint + test + govulncheck (server-side CI gate) |
| `make docker-build` | buildx the local-arch image |

---

## Coding standards

**Go**

- Target **Go 1.23**, `CGO_ENABLED=0` always. **`modernc.org/sqlite`** only — `mattn/go-sqlite3`
  (cgo) is **forbidden** (it breaks the distroless/scratch final stage and arm64 cross-compile).
- `gofmt`/`goimports` clean; `golangci-lint run ./...` must pass; new code carries tests.
- Never import the Docker or Kubernetes SDK outside `internal/provider/...`. The API layer talks to
  the `Provider` seam only (ADR-002).
- Every mutating Docker action goes through the single authz choke point and writes an audit row
  (ADR-003 §6/§7). Destructive verbs call `GuardDestructive` before touching the provider.

**TypeScript / React**

- `eslint` clean; `vitest` green. Type names must mirror the Go API field names exactly
  (`ui/src/lib/types.ts`).
- Grey out write affordances based on the provider's declared capabilities — never "click then 405".

**Dependencies**

- Keep the dependency set small and pinned (`go.sum`, `package-lock.json`). New deps must be
  permissively licensed (Apache-2.0 / MIT / BSD) and justified in the PR.

---

## Pull requests

1. Fork & branch from `main` (e.g. `feat/...`, `fix/...`, `docs/...`).
2. Keep PRs focused; describe the change and the rationale; link any issue.
3. Make CI green: the [`ci`](.github/workflows/ci.yml) workflow runs `golangci-lint`,
   `go test -race`, the UI build + `vitest`, `govulncheck`, **and** a full image build.
4. Update docs/ADRs when you change behavior, config, or the security model.
5. Sign-off is welcome; be kind in review.

### Commits

Conventional, imperative subject lines are appreciated (`feat:`, `fix:`, `docs:`, `chore:`,
`refactor:`, `test:`). Reference issues where relevant.

---

## Reporting security issues

**Do not open a public issue for vulnerabilities.** Email the LEONARD-IT/GTEK-IT security contact (see the
repository's `SECURITY.md` / org profile) with details and a reproduction. We'll coordinate a fix and
disclosure. See the threat model in [`docs/runbooks/security.md`](docs/runbooks/security.md).

---

Merci, and happy orchestrating.
