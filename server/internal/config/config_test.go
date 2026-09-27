package config

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateRejectsMissingSecret(t *testing.T) {
	c := &Config{TLSMode: TLSModeSelfSigned, HTTPAddr: ":8080", HTTPSAddr: ":8443"}
	if err := c.Validate(); err == nil {
		t.Fatalf("Validate must reject an empty secret key")
	}
	c.SecretKey = []byte("too-short")
	if err := c.Validate(); err == nil {
		t.Fatalf("Validate must reject a non-32-byte secret key")
	}
	c.SecretKey = make([]byte, 32)
	if err := c.Validate(); err != nil {
		t.Fatalf("Validate must accept a 32-byte secret key, got %v", err)
	}
}

func TestLoadDefaults(t *testing.T) {
	t.Setenv("CASTOR_HTTP_ADDR", "")
	t.Setenv("CASTOR_DB_PATH", "")
	c := Load()
	if c.HTTPAddr != ":8080" {
		t.Errorf("default HTTPAddr = %q want :8080", c.HTTPAddr)
	}
	if c.DBPath != "/data/castor.db" {
		t.Errorf("default DBPath = %q", c.DBPath)
	}
	if c.DockerSnapshotInterval != 10*time.Second {
		t.Errorf("default docker interval = %s want 10s", c.DockerSnapshotInterval)
	}
	if c.SwarmSnapshotInterval != 15*time.Second {
		t.Errorf("default swarm interval = %s want 15s", c.SwarmSnapshotInterval)
	}
	if c.StatsSampleRate != time.Second {
		t.Errorf("default stats rate = %s want 1s", c.StatsSampleRate)
	}
	if c.EventReconnectCap != 30*time.Second {
		t.Errorf("default reconnect cap = %s want 30s", c.EventReconnectCap)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("CASTOR_HTTP_ADDR", ":9000")
	t.Setenv("CASTOR_DOCKER_SNAPSHOT_INTERVAL", "5s")
	t.Setenv("CASTOR_ENABLE_SWARM", "false")
	t.Setenv("CASTOR_ALLOWED_ORIGINS", "https://a.example , https://b.example")
	c := Load()
	if c.HTTPAddr != ":9000" {
		t.Errorf("HTTPAddr override failed: %q", c.HTTPAddr)
	}
	if c.DockerSnapshotInterval != 5*time.Second {
		t.Errorf("docker interval override failed: %s", c.DockerSnapshotInterval)
	}
	if c.EnableSwarm {
		t.Errorf("EnableSwarm override failed")
	}
	if len(c.AllowedOrigins) != 2 || c.AllowedOrigins[0] != "https://a.example" {
		t.Errorf("AllowedOrigins parse failed: %v", c.AllowedOrigins)
	}
}

func TestLoadTLSDefaults(t *testing.T) {
	for _, k := range []string{"CASTOR_TLS_MODE", "CASTOR_HTTPS_ADDR", "CASTOR_TLS_DIR", "CASTOR_HTTP_REDIRECT", "CASTOR_TLS_SELF_SIGNED_HOSTS", "CASTOR_DATA_DIR", "CASTOR_DB_PATH"} {
		t.Setenv(k, "")
	}
	c := Load()
	if c.TLSMode != TLSModeSelfSigned {
		t.Errorf("default TLSMode = %q want self-signed", c.TLSMode)
	}
	if c.HTTPSAddr != ":8443" {
		t.Errorf("default HTTPSAddr = %q want :8443", c.HTTPSAddr)
	}
	if want := filepath.Join(c.DataDir, "tls"); c.TLSDir != want {
		t.Errorf("default TLSDir = %q want %q", c.TLSDir, want)
	}
	if !c.HTTPRedirect {
		t.Errorf("default HTTPRedirect must be true")
	}
	if len(c.TLSSelfSignedHosts) != 0 {
		t.Errorf("default TLSSelfSignedHosts = %v want none", c.TLSSelfSignedHosts)
	}
	if !c.TLSEnabled() {
		t.Errorf("TLSEnabled must be true by default")
	}
}

func TestLoadTLSOverrides(t *testing.T) {
	t.Setenv("CASTOR_TLS_MODE", " OFF ")
	t.Setenv("CASTOR_HTTPS_ADDR", "0.0.0.0:9443")
	t.Setenv("CASTOR_TLS_DIR", "/srv/castor-tls")
	t.Setenv("CASTOR_HTTP_REDIRECT", "false")
	t.Setenv("CASTOR_TLS_SELF_SIGNED_HOSTS", "castor.lan, 10.0.0.5")
	c := Load()
	if c.TLSMode != TLSModeOff || c.TLSEnabled() {
		t.Errorf("TLSMode = %q (enabled=%v) want off", c.TLSMode, c.TLSEnabled())
	}
	if c.HTTPSAddr != "0.0.0.0:9443" || c.TLSDir != "/srv/castor-tls" || c.HTTPRedirect {
		t.Errorf("TLS overrides failed: %+v", c)
	}
	if len(c.TLSSelfSignedHosts) != 2 || c.TLSSelfSignedHosts[1] != "10.0.0.5" {
		t.Errorf("TLSSelfSignedHosts = %v", c.TLSSelfSignedHosts)
	}
}

func TestValidateTLS(t *testing.T) {
	base := func() *Config {
		return &Config{SecretKey: make([]byte, 32), TLSMode: TLSModeSelfSigned, HTTPAddr: ":8080", HTTPSAddr: ":8443"}
	}
	if err := base().Validate(); err != nil {
		t.Fatalf("valid defaults rejected: %v", err)
	}
	for _, mode := range []string{TLSModeSelfSigned, TLSModeCustom, TLSModeACME, TLSModeOff} {
		if !IsValidTLSMode(mode) {
			t.Errorf("IsValidTLSMode(%q) = false", mode)
		}
	}
	c := base()
	c.TLSMode = "letsencrypt"
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "CASTOR_TLS_MODE") {
		t.Errorf("unknown mode err = %v", err)
	}
	c = base()
	c.HTTPSAddr = ":8080"
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "distinct ports") {
		t.Errorf("same port with TLS on err = %v", err)
	}
	// Same port is tolerated when TLS is off (HTTPS addr unused)...
	c.TLSMode = TLSModeOff
	if err := c.Validate(); err != nil {
		t.Errorf("same port with TLS off must pass: %v", err)
	}
	// ...but ValidateTLSListeners still flags it for the persisted-mode path.
	if err := c.ValidateTLSListeners(); err == nil {
		t.Errorf("ValidateTLSListeners must reject a shared port")
	}
	for _, bad := range []string{"8080", "localhost", ":0", ":70000", ":abc"} {
		c = base()
		c.HTTPAddr = bad
		if err := c.Validate(); err == nil {
			t.Errorf("HTTPAddr %q must be rejected", bad)
		}
		c = base()
		c.HTTPSAddr = bad
		if err := c.Validate(); err == nil {
			t.Errorf("HTTPSAddr %q must be rejected", bad)
		}
	}
	c = base()
	c.HTTPAddr, c.HTTPSAddr = "127.0.0.1:80", "[::]:443"
	if err := c.Validate(); err != nil {
		t.Errorf("explicit hosts rejected: %v", err)
	}
}
