# Castor — Marketing Website (Nginx container)

The static landing page for **Castor**, the open-source, self-hosted platform to
manage, deploy, and orchestrate Docker, Swarm, and Kubernetes from one UI.

This directory packages the site as a tiny, production-grade **Nginx** image that
listens on **port 8080** (non-root, Azure-friendly) and is ready for Azure App
Service for Containers, Azure Container Instances, or any container host.

- Editor: **LEONARD-IT/GTEK-IT** · License: **Apache-2.0**
- Image base: `nginx:1.27-alpine` · final image **~49 MB** · multi-arch (amd64 + arm64)

---

## What's in here

| Path                 | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| `index.html`         | The landing page (single page).                                |
| `404.html`           | Branded 404 page.                                              |
| `css/styles.css`     | Design system + all styles.                                    |
| `js/main.js`         | Vanilla-JS interactions (tabs, FAQ, copy, reveals).            |
| `assets/`            | Logo (`castor-logo.jpg` / `.webp`) + `screenshots/` drop-in.   |
| `Dockerfile`         | Builds the Nginx image (web root = contents of this dir).      |
| `nginx.conf`         | Server config: `:8080`, gzip, caching, security headers, 404.  |
| `docker-compose.yml` | One-command local preview on `:8080`.                          |
| `.dockerignore`      | Keeps `public/`, tooling, and docs out of the image.           |
| `public/`            | The designer's **source copy** of assets — **NOT** served.     |

> **Served web root.** The Nginx root is the *contents* of this `website/`
> directory, so the HTML's absolute paths resolve directly:
> `/css/styles.css`, `/js/main.js`, `/assets/castor-logo.jpg`.
> `website/public/` is an untouched source copy and is intentionally excluded
> from the image — **do not** point the root at `public/`.

