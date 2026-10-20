# ADR-CASTOR-004: Multi-host Docker agents

- **Status:** Accepted for implementation
- **Date:** 2026-10-02
- **Decision owners:** Castor maintainers

## Context

Castor currently manages one local Docker engine. Host rows and the provider
registry anticipate additional hosts, but there is no enrollment protocol,
agent runtime, host-keyed poller lifecycle, or host-safe routing for every Docker
operation. Registering a remote Docker endpoint from the UI would expose the
Castor server to SSRF and require storing high-privilege Docker credentials.

The requested behavior is complete management of multiple Linux Docker hosts,
with enrollment performed only by administrators. Remote machines may be
behind firewalls and must not expose an inbound Docker or agent port.

## Decision

1. Implement a separately distributed Linux Docker agent. It initiates an
   authenticated outbound TLS WebSocket connection to Castor and exposes no
   listener on the managed host.
2. Carry Docker Engine HTTP API streams over a fixed-purpose multiplexed tunnel
   to the agent's configured local Unix socket. The server uses one Docker SDK
   client per enrolled host. The tunnel destination is never chosen by a
   browser request and is not a generic TCP proxy.
3. Enroll agents with a short-lived, single-use credential issued by an
   interactive Castor administrator. Persist only a hash of the enrollment
   credential. Bind the redeemed agent public identity to one server-created
   host record; support revocation and credential rotation. Never log tokens,
   private keys, or tunnel payloads.
4. Keep Castor user session authentication, host-scoped RBAC, AAL checks,
   destructive-action guards, and audit logging in front of each operation.
   Agent authentication identifies the machine only; it does not authorize a
   user action.
5. Generalize provider lifecycle, snapshots, polling, health, and resource
   routing by host ID. A disconnected/revoked remote host is unavailable; a
   request must never fall back to the local Docker engine.
6. Treat an agent with access to `/var/run/docker.sock` as root-equivalent on
  its host. Current Docker image builds embed Linux amd64/arm64 agent binaries.
  The UI checksum is computed from the downloaded bytes and is not an
  independent signature; signed release artifacts remain required.

## Transport and TLS requirements

- Agent connections use TLS and verify the Castor server certificate. Never
  disable certificate verification. Self-signed deployments need explicit CA
  trust or a pinned fingerprint provisioned at enrollment.
- `CASTOR_TLS_MODE=off` must not downgrade agent traffic. The agent endpoint is
  disabled unless a dedicated trusted TLS terminator/transport is configured.
- Agent identity is checked independently of browser WebSocket Origin and
  browser session checks. Do not reuse the user `/api/v1/ws` protocol.
- Restrict tunnel streams to the enrolled agent's local Docker Unix socket;
  bound concurrent streams, message/frame sizes, and idle lifetimes. Cancel all
  streams and close the provider on disconnect or revocation.

## Consequences

- A tunnel reuses the existing Docker SDK functionality, including concrete
  image/network/volume, transfer, event, and exec APIs, instead of defining a
  separate RPC for every Docker operation.
- The tunnel grants broad authority to the enrolled agent. Enrollment,
  host-scoped RBAC and revocation are critical security controls.
- The current cache and several API handlers are local-provider-specific;
  complete support requires host-aware runtime and routing work, not only an
  enrollment endpoint or a UI form.
- Current remote support covers standalone Docker workloads, images, networks,
  volumes, backups, dashboard, and template deploy. Swarm, Kubernetes, Helm,
  and stack management remain local-only; image-update checks are local-only.
- The existing local socket host remains supported and unchanged. Remote agent
  hosts have independent IDs and provider registrations.

## Rollout

Implemented slices: (1) transport/authentication and embedded Linux agent
artifacts, (2) persistent host/enrollment lifecycle and host-keyed
provider/cache, (3) host-aware standalone Docker routes with local-only guards
for unsupported orchestrators, and (4) UI enrollment/download/revocation.
Remaining before advertising remote full management: independently signed
release artifacts, end-user lifecycle documentation, UI behavior tests, and
remote update-check support. Docker image distribution currently offers a
SHA-256 for transfer-error detection only, not independent authenticity.