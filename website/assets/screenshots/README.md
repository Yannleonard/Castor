# Product screenshots

Drop real Castor screenshots here. They render automatically in `index.html`
via `<img>` tags that **fall back to a hand-built CSS/HTML mockup** if the file
is missing (`onerror` removes the broken image and reveals the mockup), so the
page always looks complete — replacing a file is purely an upgrade.

## Expected filenames (referenced by index.html)

| File                        | Where it shows            | Recommended size / notes                                  |
|-----------------------------|---------------------------|-----------------------------------------------------------|
| `dashboard.png`             | Hero — main product shot  | ~1280×900, light theme BI dashboard (KPI cards + donut + top-by-CPU bars). This is the only screenshot the current markup wires up. |

## Adding more screenshots later

Suggested additional shots if the owner wants to expand the page (each would
need a matching `<img>` added to `index.html`):

- `kubernetes.png` — K8s view (pods/deployments, QoS classes, metrics).
- `helm.png` — Helm repos / chart install / values.
- `marketplace.png` — 50+ app template grid with official logos.
- `swarm.png` — Swarm services / scaling / rolling update.
- `security-rbac.png` — RBAC roles / audit log / SSO settings.
- `logs-exec.png` — live logs + interactive exec terminal.

## Format guidance

- Prefer **PNG** for crisp UI (or **WebP** for smaller files — update the
  `src` extension in `index.html` to match).
- Trim OS chrome; the site already frames shots in a browser-style window.
- Keep light-theme shots for the hero so they sit on the white product area.
- Optimize before committing (e.g. `oxipng`, `squoosh`) to stay Lighthouse-friendly.
