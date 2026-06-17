<div align="center">

<a href="README.md">🇬🇧 English</a> · 🇫🇷 **Français**

<img src="docs/brand/castor-logo.jpg" alt="Castor" width="300" height="300" />

# Castor

**Gérer · Déployer · Orchestrer**

Plateforme open-source et auto-hébergée d'orchestration de conteneurs multi-hôtes — **Docker · Docker Swarm · Kubernetes** dans une seule interface moderne.

Édité par **LEONARD-IT/GTEK-IT** · Apache-2.0 · distribué sous forme d'une unique petite image Docker (amd64 + arm64).

</div>

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Tableau de bord Castor — vue BI en direct avec cartes d'indicateurs, anneau d'états des conteneurs, graphiques top CPU/mémoire, panneau des orchestrateurs et journal d'activité en temps réel" width="100%" />
</p>

<p align="center"><em>Le tableau de bord Castor : indicateurs en direct, états des conteneurs, graphiques par ressource, les trois orchestrateurs et un journal d'audit en temps réel — le tout dans une seule vue.</em></p>

---

Castor, c'est « Portainer, en mieux » : trois orchestrateurs dès la V1, une interface moderne, des
statistiques en temps réel et une **sécurité par défaut** (authentification locale + 2FA TOTP, RBAC
à portée de ressource, journal d'audit complet, conteneurs protégés/système, image distroless
durcie). Il tourne dans **un seul conteneur**, dialogue avec le **moteur Docker local** via le socket
monté, et lit Kubernetes au travers d'un kubeconfig monté.

| Orchestrateur | Périmètre V1 |
|---|---|
| **Docker** | Lecture **+ écriture** complète — liste/inspection, démarrer/arrêter/redémarrer/supprimer, logs, stats, exec, événements, images, réseaux, volumes |
| **Docker Swarm** | **Lecture seule** — services / nœuds / tâches |
| **Kubernetes** | **Lecture seule** — pods / déploiements / nœuds (via `client-go` + kubeconfig) |

> Les **agents Go multi-hôtes sont prévus pour la V2.** La couture interne `Provider` est conçue pour
> qu'un agent distant devienne « juste un provider de plus » sans retoucher l'API ni l'UI — mais
> aucun agent n'est intégré en V1.

---

## ⏱️ Démarrage rapide — opérationnel en moins de 2 minutes

### Le plus simple — installeur en une ligne

L'installeur vérifie Docker, génère et sauvegarde votre clé secrète, choisit un port libre, récupère
l'image et démarre Castor. Vous avez seulement besoin de **Docker** installé et démarré.

**Linux / macOS :**

```bash
curl -fsSL https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.sh | sh
```

**Windows (PowerShell, Docker Desktop) :**

```powershell
irm https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.ps1 | iex
```

> **Vous préférez lire avant d'exécuter ?** (recommandé — ne pipez jamais un script non lu dans un
> shell.) Téléchargez, inspectez, puis exécutez :
> ```bash
> curl -fsSL https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.sh -o install.sh
> less install.sh && sh install.sh           # Windows : irm …/install.ps1 -OutFile install.ps1; notepad install.ps1; ./install.ps1
> ```
> Les scripts sont dans [`scripts/`](scripts/) et sont volontairement minimaux. À la fin, l'installeur
> affiche l'URL — ouvrez-la et créez votre compte admin (puis activez la **2FA TOTP**).

### Manuel — clone & compose

Vous préférez le faire à la main ? Il vous faut **Docker** (avec le plugin Compose) et `openssl`.

```bash
git clone https://github.com/Yannleonard/Castor.git
cd Castor

# 1) Générer la clé secrète requise de 32 octets (64 caractères hex).
export CASTOR_SECRET_KEY=$(openssl rand -hex 32)

# 2) Lancer. (Pas besoin de DOCKER_GID / --group-add : l'entrypoint de Castor détecte
#    le groupe du socket Docker et exécute le serveur en utilisateur non-root automatiquement.)
docker compose up -d
```

