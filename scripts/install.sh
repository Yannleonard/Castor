#!/usr/bin/env sh
# Castor — one-command installer for Linux / macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.sh | sh
#
# Pulls ghcr.io/yannleonard/castor:latest, generates a secret key, picks free ports and starts Castor.
# Optional overrides: CASTOR_HTTPS_PORT (8443), CASTOR_PORT (8080), CASTOR_SECRET_KEY,
#   CASTOR_IMAGE, CASTOR_NAME, CASTOR_DATA, CASTOR_KEY_FILE, CASTOR_SOCKET_MODE (ro | rw).
set -eu

IMAGE="${CASTOR_IMAGE:-ghcr.io/yannleonard/castor:latest}"
NAME="${CASTOR_NAME:-castor}"
DATA="${CASTOR_DATA:-castor-data}"
SOCKET_MODE="${CASTOR_SOCKET_MODE:-ro}"
KEY_FILE="${CASTOR_KEY_FILE:-$HOME/.castor-secret.key}"

# --- output helpers (no color if not a tty) ----------------------------------
if [ -t 1 ]; then B="$(printf '\033[1m')"; G="$(printf '\033[32m')"; Y="$(printf '\033[33m')"; R="$(printf '\033[31m')"; N="$(printf '\033[0m')"; else B=""; G=""; Y=""; R=""; N=""; fi
info() { printf '%s==>%s %s\n' "$B" "$N" "$1"; }
ok()   { printf '%s ✓ %s%s\n' "$G" "$1" "$N"; }
warn() { printf '%s ! %s%s\n' "$Y" "$1" "$N"; }
die()  { printf '%s ✗ %s%s\n' "$R" "$1" "$N" >&2; exit 1; }

# --- docker (sudo only if needed) --------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
DOCKER="docker"
if ! $DOCKER info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1 2>/dev/null || sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
    warn "Using 'sudo docker'."
  else
    die "Cannot reach the Docker daemon. Is it running? Try: sudo systemctl start docker"
  fi
fi
ok "Docker is available."

# --- secret key: environment > saved file > generate -------------------------
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
    # Fallback without openssl.
    KEY="$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  ( umask 077; printf '%s' "$KEY" > "$KEY_FILE" )
  ok "Generated a secret key and saved it to $KEY_FILE."
fi
[ "$(printf '%s' "$KEY" | tr -d '\n' | wc -c)" -eq 64 ] || die "CASTOR_SECRET_KEY must be 64 hex characters (32 bytes)."

# --- free host ports (HTTP 8080, HTTPS 8443) ---------------------------------
# Listener check that works under sh (no bash-only /dev/tcp): nc, else ss, else
# netstat; with none of them available the port is assumed free.
port_busy() {
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 1 127.0.0.1 "$1" >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$1[[:space:]]"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -q ":$1[[:space:]]"
  else
    return 1
  fi
}
PORT="${CASTOR_PORT:-8080}"
if port_busy "$PORT"; then
  warn "Port $PORT is busy — searching for a free one…"
  for p in 8081 8082 8090 9000 9090; do port_busy "$p" || { PORT="$p"; break; }; done
fi
HTTPS_PORT="${CASTOR_HTTPS_PORT:-8443}"
if port_busy "$HTTPS_PORT" || [ "$HTTPS_PORT" = "$PORT" ]; then
  warn "Port $HTTPS_PORT is busy — searching for a free one…"
  for p in 8444 8445 8543 9443 9444; do
    [ "$p" = "$PORT" ] && continue
    port_busy "$p" || { HTTPS_PORT="$p"; break; }
  done
fi
ok "Using host ports $HTTPS_PORT (HTTPS) and $PORT (HTTP)."

# --- pull + (re)create -------------------------------------------------------
info "Pulling $IMAGE …"
$DOCKER pull "$IMAGE" >/dev/null || die "Failed to pull $IMAGE. Check your network connection."
ok "Image pulled."

if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  warn "Replacing the existing '$NAME' container (the '$DATA' volume is kept)."
  $DOCKER rm -f "$NAME" >/dev/null
fi

info "Starting Castor…"
# The container listens on the published HTTPS port so the HTTP redirect lands on it.
# shellcheck disable=SC2086
$DOCKER run -d --name "$NAME" \
  -p "$PORT:8080" \
  -p "$HTTPS_PORT:$HTTPS_PORT" \
  -e CASTOR_SECRET_KEY="$KEY" \
  -e CASTOR_HTTPS_ADDR=":$HTTPS_PORT" \
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
    exited|dead) $DOCKER logs --tail 20 "$NAME" 2>&1 || true; die "Castor exited. See the logs above." ;;
  esac
  i=$((i+1)); sleep 2
done

# --- done --------------------------------------------------------------------
printf '\n%s🦫  Castor is up!%s\n\n' "$B" "$N"
# Port omitted for 443; the host address helps when installing on a remote server.
URL_PORT=""; [ "$HTTPS_PORT" != "443" ] && URL_PORT=":$HTTPS_PORT"
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
printf '   Open %shttps://localhost%s%s and create your admin account.\n' "$B" "$URL_PORT" "$N"
[ -n "$HOST_IP" ] && printf '   From another machine: %shttps://%s%s%s\n' "$B" "$HOST_IP" "$URL_PORT" "$N"
printf '   Your browser warns about the self-signed certificate: accept it once, or replace it in Settings → HTTPS.\n\n'
