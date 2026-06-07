// entrypoint.go — the container entrypoint that makes Castor "just work" when the
// Docker socket is mounted, WITHOUT requiring the operator to pass
// `--group-add <docker-gid>`, while still running the server as a NON-ROOT user.
//
// Why this exists
// ---------------
// The final image is distroless (no shell), and the server process runs as the
// unprivileged uid 65532. The mounted /var/run/docker.sock is typically owned by
// root:docker with mode 0660, so a bare non-root process cannot read it and the
// UI shows the host as "Down · degraded". The conventional fix is `gosu`/`su-exec`:
// start as root, learn the socket's group, then drop to the unprivileged uid WITH
// that group as a supplementary group, and exec the real program. We implement
// that pattern in pure Go so it works in a shell-less distroless image.
//
// The privilege-dropping logic is Linux-only (syscall.Credential + Stat_t); see
// entrypoint_linux.go. On every other OS, entrypoint_other.go simply runs the
// server in-process (these builds are for local dev/tests, never the container).
package main

import (
	"fmt"
	"os"
)

// runServerInProcess runs the HTTP server in the current process, exiting with a
// faithful status code. Shared by the non-root path of the Linux entrypoint and
// by the non-Linux fallback.
func runServerInProcess() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "castor: fatal: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}
