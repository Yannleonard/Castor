package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/gtek-it/castor/server/internal/agent"
	"github.com/gtek-it/castor/server/internal/store"
)

func TestAgentTLSEnrollmentReconnectAndRevocation(t *testing.T) {
	e := newTestEnv(t)
	server := httptest.NewTLSServer(e.mux)
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}}
	wsURL := "wss:" + server.URL[len("https:"):] + "/api/v1/agent/ws"

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	token := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	digest := sha256.Sum256([]byte(token))
	hostID := store.NewUUID()
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "edge", digest[:], time.Now().Add(time.Minute).Unix(), ""); err != nil {
		t.Fatal(err)
	}

	conn := dialAndAuthenticateAgent(t, wsURL, client, "", token, pub, priv, hostID)
	defer func() { _ = conn.CloseNow() }()
	if !e.srv.agentHostLive(hostID) {
		t.Fatal("authenticated connection was not registered")
	}
	var status string
	if err := e.st.DB().QueryRow(`SELECT status FROM registered_hosts WHERE id = ?`, hostID).Scan(&status); err != nil || status != "connected" {
		t.Fatalf("connected host status=%q err=%v", status, err)
	}
	if err := wsjson.Write(t.Context(), conn, agentFrame{Type: "heartbeat"}); err != nil {
		t.Fatal(err)
	}
	var heartbeat agentFrame
	if err := readAgentTestHeartbeat(t, conn, &heartbeat); err != nil || heartbeat.Type != "heartbeat" {
		t.Fatalf("heartbeat acknowledgement=%#v err=%v", heartbeat, err)
	}

	_ = conn.CloseNow()
	waitForAgentDisconnect(t, e, hostID)

	// Reconnect is authenticated by the persistent key and a fresh server challenge.
	reconnected := dialAndAuthenticateAgent(t, wsURL, client, hostID, "", pub, priv, hostID)
	defer func() { _ = reconnected.CloseNow() }()
	if !e.srv.agentHostLive(hostID) {
		t.Fatal("reconnected socket not registered")
	}

	if err := e.st.RevokeAgentHost(t.Context(), hostID); err != nil {
		t.Fatal(err)
	}
	e.srv.disconnectAgent(hostID)
	readCtx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	for {
		if _, _, err := reconnected.Read(readCtx); err != nil {
			if readCtx.Err() != nil {
				t.Fatal("revocation did not disconnect authenticated agent")
			}
			break
		}
	}
	if _, err := e.st.AgentPublicKey(t.Context(), hostID); err != store.ErrNotFound {
		t.Fatalf("revoked identity lookup error=%v, want ErrNotFound", err)
	}
	if err := e.st.SetAgentConnectionState(t.Context(), hostID, "down"); err != store.ErrNotFound {
		t.Fatalf("revoked host state update error=%v, want ErrNotFound", err)
	}
	status = ""
	if err := e.st.DB().QueryRow(`SELECT status FROM registered_hosts WHERE id = ?`, hostID).Scan(&status); err != nil || status != "revoked" {
		t.Fatalf("revoked host status=%q err=%v", status, err)
	}
}

func readAgentTestHeartbeat(t *testing.T, conn *websocket.Conn, dst *agentFrame) error {
	t.Helper()
	for {
		typ, payload, err := conn.Read(t.Context())
		if err != nil {
			return err
		}
		if typ == websocket.MessageBinary {
			if len(payload) < 5 {
				t.Fatalf("invalid tunnel frame: %x", payload)
			}
			frame := make([]byte, 5)
			frame[0] = 4
			copy(frame[1:], payload[1:5])
			if err := conn.Write(t.Context(), websocket.MessageBinary, frame); err != nil {
				return err
			}
			continue
		}
		return json.Unmarshal(payload, dst)
	}
}

func TestAgentHandshakeRejectsMixedEnrollmentAndReconnectFieldsWithoutConsumingToken(t *testing.T) {
	e := newTestEnv(t)
	server := httptest.NewTLSServer(e.mux)
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}}
	wsURL := "wss:" + server.URL[len("https:"):] + "/api/v1/agent/ws"

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	token := "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
	digest := sha256.Sum256([]byte(token))
	hostID := store.NewUUID()
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "edge", digest[:], time.Now().Add(time.Minute).Unix(), ""); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(agentMaxFrame)
	var challenge struct {
		Type  string `json:"type"`
		Nonce string `json:"nonce"`
	}
	if err := wsjson.Read(ctx, conn, &challenge); err != nil {
		t.Fatal(err)
	}
	nonce, err := base64.RawURLEncoding.DecodeString(challenge.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(ctx, conn, agentFrame{
		Type: "hello", HostID: "not-the-enrolled-host", Token: token,
		PublicKey: base64.RawURLEncoding.EncodeToString(pub),
		Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, agent.ChallengeMessage(nonce, "not-the-enrolled-host"))),
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.Read(ctx); err == nil {
		t.Fatal("mixed enrollment and reconnect fields unexpectedly authenticated")
	}
	if _, err := e.st.ConsumeAgentEnrollment(t.Context(), digest[:]); err != nil {
		t.Fatalf("malformed handshake consumed the enrollment token: %v", err)
	}
}

func waitForAgentDisconnect(t *testing.T, e *testEnv, hostID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !e.srv.agentHostLive(hostID) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("agent connection did not unregister")
}

func dialAndAuthenticateAgent(t *testing.T, wsURL string, client *http.Client, hostID, token string, pub ed25519.PublicKey, priv ed25519.PrivateKey, expectedHost string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPClient: client})
	if err != nil {
		t.Fatalf("dial agent endpoint: %v", err)
	}
	conn.SetReadLimit(agentMaxFrame)
	var challenge struct {
		Type  string `json:"type"`
		Nonce string `json:"nonce"`
	}
	if err := wsjson.Read(ctx, conn, &challenge); err != nil || challenge.Type != "challenge" {
		_ = conn.CloseNow()
		t.Fatalf("challenge=%#v err=%v", challenge, err)
	}
	nonce, err := base64.RawURLEncoding.DecodeString(challenge.Nonce)
	if err != nil {
		_ = conn.CloseNow()
		t.Fatal(err)
	}
	sig := ed25519.Sign(priv, agent.ChallengeMessage(nonce, hostID))
	hello := agentFrame{
		Type: "hello", HostID: hostID, Token: token,
		PublicKey: base64.RawURLEncoding.EncodeToString(pub),
		Signature: base64.RawURLEncoding.EncodeToString(sig),
	}
	if err := wsjson.Write(ctx, conn, hello); err != nil {
		_ = conn.CloseNow()
		t.Fatal(err)
	}
	var ready struct {
		Type   string `json:"type"`
		HostID string `json:"hostId"`
	}
	if err := wsjson.Read(ctx, conn, &ready); err != nil || ready.Type != "ready" || ready.HostID != expectedHost {
		_ = conn.CloseNow()
		t.Fatalf("ready=%#v err=%v", ready, err)
	}
	return conn
}
