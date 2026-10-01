// Castor by IT Leonard
// Package updates detects newer images for running containers WITHOUT pulling:
// it compares the digest recorded locally for a container's image (RepoDigests)
// against the digest the registry currently advertises for the same tag, via
// the registry v2 manifest endpoint (token auth + HEAD, Docker-Content-Digest).
package updates

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/distribution/reference"
)

const (
	// requestTimeout caps one outbound registry request.
	requestTimeout = 15 * time.Second
	// maxConcurrent bounds parallel per-container checks.
	maxConcurrent = 4
	// maxBodyBytes caps token/manifest response bodies.
	maxBodyBytes = 4 << 20
)

// manifestAccept lists the manifest media types we accept, so the registry
// returns the digest of whatever the daemon would pull (image or index).
var manifestAccept = strings.Join([]string{
	"application/vnd.docker.distribution.manifest.v2+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.oci.image.index.v1+json",
}, ", ")

// ErrDigestPinned marks an image reference pinned by digest: it can never
// drift, so there is nothing to check.
var ErrDigestPinned = errors.New("updates: image reference is digest-pinned")

// Ref is a parsed, normalized image reference.
type Ref struct {
	Domain string // registry host, e.g. docker.io, ghcr.io, registry.example.com:5000
	Path   string // repository path, e.g. library/nginx
	Tag    string // tag, defaults to latest
}

// ParseRef normalizes an image reference (defaults: docker.io, library/,
// :latest). Digest-pinned references return ErrDigestPinned.
func ParseRef(image string) (Ref, error) {
	named, err := reference.ParseNormalizedNamed(image)
	if err != nil {
		return Ref{}, fmt.Errorf("updates: parse image ref %q: %w", image, err)
	}
	if _, pinned := named.(reference.Canonical); pinned {
		return Ref{}, ErrDigestPinned
	}
	tag := "latest"
	if t, ok := named.(reference.Tagged); ok {
		tag = t.Tag()
	}
	return Ref{Domain: reference.Domain(named), Path: reference.Path(named), Tag: tag}, nil
}

// Target is one container to check, built by the cache layer from docker
// inspects (container Config.Image + image RepoDigests).
type Target struct {
	ContainerID   string
	ContainerName string
	Image         string   // original image reference from the container config
	RepoDigests   []string // RepoDigests of the image the container runs
}

