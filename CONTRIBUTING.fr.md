> [🇬🇧 English](CONTRIBUTING.md) · 🇫🇷 **Français**

# Contribuer à Castor

Merci de votre intérêt pour Castor — la plateforme open-source d'orchestration de conteneurs
multi-hôtes par LEONARD-IT/GTEK-IT. Les contributions de toute nature sont les bienvenues : rapports
de bugs, documentation, tests et code.

Castor est **100 % développé de zéro et autonome** — il ne dépend d'aucun autre dépôt. Merci de le
garder ainsi : n'introduisez aucune dépendance vers une base de code propriétaire externe/interne.

---

## Règles de base

- **Licence :** en contribuant, vous acceptez que votre travail soit sous licence [Apache-2.0](LICENSE).
- **Sécurité d'abord :** Castor contrôle le socket Docker, qui est équivalent à root sur l'hôte. Tout
  changement touchant l'authentification, le RBAC, le journal d'audit, le garde-fou des ressources
  protégées, les providers Docker/K8s, ou le durcissement Dockerfile/compose fait l'objet d'un examen
  renforcé. En cas de doute, ouvrez d'abord une issue.
- **Aucun secret dans le code, les logs ou le journal d'audit.** Jamais. (Voir [`docs/runbooks/security.md`](docs/runbooks/security.md).)

---

## Organisation du dépôt

```
server/   Backend Go (binaire statique unique). Module : github.com/gtek-it/castor
  cmd/castor/        main + la sous-commande `healthcheck`
  web/               pont d'embed : //go:embed dist  (server/web/embed.go)
  internal/...       config, provider (docker/swarm/kube), cache, store, authz, api, version
ui/       React + Vite + TypeScript. Construit vers ../server/web/dist et embarqué dans le binaire.
deploy/   docker-compose.yml (+ overlay kube) et env.example — le déploiement en 1 commande.
docs/     ADR + runbooks (install, sécurité).
Dockerfile .dockerignore Makefile build.sh build.ps1 .github/workflows/  — packaging & CI.
```

**Frontières de responsabilité** (pour éviter les conflits de merge) :

| Arborescence | Domaine |
|---|---|
| `/server`, `go.mod`, `go.sum` | Backend |
| `/ui` | Frontend |
| `/deploy`, `Dockerfile`/`.dockerignore`/`Makefile`/`build.*` à la racine, `.github/workflows`, `docker-compose.yml` racine | Packaging / DevOps |

### Le contrat du chemin d'embed (à ne pas casser)

L'UI est embarquée dans le binaire Go. Trois éléments DOIVENT être cohérents :

1. `ui/vite.config.ts` → `build.outDir = "../server/web/dist"`
2. `server/web/embed.go` → `//go:embed dist`
3. `Dockerfile` → copie le dist construit dans `server/web/dist` **avant** le `go build`

Un `server/web/dist/index.html` de remplacement est commité pour qu'un simple `go build` ne fasse
jamais échouer l'embed. Le reste de `server/web/dist/` est par ailleurs dans le `.gitignore`. Si vous
modifiez l'un des trois, modifiez les trois.

---

## Mise en place du développement

Il vous faut **Docker** (avec Compose). Pour le dev backend/UI en local (hors Docker), il vous faut en
plus **Go 1.25+** et **Node 24+**.

```bash
git clone https://github.com/Yannleonard/Castor.git
cd Castor

# Voie rapide — construire & lancer la vraie image (pas de Go local nécessaire) :
export CASTOR_SECRET_KEY=$(openssl rand -hex 32)
./build.sh build && ./build.sh run        # Windows : ./build.ps1 build; ./build.ps1 run

# Dev local avec UI en hot-reload (nécessite Go + Node) :
./build.sh dev
#   -> backend Go sur :8080, serveur de dev vite sur :5173 (proxifie /api et /ws vers :8080)
```

Cibles `make` (Unix, toolchain local) :

| Cible | Ce qu'elle fait |
|---|---|
| `make embed` | `npm ci` + `vite build` vers `server/web/dist` |
| `make build` | embed + build du binaire Go statique sans CGO |
| `make test` | `go test -race ./...` |
| `make ui-test` | `vitest` |
| `make lint` | `golangci-lint run ./...` |
| `make govulncheck` | `govulncheck ./...` |
| `make verify` | lint + test + govulncheck (garde-fou CI côté serveur) |
| `make docker-build` | buildx de l'image pour l'arch locale |

---

## Standards de code

**Go**

- Cibler **Go 1.25**, `CGO_ENABLED=0` toujours. **`modernc.org/sqlite`** uniquement —
  `mattn/go-sqlite3` (cgo) est **interdit** (il casse l'étape finale distroless/scratch et la
  compilation croisée arm64).
- `gofmt`/`goimports` propres ; `golangci-lint run ./...` doit passer ; le nouveau code est testé.
- Ne jamais importer le SDK Docker ou Kubernetes en dehors de `internal/provider/...`. La couche API
  ne dialogue qu'avec la couture `Provider` (ADR-002).
- Toute action Docker mutante passe par l'unique point de contrôle authz et écrit une ligne d'audit
  (ADR-003 §6/§7). Les verbes destructeurs appellent `GuardDestructive` avant de toucher au provider.

**TypeScript / React**

- `eslint` propre ; `vitest` au vert. Les noms de types doivent refléter exactement les noms de champs
  de l'API Go (`ui/src/lib/types.ts`).
- Griser les actions d'écriture selon les capabilities déclarées par le provider — jamais
  « cliquer puis 405 ».

**Dépendances**

- Garder le jeu de dépendances réduit et épinglé (`go.sum`, `package-lock.json`). Les nouvelles
  dépendances doivent être sous licence permissive (Apache-2.0 / MIT / BSD) et justifiées dans la PR.

---

## Pull requests

1. Forkez & créez une branche depuis `main` (ex. `feat/...`, `fix/...`, `docs/...`).
2. Gardez des PR ciblées ; décrivez le changement et sa justification ; liez l'issue éventuelle.
3. Faites passer la CI au vert : le workflow [`ci`](.github/workflows/ci.yml) exécute `golangci-lint`,
   `go test -race`, le build UI + `vitest`, `govulncheck`, **et** un build d'image complet.
4. Mettez à jour docs/ADR quand vous changez un comportement, la config ou le modèle de sécurité.
5. Le sign-off est bienvenu ; soyez bienveillant en revue.

### Commits

Des sujets conventionnels et à l'impératif sont appréciés (`feat:`, `fix:`, `docs:`, `chore:`,
`refactor:`, `test:`). Référencez les issues le cas échéant.

---

## Signaler des problèmes de sécurité

**N'ouvrez pas d'issue publique pour les vulnérabilités.** Écrivez au contact sécurité de
LEONARD-IT/GTEK-IT (voir le `SECURITY.md` du dépôt / le profil de l'organisation) avec les détails et
une reproduction. Nous coordonnerons un correctif et la divulgation. Voir le modèle de menaces dans
[`docs/runbooks/security.md`](docs/runbooks/security.md).

---

Merci, et bonne orchestration.
