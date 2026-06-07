# Castor — Landing Page Content & Copy

> **For the designer:** this is the source of truth for the marketing site copy and page structure.
> Build the sections in the order below. All copy here is final and ready to lay out — it is
> grounded in the real, shipped feature set (verified against the codebase). Primary language is
> **English** (international OSS audience); the French tagline **"Gérer · Déployer · Orchestrer"**
> is kept as a brand element only.
>
> **Brand:** mascot = friendly brown beaver holding 3 containers (Docker blue / K8s navy / Swarm teal).
> Logo: `/assets/castor-logo.webp` (fallback `.jpg`).
> Colors: navy `#0A2540` (primary/text), Docker blue `#2496ED` (accent), teal `#13A688`
> (success / secondary CTA), beaver brown `#8B5E3C` (warm accent).
> Tone: confident, technical-but-accessible, FOSS-credible. **Not** hype.
>
> **Placeholders to find-and-replace later:**
> - Domain / canonical / OG URL: `https://castor.example.com`
> - GitHub repo: `https://github.com/Yannleonard/Castor`
> - Image: `ghcr.io/yannleonard/castor:latest`

---

## 0. Global / Navigation

**Top nav (left → right):**
- Logo + wordmark **Castor** (links to `#top`)
- Features (`#features`)
- Orchestrators (`#orchestrators`)
- Compare (`#compare`)
- Security (`#security`)
- Install (`#install`)
- FAQ (`#faq`)
- **GitHub ★** button (`https://github.com/Yannleonard/Castor`) — show a star icon; if a live star count is available later, render it; otherwise just "Star on GitHub".
- Primary button: **Get started** (`#install`)

**Announcement bar (optional, dismissible), above nav:**
> Castor by Leonard It is open source under Apache-2.0 — one UI for Docker, Swarm & Kubernetes. **Star us on GitHub →**

---

## 1. Hero

**Eyebrow (small, above headline):**
OPEN SOURCE · SELF-HOSTED · APACHE-2.0

**Headline (H1):**
# One UI for Docker, Swarm, and Kubernetes.

**Subhead:**
Castor is the open-source, self-hosted platform to **manage, deploy, and orchestrate** containers across **Docker, Docker Swarm, and Kubernetes** — from a single modern interface. Helm built in, a 50+ app marketplace, enterprise SSO, and security by default. Up and running in under two minutes.

**Primary CTA button:** Get started
→ links to `#install`

**Secondary CTA button:** View on GitHub
→ links to `https://github.com/Yannleonard/Castor` (with GitHub mark icon)

**Micro-trust line under the buttons (small, muted):**
Apache-2.0 · ~67 MB distroless image · runs as non-root · amd64 + arm64

**Hero supporting visual (designer):**
- Right side / below: a clean screenshot/mock of the **light "BI dashboard"** — KPI cards (running containers, CPU %, memory, images, volumes, networks) + a container-state donut + a top-by-CPU bar chart.
- The beaver mascot can peek in a corner — playful but not dominant.

**Hero copy-paste command (small terminal chip directly in the hero, "copy" button):**
```bash
docker run -d -p 8080:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e CASTOR_SECRET_KEY=$(openssl rand -hex 32) \
  ghcr.io/yannleonard/castor:latest
```

---

## 2. "Works with" strip

**Section label (small caps, centered):**
WORKS WITH THE STACK YOU ALREADY RUN

**Logos row (monochrome/navy, evenly spaced):**
Docker · Docker Swarm · Kubernetes · Helm

**Sub-line (centered, muted):**
Plus a 50+ app marketplace — Postgres, MySQL, MariaDB, MongoDB, Redis, Nginx, Grafana, and more — deployable in one click.

> **Designer note:** use the official marks for Docker, Kubernetes, Helm where licensing allows; render Swarm with the Docker whale + the teal orchestrator badge from the logo. The app logos can scroll as a subtle marquee.

---

## 3. Features grid

**Section eyebrow:** EVERYTHING YOU NEED

**Section headline (H2):**
## Manage containers like it's 2026 — not 2016.

**Section subhead:**
Castor brings every orchestrator, every lifecycle action, and enterprise-grade security into one coherent, real-time UI. No tab-hopping between three different tools.

