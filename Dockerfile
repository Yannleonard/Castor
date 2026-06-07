# syntax=docker/dockerfile:1.7
#
# Castor — multi-host container orchestration platform (LEONARD-IT/GTEK-IT, Apache-2.0).
# Single self-contained image: a pure-Go static binary that serves both the
# JSON/WS API and the embedded React UI on one port (default :8080).
#
# Three stages:
#   1. ui    (node:24-alpine)            — build the React+Vite+TS UI to static assets.
#   2. build (golang:1.25.11-alpine)        — embed the UI dist + compile a CGO-free static binary.
#   3. final (distroless/static:nonroot) — ship only the binary, non-root, no shell, no libc.
#
# Multi-arch (linux/amd64 + linux/arm64) is trivial because the whole binary —
# including modernc.org/sqlite — is pure Go with CGO_ENABLED=0. mattn/go-sqlite3
# is FORBIDDEN (it needs cgo + libc and would break distroless/scratch + arm64 cross).
#
# Build locally:
#   docker buildx build --build-arg VERSION=$(git describe --tags --always) \
#     --build-arg COMMIT=$(git rev-parse --short HEAD) -t castor:dev --load .
#
# CRITICAL embed-path contract (must stay in lockstep across three agents):
#   - UI  : vite.config.ts  build.outDir = "../server/web/dist"
#   - GO  : server/web/embed.go has  //go:embed dist   (relative to that file)
#   - HERE: stage 1 writes /server/web/dist; stage 2 copies it to ./server/web/dist
#           BEFORE `go build`, so go:embed captures the freshly built assets.

# ============================================================================
# STAGE 1 — UI build (React + Vite + TypeScript -> static dist)
# ============================================================================
FROM node:24-alpine AS ui
WORKDIR /ui

# Install deps first (cached layer keyed on the lockfile only).
COPY ui/package.json ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Then the sources.
COPY ui/ ./

# vite.config.ts sets build.outDir to "../server/web/dist", which — with WORKDIR
# /ui — resolves to /server/web/dist inside THIS stage. The go stage copies that
# path into the embed location. Fail fast if the build did not produce index.html
# (the SPA fallback target that go:embed and the router depend on).
RUN npm run build \
 && test -f /server/web/dist/index.html \
    || (echo "FATAL: vite build did not emit /server/web/dist/index.html — check vite.config.ts build.outDir (must be ../server/web/dist)"; exit 1)

# ============================================================================
# STAGE 2 — Go build (embeds UI dist, fully static, CGO-free, trimmed)
# ============================================================================
FROM golang:1.25.11-alpine AS build
WORKDIR /src

# git: VCS stamping fallback; ca-certificates/tzdata: vendored for completeness
# (distroless/static:nonroot already ships certs+tz, but COPYing keeps scratch an
# easy drop-in alternative and keeps the builder self-sufficient).
RUN apk add --no-cache git ca-certificates tzdata

# Module graph first (cached layer keyed on go.mod/go.sum only).
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# Backend sources.
COPY server/ ./server/

# Bring the built UI into the embed path BEFORE `go build` so //go:embed dist
# (in server/web/embed.go) captures the real assets, not the committed placeholder.
COPY --from=ui /server/web/dist ./server/web/dist

# Version stamping (passed by CI / build scripts). buildx provides TARGETOS/TARGETARCH.
ARG VERSION=dev
ARG COMMIT=none
ARG TARGETOS
ARG TARGETARCH

# CGO_ENABLED=0 ALWAYS (modernc.org/sqlite is pure Go). -trimpath + -s -w for a
# small, reproducible binary. Caches for module + build artifacts speed rebuilds.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath \
      -ldflags="-s -w \
        -X github.com/gtek-it/castor/server/internal/version.Version=${VERSION} \
        -X github.com/gtek-it/castor/server/internal/version.Commit=${COMMIT}" \
      -o /out/castor ./server/cmd/castor

# Sanity: the artifact must exist and be non-empty before we ship it.
RUN test -s /out/castor

# Prepare an empty /data owned by the non-root runtime uid:gid (65532:65532).
# distroless has no shell, so we cannot mkdir/chown at runtime — we stage the
# directory here and COPY --chown it into the final image. When a fresh named
# volume is mounted over /data, Docker seeds the volume from this image content,
# preserving the 65532 ownership so SQLite can create /data/castor.db.
RUN install -d -o 65532 -g 65532 -m 0750 /data

# ============================================================================
# STAGE 3 — final (distroless static, non-root, no shell, no package manager)
# ============================================================================
# gcr.io/distroless/static:nonroot == debian12 base, runs as uid:gid 65532:65532,
# ships CA certificates + tzdata, contains no shell and no libc. Perfect for a
# fully static CGO-free Go binary.
FROM gcr.io/distroless/static:nonroot AS final

LABEL org.opencontainers.image.title="Castor" \
      org.opencontainers.image.description="Castor by Leonard — multi-host container orchestration platform (Docker, Swarm, Kubernetes)." \
      org.opencontainers.image.vendor="LEONARD-IT" \
      org.opencontainers.image.authors="LEONARD-IT" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="1.0.2" \
      org.opencontainers.image.source="https://github.com/Yannleonard/Castor" \
      org.opencontainers.image.url="https://github.com/Yannleonard/Castor" \
      org.opencontainers.image.documentation="https://github.com/Yannleonard/Castor#readme"

COPY --from=build /out/castor /usr/local/bin/castor

# Seed /data from the build stage with uid:gid 65532 ownership so the non-root
# process can create the SQLite database. A fresh named volume mounted at /data
# inherits this ownership; a bind mount must be chowned by the operator.
COPY --from=build --chown=65532:65532 /data /data

# /data is the SQLite home. Declared a VOLUME so it persists across container
# recreation and is writable by uid 65532. The named volume / bind mount is
# self-protected from UI removal (ADR-003 §7.4).
VOLUME ["/data"]

EXPOSE 8080

ENV CASTOR_HTTP_ADDR=":8080" \
    CASTOR_DB_PATH="/data/castor.db"

# Distroless has NO shell and NO curl/wget, so the healthcheck calls the binary's
# own subcommand: `castor healthcheck` performs GET 127.0.0.1$CASTOR_HTTP_ADDR
# /api/v1/healthz and exits 0 (healthy) or 1 (unhealthy). Exec form is mandatory
# (no shell to interpret a string form).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/castor", "healthcheck"]

# The CONTAINER starts as root, but the SERVER runs as NON-ROOT (uid 65532).
# `castor entrypoint` runs as root ONLY long enough to read the mounted docker
# socket's group, then immediately drops to uid:gid 65532:65532 WITH that group as
# a supplementary group and re-execs the server (the gosu/su-exec pattern, in pure
# Go for this shell-less distroless image). This is what lets
# `docker run -v /var/run/docker.sock:... ghcr.io/.../castor` work with NO
# `--group-add` while the actual server process stays unprivileged.
#
# We must set USER 0 explicitly because the distroless :nonroot base defaults to
# uid 65532 — without this the entrypoint could not read a root:docker socket and
# the host would show "degraded". The drop to 65532 happens in-process; root is
# never retained by the server.
#
# Operators who prefer to pin the user can still run with
# `--user 65532:65532 --group-add <docker-gid>`: the entrypoint sees it is already
# non-root and simply runs the server without attempting to drop.
USER 0:0

ENTRYPOINT ["/usr/local/bin/castor", "entrypoint"]
