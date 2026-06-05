package docker

import (
	"fmt"
	"strings"

	"github.com/gtek-it/castor/server/internal/provider"
)

// --- host-mount escalation guard (P0 security) ---
//
// Access to the host filesystem through a bind mount is root-equivalent: a
// container that binds /var/run/docker.sock can drive the daemon, and one that
// binds / (or /etc, /root, ...) can read or overwrite host secrets and escape to
// root. The Castor UI must therefore NOT let a non-admin create a container with
// a host bind mount. Named volumes are safe (they are managed by the daemon and
// cannot reach the host filesystem) and are always allowed.
//
// Policy (enforced server-side, before ContainerCreate):
//   - A mount whose Source is a host path (absolute unix path, or a Windows host
//     path like C:\ or \\unc) is a BIND mount.
//   - By default every bind mount is REJECTED (ErrHostMountDenied / 403).
//   - A set of host paths is ALWAYS hard-rejected regardless of any flag —
//     docker.sock, /, /etc, /root, /var/lib/docker, /proc, /sys, and host device
//     paths (/dev). These are never legitimate one-click/compose mounts.
//   - A user with global superuser may set AllowHostMounts to permit *ordinary*
//     host binds (not the always-blocked set, which stays denied for everyone via
//     the API to keep the foot-gun off the UI).
//   - Named volumes and anonymous volumes are always allowed.

// alwaysBlockedHostPaths are host bind sources that are denied for EVERYONE
// through the API (including admins) because mounting them is a direct host
// takeover and is never a legitimate managed-container mount. Compared after
// normalization (lowercased on the slash-separated form). A path matches when it
// equals the entry or is nested under it (entry + "/").
var alwaysBlockedHostPaths = []string{
	"/var/run/docker.sock",
	"/run/docker.sock",
	"/", // the entire host root
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
}

// isHostPath reports whether a mount Source refers to a host filesystem path
// (i.e. a bind mount) rather than a named/anonymous volume. A leading '/' is the
// unix bind form used throughout Castor; we also treat Windows host paths
// (drive-letter "C:\..." / "C:/..." and UNC "\\server\share") as binds so the
// guard is correct if Castor ever drives a Windows daemon. An empty Source is an
// anonymous volume (not a bind).
func isHostPath(source string) bool {
	s := strings.TrimSpace(source)
	if s == "" {
		return false
	}
	if s[0] == '/' || s[0] == '\\' {
		return true // unix absolute path or UNC/back-slash path
	}
	// Windows drive-letter path: "C:\data" or "C:/data".
	if len(s) >= 3 && isDriveLetter(s[0]) && s[1] == ':' && (s[2] == '\\' || s[2] == '/') {
		return true
	}
	return false
}

func isDriveLetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// normalizeHostPath lowercases and converts a host source to a forward-slash
// form with any trailing slash trimmed, so the always-blocked comparison is
// stable across "/etc", "/etc/", and "\etc" inputs.
func normalizeHostPath(source string) string {
	s := strings.ToLower(strings.TrimSpace(source))
	s = strings.ReplaceAll(s, "\\", "/")
	if len(s) > 1 {
		s = strings.TrimRight(s, "/")
	}
	if s == "" {
		return "/"
	}
	return s
}

// isAlwaysBlockedHostPath reports whether a (normalized) host bind source is one
// of the always-blocked host takeover paths (or nested under one). The host root
// "/" matches itself only (every absolute path is "under" / but we only block a
// literal root mount here; deeper paths like /var/lib/docker are listed
// explicitly).
func isAlwaysBlockedHostPath(source string) bool {
	n := normalizeHostPath(source)
	for _, blocked := range alwaysBlockedHostPaths {
		if blocked == "/" {
			if n == "/" {
				return true
			}
			continue
		}
		if n == blocked || strings.HasPrefix(n, blocked+"/") {
			return true
		}
	}
	return false
}

// ValidateMounts enforces the host-mount policy over a spec's volumes. It returns
// nil when every mount is permitted, or an error wrapping provider.ErrForbidden
// (mapped to 403) naming the offending host path(s). allowHostMounts only relaxes
// *ordinary* host binds; the always-blocked set (docker.sock, /, /etc, ...) is
// denied regardless. Named/anonymous volumes always pass.
//
// This is the single source of truth for the policy; both the API handlers
// (which set allowHostMounts based on the actor) and the provider's
// ContainerCreateAndStart (defense-in-depth) call it.
func ValidateMounts(vols []VolMount, allowHostMounts bool) error {
	for _, v := range vols {
		if !isHostPath(v.Source) {
			continue // named or anonymous volume
		}
		if isAlwaysBlockedHostPath(v.Source) {
			return fmt.Errorf("%w (%q is a protected host path and can never be mounted)",
				provider.ErrHostMountDenied, v.Source)
		}
		if !allowHostMounts {
			return fmt.Errorf("%w (%q is a host path; only an administrator may mount host paths, and never as a one-click/compose deploy)",
				provider.ErrHostMountDenied, v.Source)
		}
	}
	return nil
}

// HostMountSources returns the host bind sources requested by a spec's volumes
// (empty when there are none). Handlers use it to populate the audit detail on a
// denied request without re-implementing the classification.
func HostMountSources(vols []VolMount) []string {
	var out []string
	for _, v := range vols {
		if isHostPath(v.Source) {
			out = append(out, v.Source)
		}
	}
	return out
}