> **Designer note:** 9 cards, 3 across on desktop. Each card = icon + title + 1–2 sentence blurb. Use the brand accent colors to tint icons by theme (orchestration = Docker blue, security = navy, dashboard = teal).

**Card 1 — Three orchestrators, one tool**
Drive Docker, Docker Swarm, and Kubernetes from the same UI, with the same mental model. Stop switching products just to switch runtimes.

**Card 2 — Modern BI dashboard**
A clean, light command center: KPI cards for running containers, CPU, memory, images, volumes, and networks, plus live donut and top-by-resource charts that update in real time.

**Card 3 — Live logs, stats & exec terminal**
Stream container logs, watch live CPU/memory stats, and drop into an interactive shell — Docker `exec` and Kubernetes pod `exec` — straight from the browser.

**Card 4 — Helm, built in**
Manage Helm end to end: add repos, search charts, install, upgrade, roll back, uninstall, inspect history and values. No CLI context-switch required.

**Card 5 — Marketplace: 50+ one-click apps**
Deploy Postgres, Redis, Nginx, Grafana and 50+ more from curated templates with official logos. Add your own templates, point at remote catalogs, and pull from private registries with encrypted credentials.

**Card 6 — Resources & QoS, made visible**
Set CPU/memory limits and reservations for Docker and Swarm, and see Kubernetes QoS classes — Guaranteed, Burstable, BestEffort — at a glance. Scale, drain nodes, and rolling-update without guesswork.

**Card 7 — Enterprise SSO, RBAC & audit**
Local auth with TOTP 2FA, plus SSO via LDAP/LDAPS and Microsoft Entra ID (OIDC). Resource-scoped RBAC with admin/operator/viewer roles and an append-only audit log of every change.

**Card 8 — Backup & restore**
Back up and restore Docker volumes from the UI, so your stateful workloads aren't a single `docker volume rm` away from disaster.

**Card 9 — Security by default**
Secrets sealed with AES-256-GCM, argon2id password hashing, protected containers, a host-mount guard, and per-route AAL step-up. Shipped as a distroless, non-root image. Secure out of the box — not after a hardening guide.

---

## 4. "One tool, three orchestrators" highlight (the differentiator)

**Section eyebrow:** THE DIFFERENCE

**Headline (H2):**
## Three orchestrators. One coherent UX. Not three products.

**Lead paragraph:**
Most tools force a choice: a Docker tool here, a Kubernetes tool there, Swarm as an afterthought — each with its own UI, its own auth, its own learning curve. Castor unifies all three behind one interface, one login, one permission model, and one real-time experience. Manage a homelab Docker host and a production Kubernetes cluster in the same session.

**Three columns (designer: tabbed or 3-up, color-coded):**

### Docker — full lifecycle (blue `#2496ED`)
Start, stop, restart, and remove containers. Live logs and live stats. Interactive `exec` terminal. Manage images, networks, and volumes. Apply resource limits. Visual + YAML Compose with stack deploy.

### Docker Swarm — service-grade control (teal `#13A688`)
Create, scale, update, rolling-restart, and remove services. Drain nodes. Manage secrets and configs. Set resource limits and reservations across the cluster.

### Kubernetes — first-class, not bolted-on (navy `#0A2540`)
Pods, deployments, nodes, namespaces, services, configmaps, secrets, events, and Ingress. Scale and rollout-restart. Apply YAML server-side. Pod `exec` terminal. Live metrics via metrics-server. PV/PVC/StorageClass, HPA autoscaling, and QoS classes.

**Closing line (centered, emphasized):**
**Built from scratch, Apache-2.0, 100% self-hosted.** Your clusters, your data, your rules.

---

## 5. Comparison table — Castor vs Portainer vs Lens vs Rancher

**Section eyebrow:** HOW CASTOR COMPARES

**Headline (H2):**
## Why teams pick Castor

**Intro line:**
An honest look at where Castor fits. Every tool below is good at something — Castor's edge is doing all three orchestrators, with Helm and enterprise SSO, under a permissive license.

