> [🇬🇧 English](install.md) · 🇫🇷 **Français**

# Installation et exploitation

Castor s'exécute dans un seul conteneur à côté de votre moteur Docker. Ce runbook complète le [README](../../README.fr.md) avec les commandes exactes et les opérations du quotidien.

## Prérequis

- **Docker Engine** (ou Docker Desktop) et, pour la voie compose, **Docker Compose v2** (`docker compose version`).
- Les ports hôte **8443** (HTTPS) et **8080** (HTTP) libres, ou d'autres ports de votre choix.

## Déployer avec `docker run`

```bash
docker run -d --name castor -p 8080:8080 -p 8443:8443 -v /var/run/docker.sock:/var/run/docker.sock:rw -v castor-data:/data --restart unless-stopped ghcr.io/yannleonard/castor:latest
```

La clé de chiffrement est générée au premier démarrage et stockée dans le volume (`/data/secret.key`) ; sauvegardez le volume. Pour fournir votre propre clé, ajoutez `-e CASTOR_SECRET_KEY=<64 hex>` (`openssl rand -hex 32`) ; la variable prime sur la clé stockée.

Variante durcie (système de fichiers racine en lecture seule, capabilities minimales), identique au fichier compose :

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

## Déployer avec Docker Compose

```bash
git clone https://github.com/Yannleonard/Castor.git && cd Castor
docker compose up -d
```

Pour modifier les valeurs par défaut (ports, mode TLS, votre propre `CASTOR_SECRET_KEY`), copiez `deploy/env.example` vers `.env` et lancez `docker compose --env-file .env up -d`.

## Premier accès

1. Ouvrez **<https://localhost:8443>**. Castor sert un certificat auto-signé, le navigateur affiche donc un avertissement : acceptez-le une fois (ou installez un certificat de confiance, voir ci-dessous).
2. Créez le premier compte administrateur.
3. Activez la **2FA TOTP** depuis votre profil et conservez les codes de récupération.

## Ports et reverse proxy

Castor écoute sur `:8443` (HTTPS) et `:8080` (HTTP : healthcheck, challenges Let's Encrypt, redirection). Pour publier un autre port HTTPS, changez à la fois le mapping et l'écouteur : `-p 9443:9443 -e CASTOR_HTTPS_ADDR=:9443`.

Derrière Caddy, Traefik ou nginx assurant la terminaison TLS, désactivez l'écouteur intégré et ne publiez que le port 8080 vers le proxy :

```yaml
    environment:
      CASTOR_TLS_MODE: "off"
      CASTOR_TRUST_PROXY: "true"
```

Bloc Caddy minimal : `castor.example.com { reverse_proxy castor:8080 }`. Le proxy doit transmettre `X-Forwarded-Proto` et `X-Forwarded-For` et laisser passer les upgrades WebSocket.

## Let's Encrypt

Prérequis : un nom DNS public pointant vers l'hôte, et les ports **80 et 443** joignables depuis internet et mappés vers Castor (`"80:8080"` et `"443:8443"` dans le fichier compose). Ensuite, dans **Settings → HTTPS & certificates → Let's Encrypt**, saisissez le domaine et un e-mail de contact puis cliquez sur **Enable Let's Encrypt**. Castor est alors joignable sur `https://votre-domaine` ; le renouvellement est automatique.

## Kubernetes

Ajoutez l'overlay qui monte votre kubeconfig en lecture seule et définit `CASTOR_KUBECONFIG` :

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.kube.yml up -d
```

Utilisez un kubeconfig autonome (identifiants embarqués) dont l'URL du serveur est joignable depuis un conteneur. Castor agit sur le cluster avec les droits que porte ce kubeconfig.

## Socket Docker : `:ro` ou `:rw`

| Montage | Ce que Castor peut faire |
|---|---|
| `:ro` (par défaut) | Lister et inspecter les conteneurs, images, réseaux et volumes ; logs, stats, events |
| `:rw` | Tout ce qui précède plus start, stop, restart, pause, remove, exec, create, prune, mises à jour d'images |

Pour changer, éditez la ligne du socket dans [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml) et lancez `docker compose up -d`. Pour restreindre l'accès de Castor au démon, faites pointer `CASTOR_DOCKER_HOST` vers un docker-socket-proxy.

## Mise à jour

```bash
docker compose pull && docker compose up -d
```

Les données de `/data` persistent et les migrations de schéma s'exécutent au démarrage.

## Sauvegarde et restauration

Tout vit dans le volume `castor-data` (base de données, certificats, clé secrète). Sauvegarder le volume sauvegarde tout. Si vous avez fourni `CASTOR_SECRET_KEY` vous-même, conservez-la avec la sauvegarde.

```bash
# sauvegarde
docker run --rm -v castor-data:/data -v "$PWD:/backup" busybox \
  sh -c 'cd /data && tar czf /backup/castor-$(date +%Y%m%d).tgz .'
# restauration
docker compose stop
docker run --rm -v castor-data:/data -v "$PWD:/backup" busybox \
  sh -c 'cd /data && tar xzf /backup/castor-YYYYMMDD.tgz'
docker compose start
```

## Dépannage

| Symptôme | Que faire |
|---|---|
| Le conteneur s'arrête juste après le démarrage | Consultez `docker logs castor` ; si vous avez défini `CASTOR_SECRET_KEY`, elle doit faire 64 caractères hexadécimaux. |
| Le navigateur avertit au sujet du certificat | Faites confiance au certificat téléchargé depuis Settings, ou utilisez un certificat émis par une CA. |
| La redirection pointe vers le mauvais port | Alignez `CASTOR_HTTPS_ADDR` sur le port HTTPS publié. |
| Start, stop ou remove sont indisponibles | Montez le socket Docker en `:rw`. |
| La vue Kubernetes est vide | Vérifiez le chemin du kubeconfig, les identifiants et l'URL du serveur depuis l'intérieur d'un conteneur. |
