// Castor by IT Leonard
// Package config loads and validates Castor runtime configuration from the
// environment. See ADR-CASTOR-001 (intervals) and ADR-CASTOR-003 (stack/auth).
package config

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime configuration, loaded from the environment.
type Config struct {
	// HTTPAddr is the listen address for the API + embedded UI. Default ":8080".
	HTTPAddr string

	// SecretKey is the 32-byte AES-256-GCM key used to seal TOTP secrets and
	// other secrets at rest. Load fills it from CASTOR_SECRET_KEY when set;
	// ResolveSecretKey then falls back to <DataDir>/secret.key, generating that
	// file on first start. Validate refuses to start without a 32-byte key.
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

	// DataDir is the writable directory for Castor's persistent working state
	// beyond the SQLite file (e.g. GitOps stack clones under <DataDir>/stacks/).
	// Env CASTOR_DATA_DIR; default filepath.Dir(DBPath) so it sits alongside the
	// database (the same volume operators already mount).
	DataDir string

	// --- TLS (see the tlsmgr package) ---
	//
	// The environment only sets the DEFAULT mode and the listen addresses. The
	// mode and the ACME settings are editable in the UI and persisted in the
	// settings table ("tls.mode", "tls.acme.*"); when present they take
	// precedence over the env values (resolved at startup in main.go).

	// TLSMode is the default TLS mode: "self-signed" (default), "custom", "acme"
	// or "off". Env CASTOR_TLS_MODE. "off" is the pre-TLS behavior (plain HTTP on
	// HTTPAddr, no redirect) for deployments behind a TLS-terminating proxy.
	TLSMode string

	// HTTPSAddr is the HTTPS listen address when TLS is active. Default ":8443".
	// Env CASTOR_HTTPS_ADDR. Ignored when the effective mode is "off".
	HTTPSAddr string

	// TLSDir holds the self-signed key pair and the ACME cache. Env CASTOR_TLS_DIR;
	// default <DataDir>/tls. Created 0700 by the TLS manager.
	TLSDir string

	// HTTPRedirect, when TLS is active, makes the plain-HTTP listener answer
	// everything except /api/v1/healthz and ACME HTTP-01 challenges with a 308 to
	// the HTTPS origin. Env CASTOR_HTTP_REDIRECT; default true. When false the
	// HTTP listener serves the full application as well (dual HTTP + HTTPS).
	HTTPRedirect bool

	// TLSSelfSignedHosts are extra SANs (DNS names or IPs) added to the generated
	// self-signed certificate on top of localhost, 127.0.0.1, ::1 and the
	// container hostname. Env CASTOR_TLS_SELF_SIGNED_HOSTS (comma-separated).
	TLSSelfSignedHosts []string

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

// TLS modes accepted by CASTOR_TLS_MODE and the persisted "tls.mode" setting.
const (
	// TLSModeSelfSigned serves a locally generated, persisted self-signed cert.
	TLSModeSelfSigned = "self-signed"
	// TLSModeCustom serves an operator-imported certificate (DigiCert, Thawte,
	// an internal CA, ...) stored sealed in the database.
	TLSModeCustom = "custom"
	// TLSModeACME obtains and renews a certificate from Let's Encrypt (ACME).
	TLSModeACME = "acme"
	// TLSModeOff disables the HTTPS listener entirely (plain HTTP only).
	TLSModeOff = "off"
)

// IsValidTLSMode reports whether mode is one of the supported TLS modes.
func IsValidTLSMode(mode string) bool {
	switch mode {
	case TLSModeSelfSigned, TLSModeCustom, TLSModeACME, TLSModeOff:
		return true
	}
	return false
}

// errSecretKey is returned when CASTOR_SECRET_KEY is set but does not yield a
// 32-byte AES-256 key, or by Validate when no key was resolved at all.
var errSecretKey = errors.New("config: CASTOR_SECRET_KEY must yield a 32-byte key — set it to 64 hex chars (`openssl rand -hex 32`), 44 base64 chars (`openssl rand -base64 32`), or a raw 32-byte string; or leave it unset to have Castor generate <data dir>/secret.key")

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
		DataDir:                strings.TrimSpace(os.Getenv("CASTOR_DATA_DIR")),
		TLSMode:                strings.ToLower(strings.TrimSpace(envStr("CASTOR_TLS_MODE", TLSModeSelfSigned))),
		HTTPSAddr:              envStr("CASTOR_HTTPS_ADDR", ":8443"),
		TLSDir:                 strings.TrimSpace(os.Getenv("CASTOR_TLS_DIR")),
		HTTPRedirect:           envBool("CASTOR_HTTP_REDIRECT", true),
		TLSSelfSignedHosts:     envList("CASTOR_TLS_SELF_SIGNED_HOSTS"),
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
	// Default the data dir to the directory that holds the SQLite file so GitOps
	// clones live on the same mounted volume as the database.
	if c.DataDir == "" {
		c.DataDir = filepath.Dir(c.DBPath)
	}
	// The TLS material (self-signed pair, ACME cache) lives next to the database
	// by default, on the volume operators already mount.
	if c.TLSDir == "" {
		c.TLSDir = filepath.Join(c.DataDir, "tls")
	}
	// If DOCKER_HOST is explicitly provided via CASTOR_DOCKER_HOST, export it so
	// the Docker SDK's FromEnv picks it up.
	if c.DockerHost != "" {
		_ = os.Setenv("DOCKER_HOST", c.DockerHost)
	}
	return c
}

