// Package config loads and validates Castor runtime configuration from the
// environment. See ADR-CASTOR-001 (intervals) and ADR-CASTOR-003 (stack/auth).
package config

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime configuration, loaded from the environment.
type Config struct {
	// HTTPAddr is the listen address for the API + embedded UI. Default ":8080".
	HTTPAddr string

	// SecretKey is the 32-byte AES-256-GCM key used to seal TOTP secrets and
	// other secrets at rest. REQUIRED; the server refuses to start without it.
	SecretKey []byte

	// DockerHost optionally overrides DOCKER_HOST (e.g. a socket proxy). Empty
	// means the Docker SDK uses its FromEnv default (unix:///var/run/docker.sock).
	DockerHost string

	// TrustProxy, when true, honors X-Forwarded-Proto / X-Forwarded-For from a
	// trusted upstream reverse proxy.
	TrustProxy bool

	// BootstrapToken, when set, gates the one-shot bootstrap endpoint.
	BootstrapToken string

	// PublicURL is the externally-reachable base URL of this Castor instance
	// (scheme + host, no trailing slash), e.g. "https://castor.example.com". It is
	// used to build the OIDC redirect_uri when a provider does not pin its own
	// oidc_redirect_url. Default "" — when empty the redirect is derived from the
	// incoming request (scheme honoring TrustProxy + Host).
	PublicURL string

	// DBPath is the SQLite database file path. Default "/data/castor.db".
	DBPath string

	// Kubeconfig is the path to a kubeconfig file for read-only K8s. Empty means
	// the kube provider is disabled.
	Kubeconfig string

	// SelfContainerID is Castor's own container id (for self-protection). If
	// empty the server attempts auto-detection at startup.
	SelfContainerID string

	// AllowedOrigins is the explicit list of allowed Origin values for mutations
	// and WebSocket upgrades. Empty means same-origin only (derived from Host).
	AllowedOrigins []string

	// EnableSwarm, when true, registers the read-only Swarm provider.
	EnableSwarm bool

	// --- ADR-001 intervals (env-overridable) ---

	DockerSnapshotInterval time.Duration // default 10s
	SwarmSnapshotInterval  time.Duration // default 15s
	K8sSnapshotInterval    time.Duration // default 15s
	StatsSampleRate        time.Duration // default 1s
	EventReconnectBackoff  time.Duration // initial backoff, default 1s
	EventReconnectCap      time.Duration // backoff cap, default 30s

	// SessionTTL is the sliding session lifetime. Default 12h.
	SessionTTL time.Duration
	// SessionAbsoluteTTL is the hard cap on session lifetime. Default 24h.
	SessionAbsoluteTTL time.Duration
}

// errSecretKey is returned by Validate when CASTOR_SECRET_KEY is unset or does
// not yield a 32-byte AES-256 key.
var errSecretKey = errors.New("config: CASTOR_SECRET_KEY must yield a 32-byte key — set it to 64 hex chars (`openssl rand -hex 32`), 44 base64 chars (`openssl rand -base64 32`), or a raw 32-byte string")

// decodeSecretKey normalizes CASTOR_SECRET_KEY to a 32-byte key, accepting the
// formats the docs/compose recommend: 64 hex chars (openssl rand -hex 32),
// 44 base64 chars (openssl rand -base64 32), or a raw 32-byte string. It returns
// nil if the value cannot be interpreted as 32 bytes.
func decodeSecretKey(raw string) []byte {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	// 64 hex chars -> 32 bytes (the value the README/compose generate).
	if len(raw) == 64 {
		if b, err := hex.DecodeString(raw); err == nil {
			return b
		}
	}
	// base64 (std or url, with/without padding) decoding to exactly 32 bytes.
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(raw); err == nil && len(b) == 32 {
			return b
		}
	}
	// Raw 32-byte string fallback.
	if len(raw) == 32 {
		return []byte(raw)
	}
	return nil
}

// Load reads configuration from the environment, applying defaults. It does not
// validate; call Validate separately so the caller controls fatal behavior.
func Load() *Config {
	c := &Config{
		HTTPAddr:               envStr("CASTOR_HTTP_ADDR", ":8080"),
		SecretKey:              decodeSecretKey(os.Getenv("CASTOR_SECRET_KEY")),
		DockerHost:             os.Getenv("CASTOR_DOCKER_HOST"),
		TrustProxy:             envBool("CASTOR_TRUST_PROXY", false),
		BootstrapToken:         os.Getenv("CASTOR_BOOTSTRAP_TOKEN"),
		PublicURL:              strings.TrimRight(strings.TrimSpace(os.Getenv("CASTOR_PUBLIC_URL")), "/"),
		DBPath:                 envStr("CASTOR_DB_PATH", "/data/castor.db"),
		Kubeconfig:             os.Getenv("CASTOR_KUBECONFIG"),
		SelfContainerID:        os.Getenv("CASTOR_SELF_CONTAINER_ID"),
		AllowedOrigins:         envList("CASTOR_ALLOWED_ORIGINS"),
		EnableSwarm:            envBool("CASTOR_ENABLE_SWARM", true),
		DockerSnapshotInterval: envDur("CASTOR_DOCKER_SNAPSHOT_INTERVAL", 10*time.Second),
		SwarmSnapshotInterval:  envDur("CASTOR_SWARM_SNAPSHOT_INTERVAL", 15*time.Second),
		K8sSnapshotInterval:    envDur("CASTOR_K8S_SNAPSHOT_INTERVAL", 15*time.Second),
		StatsSampleRate:        envDur("CASTOR_STATS_SAMPLE_RATE", 1*time.Second),
		EventReconnectBackoff:  envDur("CASTOR_EVENT_RECONNECT_BACKOFF", 1*time.Second),
		EventReconnectCap:      envDur("CASTOR_EVENT_RECONNECT_CAP", 30*time.Second),
		SessionTTL:             envDur("CASTOR_SESSION_TTL", 12*time.Hour),
		SessionAbsoluteTTL:     envDur("CASTOR_SESSION_ABSOLUTE_TTL", 24*time.Hour),
	}
	// If DOCKER_HOST is explicitly provided via CASTOR_DOCKER_HOST, export it so
	// the Docker SDK's FromEnv picks it up.
	if c.DockerHost != "" {
		_ = os.Setenv("DOCKER_HOST", c.DockerHost)
	}
	return c
}

// Validate refuses to start if the secret key is missing or wrong length.
func (c *Config) Validate() error {
	if len(c.SecretKey) != 32 {
		return errSecretKey
	}
	return nil
}

// KubeEnabled reports whether a kubeconfig path was provided.
func (c *Config) KubeEnabled() bool { return strings.TrimSpace(c.Kubeconfig) != "" }

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return b
}

func envDur(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil || d <= 0 {
		return def
	}
	return d
}

func envList(key string) []string {
	v := os.Getenv(key)
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
