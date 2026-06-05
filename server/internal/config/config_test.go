package config

import (
	"testing"
	"time"
)

func TestValidateRejectsMissingSecret(t *testing.T) {
	c := &Config{}
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