// SecretKeyFile is the name of the key file under DataDir used when
// CASTOR_SECRET_KEY is not set.
const SecretKeyFile = "secret.key"

// SecretKeySource tells where the effective secret key came from.
type SecretKeySource string

const (
	// SecretKeySourceEnv: CASTOR_SECRET_KEY was set and used as-is.
	SecretKeySourceEnv SecretKeySource = "env"
	// SecretKeySourceFile: an existing <DataDir>/secret.key was read.
	SecretKeySourceFile SecretKeySource = "file"
	// SecretKeySourceGenerated: no key anywhere; one was generated and written
	// to <DataDir>/secret.key.
	SecretKeySourceGenerated SecretKeySource = "generated"
)

// SecretKeyInfo describes how the secret key was resolved so the caller can
// log it. It never carries the key value itself.
type SecretKeyInfo struct {
	Source SecretKeySource
	// Path is the key file considered (<DataDir>/secret.key), whatever the source.
	Path string
	// EnvDiffersFromFile is set when CASTOR_SECRET_KEY was used but the key file
	// exists with a different key: data sealed with the file key is unreadable.
	EnvDiffersFromFile bool
}

// LoadSecretKey resolves the secret key with the following precedence:
//  1. envValue (CASTOR_SECRET_KEY) when non-empty, used as-is; an invalid value
//     is an error, never silently replaced.
//  2. <dataDir>/secret.key when it exists and decodes to 32 bytes; a file that
//     cannot be read or decoded is a fatal error naming the path (it is never
//     overwritten).
//  3. Otherwise a fresh 32-byte key from crypto/rand is written to that file as
//     64 hex chars (mode 0600, dataDir created 0700 if missing), read back and
//     used.
func LoadSecretKey(envValue, dataDir string) ([]byte, SecretKeyInfo, error) {
	path := filepath.Join(dataDir, SecretKeyFile)
	info := SecretKeyInfo{Path: path}

	if strings.TrimSpace(envValue) != "" {
		key := decodeSecretKey(envValue)
		if key == nil {
			return nil, info, errSecretKey
		}
		info.Source = SecretKeySourceEnv
		// Warn when a key file holds a different key: the env wins, but anything
		// sealed with the file key is unreadable. A missing or unreadable file is
		// irrelevant here since the env is authoritative.
		if fileKey, err := readSecretKeyFile(path); err == nil && !bytes.Equal(fileKey, key) {
			info.EnvDiffersFromFile = true
		}
		return key, info, nil
	}

	key, err := readSecretKeyFile(path)
	switch {
	case err == nil:
		info.Source = SecretKeySourceFile
		return key, info, nil
	case !errors.Is(err, os.ErrNotExist):
		return nil, info, err
	}

	if err := writeSecretKeyFile(path); err != nil {
		return nil, info, err
	}
	key, err = readSecretKeyFile(path)
	if err != nil {
		return nil, info, fmt.Errorf("config: secret key file %s written but cannot be read back: %w", path, err)
	}
	info.Source = SecretKeySourceGenerated
	return key, info, nil
}