> **Dashboard screenshot.** `index.html` references
> `/assets/screenshots/dashboard.png`. That file is intentionally absent — an
> `onerror` handler removes the broken `<img>` and reveals a pixel-faithful
> CSS/HTML mockup, so the hero always looks complete. Drop a real
> `dashboard.png` into `assets/screenshots/` (see that folder's `README.md`)
> and rebuild to upgrade it.

---

## Run locally

### Option A — Docker Compose (simplest)

```bash
docker compose up -d --build
# visit http://localhost:8080
docker compose down            # stop & remove
```

### Option B — plain Docker

```bash
# Build
docker build -t castor-website:local .

# Run (host 8080 -> container 8080)
docker run -d --name castor-website -p 8080:8080 castor-website:local

# Health: http://localhost:8080/healthz  ->  "ok"
# Site:   http://localhost:8080
```

### Build for multiple architectures (amd64 + arm64)

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t castor-website:latest --push .
```

---

## Configuration notes

- **Port:** Nginx listens on **8080** (not 80) so it runs unprivileged and matches
  Azure's configurable-port model. For Azure App Service, set **`WEBSITES_PORT=8080`**.
- **Health check:** `GET /healthz` returns `200 ok`. Baked into the image
  `HEALTHCHECK` and the compose file.
- **Caching:** `index.html` / `404.html` are `no-cache` (updates go live
  immediately); `/css`, `/js`, `/assets/*` are `public, max-age=1y, immutable`.
- **Security headers:** `Content-Security-Policy` (scoped to self + Google Fonts +
  inline styles the page needs), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`,
  `server_tokens off`.
- **gzip:** on for HTML, CSS, JS, JSON, SVG, fonts.

> ### Replace the placeholder domain before going live
> The site ships with the placeholder domain **`https://castor.example.com`** in
> the canonical URL, Open Graph / Twitter tags, and JSON-LD. Find-and-replace it
> with your real domain across `index.html` (and double-check
> `https://github.com/Yannleonard/Castor` and `ghcr.io/yannleonard/castor:latest`).
>
> ```bash
> # from the website/ directory (GNU sed)
> sed -i 's#https://castor.example.com#https://your-domain.tld#g' index.html
> ```

---

## Deploy to Azure

All three options below use the same image built from this `Dockerfile`.
Replace the placeholder values (`<...>`). Pick the model that fits:

| Option | Best for | Custom domain + free TLS | Scales |
|--------|----------|--------------------------|--------|
| **(1) ACR + App Service for Containers** | A managed web app, easiest custom domain + managed certs | Yes (App Service Managed Certificate) | Yes |
| **(2) Azure Container Instances (ACI)** | Quick, cheap, single-container demo | Manual (front with App Gateway / Front Door for TLS) | No (single instance) |
| **(3) Azure Static Web Apps** | *Pure static, no container* — global CDN + free certs | Yes (built-in) | Global CDN |

---

### Option 1 — Azure Container Registry + App Service for Containers (recommended)

Builds the image in the cloud with **`az acr build`** (no local Docker needed)
and runs it as a Linux Web App. App Service handles custom domains + free managed
TLS certificates.

```bash
# ---- variables ----
RG=castor-rg
LOCATION=westeurope
ACR=castoracr$RANDOM          # must be globally unique, lowercase, 5-50 alnum
PLAN=castor-plan
APP=castor-site-$RANDOM       # becomes <APP>.azurewebsites.net
IMAGE=castor-website:latest

# ---- resource group ----
az group create -n $RG -l $LOCATION

# ---- container registry (Basic is plenty for one image) ----
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true

# ---- build the image IN Azure, straight from this directory ----
#      (run from website/ — the dir containing the Dockerfile)
az acr build -r $ACR -t $IMAGE .

# ---- App Service plan (Linux) ----
az appservice plan create -n $PLAN -g $RG --is-linux --sku B1

# ---- web app from the ACR image ----
az webapp create -g $RG -p $PLAN -n $APP \
  --deployment-container-image-name $ACR.azurecr.io/$IMAGE

# ---- let the web app pull from ACR + tell it the container port ----
az webapp config container set -g $RG -n $APP \
  --docker-custom-image-name $ACR.azurecr.io/$IMAGE \
  --docker-registry-server-url https://$ACR.azurecr.io
az webapp identity assign -g $RG -n $APP
ACR_ID=$(az acr show -n $ACR -g $RG --query id -o tsv)
PRINCIPAL=$(az webapp identity show -g $RG -n $APP --query principalId -o tsv)
az role assignment create --assignee $PRINCIPAL --role AcrPull --scope $ACR_ID

# CRITICAL: Nginx listens on 8080, so App Service must probe 8080.
az webapp config appsettings set -g $RG -n $APP \
  --settings WEBSITES_PORT=8080

# restart to apply
az webapp restart -g $RG -n $APP
echo "Live at: https://$APP.azurewebsites.net"
```

**Custom domain + free TLS on App Service:**

```bash
# 1) Add a CNAME at your DNS provider:  www  ->  <APP>.azurewebsites.net
# 2) Bind the hostname
az webapp config hostname add -g $RG --webapp-name $APP \
  --hostname www.your-domain.tld
# 3) Free App Service Managed Certificate + bind it (SNI SSL)
az webapp config ssl create -g $RG --name $APP --hostname www.your-domain.tld
THUMB=$(az webapp config ssl list -g $RG \
  --query "[?subjectName=='www.your-domain.tld'].thumbprint" -o tsv)
az webapp config ssl bind -g $RG --name $APP \
  --certificate-thumbprint $THUMB --ssl-type SNI
```

> Don't forget to find-and-replace `https://castor.example.com` with
> `https://www.your-domain.tld` in `index.html` **before** `az acr build`.

**Redeploy after a content change:** rebuild and restart.

```bash
az acr build -r $ACR -t $IMAGE .
az webapp restart -g $RG -n $APP
```

---

### Option 2 — Azure Container Instances (ACI)

Fastest path to a running container with a public DNS label. Single instance,
HTTP on port 8080.

```bash
RG=castor-rg
LOCATION=westeurope
ACR=castoracr...            # from Option 1, or build/push the image anywhere
IMAGE=castor-website:latest
DNSLABEL=castor-demo-$RANDOM   # -> <DNSLABEL>.<region>.azurecontainer.io

# Build the image in ACR (if not already done)
az acr build -r $ACR -t $IMAGE .

# Pull credentials for ACI
ACR_SERVER=$(az acr show -n $ACR --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n $ACR --query username -o tsv)
ACR_PASS=$(az acr credential show -n $ACR --query "passwords[0].value" -o tsv)

az container create -g $RG -n castor-site \
  --image $ACR_SERVER/$IMAGE \
  --registry-login-server $ACR_SERVER \
  --registry-username $ACR_USER \
  --registry-password $ACR_PASS \
  --os-type Linux --cpu 1 --memory 1 \
  --ports 8080 \
  --ip-address Public \
  --dns-name-label $DNSLABEL

az container show -g $RG -n castor-site \
  --query "ipAddress.fqdn" -o tsv
# -> http://<DNSLABEL>.<region>.azurecontainer.io:8080
```

> ACI exposes plain HTTP. For a real domain with TLS, front the container with
> **Azure Front Door** or **Application Gateway**, or prefer Option 1 / Option 3.

---

### Option 3 — Azure Static Web Apps (no container, pure static)

Because this site is fully static, you can skip containers entirely and serve it
from Azure's global CDN with **free** managed certificates and custom domains.
The web root is this `website/` directory (`index.html` at its top).

```bash
RG=castor-rg
LOCATION=westeurope
SWA=castor-swa

az staticwebapp create -n $SWA -g $RG -l $LOCATION --sku Free
# Deploy the static files (run from website/):
#   npm i -g @azure/static-web-apps-cli
swa deploy . --deployment-token \
  "$(az staticwebapp secrets list -n $SWA -g $RG --query 'properties.apiKey' -o tsv)"
```

Add a custom domain in the portal (Static Web App → Custom domains) or:

```bash
az staticwebapp hostname set -n $SWA -g $RG --hostname www.your-domain.tld
```

> Static Web Apps ignores the `Dockerfile`/`nginx.conf` (it's not a container
> host). Caching/headers there are configured via an optional
> `staticwebapp.config.json` instead. Use this option only if you don't need the
> container.

---

## Verification checklist (done at packaging time)

- [x] Image builds on `nginx:1.27-alpine`, **~49 MB**, multi-arch capable.
- [x] `nginx -t` passes inside the container.
- [x] Web root tree: `index.html`, `404.html`, `css/styles.css`, `js/main.js`,
      `assets/castor-logo.{jpg,webp}` — matches the HTML's absolute paths.
- [x] `GET /`, `/index.html`, `/css/styles.css`, `/js/main.js`,
      `/assets/castor-logo.jpg`, `/assets/castor-logo.webp` → **200** with
      correct content-types.
- [x] `GET /healthz` → **200 `ok`**; container reports **healthy**.
- [x] `GET /assets/screenshots/dashboard.png` → **404** (intended — CSS mockup
      fallback) and unknown paths render the branded **404** page.
- [x] Security headers + `server_tokens off` present; gzip active; long-cache on
      assets, no-cache on `index.html`.
