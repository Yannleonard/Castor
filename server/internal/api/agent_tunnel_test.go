package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/gtek-it/castor/server/internal/store"
)

func TestAgentTunnelRejectsAgentInitiatedStreamsAndBadFrames(t *testing.T) {
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
	token := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	digest := sha256.Sum256([]byte(token))
	hostID := store.NewUUID()
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "tunnel-test", digest[:], time.Now().Add(time.Minute).Unix(), ""); err != nil {
		t.Fatal(err)
	}
	conn := dialAndAuthenticateAgent(t, wsURL, client, "", token, pub, priv, hostID)
	defer func() { _ = conn.CloseNow() }()
	openFrame := make([]byte, 5)
	openFrame[0] = 1
	const maliciousID = uint32(0xfedcba98)
	binary.BigEndian.PutUint32(openFrame[1:], maliciousID)
	if err := conn.Write(t.Context(), websocket.MessageBinary, openFrame); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	for {
		typ, payload, err := conn.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				t.Fatal("agent-initiated Docker stream was accepted")
			}
			break
		}
		if typ == websocket.MessageBinary && len(payload) >= 5 && binary.BigEndian.Uint32(payload[1:5]) == maliciousID {
			t.Fatal("server replied to an agent-initiated stream")
		}
	}
}
