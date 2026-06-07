//go:build linux

// entrypoint_linux.go — Linux privilege-drop entrypoint (the gosu/su-exec pattern
// in pure Go). See entrypoint.go for the rationale.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

const (
	defaultRunUID = 65532
	defaultRunGID = 65532
)

// envInt reads a small non-negative integer from an env var, or returns def.
func envInt(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return def
}

// dockerSocketPath returns the unix socket path Castor will talk to. It honours
// DOCKER_HOST when it is a unix:// URL; otherwise it falls back to the default.
func dockerSocketPath() string {
	if dh := strings.TrimSpace(os.Getenv("DOCKER_HOST")); strings.HasPrefix(dh, "unix://") {
		return strings.TrimPrefix(dh, "unix://")
	}
	return "/var/run/docker.sock"
}

// runEntrypoint is invoked for `castor entrypoint`.
//   - Not uid 0 → the operator is already controlling the user (e.g. via
//     `--user`); run the server in-process and let `--group-add` be the escape
//     hatch for socket access.
//   - uid 0 → read the mounted docker socket's group, then re-exec ourselves as
//     the unprivileged uid:gid WITH that group as a supplementary group so the
//     non-root server can reach the daemon without `--group-add`.
//
// It never returns: it either exits via the in-process server or via the child's
// exit status.
func runEntrypoint() {
	if os.Geteuid() != 0 {
		runServerInProcess()
		return
	}

	uid := envInt("CASTOR_UID", defaultRunUID)
	gid := envInt("CASTOR_GID", defaultRunGID)

	// Supplementary groups for the dropped process: always include the primary
	// gid, and add the docker socket's group so the non-root server can read it
	// without the operator passing --group-add.
	groups := []uint32{uint32(gid)}
	sockPath := dockerSocketPath()
	if fi, err := os.Stat(sockPath); err == nil {
		if st, ok := fi.Sys().(*syscall.Stat_t); ok {
			sockGID := st.Gid
			if sockGID != uint32(gid) {
				groups = append(groups, sockGID)
				fmt.Fprintf(os.Stderr, "castor: entrypoint: adding docker socket group %d (from %s) so the non-root server can reach the daemon\n", sockGID, sockPath)
			}
		}
	} else {
		fmt.Fprintf(os.Stderr, "castor: entrypoint: %s not present; starting without docker socket group (mount it with -v /var/run/docker.sock:/var/run/docker.sock)\n", sockPath)
	}

	// Re-exec ourselves as the server, now as the unprivileged user. The "serve"
	// sentinel keeps the child from re-entering the entrypoint path.
	cmd := exec.Command("/proc/self/exe", "serve")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Credential: &syscall.Credential{
			Uid:    uint32(uid),
			Gid:    uint32(gid),
			Groups: groups,
		},
	}

	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			os.Exit(ee.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "castor: entrypoint: failed to start server: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}
