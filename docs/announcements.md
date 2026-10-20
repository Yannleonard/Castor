# Website announcements

Castor's compact announcement slot is backed by the Website communications
service under `website/communications`. The service owns the persistent
announcement records and image data; Castor only fetches the currently active
message through its authenticated API session.

## Deployment

Deploy the communications API alongside the Website, or on another host that
is reachable by the Castor server. In the current website deployment, the
static landing page and communications API share the same container; the admin
interface is at `/admin` and the public feed is at
`https://castor.gtek-it.fr/api/announcements/current`. The admin API requires
the bearer token and should only be used over HTTPS.

The production website runs in one Docker container on apps-gtek. See the
[apps-gtek operations runbook](runbooks/website-apps-gtek.fr.md) for its SSH
alias, persistent data volume, health checks, and operational safeguards.

For a separate Compose deployment, the API listens on port 8099 and stores its
data in the `castor-website-announcements` Docker volume. Keep port 8099 private
and put an HTTPS reverse proxy in front of the admin interface and public feed.

On first start the service generates a 256-bit admin token in the persistent
volume. Retrieve it through the container runtime and enter it into the admin
page; it is never embedded in client-side configuration. A token may instead be
provided as `CASTOR_ANNOUNCEMENTS_ADMIN_TOKEN` (minimum 32 characters). Store
that value in the deployment secret manager, not in source control.

Every Castor container uses the fixed `https://castor.gtek-it.fr` feed; the URL
is built into the server and is not configurable from the application UI or
container environment. The proxy only requests the fixed
`/api/announcements/current` endpoint, has a two-second timeout and rejects
invalid or oversized responses. The Castor host must have outbound HTTPS access
to `castor.gtek-it.fr` for announcements to load.

## Content limits

Announcements support information, Castor releases, and commercial messages.
Titles are limited to 100 characters, bodies to 300 characters, with optional
HTTPS links and PNG/JPEG images up to 512 KiB and 2 megapixels. Optional start
and end times use RFC3339. The header hides the slot on phone-width screens so
the navigation controls remain usable.