| Capability | **Castor** | Portainer | Lens | Rancher |
|---|:---:|:---:|:---:|:---:|
| Docker management | ✓ | ✓ | — | partial |
| Docker Swarm management | ✓ | ✓ | — | — |
| Kubernetes management | ✓ | ✓ | ✓ | ✓ |
| **All three in one tool** | **✓** | partial¹ | — | — |
| Helm built in | ✓ | partial | ✓ | ✓ |
| App marketplace / templates | ✓ (50+) | ✓ | — | ✓ |
| Modern dark **and** light UI | ✓ | dated | ✓ | functional |
| Enterprise SSO (LDAP + Entra/OIDC) | ✓ | paid tier | — | ✓ |
| Resource-scoped RBAC | ✓ | paid tier | — | ✓ |
| Append-only audit log | ✓ | paid tier | — | ✓ |
| Self-hosted | ✓ | ✓ | desktop app² | ✓ |
| Single small image (~67 MB) | ✓ | ✓ | n/a | heavy |
| License | **Apache-2.0** | zlib/commercial | MIT/commercial | Apache-2.0 |

**Footnotes (small, under table):**
¹ Portainer covers Docker + Swarm + K8s but RBAC, SSO, and audit sit behind the paid Business edition.
² Lens is primarily a Kubernetes-only desktop client, not a self-hosted multi-orchestrator server.

**Caption (muted):**
Comparison reflects publicly documented capabilities at time of writing and is provided in good faith. Run your own evaluation — Castor is free.

---

## 6. Security section

**Section eyebrow:** SECURITY BY DEFAULT

**Headline (H2):**
## A tool that controls your containers should be the hardest thing to break.

**Lead paragraph:**
Castor sits at a privileged spot in your infrastructure, so security isn't a checkbox — it's the foundation. Authentication, authorization, secret handling, and the runtime image are all locked down out of the box.

**Two-column list of pillars (icon + title + one line each):**

- **SSO + 2FA** — Local accounts with TOTP two-factor, plus SSO via LDAP/LDAPS and Microsoft Entra ID (OIDC). Per-route AAL step-up for sensitive actions.
- **Resource-scoped RBAC** — Built-in admin, operator, and viewer roles; permissions scoped to resources so people see and touch only what they should.
- **Append-only audit log** — Every mutating action writes exactly one immutable row. Know who did what, when — and prove it.
- **AES-256-GCM secrets** — Sensitive data, including TOTP secrets and private registry credentials, is sealed with authenticated AES-256-GCM encryption at rest.
- **argon2id passwords** — Passwords are hashed with argon2id, a modern memory-hard function — no fast, crackable hashes.
- **Protected containers & host-mount guard** — Castor's own container and data volume can never be deleted from the UI, and a host-mount guard blocks risky bind mounts before they happen.
- **Distroless, non-root image** — Ships on `distroless/static:nonroot` (uid 65532): no shell, no package manager, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`.
- **Read-only by default** — Mount the Docker socket read-only to inspect safely; explicitly opt in to read-write for the full lifecycle. Least privilege, by design.

**Pull-quote (large, navy):**
> Secrets sealed, roles scoped, every action logged, and a hardened runtime — before you write a single line of config.

---

## 7. Install / Quickstart

**Section eyebrow:** QUICKSTART

**Headline (H2):**
## Running in under two minutes.

**Subhead:**
One container, one port, one secret key. Castor talks to your local Docker engine over the mounted socket and reads Kubernetes through a mounted kubeconfig.

**Tab 1 — `docker run` (default tab):**
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

**Tab 2 — `docker compose`:**
```yaml
services:
  castor:
    image: ghcr.io/yannleonard/castor:latest
    container_name: castor
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # REQUIRED — 32-byte key (64 hex chars): openssl rand -hex 32
      CASTOR_SECRET_KEY: "${CASTOR_SECRET_KEY:?set CASTOR_SECRET_KEY first}"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro   # :rw for full lifecycle
      - castor-data:/data
    group_add:
      - "${DOCKER_GID:-999}"          # docker group GID — NOT root
    read_only: true
    tmpfs: [/tmp]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]

volumes:
  castor-data:
    name: castor-data