// readSecretKeyFile reads and decodes the key file. A missing file yields an
// error wrapping os.ErrNotExist; any other failure (permissions, corrupted or
// wrong-length content) is an explicit error naming the path.
func readSecretKeyFile(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		return nil, fmt.Errorf("config: cannot read secret key file %s: %w", path, err)
	}
	key := decodeSecretKey(string(raw))
	if key == nil {
		return nil, fmt.Errorf("config: secret key file %s is corrupted (expected 64 hex chars for a 32-byte key); restore it from a backup, or remove it to generate a new key (data sealed with the old key becomes unreadable)", path)
	}
	return key, nil
}

// writeSecretKeyFile generates a 32-byte key and writes it hex-encoded (64
// chars + newline) to path with mode 0600, creating the parent 0700 if needed.
// It never overwrites an existing file.
func writeSecretKeyFile(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("config: cannot create data dir for secret key file %s: %w", path, err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return fmt.Errorf("config: cannot generate secret key: %w", err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("config: cannot create secret key file %s: %w", path, err)
	}
	_, werr := f.WriteString(hex.EncodeToString(key) + "\n")
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		_ = os.Remove(path)
		return fmt.Errorf("config: cannot write secret key file %s: %w", path, werr)
	}
	return nil
}

// ResolveSecretKey fills c.SecretKey using LoadSecretKey with CASTOR_SECRET_KEY
// and c.DataDir. Call it after Load (DataDir must be resolved) and before
// Validate.
func (c *Config) ResolveSecretKey() (SecretKeyInfo, error) {
	key, info, err := LoadSecretKey(os.Getenv("CASTOR_SECRET_KEY"), c.DataDir)
	if err != nil {
		return info, err
	}
	c.SecretKey = key
	return info, nil
}

// Validate refuses to start if the secret key is missing or wrong length (see
// ResolveSecretKey), if the TLS mode is unknown, or if a listen address is malformed. When TLS is on
// by default, the HTTP and HTTPS listeners must not share a port.
func (c *Config) Validate() error {
	if len(c.SecretKey) != 32 {
		return errSecretKey
	}
	if !IsValidTLSMode(c.TLSMode) {
		return fmt.Errorf("config: CASTOR_TLS_MODE %q is not one of self-signed, custom, acme, off", c.TLSMode)
	}
	if err := validateListenAddr("CASTOR_HTTP_ADDR", c.HTTPAddr); err != nil {
		return err
	}
	if err := validateListenAddr("CASTOR_HTTPS_ADDR", c.HTTPSAddr); err != nil {
		return err
	}
	if c.TLSMode != TLSModeOff {
		return c.ValidateTLSListeners()
	}
	return nil
}

// ValidateTLSListeners checks that the HTTP and HTTPS listeners use distinct
// ports. Validate applies it when the env default enables TLS; main.go applies
// it again once the persisted tls.mode setting (which may enable TLS despite an
// env default of "off") is known.
func (c *Config) ValidateTLSListeners() error {
	_, hp, _ := net.SplitHostPort(c.HTTPAddr)
	_, sp, _ := net.SplitHostPort(c.HTTPSAddr)
	if hp == sp {
		return fmt.Errorf("config: CASTOR_HTTP_ADDR and CASTOR_HTTPS_ADDR both use port %s; TLS needs two distinct ports (or CASTOR_TLS_MODE=off)", hp)
	}
	return nil
}

// validateListenAddr checks that addr is a "host:port" (host may be empty)
// with a numeric port in range, as net.Listen expects.
func validateListenAddr(name, addr string) error {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("config: %s %q must be host:port (e.g. \":8080\"): %w", name, addr, err)
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return fmt.Errorf("config: %s %q has an invalid port", name, addr)
	}
	return nil
}

// TLSEnabled reports whether the configured default mode starts the HTTPS
// listener. The persisted setting may override the mode; main.go resolves that.
func (c *Config) TLSEnabled() bool { return c.TLSMode != TLSModeOff }

// KubeEnabled reports whether a kubeconfig path was provided.
func (c *Config) KubeEnabled() bool { return strings.TrimSpace(c.Kubeconfig) != "" }

// StackCloneDir returns the per-stack GitOps working directory
// (<DataDir>/stacks/<stackID>). The caller creates it with os.MkdirAll(dir, 0o750).
func (c *Config) StackCloneDir(stackID string) string {
	return filepath.Join(c.DataDir, "stacks", stackID)
}

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
