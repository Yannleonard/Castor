// Castor by IT Leonard
package docker

import (
	"testing"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
)

// TestPreserveAnonymousVolumes proves that a recreate re-attaches every volume
// of the old container that Config/HostConfig alone would NOT re-attach — the
// anonymous ones — while leaving bind mounts and already-declared volumes to
// the copied HostConfig.
func TestPreserveAnonymousVolumes(t *testing.T) {
	anonName := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	hc := &container.HostConfig{
		Binds: []string{
			"/host/conf:/etc/app:ro", // host bind
			"named-vol:/var/lib/data",
		},
		Mounts: []mount.Mount{
			{Type: mount.TypeVolume, Source: "mnt-vol", Target: "/cache"},
		},
	}
	mounts := []container.MountPoint{
		{Type: mount.TypeBind, Source: "/host/conf", Destination: "/etc/app", RW: false},
		{Type: mount.TypeVolume, Name: "named-vol", Destination: "/var/lib/data", RW: true},
		{Type: mount.TypeVolume, Name: "mnt-vol", Destination: "/cache", RW: true},
		// The anonymous volume: only visible here, nowhere in HostConfig.
		{Type: mount.TypeVolume, Name: anonName, Destination: "/var/lib/postgresql/data", RW: true},
		// A read-only anonymous volume must keep its read-only flag.
		{Type: mount.TypeVolume, Name: "roanon", Destination: "/seed", RW: false},
		// tmpfs mounts are recreated by HostConfig.Tmpfs, never mapped here.
		{Type: mount.TypeTmpfs, Destination: "/tmp"},
	}

	got := preserveAnonymousVolumes(hc, mounts)
	if len(got) != 2 {
		t.Fatalf("preserveAnonymousVolumes returned %d mounts want 2: %+v", len(got), got)
	}
	if got[0].Type != mount.TypeVolume || got[0].Source != anonName ||
		got[0].Target != "/var/lib/postgresql/data" || got[0].ReadOnly {
		t.Errorf("anonymous volume mapped wrong: %+v", got[0])
	}
	if got[1].Source != "roanon" || got[1].Target != "/seed" || !got[1].ReadOnly {
		t.Errorf("read-only anonymous volume mapped wrong: %+v", got[1])
	}
}

// TestPreserveAnonymousVolumesNilHostConfig covers the defensive nil path: the
// anonymous volume must still be mapped.
func TestPreserveAnonymousVolumesNilHostConfig(t *testing.T) {
	got := preserveAnonymousVolumes(nil, []container.MountPoint{
		{Type: mount.TypeVolume, Name: "anon", Destination: "/data", RW: true},
	})
	if len(got) != 1 || got[0].Source != "anon" || got[0].Target != "/data" {
		t.Fatalf("nil HostConfig: got %+v want the anonymous volume mapped", got)
	}
}

// TestBindDestination pins the container-side path extraction from Binds
// entries, including the Windows drive-letter colon ambiguity.
func TestBindDestination(t *testing.T) {
	cases := []struct{ in, want string }{
		{"named-vol:/data", "/data"},
		{"/host/path:/data:ro", "/data"},
		{"/data", ""}, // destination-only spec: nothing to cover
		{`C:\src:D:\dst`, `D:\dst`},
		{`C:\src:D:\dst:ro`, `D:\dst`},
		{"", ""},
	}
	for _, c := range cases {
		if got := bindDestination(c.in); got != c.want {
			t.Errorf("bindDestination(%q) = %q want %q", c.in, got, c.want)
		}
	}
}
