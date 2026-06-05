# Castor — Install & Operations Runbook

Castor runs as **one container**: a single static Go binary that serves both the API and the
embedded React UI on one port (default `:8080`), backed by a SQLite file at `/data/castor.db`. It
talks to the **local Docker engine** through the bind-mounted socket and, optionally, to **Kubernetes**
through a mounted kubeconfig.

---

## 1. Prerequisites

- **Docker Engine** with the **Compose v2** plugin (`docker compose version`).
- **`openssl`** (to generate the secret key).
- A user that can reach the Docker socket (typically a member of the `docker` group).
- Architectures supported: **linux/amd64** and **linux/arm64** (the published image is multi-arch).

---

## 2. Fastest install (compose, < 2 minutes)

```bash
git clone https://github.com/gtek-it/castor.git
cd castor

export CASTOR_SECRET_KEY=$(openssl rand -hex 32)        # 64 hex chars = 32 bytes (REQUIRED)
export DOCKER_GID=$(getent group docker | cut -d: -f3)  # socket access without running as root

docker compose up -d
```

Browse to **<http://localhost:8080>** and complete the **bootstrap** (create the first admin). Enable
**TOTP 2FA** immediately afterwards.

### Using a `.env` file instead of exports

```bash
cp deploy/env.example .env
# edit .env: set CASTOR_SECRET_KEY (and DOCKER_GID if not 999)
docker compose --env-file .env up -d
```

### `docker run` (no compose)

```bash
docker run -d --name castor \
  -p 8080:8080 \
  -e CASTOR_SECRET_KEY=$(openssl rand -hex 32) \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v castor-data:/data \
  --group-add "$(getent group docker | cut -d: -f3)" \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --restart unless-stopped \
  ghcr.io/gtek-it/castor:latest
```

---

## 3. The secret key (`CASTOR_SECRET_KEY`)

- **What:** a **32-byte** key used for AES-256-GCM (sealing TOTP secrets at rest) and derived crypto.
- **How:** encode 32 bytes as **64 hexadecimal characters**:
  ```bash
  openssl rand -hex 32
  ```
- **Validation:** Castor **refuses to start** if the key is unset or does not decode to exactly 32
  bytes. (`openssl rand -hex 16` is only 16 bytes — wrong.)
