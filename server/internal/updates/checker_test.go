package updates

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseRef(t *testing.T) {
	cases := []struct {
		in                string
		domain, path, tag string
	}{
		{"docker.io/library/nginx:latest", "docker.io", "library/nginx", "latest"},
		{"nginx", "docker.io", "library/nginx", "latest"},
		{"nginx:1.27", "docker.io", "library/nginx", "1.27"},
		{"grafana/grafana", "docker.io", "grafana/grafana", "latest"},
		{"ghcr.io/owner/app:v1", "ghcr.io", "owner/app", "v1"},
		{"registry.example.com:5000/x/y", "registry.example.com:5000", "x/y", "latest"},
	}
	for _, c := range cases {
		got, err := ParseRef(c.in)
		if err != nil {
			t.Errorf("ParseRef(%q) error: %v", c.in, err)
			continue
		}
		if got.Domain != c.domain || got.Path != c.path || got.Tag != c.tag {
			t.Errorf("ParseRef(%q) = %+v want {%s %s %s}", c.in, got, c.domain, c.path, c.tag)
		}
	}
}

func TestParseRefDigestPinnedAndInvalid(t *testing.T) {
	if _, err := ParseRef("nginx@sha256:" + strings.Repeat("a", 64)); !errors.Is(err, ErrDigestPinned) {
		t.Errorf("digest-pinned ref: err = %v want ErrDigestPinned", err)
	}
	if _, err := ParseRef("UPPER CASE not a ref"); err == nil {
		t.Errorf("invalid ref: expected an error")
	}
}

func TestLocalDigestMatchesRepo(t *testing.T) {
	ref := Ref{Domain: "docker.io", Path: "library/nginx", Tag: "latest"}
	dgst := "sha256:" + strings.Repeat("b", 64)
	got := localDigest(ref, []string{
		"ghcr.io/other/app@sha256:" + strings.Repeat("c", 64), // wrong repo
		"nginx@" + dgst, // familiar Hub form must normalize + match
	})
	if got != dgst {
		t.Errorf("localDigest = %q want %q", got, dgst)
	}
	if got := localDigest(ref, nil); got != "" {
		t.Errorf("localDigest with no RepoDigests = %q want empty", got)
	}
}

func TestParseBearerChallenge(t *testing.T) {
	ch := parseBearerChallenge(`Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"`)
	if ch == nil {
		t.Fatal("challenge not parsed")
	}
	if ch.realm != "https://auth.docker.io/token" || ch.service != "registry.docker.io" ||
		ch.scope != "repository:library/nginx:pull" {
		t.Errorf("challenge = %+v", *ch)
	}
	if parseBearerChallenge(`Basic realm="x"`) != nil {
		t.Errorf("Basic challenge must not parse as Bearer")
	}
}

