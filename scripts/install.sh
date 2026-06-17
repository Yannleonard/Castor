#!/usr/bin/env sh
# =============================================================================
# Castor — one-command installer for Linux / macOS.
#
# It is intentionally small and auditable. Read it before running (you should
# always read a script you pipe into a shell):
#
#   https://github.com/Yannleonard/Castor/blob/main/scripts/install.sh
#
# Usage — convenient one-liner:
#   curl -fsSL https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.sh | sh
#
# Usage — audit first (recommended):
#   curl -fsSL https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.sh -o install.sh
#   less install.sh        # read it
#   sh install.sh
#
# What it does:
#   1. checks Docker is installed and the daemon is reachable,
#   2. generates a 32-byte CASTOR_SECRET_KEY (if you don't pass one) and saves it,
#   3. picks a free host port (8080, else the next free one),
#   4. pulls ghcr.io/yannleonard/castor:latest and runs it (non-root; the
#      entrypoint handles the docker socket group — no --group-add needed),
#   5. waits for health and prints the URL.
#
# Environment overrides (all optional):
#   CASTOR_PORT=8080                 host port to expose
#   CASTOR_SECRET_KEY=<64-hex>       reuse an existing key (else one is generated)
#   CASTOR_IMAGE=ghcr.io/yannleonard/castor:latest
#   CASTOR_NAME=castor               container name
#   CASTOR_DATA=castor-data          named volume for /data
#   CASTOR_SOCKET_MODE=ro            ro (default) or rw (full lifecycle: start/stop/exec)
# =============================================================================
set -eu

IMAGE="${CASTOR_IMAGE:-ghcr.io/yannleonard/castor:latest}"
NAME="${CASTOR_NAME:-castor}"
DATA="${CASTOR_DATA:-castor-data}"
SOCKET_MODE="${CASTOR_SOCKET_MODE:-ro}"
KEY_FILE="${CASTOR_KEY_FILE:-$HOME/.castor-secret.key}"

# --- pretty output (no color if not a tty) ----------------------------------
if [ -t 1 ]; then B="$(printf '\033[1m')"; G="$(printf '\033[32m')"; Y="$(printf '\033[33m')"; R="$(printf '\033[31m')"; N="$(printf '\033[0m')"; else B=""; G=""; Y=""; R=""; N=""; fi
info() { printf '%s==>%s %s\n' "$B" "$N" "$1"; }
ok()   { printf '%s ✓ %s%s\n' "$G" "$1" "$N"; }
warn() { printf '%s ! %s%s\n' "$Y" "$1" "$N"; }
die()  { printf '%s ✗ %s%s\n' "$R" "$1" "$N" >&2; exit 1; }

# --- a docker that can reach the daemon (try sudo only if needed) ------------
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
DOCKER="docker"
if ! $DOCKER info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1 2>/dev/null || sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
    warn "Using 'sudo docker' (your user can't reach the Docker socket directly)."
  else
    die "Cannot reach the Docker daemon. Is it running? Try: sudo systemctl start docker"
  fi
fi
ok "Docker is available."

# --- secret key: reuse > saved file > generate -------------------------------
if [ -n "${CASTOR_SECRET_KEY:-}" ]; then
  KEY="$CASTOR_SECRET_KEY"
  info "Using CASTOR_SECRET_KEY from the environment."
elif [ -f "$KEY_FILE" ]; then
  KEY="$(cat "$KEY_FILE")"
  info "Reusing the saved key at $KEY_FILE."
else
  if command -v openssl >/dev/null 2>&1; then
    KEY="$(openssl rand -hex 32)"
  else
    # Portable fallback without openssl.
    KEY="$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  ( umask 077; printf '%s' "$KEY" > "$KEY_FILE" )
  ok "Generated a 32-byte secret key and saved it to $KEY_FILE (keep it safe)."
fi
[ "$(printf '%s' "$KEY" | tr -d '\n' | wc -c)" -eq 64 ] || die "CASTOR_SECRET_KEY must be 64 hex characters (32 bytes)."

# --- pick a free host port (default 8080) ------------------------------------
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0 || return 1; }
PORT="${CASTOR_PORT:-8080}"
if port_busy "$PORT"; then
  warn "Port $PORT is busy — searching for a free one…"
  for p in 8081 8082 8090 9000 9090; do port_busy "$p" || { PORT="$p"; break; }; done
fi
ok "Will expose Castor on host port $PORT."

# --- pull + (re)create -------------------------------------------------------
info "Pulling $IMAGE …"
$DOCKER pull "$IMAGE" >/dev/null || die "Failed to pull $IMAGE (is it public / are you online?)."
ok "Image pulled."

if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  warn "A container named '$NAME' already exists — replacing it (the '$DATA' volume is kept)."
  $DOCKER rm -f "$NAME" >/dev/null
fi

info "Starting Castor…"
# shellcheck disable=SC2086
$DOCKER run -d --name "$NAME" \
  -p "$PORT:8080" \
  -e CASTOR_SECRET_KEY="$KEY" \
  -v "/var/run/docker.sock:/var/run/docker.sock:$SOCKET_MODE" \
  -v "$DATA:/data" \
  --restart unless-stopped \
  "$IMAGE" >/dev/null || die "docker run failed."

# --- wait for health ---------------------------------------------------------
info "Waiting for Castor to become healthy…"
i=0
while [ "$i" -lt 30 ]; do
  status="$($DOCKER inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$NAME" 2>/dev/null || echo unknown)"
  case "$status" in
    healthy) ok "Castor is healthy."; break ;;
    exited|dead) $DOCKER logs --tail 20 "$NAME" 2>&1 || true; die "Castor exited unexpectedly (see logs above)." ;;
  esac
  i=$((i+1)); sleep 2
done

# --- done --------------------------------------------------------------------
printf '\n%s🦫  Castor is up!%s\n\n' "$B" "$N"
printf '   Open:        %shttp://localhost:%s%s   (create your admin account)\n' "$B" "$PORT" "$N"
printf '   Secret key:  %s\n' "$KEY_FILE"
printf '   Logs:        %s logs -f %s\n' "$DOCKER" "$NAME"
printf '   Stop:        %s rm -f %s   (data persists in the %s volume)\n\n' "$DOCKER" "$NAME" "$DATA"
[ "$SOCKET_MODE" = ro ] && printf '   %sTip:%s the Docker socket is mounted read-only (list/inspect/logs/stats).\n        For full lifecycle (start/stop/exec), re-run with CASTOR_SOCKET_MODE=rw.\n\n' "$Y" "$N"
printf '   %sSecurity:%s enable TOTP 2FA right after creating your admin (Profile → 2FA),\n             especially if this host is reachable from the internet.\n\n' "$Y" "$N"