// UpdateStatus is the result of one container's check.
type UpdateStatus struct {
	ContainerID     string `json:"containerId"`
	ContainerName   string `json:"containerName"`
	Image           string `json:"image"`
	LocalDigest     string `json:"localDigest,omitempty"`
	RemoteDigest    string `json:"remoteDigest,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	CheckedAt       int64  `json:"checkedAt"`
	Error           string `json:"error,omitempty"`
}

// CredentialFunc resolves optional registry credentials for a registry host
// (the normalized image-ref domain). ok=false means anonymous. Implemented by
// the API layer, which owns unsealing of stored registry secrets.
type CredentialFunc func(ctx context.Context, registryHost string) (username, password string, ok bool)

// Checker performs digest comparisons against registry v2 endpoints.
type Checker struct {
	client *http.Client
	creds  CredentialFunc
	scheme string // "https"; package tests override to "http"
}

// NewChecker returns a Checker with the default 15s per-request timeout.
// creds may be nil (anonymous only).
func NewChecker(creds CredentialFunc) *Checker {
	return &Checker{
		client: &http.Client{Timeout: requestTimeout},
		creds:  creds,
		scheme: "https",
	}
}

// Check runs the digest comparison for every target with bounded concurrency,
// respecting ctx. Digest-pinned and local-only (no RepoDigest) images are
// skipped. Results are sorted by container name.
func (c *Checker) Check(ctx context.Context, targets []Target) []UpdateStatus {
	out := make([]UpdateStatus, 0, len(targets))
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		sem = make(chan struct{}, maxConcurrent)
	)
	for i := range targets {
		if ctx.Err() != nil {
			break
		}
		t := targets[i]
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			st, checked := c.checkOne(ctx, t)
			if !checked {
				return
			}
			mu.Lock()
			out = append(out, st)
			mu.Unlock()
		}()
	}
	wg.Wait()
	sort.Slice(out, func(i, j int) bool { return out[i].ContainerName < out[j].ContainerName })
	return out
}

// checkOne compares one container's local digest to the registry. The second
// return is false when the target is skipped (pinned or never-pushed image).
func (c *Checker) checkOne(ctx context.Context, t Target) (UpdateStatus, bool) {
	st := UpdateStatus{
		ContainerID:   t.ContainerID,
		ContainerName: t.ContainerName,
		Image:         t.Image,
		CheckedAt:     time.Now().Unix(),
	}
	ref, err := ParseRef(t.Image)
	if err != nil {
		if errors.Is(err, ErrDigestPinned) {
			return UpdateStatus{}, false
		}
		st.Error = err.Error()
		return st, true
	}
	local := localDigest(ref, t.RepoDigests)
	if local == "" {
		// No RepoDigest for this repository: locally built / never pushed.
		return UpdateStatus{}, false
	}
	st.LocalDigest = local
	remote, err := c.RemoteDigest(ctx, ref)
	if err != nil {
		st.Error = err.Error()
		return st, true
	}
	st.RemoteDigest = remote
	st.UpdateAvailable = remote != "" && remote != local
	return st, true
}

// localDigest picks the RepoDigest matching the ref's registry/repository.
func localDigest(ref Ref, repoDigests []string) string {
	for _, rd := range repoDigests {
		named, err := reference.ParseNormalizedNamed(rd)
		if err != nil {
			continue
		}
		canon, ok := named.(reference.Canonical)
		if !ok {
			continue
		}
		if reference.Domain(named) == ref.Domain && reference.Path(named) == ref.Path {
			return canon.Digest().String()
		}
	}
	return ""
}

// registryHost maps the normalized docker.io domain to the real API host.
func registryHost(domain string) string {
	if domain == "docker.io" {
		return "registry-1.docker.io"
	}
	return domain
}

// RemoteDigest resolves the digest the registry currently serves for ref's
// tag. Flow: HEAD the manifest (anonymous, or Basic when credentials exist for
// the host); on a 401 Bearer challenge fetch a pull token from the advertised
// realm (auth.docker.io / ghcr.io/token / generic) and retry with it.
func (c *Checker) RemoteDigest(ctx context.Context, ref Ref) (string, error) {
	manifestURL := c.scheme + "://" + registryHost(ref.Domain) + "/v2/" + ref.Path + "/manifests/" + ref.Tag

	var user, pass string
	haveCreds := false
	if c.creds != nil {
		user, pass, haveCreds = c.creds(ctx, ref.Domain)
	}
	basic := func(req *http.Request) {
		if haveCreds {
			req.SetBasicAuth(user, pass)
		}
	}

	digest, challenge, err := c.manifestDigest(ctx, manifestURL, basic)
	if err != nil {
		return "", err
	}
	if digest != "" {
		return digest, nil
	}

	// 401 with a Bearer challenge: obtain a pull token and retry once.
	token, err := c.fetchToken(ctx, challenge, ref, user, pass, haveCreds)
	if err != nil {
		return "", err
	}
	digest, _, err = c.manifestDigest(ctx, manifestURL, func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+token)
	})
	if err != nil {
		return "", err
	}
	if digest == "" {
		return "", errors.New("updates: registry rejected the pull token")
	}
	return digest, nil
}

// bearerChallenge is a parsed WWW-Authenticate: Bearer header.
type bearerChallenge struct {
	realm, service, scope string
}

// manifestDigest HEADs the manifest URL and returns the Docker-Content-Digest.
// On 401 it returns the parsed Bearer challenge instead (digest empty, nil
// error). Registries that omit the digest header on HEAD are retried with GET;
// as a last resort the digest is computed as the sha256 of the manifest body
// (its definition).
func (c *Checker) manifestDigest(ctx context.Context, manifestURL string, auth func(*http.Request)) (string, *bearerChallenge, error) {
	do := func(method string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, method, manifestURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", manifestAccept)
		if auth != nil {
			auth(req)
		}
		return c.client.Do(req)
	}

	resp, err := do(http.MethodHead)
	if err != nil {
		return "", nil, err
	}
	drainClose(resp)
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		ch := parseBearerChallenge(resp.Header.Get("WWW-Authenticate"))
		if ch == nil {
			return "", nil, errors.New("updates: registry returned 401 without a bearer challenge")
		}
		return "", ch, nil
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		return "", nil, fmt.Errorf("updates: registry returned HTTP %d for manifest", resp.StatusCode)
	}
	if d := resp.Header.Get("Docker-Content-Digest"); d != "" {
		return d, nil, nil
	}

	resp2, err := do(http.MethodGet)
	if err != nil {
		return "", nil, err
	}
	defer drainClose(resp2)
	if resp2.StatusCode < 200 || resp2.StatusCode >= 300 {
		return "", nil, fmt.Errorf("updates: registry returned HTTP %d for manifest", resp2.StatusCode)
	}
	if d := resp2.Header.Get("Docker-Content-Digest"); d != "" {
		return d, nil, nil
	}
	h := sha256.New()
	// Read one byte past the cap to detect overflow: hashing a silently
	// truncated manifest yields a digest that never matches the local one,
	// i.e. a permanent phantom "update available".
	n, err := io.Copy(h, io.LimitReader(resp2.Body, maxBodyBytes+1))
	if err != nil {
		return "", nil, fmt.Errorf("updates: read manifest body: %w", err)
	}
	if n > maxBodyBytes {
		return "", nil, errors.New("updates: manifest too large for digest fallback")
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil, nil
}

// fetchToken GETs a pull token from the challenge realm (with Basic auth when
// credentials exist), defaulting scope to repository:<path>:pull.
func (c *Checker) fetchToken(ctx context.Context, ch *bearerChallenge, ref Ref, user, pass string, haveCreds bool) (string, error) {
	if ch == nil || ch.realm == "" {
		return "", errors.New("updates: registry bearer challenge has no realm")
	}
	u, err := url.Parse(ch.realm)
	if err != nil {
		return "", fmt.Errorf("updates: bearer realm: %w", err)
	}
	q := u.Query()
	if ch.service != "" {
		q.Set("service", ch.service)
	}
	scope := ch.scope
	if scope == "" {
		scope = "repository:" + ref.Path + ":pull"
	}
	q.Set("scope", scope)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	if haveCreds {
		req.SetBasicAuth(user, pass)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer drainClose(resp)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("updates: token endpoint returned HTTP %d", resp.StatusCode)
	}
	var tr struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&tr); err != nil {
		return "", fmt.Errorf("updates: decode token response: %w", err)
	}
	token := tr.Token
	if token == "" {
		token = tr.AccessToken
	}
	if token == "" {
		return "", errors.New("updates: token endpoint returned no token")
	}
	return token, nil
}

// parseBearerChallenge parses `Bearer realm="...",service="...",scope="..."`.
// Returns nil when the header is absent or not a Bearer challenge.
func parseBearerChallenge(h string) *bearerChallenge {
	const prefix = "bearer "
	if len(h) < len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return nil
	}
	ch := &bearerChallenge{}
	for _, part := range strings.Split(h[len(prefix):], ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		val := strings.Trim(kv[1], `"`)
		switch strings.ToLower(kv[0]) {
		case "realm":
			ch.realm = val
		case "service":
			ch.service = val
		case "scope":
			ch.scope = val
		}
	}
	return ch
}

// drainClose drains a bounded amount of the body (connection reuse) and closes.
func drainClose(resp *http.Response) {
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	_ = resp.Body.Close()
}