```
```bash
export CASTOR_SECRET_KEY=$(openssl rand -hex 32)        # 64 hex chars = 32 bytes
export DOCKER_GID=$(getent group docker | cut -d: -f3)  # socket access, not root
docker compose up -d
```

**After-install steps (numbered, with a "next steps" feel):**
1. Open **http://localhost:8080**
2. Create your first admin on the bootstrap screen.
3. Enable **TOTP 2FA** — strongly recommended.
4. (Optional) Add Kubernetes by mounting your kubeconfig with the Kubernetes overlay.

**Callout box (muted, important):**
> 🔑 **Keep `CASTOR_SECRET_KEY` safe.** It must decode to exactly 32 bytes (`openssl rand -hex 32` → 64 hex chars). Castor refuses to start otherwise, and losing the key makes enrolled 2FA unrecoverable.

**Secondary links under the install block:**
- Full install & operations guide →
- Security & threat model →
- Build it yourself (no Go toolchain needed) →

---

## 8. Open source / Community

**Section eyebrow:** OPEN SOURCE, FOR REAL

**Headline (H2):**
## Free, permissive, and built in the open.

**Body:**
Castor is licensed under **Apache-2.0** — permissive, patent-protected, and friendly to commercial use. It's built and maintained by **LEONARD-IT/GTEK-IT**, 100% from scratch and self-contained, with no hidden dependency on any other product. No "open core" bait-and-switch: the features on this page are the free features.

**Three small stat/value tiles:**
- **Apache-2.0** — Use it, fork it, ship it. No per-node fees, no locked-away enterprise tier for SSO and audit.
- **From scratch** — A single static Go binary serving the API and the React UI. Pure-Go SQLite — no external database to run.
- **Community-driven** — Issues, PRs, and good first issues welcome. CI gates every change with linting, race-tested Go, UI tests, and vulnerability scanning.

**CTA buttons:**
- **Star on GitHub ★** → `https://github.com/Yannleonard/Castor`
- **Read the docs** → docs
- **Contribute** → `CONTRIBUTING.md`

**Line (muted):**
Edited by LEONARD-IT/GTEK-IT · Apache-2.0 © 2026

---

## 9. FAQ

**Section eyebrow:** QUESTIONS

**Headline (H2):**
## Frequently asked questions

**Q1 — Is Castor really free?**
Yes. Castor is open source under the Apache-2.0 license — free to use, modify, and self-host, including in commercial settings. There's no paywalled tier: SSO, RBAC, and the audit log are all included.

**Q2 — Is it self-hosted? Where does my data go?**
Entirely self-hosted. Castor runs as a single container on your own infrastructure and stores its state in a local SQLite database on a volume you control. Live cluster state is fetched on demand and never sent anywhere — there is no cloud, no telemetry phone-home.

**Q3 — Does it really manage all three orchestrators?**
Yes. Docker (full lifecycle, logs, stats, exec, images/networks/volumes), Docker Swarm (services, scaling, rolling updates, node drain, secrets/configs), and Kubernetes (pods, deployments, scale, rollout restart, server-side apply, pod exec, metrics, storage, HPA, Ingress, and more) — plus Helm — all from one UI.

**Q4 — Is it production-ready?**
Castor is built for real workloads: a hardened distroless non-root image, security by default, an append-only audit log, automatic schema migrations on upgrade, and CI that race-tests the Go core and scans dependencies on every change. Start read-only, then opt into write access when you're ready.

**Q5 — How do I install it?**
One `docker run` command or a short `docker compose` file — you'll be on the setup screen in under two minutes. You need Docker (with the Compose plugin) and `openssl` to generate the secret key. See the Quickstart above.

**Q6 — How does it stay secure if it can control Docker?**
Defense in depth: the Docker socket is read-only by default, Castor runs as a non-root user (never root), secrets are sealed with AES-256-GCM, passwords use argon2id, access is gated by resource-scoped RBAC with optional 2FA and SSO, and its own container and data volume are protected from deletion. For hardened setups, you can front the socket with a scoped socket-proxy.

---

## 10. Closing CTA band

**Headline (H2, centered, on a navy or gradient band):**
## Take control of your containers.

**Subhead (centered):**
One UI for Docker, Swarm, and Kubernetes. Open source, self-hosted, secure by default — running in under two minutes.

