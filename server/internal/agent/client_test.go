package agent

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNewRequiresFixedWSSURLAndPreservesTLSVerification(t *testing.T) {
	for _, bad := range []string{
		"http://castor.example/api/v1/agent/ws",
		"wss://castor.example/other",
		"wss://user:pass@castor.example/api/v1/agent/ws",
		"wss://castor.example/api/v1/agent/ws?token=secret",
	} {
		if _, err := New(bad, filepath.Join(t.TempDir(), "identity.json"), "", ""); err == nil {
			t.Errorf("New(%q) unexpectedly succeeded", bad)
		}
	}
	c, err := New("wss://castor.example", filepath.Join(t.TempDir(), "identity.json"), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if c.serverURL.String() != "wss://castor.example/api/v1/agent/ws" {
		t.Fatalf("fixed endpoint=%q", c.serverURL)
	}
	if c.tlsConfig.InsecureSkipVerify || c.tlsConfig.MinVersion < tls.VersionTLS12 {
		t.Fatal("TLS verification disabled or minimum version below TLS 1.2")
	}
}

func TestIdentityStatePrivatePermissionsAndStableKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent", "identity.json")
	c, err := New("wss://castor.example", path, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "")
	if err != nil {
		t.Fatal(err)
	}
	first, key1, err := c.loadOrCreateState()
	if err != nil {
		t.Fatal(err)
	}
	second, key2, err := c.loadOrCreateState()
	if err != nil {
		t.Fatal(err)
	}
	if first.PrivateKey != second.PrivateKey || string(key1) != string(key2) {
		t.Fatal("identity changed between loads")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("identity permissions=%o, want 600", info.Mode().Perm())
	}
	var persisted state
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &persisted); err != nil || persisted.HostID != "" {
		t.Fatalf("initial identity state=%#v err=%v", persisted, err)
	}
}

func TestIdentityStateRejectsInsecurePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.json")
	c, err := New("wss://castor.example", path, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := c.saveState(state{PrivateKey: base64.RawURLEncoding.EncodeToString(make([]byte, ed25519.PrivateKeySize))}); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.loadOrCreateState(); err == nil {
		t.Fatal("identity with group/world-readable permissions was accepted")
	}
}

func TestChallengeMessageSignatureBindsHostAndNonce(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, 32)
	_, _ = rand.Read(nonce)
	msg := ChallengeMessage(nonce, "host-a")
	sig := ed25519.Sign(priv, msg)
	if !ed25519.Verify(pub, msg, sig) {
		t.Fatal("signature did not verify")
	}
	if ed25519.Verify(pub, ChallengeMessage(nonce, "host-b"), sig) {
		t.Fatal("signature was not bound to host ID")
	}
	other := append([]byte(nil), nonce...)
	other[0] ^= 1
	if ed25519.Verify(pub, ChallengeMessage(other, "host-a"), sig) {
		t.Fatal("signature was not bound to challenge")
	}
	if _, err := base64.RawURLEncoding.DecodeString("not valid!"); err == nil {
		t.Fatal("expected strict raw base64 validation")
	}
}
