// ui/src/lib/mounts.ts
//
// Client-side mirror of the server host-mount policy (server/internal/provider/
// docker/mounts.go). This is a UX affordance only — it lets the deploy / compose
// UI warn before submit and surface the admin-only "allow host mount" opt-in. The
// backend re-checks every mount and is the single source of truth; the UI never
// relies on this for security.

// isHostBindSource reports whether a mount source is a host filesystem path (a
// bind mount) rather than a named/anonymous volume. Mirrors docker.isHostPath: a
// leading "/" or "\" is a unix/UNC path; "C:\" / "C:/" is a Windows drive path.
// An empty source is an anonymous volume (not a bind).
export function isHostBindSource(source: string): boolean {
  const s = source.trim();
  if (s === "") return false;
  if (s[0] === "/" || s[0] === "\\") return true;
  if (s.length >= 3 && /[a-zA-Z]/.test(s[0]!) && s[1] === ":" && (s[2] === "\\" || s[2] === "/")) {
    return true;
  }
  return false;
}

// Always-blocked host bind sources — denied for EVERYONE through the API
// (including admins), because mounting them is a direct host takeover. Mirrors
// docker.alwaysBlockedHostPaths.
const ALWAYS_BLOCKED = [
  "/var/run/docker.sock",
  "/run/docker.sock",
  "/",
  "/etc",
  "/root",
  "/home",
  "/boot",
  "/var/lib/docker",
  "/var/run",
  "/run",
  "/proc",
  "/sys",
  "/dev",
];

function normalizeHostPath(source: string): string {
  let s = source.trim().toLowerCase().replace(/\\/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s === "" ? "/" : s;
}

// isAlwaysBlockedHostPath reports whether a host bind source is one of the
// always-blocked host-takeover paths (or nested under one). Mirrors
// docker.isAlwaysBlockedHostPath.
export function isAlwaysBlockedHostPath(source: string): boolean {
  const n = normalizeHostPath(source);
  for (const blocked of ALWAYS_BLOCKED) {
    if (blocked === "/") {
      if (n === "/") return true;
      continue;
    }
    if (n === blocked || n.startsWith(blocked + "/")) return true;
  }
  return false;
}
