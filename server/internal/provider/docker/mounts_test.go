package docker

import (
	"context"
	"errors"
	"testing"

	"github.com/gtek-it/castor/server/internal/provider"
)

// TestValidateMountsNamedVolumesAlwaysAllowed: named + anonymous volumes pass
// regardless of the admin flag (they cannot reach the host filesystem).
func TestValidateMountsNamedVolumesAlwaysAllowed(t *testing.T) {
	vols := []VolMount{
		{Source: "pgdata", Target: "/var/lib/postgresql/data"},
		{Source: "cache", Target: "/cache"},
		{Source: "", Target: "/anon"}, // anonymous volume
	}
	if err := ValidateMounts(vols, false); err != nil {
		t.Fatalf("named/anonymous volumes must be allowed for non-admins, got %v", err)
	}
	if err := ValidateMounts(vols, true); err != nil {
		t.Fatalf("named/anonymous volumes must be allowed for admins, got %v", err)
	}
}

// TestValidateMountsRejectsHostBindByDefault: an ordinary host bind is denied
// when allowHostMounts is false, and the error maps to 403 (ErrForbidden).
func TestValidateMountsRejectsHostBindByDefault(t *testing.T) {
	vols := []VolMount{{Source: "/srv/app/data", Target: "/data"}}
	err := ValidateMounts(vols, false)
	if err == nil {
		t.Fatal("host bind mount must be rejected by default")
	}
	if !errors.Is(err, provider.ErrHostMountDenied) {
		t.Errorf("error must wrap ErrHostMountDenied, got %v", err)
	}
	if !errors.Is(err, provider.ErrForbidden) {
		t.Errorf("error must wrap ErrForbidden (maps to 403), got %v", err)
	}
}

// TestValidateMountsAdminBypassOrdinaryBind: with the admin flag, an ordinary
// host bind (not an always-blocked path) is permitted.
func TestValidateMountsAdminBypassOrdinaryBind(t *testing.T) {
	vols := []VolMount{{Source: "/srv/app/data", Target: "/data"}}
	if err := ValidateMounts(vols, true); err != nil {
		t.Fatalf("admin must be able to mount an ordinary host path, got %v", err)
	}
}

// TestValidateMountsAlwaysBlockedDeniedEvenForAdmin: the docker socket, /, /etc,
// and friends are denied even with the admin flag set.
func TestValidateMountsAlwaysBlockedDeniedEvenForAdmin(t *testing.T) {
	blocked := []string{
		"/var/run/docker.sock",
		"/run/docker.sock",
		"/",
		"/etc",
		"/etc/shadow",            // nested under /etc
		"/root",
		"/root/.ssh",             // nested under /root
		"/var/lib/docker",
		"/var/lib/docker/volumes", // nested
		"/proc",
		"/sys",
		"/dev",
		"/dev/sda",               // host device
		"/home",
	}
	for _, src := range blocked {
		vols := []VolMount{{Source: src, Target: "/x"}}
		// Even an admin (allowHostMounts=true) must be denied these.
		err := ValidateMounts(vols, true)
		if err == nil {
			t.Errorf("always-blocked host path %q must be denied even for admins", src)
			continue
		}
		if !errors.Is(err, provider.ErrForbidden) {
			t.Errorf("%q: error must wrap ErrForbidden, got %v", src, err)
		}
	}
}

// TestValidateMountsDockerSockTrailingSlash: normalization catches a trailing
// slash and case variations.
func TestValidateMountsDockerSockVariants(t *testing.T) {
	for _, src := range []string{"/etc/", "/ETC", "/var/lib/docker/"} {
		if err := ValidateMounts([]VolMount{{Source: src, Target: "/x"}}, true); err == nil {
			t.Errorf("normalized always-blocked path %q must be denied", src)
		}
	}
}

// TestIsHostPath classifies host paths vs named volumes (incl. Windows forms).
func TestIsHostPath(t *testing.T) {
	host := []string{"/", "/srv/data", "/var/run/docker.sock", `C:\data`, "C:/data", `\\server\share`}
	for _, s := range host {
		if !isHostPath(s) {
			t.Errorf("isHostPath(%q) = false, want true", s)
		}
	}
	notHost := []string{"", "pgdata", "my-volume", "cache_1"}
	for _, s := range notHost {
		if isHostPath(s) {
			t.Errorf("isHostPath(%q) = true, want false (named/anon volume)", s)
		}
	}
}

// TestHostMountSources returns only the host binds (for audit detail).
func TestHostMountSources(t *testing.T) {
	vols := []VolMount{
		{Source: "named", Target: "/a"},
		{Source: "/host/path", Target: "/b"},
		{Source: "", Target: "/c"},
		{Source: "/var/run/docker.sock", Target: "/d"},
	}
	got := HostMountSources(vols)
	if len(got) != 2 || got[0] != "/host/path" || got[1] != "/var/run/docker.sock" {
		t.Errorf("HostMountSources = %#v, want [/host/path /var/run/docker.sock]", got)
	}
}

// TestContainerCreateAndStartRejectsHostMount: the provider entrypoint refuses a
// forbidden host bind BEFORE touching the daemon (no image pull, no create) —
// proving the defense-in-depth guard. A nil docker client would panic if the
// guard let execution proceed to ensureImage.
func TestContainerCreateAndStartRejectsHostMount(t *testing.T) {
	p := &DockerProvider{} // no client wired; guard must short-circuit first
	spec := DeploySpec{
		Image:   "nginx:latest",
		Name:    "evil",
		Volumes: []VolMount{{Source: "/var/run/docker.sock", Target: "/var/run/docker.sock"}},
		// AllowHostMounts left false (non-admin path).
	}
	_, err := p.ContainerCreateAndStart(context.Background(), spec)
	if err == nil {
		t.Fatal("ContainerCreateAndStart must reject a forbidden host bind")
	}
	if !errors.Is(err, provider.ErrForbidden) {
		t.Errorf("error must wrap ErrForbidden, got %v", err)
	}
}