- **Backup responsibility:** store it in your secret manager. **Losing it makes enrolled 2FA secrets
  unrecoverable** (you would have to reset affected users' 2FA out-of-band).

---

## 4. Docker socket: read-only vs read-write

The default mount is **read-only** (`/var/run/docker.sock:ro`):

| Mount | Works | Does NOT work |
|---|---|---|
| `…:ro` (default) | list, inspect, logs, **stats**, events | start, stop, restart, **remove**, exec |
| `…:rw` | full Docker lifecycle (the V1 promise) | — |

To enable the full lifecycle, edit `deploy/docker-compose.yml` (or the root `docker-compose.yml`):

```yaml
    volumes:
      # - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/run/docker.sock:/var/run/docker.sock:rw
```

then `docker compose up -d`.

> ⚠️ Write access to the socket is **root-equivalent on the host**. Castor mitigates this (non-root
> uid 65532, capability drop, no-new-privileges, the protected-resource guard, RBAC + audit), but you
> are still trusting Castor with host-level power. For hardened setups, see §8 (socket proxy).

### Finding the docker GID

```bash
getent group docker | cut -d: -f3     # commonly 999 on Debian/Ubuntu
```

Set `DOCKER_GID` to that value (the compose default is `999`). On hosts using rootless Docker or a
non-standard socket, set `CASTOR_DOCKER_HOST` and adjust the mount accordingly.

---

## 5. Kubernetes (read-only) overlay

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.kube.yml \
  up -d
```

This mounts `~/.kube/config` read-only at `/home/nonroot/.kube/config` and sets `CASTOR_KUBECONFIG`.

Caveats:

- Use a **read-scoped** kubeconfig (K8s is read-only in V1).
- If the kubeconfig references CA/client cert/key **files by path**, those files must be reachable at
  the same path inside the container — prefer a self-contained kubeconfig with **inline** (base64)
  credentials, or mount the whole `~/.kube` directory.
- A kubeconfig pointing at `127.0.0.1`/`localhost` (kind/minikube) refers to the **container's**
  loopback. Point the server URL at a host-reachable address, or use host networking for such local
  clusters.

---

## 6. Health, logs, and upgrades

**Health.** The distroless image has no shell or curl, so health is the binary's own subcommand:

```bash
docker inspect --format '{{.State.Health.Status}}' castor   # healthy | starting | unhealthy
docker exec castor /usr/local/bin/castor healthcheck         # exits 0 (healthy) / 1 (unhealthy)
```

`castor healthcheck` performs `GET http://127.0.0.1:8080/api/v1/healthz` against the local listener.

**Logs.**

```bash
docker logs -f castor      # structured JSON; secrets are redacted before logging
```

**Upgrade.**

```bash
docker compose pull        # fetch the new image
docker compose up -d        # recreate; /data persists, migrations run on startup
```

---

## 7. Backup & restore

All persistent state is the single SQLite file `/data/castor.db` (WAL mode) on the `castor-data`
volume.

**Backup** (consistent copy via a throwaway container):

```bash
docker run --rm \
  -v castor-data:/data \
  -v "$PWD:/backup" \
  busybox sh -c 'cp /data/castor.db /backup/castor-$(date +%Y%m%d-%H%M%S).db'
```

> For a strictly hot-consistent copy, stop Castor first (`docker compose stop`) or use SQLite's
> backup API; for most deployments the WAL-mode file copy above is sufficient.

**Restore:**

```bash
docker compose stop
docker run --rm -v castor-data:/data -v "$PWD:/backup" busybox \
  sh -c 'cp /backup/castor-YYYYMMDD-HHMMSS.db /data/castor.db'
docker compose start
```

> Also back up `CASTOR_SECRET_KEY` — without it, encrypted TOTP secrets in the DB are unusable.

---

## 8. Hardening checklist (production)

- [ ] Run behind a **TLS-terminating reverse proxy**; set `CASTOR_TRUST_PROXY=true` only when the
      proxy is trusted (this controls the `Secure` cookie flag and the audited client IP).
- [ ] Keep the container **non-root** (default) and **read-only rootfs** with `cap_drop: ALL` and
      `no-new-privileges` (all set in the provided compose).
- [ ] Prefer a scoped **`docker-socket-proxy`** over the raw socket; point `CASTOR_DOCKER_HOST` at it.
- [ ] Restrict who can reach port 8080 (firewall / proxy auth in front).
- [ ] Label infrastructure containers (DB, reverse proxy, etc.) `io.castor.protected="true"` so the
      UI guards them.
- [ ] Enforce 2FA for the admin; consider setting `security.totp_required_for_mutations`.
- [ ] Store `CASTOR_SECRET_KEY` in a secret manager; schedule `/data/castor.db` backups.

See the full threat model in [`security.md`](security.md).

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Container exits immediately, log mentions the secret key | `CASTOR_SECRET_KEY` unset or not 32 bytes → `export CASTOR_SECRET_KEY=$(openssl rand -hex 32)`. |
| UI loads, but start/stop/remove fail | Socket mounted read-only → switch to `:rw` (see §4). |
| "permission denied" on `/var/run/docker.sock` | `DOCKER_GID` wrong → set it to `getent group docker | cut -d: -f3`. |
| Health shows `unhealthy` | Inspect logs: `docker logs castor`. The server may still be starting (`start_period` 10s). |
| Kubernetes view empty / connection refused | kubeconfig path/credentials or loopback issue → see §5 caveats. |
| Bootstrap screen never appears / returns 409 | Bootstrap already completed; log in instead. For unattended installs use `CASTOR_BOOTSTRAP_TOKEN`. |

---

## 10. Uninstall

```bash
docker compose down              # stop & remove the container (keeps the data volume)
docker volume rm castor-data      # ⚠️ deletes the database permanently
```