// newFakeRegistry simulates a registry v2 with token auth: the manifest
// endpoint returns 401 + a Bearer challenge until the token from /token is
// presented, then answers with Docker-Content-Digest. It records whether the
// token endpoint saw Basic credentials.
func newFakeRegistry(t *testing.T, repo, tag, digest string) (srv *httptest.Server, sawBasic *bool) {
	t.Helper()
	sawBasic = new(bool)
	const token = "test-pull-token"
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("scope") != "repository:"+repo+":pull" {
			t.Errorf("token scope = %q", r.URL.Query().Get("scope"))
		}
		if _, _, ok := r.BasicAuth(); ok {
			*sawBasic = true
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
	})
	mux.HandleFunc("/v2/"+repo+"/manifests/"+tag, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept"), "application/vnd.oci.image.index.v1+json") {
			t.Errorf("manifest Accept header missing OCI index type: %q", r.Header.Get("Accept"))
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.Header().Set("WWW-Authenticate",
				`Bearer realm="`+srv.URL+`/token",service="test-registry"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Docker-Content-Digest", digest)
		w.WriteHeader(http.StatusOK)
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, sawBasic
}

func TestCheckAgainstFakeRegistryV2(t *testing.T) {
	localDgst := "sha256:" + strings.Repeat("1", 64)
	remoteDgst := "sha256:" + strings.Repeat("2", 64)
	srv, _ := newFakeRegistry(t, "owner/app", "v1", remoteDgst)
	host := strings.TrimPrefix(srv.URL, "http://")

	c := NewChecker(nil)
	c.scheme = "http" // httptest registries are plain HTTP

	got := c.Check(context.Background(), []Target{
		{
			ContainerID:   "c1",
			ContainerName: "app",
			Image:         host + "/owner/app:v1",
			RepoDigests:   []string{host + "/owner/app@" + localDgst},
		},
		// Local-only image (no RepoDigests): must be skipped, not errored.
		{ContainerID: "c2", ContainerName: "local", Image: host + "/owner/local:dev"},
	})
	if len(got) != 1 {
		t.Fatalf("Check returned %d statuses want 1 (local-only skipped): %+v", len(got), got)
	}
	st := got[0]
	if st.ContainerID != "c1" || st.LocalDigest != localDgst || st.RemoteDigest != remoteDgst {
		t.Errorf("status = %+v", st)
	}
	if !st.UpdateAvailable {
		t.Errorf("UpdateAvailable = false want true (digests differ)")
	}
	if st.Error != "" {
		t.Errorf("Error = %q want empty", st.Error)
	}
	if st.CheckedAt == 0 {
		t.Errorf("CheckedAt not set")
	}
}

func TestCheckUpToDateAndCredentials(t *testing.T) {
	dgst := "sha256:" + strings.Repeat("3", 64)
	srv, sawBasic := newFakeRegistry(t, "owner/app", "v2", dgst)
	host := strings.TrimPrefix(srv.URL, "http://")

	c := NewChecker(func(_ context.Context, registryHost string) (string, string, bool) {
		if registryHost != host {
			t.Errorf("creds asked for host %q want %q", registryHost, host)
		}
		return "user", "pass", true
	})
	c.scheme = "http"

	got := c.Check(context.Background(), []Target{{
		ContainerID:   "c1",
		ContainerName: "app",
		Image:         host + "/owner/app:v2",
		RepoDigests:   []string{host + "/owner/app@" + dgst},
	}})
	if len(got) != 1 {
		t.Fatalf("Check returned %d statuses want 1", len(got))
	}
	if got[0].UpdateAvailable {
		t.Errorf("UpdateAvailable = true want false (same digest)")
	}
	if got[0].Error != "" {
		t.Errorf("Error = %q want empty", got[0].Error)
	}
	if !*sawBasic {
		t.Errorf("token endpoint never saw the Basic credentials")
	}
}

// newNoDigestRegistry simulates a registry that never sends the
// Docker-Content-Digest header, forcing the sha256-of-body fallback.
func newNoDigestRegistry(t *testing.T, body []byte) (host string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write(body)
		}
	}))
	t.Cleanup(srv.Close)
	return strings.TrimPrefix(srv.URL, "http://")
}

// TestRemoteDigestBodyFallback proves the digest fallback hashes the FULL
// manifest body when the registry omits Docker-Content-Digest.
func TestRemoteDigestBodyFallback(t *testing.T) {
	body := []byte(`{"schemaVersion":2}`)
	sum := sha256.Sum256(body)
	want := "sha256:" + hex.EncodeToString(sum[:])
	host := newNoDigestRegistry(t, body)

	c := NewChecker(nil)
	c.scheme = "http"
	got, err := c.RemoteDigest(context.Background(), Ref{Domain: host, Path: "x/y", Tag: "latest"})
	if err != nil {
		t.Fatalf("RemoteDigest: %v", err)
	}
	if got != want {
		t.Errorf("fallback digest = %q want %q", got, want)
	}
}

// TestRemoteDigestBodyFallbackTooLarge proves an over-cap manifest is refused
// instead of hashed truncated: a truncated hash would never match the local
// digest and would report a phantom update forever.
func TestRemoteDigestBodyFallbackTooLarge(t *testing.T) {
	host := newNoDigestRegistry(t, bytes.Repeat([]byte("a"), maxBodyBytes+1))

	c := NewChecker(nil)
	c.scheme = "http"
	_, err := c.RemoteDigest(context.Background(), Ref{Domain: host, Path: "x/y", Tag: "latest"})
	if err == nil || !strings.Contains(err.Error(), "manifest too large") {
		t.Fatalf("RemoteDigest = %v want a 'manifest too large' error", err)
	}
}

func TestRemoteDigestRegistryError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	host := strings.TrimPrefix(srv.URL, "http://")

	c := NewChecker(nil)
	c.scheme = "http"
	if _, err := c.RemoteDigest(context.Background(), Ref{Domain: host, Path: "x/y", Tag: "latest"}); err == nil {
		t.Fatal("expected an error from a 500 registry")
	}
}
