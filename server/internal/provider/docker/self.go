package docker

import (
	"bufio"
	"context"
	"os"
	"regexp"
)

// cgroupContainerID matches a 64-hex container id within a cgroup path line.
var cgroupContainerID = regexp.MustCompile(`[0-9a-f]{64}`)

// ResolveSelfContainerID determines Castor's own container id for the
// self-protection guard. Resolution order:
//
//  1. explicit env CASTOR_SELF_CONTAINER_ID (passed by config);
//  2. /proc/self/cgroup or /proc/self/mountinfo (64-hex id);
//  3. the container hostname cross-checked against a Docker inspect.
//
// It returns the id and whether identity was positively determined. When false,
// the guard default-denies destructive container actions (anti-foot-gun).
func ResolveSelfContainerID(ctx context.Context, cli interface {
	ContainerInspectID(ctx context.Context, idOrName string) (string, bool)
}, explicit string) (string, bool) {
	if explicit != "" {
		// Resolve the explicit value to a full container id. Operators naturally
		// set CASTOR_SELF_CONTAINER_ID to the container NAME (e.g. the compose
		// `container_name: castor`), but the guard compares full ids from cache
		// snapshots — so a bare name would silently defeat self-protection. Inspect
		// it against Docker to get the canonical 64-hex id. If it is already a full
		// id this is a cheap round-trip; if inspect fails (non-Docker host or the
		// name is wrong) fall back to using the value verbatim so an explicit
		// setting is never weaker than no setting.
		if id, ok := cli.ContainerInspectID(ctx, explicit); ok {
			return id, true
		}
		return explicit, true
	}
	if id := idFromCgroup(); id != "" {
		return id, true
	}
	// Fall back to hostname (Docker sets the container short id as hostname by
	// default) cross-checked against an inspect to confirm it is a real container.
	if host, err := os.Hostname(); err == nil && host != "" {
		if id, ok := cli.ContainerInspectID(ctx, host); ok {
			return id, true
		}
	}
	return "", false
}

// idFromCgroup scans /proc/self/cgroup and /proc/self/mountinfo for a 64-hex
// container id.
func idFromCgroup() string {
	for _, path := range []string{"/proc/self/cgroup", "/proc/self/mountinfo"} {
		if id := scanForContainerID(path); id != "" {
			return id
		}
	}
	return ""
}

func scanForContainerID(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = f.Close() }()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if m := cgroupContainerID.FindString(line); m != "" {
			return m
		}
	}
	return ""
}

// ContainerInspectID resolves a container name/id to its full id, reporting
// whether it exists. It satisfies the small interface ResolveSelfContainerID
// needs, keeping that function unit-testable without the full client.
func (p *DockerProvider) ContainerInspectID(ctx context.Context, idOrName string) (string, bool) {
	cj, err := p.cli.ContainerInspect(ctx, idOrName)
	if err != nil {
		return "", false
	}
	return cj.ID, true
}