Ouvrez **<http://localhost:8080>** → vous arrivez sur l'écran de **bootstrap** pour créer le premier
administrateur. Activer le **2FA TOTP** juste après est fortement recommandé.

> Vous préférez ne pas cloner ? Récupérez l'image publiée et lancez le fichier compose directement
> depuis le dépôt, ou exécutez-la directement :
>
> ```bash
> docker run -d --name castor \
>   -p 8080:8080 \
>   -e CASTOR_SECRET_KEY=$(openssl rand -hex 32) \
>   -v /var/run/docker.sock:/var/run/docker.sock:ro \
>   -v castor-data:/data \
>   --restart unless-stopped \
>   ghcr.io/yannleonard/castor:latest
> ```
>
> **Pas de `--group-add`.** L'entrypoint de Castor démarre en root uniquement pour lire le groupe du
> socket monté, puis se rabaisse à un utilisateur non-root (uid 65532) **avec ce groupe** et
> ré-exécute le serveur. Pour un lancement durci qui ne conserve que les capabilities nécessaires à
> ce rabaissement de privilèges :
>
> ```bash
> docker run -d --name castor \
>   -p 8080:8080 \
>   -e CASTOR_SECRET_KEY=$(openssl rand -hex 32) \
>   -v /var/run/docker.sock:/var/run/docker.sock:ro \
>   -v castor-data:/data \
>   --read-only --tmpfs /tmp \
>   --security-opt no-new-privileges:true \
>   --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add DAC_OVERRIDE \
>   --restart unless-stopped \
>   ghcr.io/yannleonard/castor:latest
> ```

### `CASTOR_SECRET_KEY` — la générer correctement

C'est une clé de **32 octets** (AES-256-GCM, utilisée pour sceller les secrets TOTP). Encodez-la en
**64 caractères hexadécimaux**. Choisissez l'extrait adapté à votre plateforme :

**Linux / macOS (bash/zsh)** — `openssl` est préinstallé :

```bash
export CASTOR_SECRET_KEY=$(openssl rand -hex 32)
```

