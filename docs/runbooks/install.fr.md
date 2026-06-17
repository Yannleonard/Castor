> [🇬🇧 English](install.md) · 🇫🇷 **Français**

# Castor — Runbook d'installation et d'exploitation

Castor s'exécute dans **un seul conteneur** : un unique binaire Go statique qui sert à la fois l'API et
l'interface React embarquée sur un seul port (par défaut `:8080`), s'appuyant sur un fichier SQLite situé à `/data/castor.db`. Il
dialogue avec le **moteur Docker local** via le socket monté en bind-mount et, en option, avec **Kubernetes**
via un kubeconfig monté.

---

## 1. Prérequis

- **Docker Engine** avec le plugin **Compose v2** (`docker compose version`).
- **`openssl`** (pour générer la clé secrète).
- Un utilisateur capable d'accéder au socket Docker (généralement un membre du groupe `docker`).
- Architectures supportées : **linux/amd64** et **linux/arm64** (l'image publiée est multi-arch).

---

## 2. Installation la plus rapide (compose, < 2 minutes)

```bash
git clone https://github.com/Yannleonard/Castor.git
cd castor

export CASTOR_SECRET_KEY=$(openssl rand -hex 32)        # 64 caractères hex = 32 octets (REQUIS)
export DOCKER_GID=$(getent group docker | cut -d: -f3)  # accès au socket sans s'exécuter en root

docker compose up -d
```

Ouvrez **<http://localhost:8080>** et terminez le **bootstrap** (création du premier administrateur). Activez
la **2FA TOTP** immédiatement après.

### Utiliser un fichier `.env` plutôt que des exports

```bash
cp deploy/env.example .env
# éditez .env : définissez CASTOR_SECRET_KEY (l'entrypoint gère le groupe du socket docker)
docker compose --env-file .env up -d
```

### `docker run` (sans compose)

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
  ghcr.io/yannleonard/castor:latest
```

---

## 3. La clé secrète (`CASTOR_SECRET_KEY`)

- **Quoi :** une clé de **32 octets** utilisée pour AES-256-GCM (chiffrement au repos des secrets TOTP) et la cryptographie dérivée.
- **Comment :** encodez 32 octets sous forme de **64 caractères hexadécimaux**. Choisissez l'extrait adapté à votre plateforme :

  **Linux / macOS / Git Bash** (`openssl` disponible) :
  ```bash
  export CASTOR_SECRET_KEY=$(openssl rand -hex 32)
  ```

  **Windows — PowerShell** (pas besoin d'`openssl` ; RNG sécurisé .NET) :
  ```powershell
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env:CASTOR_SECRET_KEY = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $env:CASTOR_SECRET_KEY   # l'afficher — à copier dans votre .env / compose
  ```

  > **Docker Desktop (Windows/macOS) :** générez avec l'un des extraits ci-dessus, puis transmettez la
  > valeur au conteneur en ligne (`-e CASTOR_SECRET_KEY=<64-hex>`) ou via un fichier `.env`. Utilisez la
  > **même** valeur à chaque recréation.
- **Validation :** Castor **refuse de démarrer** si la clé est absente ou ne se décode pas en exactement 32
  octets. (`openssl rand -hex 16` ne fait que 16 octets — incorrect.)
- **Responsabilité de sauvegarde :** stockez-la dans votre gestionnaire de secrets. **La perdre rend les secrets 2FA
  enregistrés irrécupérables** (vous devriez alors réinitialiser la 2FA des utilisateurs concernés hors bande).

---

## 4. Socket Docker : lecture seule vs lecture-écriture

Le montage par défaut est en **lecture seule** (`/var/run/docker.sock:ro`) :

| Montage | Fonctionne | Ne fonctionne PAS |
|---|---|---|
| `…:ro` (par défaut) | list, inspect, logs, **stats**, events | start, stop, restart, **remove**, exec |
| `…:rw` | cycle de vie Docker complet (la promesse de la V1) | — |

Pour activer le cycle de vie complet, éditez `deploy/docker-compose.yml` (ou le `docker-compose.yml` racine) :

```yaml
    volumes:
      # - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/run/docker.sock:/var/run/docker.sock:rw
```

puis `docker compose up -d`.

> ⚠️ L'accès en écriture au socket est **équivalent à root sur l'hôte**. Castor atténue ce risque (uid non-root
> 65532, suppression des capabilities, no-new-privileges, le garde-fou des ressources protégées, RBAC + audit), mais vous
> faites tout de même confiance à Castor avec des pouvoirs de niveau hôte. Pour des configurations durcies, voir §8 (proxy de socket).

### Trouver le GID docker

```bash
getent group docker | cut -d: -f3     # couramment 999 sur Debian/Ubuntu
```

Définissez `DOCKER_GID` sur cette valeur (la valeur par défaut de compose est `999`). Sur les hôtes utilisant Docker rootless ou un
socket non standard, définissez `CASTOR_DOCKER_HOST` et ajustez le montage en conséquence.

---

## 5. Overlay Kubernetes (lecture seule)

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.kube.yml \
  up -d
```

Ceci monte `~/.kube/config` en lecture seule à `/home/nonroot/.kube/config` et définit `CASTOR_KUBECONFIG`.

Précautions :

- Utilisez un kubeconfig **à portée lecture** (K8s est en lecture seule en V1).
- Si le kubeconfig référence des **fichiers** CA/certificat client/clé **par chemin**, ces fichiers doivent être accessibles au
  même chemin à l'intérieur du conteneur — préférez un kubeconfig autonome avec des identifiants **inline** (base64),
  ou montez l'ensemble du répertoire `~/.kube`.
- Un kubeconfig pointant vers `127.0.0.1`/`localhost` (kind/minikube) référence la
  boucle locale du **conteneur**. Faites pointer l'URL du serveur vers une adresse accessible depuis l'hôte, ou utilisez le réseau de l'hôte pour de tels clusters
  locaux.

---

## 6. Santé, journaux et mises à niveau

**Santé.** L'image distroless n'a ni shell ni curl, donc la vérification de santé est une sous-commande propre au binaire :

```bash
docker inspect --format '{{.State.Health.Status}}' castor   # healthy | starting | unhealthy
docker exec castor /usr/local/bin/castor healthcheck         # quitte avec 0 (sain) / 1 (non sain)
```

`castor healthcheck` effectue un `GET http://127.0.0.1:8080/api/v1/healthz` sur l'écouteur local.

**Journaux.**

```bash
docker logs -f castor      # JSON structuré ; les secrets sont expurgés avant journalisation
```

**Mise à niveau.**

```bash
docker compose pull        # récupère la nouvelle image
docker compose up -d        # recrée ; /data persiste, les migrations s'exécutent au démarrage
```

---

## 7. Sauvegarde et restauration

Tout l'état persistant tient dans l'unique fichier SQLite `/data/castor.db` (mode WAL) sur le volume `castor-data`.

**Sauvegarde** (copie cohérente via un conteneur jetable) :

```bash
docker run --rm \
  -v castor-data:/data \
  -v "$PWD:/backup" \
  busybox sh -c 'cp /data/castor.db /backup/castor-$(date +%Y%m%d-%H%M%S).db'
```

> Pour une copie strictement cohérente à chaud, arrêtez d'abord Castor (`docker compose stop`) ou utilisez l'API
> de sauvegarde de SQLite ; pour la plupart des déploiements, la copie du fichier en mode WAL ci-dessus suffit.

**Restauration :**

```bash
docker compose stop
docker run --rm -v castor-data:/data -v "$PWD:/backup" busybox \
  sh -c 'cp /backup/castor-YYYYMMDD-HHMMSS.db /data/castor.db'
docker compose start
```

> Sauvegardez également `CASTOR_SECRET_KEY` — sans elle, les secrets TOTP chiffrés dans la base sont inutilisables.

---

## 8. Liste de contrôle de durcissement (production)

- [ ] Exécutez derrière un **reverse proxy assurant la terminaison TLS** ; ne définissez `CASTOR_TRUST_PROXY=true` que lorsque le
      proxy est de confiance (cela contrôle le drapeau de cookie `Secure` et l'adresse IP cliente auditée).
- [ ] Gardez le conteneur **non-root** (par défaut) et un **rootfs en lecture seule** avec `cap_drop: ALL` et
      `no-new-privileges` (tout est défini dans le compose fourni).
- [ ] Préférez un **`docker-socket-proxy`** à portée restreinte au socket brut ; faites pointer `CASTOR_DOCKER_HOST` vers lui.
- [ ] Restreignez qui peut atteindre le port 8080 (pare-feu / authentification du proxy en frontal).
- [ ] Étiquetez les conteneurs d'infrastructure (BD, reverse proxy, etc.) avec `io.castor.protected="true"` afin que
      l'interface les protège.
- [ ] Imposez la 2FA pour l'administrateur ; envisagez de définir `security.totp_required_for_mutations`.
- [ ] Stockez `CASTOR_SECRET_KEY` dans un gestionnaire de secrets ; planifiez des sauvegardes de `/data/castor.db`.

Consultez le modèle de menaces complet dans [`security.md`](security.md).

---

## 9. Dépannage

| Symptôme | Cause / correctif |
|---|---|
| Le conteneur s'arrête immédiatement, le journal mentionne la clé secrète | `CASTOR_SECRET_KEY` absente ou pas de 32 octets → `export CASTOR_SECRET_KEY=$(openssl rand -hex 32)`. |
| L'interface se charge, mais start/stop/remove échouent | Socket monté en lecture seule → passez en `:rw` (voir §4). |
| « permission denied » sur `/var/run/docker.sock` | `DOCKER_GID` incorrect → définissez-le sur `getent group docker | cut -d: -f3`. |
| La santé affiche `unhealthy` | Inspectez les journaux : `docker logs castor`. Le serveur est peut-être encore en cours de démarrage (`start_period` 10s). |
| La vue Kubernetes est vide / connexion refusée | Problème de chemin/identifiants du kubeconfig ou de boucle locale → voir les précautions du §5. |
| L'écran de bootstrap n'apparaît jamais / renvoie 409 | Le bootstrap est déjà terminé ; connectez-vous plutôt. Pour des installations sans surveillance, utilisez `CASTOR_BOOTSTRAP_TOKEN`. |

---

## 10. Désinstallation

```bash
docker compose down              # arrête & supprime le conteneur (conserve le volume de données)
docker volume rm castor-data      # ⚠️ supprime définitivement la base de données
```