**Buttons (centered):**
- **Get started** → `#install`
- **View on GitHub** → `https://github.com/Yannleonard/Castor`

> **Designer note:** the beaver mascot with its 3-container stack belongs here — confident, friendly, holding up the stack.

---

## 11. Footer

**Left: brand block**
- Logo + **Castor**
- Tagline: *Gérer · Déployer · Orchestrer*
- One line: Open-source, self-hosted container orchestration for Docker, Swarm & Kubernetes.

**Column — Product**
- Features (`#features`)
- Orchestrators (`#orchestrators`)
- Compare (`#compare`)
- Security (`#security`)
- Install (`#install`)

**Column — Resources**
- Documentation
- Install guide
- Security & threat model
- Changelog / Releases

**Column — Open source**
- GitHub (`https://github.com/Yannleonard/Castor`)
- Apache-2.0 License
- Contributing
- Report an issue

**Bottom bar:**
- © 2026 LEONARD-IT/GTEK-IT. Castor is released under the Apache-2.0 License.
- Made with the Castor icon by LEONARD-IT.
- (Right) small social/GitHub icon.

---

## SEO / Metadata

**`<title>` (~60 chars):**
`Castor — Docker, Swarm & Kubernetes in One Open-Source UI`

**Meta description (~155 chars):**
`Castor is the open-source, self-hosted platform to manage, deploy and orchestrate Docker, Swarm & Kubernetes from one modern UI. Helm, SSO, 2-min install.`

**Meta keywords (use sparingly; modern SEO ignores these but harmless):**
`container orchestration, docker UI, kubernetes dashboard, docker swarm management, portainer alternative, helm UI, self-hosted, open source, apache-2.0, kubernetes management`

**Canonical:**
`<link rel="canonical" href="https://castor.example.com/" />`

**Open Graph:**
```html
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Castor" />
<meta property="og:title" content="Castor — Docker, Swarm & Kubernetes in One Open-Source UI" />
<meta property="og:description" content="Manage, deploy and orchestrate Docker, Swarm & Kubernetes from one modern, self-hosted UI. Helm built in, 50+ app marketplace, enterprise SSO, security by default." />
<meta property="og:url" content="https://castor.example.com/" />
<meta property="og:image" content="https://castor.example.com/assets/castor-logo.jpg" />
<meta property="og:image:alt" content="Castor — the beaver mascot holding a stack of Docker, Kubernetes and Swarm containers." />
<meta property="og:locale" content="en" />
```

**Twitter / X Card:**
```html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Castor — Docker, Swarm & Kubernetes in One Open-Source UI" />
<meta name="twitter:description" content="Open-source, self-hosted container orchestration for Docker, Swarm & Kubernetes. Helm, marketplace, SSO, 2-minute install." />
<meta name="twitter:image" content="https://castor.example.com/assets/castor-logo.jpg" />
<meta name="twitter:image:alt" content="Castor beaver mascot holding a stack of three containers." />
```

**JSON-LD (SoftwareApplication) — drop in `<head>`:**
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Castor",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Linux, Docker, Kubernetes",
  "description": "Open-source, self-hosted platform to manage, deploy and orchestrate containers across Docker, Docker Swarm and Kubernetes from one modern UI.",
  "license": "https://www.apache.org/licenses/LICENSE-2.0",
  "url": "https://castor.example.com/",
  "author": { "@type": "Organization", "name": "LEONARD-IT/GTEK-IT" },
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
}
```

**`<html lang="en">`** · favicon from the beaver logo · `theme-color` = `#0A2540`.

---

## Voice & word-bank (for any extra microcopy the designer needs)

- **Verbs:** manage, deploy, orchestrate, scale, roll out, drain, inspect, stream, secure.
- **Proof words (use, don't overuse):** open-source, self-hosted, Apache-2.0, distroless, non-root, real-time, append-only, server-side, from scratch.
- **Avoid:** "revolutionary", "game-changing", "synergy", exclamation-mark spam. Stay confident and concrete.
- **Numbers we can stand behind:** 3 orchestrators, 50+ marketplace apps, ~67 MB image, uid 65532, AES-256-GCM, under 2 minutes, amd64 + arm64.