**Windows — PowerShell** (pas besoin d'`openssl` ; utilise le RNG sécurisé de .NET) :

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:CASTOR_SECRET_KEY = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$env:CASTOR_SECRET_KEY   # l'afficher — à copier dans votre .env / compose
```

**Windows — Git Bash** (fournit `openssl`, comme sous Linux) :

```bash
export CASTOR_SECRET_KEY=$(openssl rand -hex 32)
```

> **Docker Desktop (Windows/macOS) :** générez la clé avec l'un des extraits ci-dessus, puis
> transmettez-la au conteneur — soit en ligne (`-e CASTOR_SECRET_KEY=<la valeur de 64 car. hex>`),
> soit via un fichier `.env` à côté de votre compose. La valeur doit être la même à chaque
> recréation du conteneur.

> ⚠️ `openssl rand -hex 16` ne donne que 16 octets (32 caractères) — **incorrect**. Castor refuse de
> démarrer si la clé ne fait pas exactement 32 octets. Conservez-la précieusement : **la perdre rend
> le 2FA enrôlé irrécupérable.**

### Socket Docker en lecture seule vs lecture-écriture

Le fichier compose monte `/var/run/docker.sock` en **lecture seule** par défaut — suffisant pour
**lister, inspecter, lire les logs et streamer les stats**, mais **pas** pour
démarrer/arrêter/redémarrer/supprimer/exec (qui nécessitent un accès en écriture au socket). Pour le
cycle de vie Docker complet, passez le montage en `:rw` dans
[`deploy/docker-compose.yml`](deploy/docker-compose.yml) :

```yaml
    volumes:
      # - /var/run/docker.sock:/var/run/docker.sock:ro     # lecture seule (défaut)
      - /var/run/docker.sock:/var/run/docker.sock:rw       # cycle de vie complet
```

> **Réalité sécurité (ADR-003 §7, T1) :** l'accès en écriture au socket Docker est **équivalent à
> root sur l'hôte**. Le serveur Castor tourne en **non-root** (uid 65532) ; son entrypoint lit le
> groupe du socket au démarrage et se rabaisse à cet utilisateur non-root avec le groupe, de sorte
> qu'il atteint le socket sans exécuter le serveur en root et sans `--group-add` manuel. Pour les
> déploiements durcis, placez un `docker-socket-proxy` à portée restreinte devant le socket et
> pointez `CASTOR_DOCKER_HOST` dessus.

### Ajouter Kubernetes (lecture seule)

Superposez l'overlay Kubernetes pour monter votre kubeconfig :

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.kube.yml \
  up -d
```

Cela monte `~/.kube/config` en lecture seule dans le conteneur et définit `CASTOR_KUBECONFIG`.
Utilisez un kubeconfig à portée de lecture — K8s est en lecture seule en V1. Voir
[`deploy/docker-compose.kube.yml`](deploy/docker-compose.kube.yml) pour les subtilités (clusters en
loopback, identifiants par chemin vs en ligne).

---

## ⚙️ Configuration (variables d'environnement)

| Variable | Requise | Défaut | Rôle |
|---|:---:|---|---|
| `CASTOR_SECRET_KEY` | ✅ | — | Clé de 32 octets (64 car. hex) pour AES-256-GCM. Refuse de démarrer si absente / ≠ 32 octets. |
| `CASTOR_HTTP_ADDR` | | `:8080` | Adresse d'écoute dans le conteneur. |
| `CASTOR_DB_PATH` | | `/data/castor.db` | Fichier de base SQLite (sur le volume `/data`). |
| `CASTOR_DOCKER_HOST` | | (socket) | Surcharge le point de terminaison Docker (ex. un socket-proxy `tcp://…`). |
| `CASTOR_KUBECONFIG` | | — | Chemin vers un kubeconfig monté (défini par l'overlay kube). |
| `CASTOR_TRUST_PROXY` | | `false` | Respecter `X-Forwarded-Proto`/`-For` (mettre `true` uniquement derrière un proxy TLS de confiance). |
| `CASTOR_SELF_CONTAINER_ID` | | (auto) | Indice d'auto-protection ; aussi résolu au runtime depuis `/proc/self/cgroup`. |
| `CASTOR_BOOTSTRAP_TOKEN` | | — | Jeton optionnel pour protéger `POST /api/v1/bootstrap` lors d'installations automatisées. |

Un modèle prêt à copier se trouve dans [`deploy/env.example`](deploy/env.example). Pour utiliser un
fichier `.env` :

```bash
cp deploy/env.example .env      # éditer au minimum CASTOR_SECRET_KEY
docker compose --env-file .env up -d
```

---

## 🔐 Points forts de sécurité

- **Auth locale + 2FA TOTP** (hachage des mots de passe argon2id ; secret TOTP scellé en AES-256-GCM au repos).
- **RBAC à portée de ressource** avec les rôles intégrés `admin` / `operator` / `viewer`, conçu pour la V2 multi-hôtes.
- **Journal d'audit complet** — chaque action mutante écrit exactement une ligne en ajout seul.
- **Conteneurs protégés** — le conteneur de Castor lui-même et le volume `/data` ne peuvent **jamais**
  être supprimés via l'UI (même par un admin) ; les conteneurs étiquetés `io.castor.protected="true"` sont protégés aussi.
- **Image durcie** — distroless `static:nonroot` (uid 65532), pas de shell, pas de libc, rootfs en
  lecture seule en compose, toutes les capabilities retirées, `no-new-privileges`.
- **Garde-fous CI** — `golangci-lint`, `go test -race`, vitest et `govulncheck` à chaque push/PR.

Modèle de menaces & guide opérationnel complet : [`docs/runbooks/security.md`](docs/runbooks/security.md).

---

## 🏗️ Architecture & build

Castor est **un unique binaire Go statique** qui sert l'API JSON/WebSocket **et** l'UI React
(embarquée via `embed.FS`) sur un seul port. SQLite (`modernc.org/sqlite`, pur Go) est le seul
stockage ; l'état live du cluster n'est jamais persisté — il est récupéré à la demande et mis en
cache en mémoire.

L'image est un build en **trois étapes** :

```
ui    (node:24-alpine)            ── vite build ──▶  /server/web/dist  (assets statiques React)
build (golang:1.25-alpine)        ── copie le dist dans le chemin d'embed, puis
                                     CGO_ENABLED=0 go build ──▶ /usr/local/bin/castor
final (distroless/static:nonroot) ── ne livre que le binaire ; non-root ; pas de shell ; pas de libc
```

**Contrat du chemin d'embed (doit rester synchronisé) :** le `vite.config.ts` de l'UI définit
`build.outDir = "../server/web/dist"`, le côté Go utilise `//go:embed dist` dans `server/web/embed.go`,
et le Dockerfile copie le dist construit dans `server/web/dist` **avant** le `go build`. Un
`server/web/dist/index.html` de remplacement est commité pour qu'un simple `go build` ne fasse jamais
échouer l'embed.

### Le construire soi-même

> Go n'est **pas** requis sur votre hôte — il est compilé à l'intérieur du build Docker.

```bash
# Linux/macOS
./build.sh build      # buildx l'image pour votre arch et la charge
./build.sh run        # docker compose up -d  (nécessite CASTOR_SECRET_KEY)

# Windows (PowerShell 7+)
$env:CASTOR_SECRET_KEY = (openssl rand -hex 32)
./build.ps1 build
./build.ps1 run

# Make (Unix), avec un toolchain Go + Node local :
make build            # UI -> embed -> binaire Go statique
make docker-build     # image buildx pour l'arch locale
make docker-push      # push buildx multi-arch (amd64+arm64) vers GHCR
make verify           # golangci-lint + go test -race + govulncheck
```

Les images multi-arch (`linux/amd64`, `linux/arm64`) sont publiées sur
`ghcr.io/yannleonard/castor` par [`.github/workflows/release.yml`](.github/workflows/release.yml) sur
un tag `v*.*.*`.

---

## 🩺 Santé & exploitation

- **Healthcheck :** l'image n'a pas de shell/curl, donc la santé passe par la sous-commande du binaire
  — `castor healthcheck` exécute `GET /api/v1/healthz` sur l'écoute locale et sort `0`/`1`. Le
  `HEALTHCHECK` du Dockerfile et le `healthcheck` du compose l'utilisent tous les deux.
- **Données & sauvegarde :** tout ce qui est persistant vit dans `/data/castor.db` sur le volume
  `castor-data`. Sauvegardez-le en copiant ce fichier (SQLite en mode WAL) :
  ```bash
  docker run --rm -v castor-data:/data -v "$PWD:/backup" busybox \
    sh -c 'cp /data/castor.db /backup/castor-$(date +%Y%m%d).db'
  ```
- **Logs :** `docker logs castor` (JSON structuré ; les secrets sont caviardés avant journalisation).
- **Mise à jour :** `docker compose pull && docker compose up -d` — la base sur `/data` persiste ; les
  migrations de schéma s'exécutent automatiquement au démarrage.

Plus : [`docs/runbooks/install.md`](docs/runbooks/install.md).

---

## 📚 Documentation

- Installation & exploitation — [`docs/runbooks/install.md`](docs/runbooks/install.md)
- Sécurité & modèle de menaces — [`docs/runbooks/security.md`](docs/runbooks/security.md)
- Décisions d'architecture — [`docs/adr/`](docs/adr/)
- Contribuer — [`CONTRIBUTING.md`](CONTRIBUTING.md)

## 🤝 Contribuer

Les contributions sont les bienvenues — voir [`CONTRIBUTING.md`](CONTRIBUTING.md). Castor est
**100 % développé de zéro** et autonome ; il ne dépend d'aucun autre dépôt.

## 📄 Licence

[Apache-2.0](LICENSE) © 2026 LEONARD-IT/GTEK-IT.
