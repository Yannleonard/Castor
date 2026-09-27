> 🇬🇧 **English** · [🇫🇷 Français](install.fr.md)

# Install & operations

Castor runs as one container next to your Docker engine. This runbook completes the [README](../../README.md) with the exact commands and the day-to-day operations.

## Prerequisites

- **Docker Engine** (or Docker Desktop) and, for the compose path, **Docker Compose v2** (`docker compose version`).
- Host ports **8443** (HTTPS) and **8080** (HTTP) free, or other ports of your choice.

## Deploy with `docker run`

```bash
docker run -d --name castor -p 8080:8080 -p 8443:8443 -v /var/run/docker.sock:/var/run/docker.sock:rw -v castor-data:/data --restart unless-stopped ghcr.io/yannleonard/castor:latest
```

The encryption key is generated on first start and stored in the volume (`/data/secret.key`); back up the volume. To supply your own key, add `-e CASTOR_SECRET_KEY=<64 hex>` (`openssl rand -hex 32`); the variable takes precedence over the stored key.

Hardened variant (read-only root filesystem, minimal capabilities), same as the compose file:

```bash
docker run -d --name castor \
  -p 8080:8080 -p 8443:8443 \
  -v /var/run/docker.sock:/var/run/docker.sock:rw \
  -v castor-data:/data \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add DAC_OVERRIDE \
  --restart unless-stopped \
  ghcr.io/yannleonard/castor:latest
```

## Deploy with Docker Compose

```bash
git clone https://github.com/Yannleonard/Castor.git && cd Castor
docker compose up -d
```

To override defaults (ports, TLS mode, your own `CASTOR_SECRET_KEY`), copy `deploy/env.example` to `.env` and run `docker compose --env-file .env up -d`.

## First access

1. Open **<https://localhost:8443>**. Castor serves a self-signed certificate, so the browser shows a warning: accept it once (or install a trusted certificate, below).
2. Create the first admin account.
3. Enable **TOTP 2FA** from your profile and store the recovery codes.

## Ports and reverse proxy

Castor listens on `:8443` (HTTPS) and `:8080` (HTTP: healthcheck, Let's Encrypt challenges, redirect). To publish another HTTPS port, change both the mapping and the listener: `-p 9443:9443 -e CASTOR_HTTPS_ADDR=:9443`.

Behind Caddy, Traefik or nginx terminating TLS, turn the built-in listener off and publish only port 8080 to the proxy:

```yaml
    environment:
      CASTOR_TLS_MODE: "off"
      CASTOR_TRUST_PROXY: "true"
```

Minimal Caddy block: `castor.example.com { reverse_proxy castor:8080 }`. The proxy must forward `X-Forwarded-Proto` and `X-Forwarded-For` and pass WebSocket upgrades.

## Let's Encrypt

Requirements: a public DNS name pointing at the host, and ports **80 and 443** reachable from the internet and mapped to Castor (`"80:8080"` and `"443:8443"` in the compose file). Then, in **Settings → HTTPS & certificates → Let's Encrypt**, enter the domain and a contact e-mail and click **Enable Let's Encrypt**. Castor is then reached at `https://your-domain`; renewal is automatic.

## Kubernetes

Add the overlay that mounts your kubeconfig read-only and sets `CASTOR_KUBECONFIG`:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.kube.yml up -d
```

Use a self-contained kubeconfig (credentials embedded) whose server URL is reachable from a container. Castor acts on the cluster with the rights that kubeconfig carries.

## Docker socket: `:ro` or `:rw`

| Mount | What Castor can do |
|---|---|
| `:ro` (default) | List and inspect containers, images, networks and volumes; logs, stats, events |
| `:rw` | Everything above plus start, stop, restart, pause, remove, exec, create, prune, image updates |

To switch, edit the socket line in [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml) and run `docker compose up -d`. To restrict Castor's access to the daemon, point `CASTOR_DOCKER_HOST` at a docker-socket-proxy.

## Update

```bash
docker compose pull && docker compose up -d
```

Data on `/data` persists and schema migrations run at startup.

## Backup and restore

Everything lives in the `castor-data` volume (database, certificates, secret key). Backing up the volume backs up everything. If you supplied `CASTOR_SECRET_KEY` yourself, keep it with the backup.

```bash
# backup
docker run --rm -v castor-data:/data -v "$PWD:/backup" busybox \
  sh -c 'cd /data && tar czf /backup/castor-$(date +%Y%m%d).tgz .'
# restore
docker compose stop
docker run --rm -v castor-data:/data -v "$PWD:/backup" busybox \
  sh -c 'cd /data && tar xzf /backup/castor-YYYYMMDD.tgz'
docker compose start
```

## Troubleshooting

| Symptom | What to do |
|---|---|
| The container stops right after start | Check `docker logs castor`; if you set `CASTOR_SECRET_KEY`, it must be 64 hex characters. |
| The browser warns about the certificate | Trust the certificate downloaded from Settings, or use a CA-issued one. |
| The redirect points at the wrong port | Align `CASTOR_HTTPS_ADDR` with the published HTTPS port. |
| Start, stop or remove are unavailable | Mount the Docker socket `:rw`. |
| The Kubernetes view is empty | Check the kubeconfig path, credentials and server URL from inside a container. |
