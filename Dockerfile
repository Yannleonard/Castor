# syntax=docker/dockerfile:1.7
#
# Castor — multi-host container orchestration platform (Apache-2.0).
# Single static Go binary serving the API and the embedded React UI (HTTPS :8443, HTTP :8080).
# Stages: ui (node) -> build (go, embeds server/web/dist) -> final (distroless, non-root).
#
# Build: docker buildx build --build-arg VERSION=$(git describe --tags --always) \
#          --build-arg COMMIT=$(git rev-parse --short HEAD) -t castor:dev --load .

# --- Stage 1: UI build (React + Vite + TypeScript) ---------------------------
FROM --platform=$BUILDPLATFORM node:24-alpine AS ui
WORKDIR /ui

# Dependencies first (cached layer).
COPY ui/package.json ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY ui/ ./

# Outputs to /server/web/dist (vite.config.ts build.outDir = ../server/web/dist).
RUN npm run build \
 && test -f /server/web/dist/index.html \
    || (echo "FATAL: vite build did not emit /server/web/dist/index.html — check vite.config.ts build.outDir (must be ../server/web/dist)"; exit 1)

# --- Stage 2: Go build (static, CGO-free, embeds the UI) ---------------------
FROM --platform=$BUILDPLATFORM golang:1.25.11-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates tzdata

# Module download first (cached layer).
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY server/ ./server/

# go:embed (server/web/embed.go) reads server/web/dist; the UI must be in place before go build.
COPY --from=ui /server/web/dist ./server/web/dist

# Version stamping; buildx provides TARGETOS/TARGETARCH.
ARG VERSION=dev
ARG COMMIT=none
ARG TARGETOS
ARG TARGETARCH

# Static, trimmed binary. Keep CGO_ENABLED=0 (modernc.org/sqlite is pure Go).
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath \
      -ldflags="-s -w \
        -X github.com/gtek-it/castor/server/internal/version.Version=${VERSION} \
        -X github.com/gtek-it/castor/server/internal/version.Commit=${COMMIT}" \
      -o /out/castor ./server/cmd/castor

RUN test -s /out/castor

# Empty /data owned by the runtime uid:gid (65532), copied into the final image below.
RUN install -d -o 65532 -g 65532 -m 0750 /data

# --- Stage 3: runtime (distroless, non-root, no shell) -----------------------
FROM gcr.io/distroless/static:nonroot AS final

LABEL org.opencontainers.image.title="Castor by IT Leonard" \
      org.opencontainers.image.description="Castor by IT Leonard — multi-host container orchestration platform (Docker, Swarm, Kubernetes)." \
      org.opencontainers.image.vendor="IT Leonard" \
      org.opencontainers.image.authors="LEONARD-IT" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="1.0.2" \
      org.opencontainers.image.source="https://github.com/Yannleonard/Castor" \
      org.opencontainers.image.url="https://github.com/Yannleonard/Castor" \
      org.opencontainers.image.documentation="https://github.com/Yannleonard/Castor#readme"

COPY --from=build /out/castor /usr/local/bin/castor

# /data is owned by uid:gid 65532; a bind mount must be chowned to 65532 as well.
COPY --from=build --chown=65532:65532 /data /data

# Persistent data: SQLite database, settings, TLS material (CASTOR_TLS_DIR, default /data/tls).
VOLUME ["/data"]

# 8443 HTTPS (UI + API); 8080 HTTP (healthcheck, ACME challenges, redirect to HTTPS).
EXPOSE 8080 8443

ENV CASTOR_HTTP_ADDR=":8080" \
    CASTOR_HTTPS_ADDR=":8443" \
    CASTOR_DB_PATH="/data/castor.db"

# Exec form: distroless has no shell or curl, the binary performs its own check.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/castor", "healthcheck"]

# The entrypoint drops to uid:gid 65532 (plus the Docker socket group) before starting the server.
# `--user 65532:65532 --group-add <docker-gid>` is also supported.
USER 0:0

ENTRYPOINT ["/usr/local/bin/castor", "entrypoint"]
