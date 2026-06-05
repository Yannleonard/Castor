#!/usr/bin/env bash
# =============================================================================
# Castor build helper (Unix/macOS).  Windows users: use build.ps1.
#
#   ./build.sh build           # buildx the image for the local arch, load it
#   ./build.sh buildx          # build multi-arch (linux/amd64,linux/arm64)
#   ./build.sh push            # build + push multi-arch to the registry
#   ./build.sh run             # docker compose up -d (the < 2 min path)
#   ./build.sh dev             # local dev: go backend :8080 + vite dev :5173
#   ./build.sh down            # docker compose down
#   ./build.sh help
#
# Env overrides: IMAGE, VERSION, COMMIT, PLATFORMS, PORT, DOCKER_GID, CASTOR_SECRET_KEY
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="${IMAGE:-ghcr.io/gtek-it/castor}"
VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"
COMMIT="${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo none)}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PORT="${PORT:-8080}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"

log()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

resolve_docker_gid() {
  if [ -n "${DOCKER_GID:-}" ]; then echo "$DOCKER_GID"; return; fi
  getent group docker 2>/dev/null | cut -d: -f3 || echo 999
}

require_secret() {
  [ -n "${CASTOR_SECRET_KEY:-}" ] || die "CASTOR_SECRET_KEY is unset. Run: export CASTOR_SECRET_KEY=\$(openssl rand -hex 32)"
  # 32 bytes == 64 hex chars. Warn (don't hard fail) if it doesn't look like that.
  if ! printf '%s' "$CASTOR_SECRET_KEY" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    printf '\033[33mWARN:\033[0m CASTOR_SECRET_KEY is not 64 hex chars (32 bytes). The backend will refuse to start unless it decodes to 32 bytes. Generate with: openssl rand -hex 32\n' >&2
  fi
}

cmd_build() {
  log "buildx (local arch, --load): $IMAGE:$VERSION"
  docker buildx build \
    --build-arg VERSION="$VERSION" \
    --build-arg COMMIT="$COMMIT" \
    -t "$IMAGE:$VERSION" -t "$IMAGE:latest" \
    --load .
  log "done. images: $IMAGE:$VERSION, $IMAGE:latest"
}

cmd_buildx() {
  log "buildx multi-arch ($PLATFORMS): $IMAGE:$VERSION"
  docker buildx build \
    --platform "$PLATFORMS" \
    --build-arg VERSION="$VERSION" \
    --build-arg COMMIT="$COMMIT" \
    -t "$IMAGE:$VERSION" -t "$IMAGE:latest" \
    .
}

cmd_push() {
  log "buildx multi-arch + push ($PLATFORMS): $IMAGE:$VERSION"
  docker buildx build \
    --platform "$PLATFORMS" \
    --build-arg VERSION="$VERSION" \
    --build-arg COMMIT="$COMMIT" \
    -t "$IMAGE:$VERSION" -t "$IMAGE:latest" \
    --push .
}

cmd_run() {
  require_secret
  log "docker compose up -d ($COMPOSE_FILE)"
  CASTOR_SECRET_KEY="$CASTOR_SECRET_KEY" \
  DOCKER_GID="$(resolve_docker_gid)" \
    docker compose -f "$COMPOSE_FILE" up -d
  log "Castor is starting -> http://localhost:${PORT} (first run shows the bootstrap screen)"
}

cmd_down() {
  log "docker compose down ($COMPOSE_FILE)"
  docker compose -f "$COMPOSE_FILE" down
}

cmd_dev() {
  command -v go >/dev/null 2>&1 || die "Go is not installed on this host; dev mode needs Go. (Production builds happen inside Docker — use './build.sh build'.)"
  [ -d ui/node_modules ] || (log "installing UI deps"; (cd ui && npm ci))
  log "starting Go backend on :8080"
  CGO_ENABLED=0 go run ./server/cmd/castor &
  GO_PID=$!
  trap 'kill "$GO_PID" 2>/dev/null || true' EXIT INT TERM
  log "starting vite dev server on :5173 (proxies /api and /ws -> :8080)"
  (cd ui && npm run dev)
}

cmd_help() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-help}" in
  build)  cmd_build  ;;
  buildx) cmd_buildx ;;
  push)   cmd_push   ;;
  run)    cmd_run    ;;
  down)   cmd_down   ;;
  dev)    cmd_dev    ;;
  help|-h|--help) cmd_help ;;
  *) die "unknown command '$1' (try: build | buildx | push | run | down | dev | help)" ;;
esac
