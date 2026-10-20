package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/go-chi/chi/v5"
	"github.com/gtek-it/castor/server/internal/agent"
	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/store"
)

// CreateAgentHost issues a short-lived, single-use bearer only once over HTTPS.
func (s *Server) CreateAgentHost(w http.ResponseWriter, r *http.Request) {
	if !s.agentEnrollmentHTTPS(r) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrForbidden, "Agent enrollment credentials can only be issued over trusted HTTPS."))
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeMapped(w, r, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 128 {
		authz.WriteError(w, r, authz.ErrValidation)
		return
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		writeMapped(w, r, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	digest := sha256.Sum256([]byte(token))
	hostID := store.NewUUID()
	createdBy := ""
	if user := authz.UserFrom(r); user != nil {
		createdBy = user.ID
	}
	if err := s.store.CreateAgentHostEnrollment(r.Context(), hostID, name, digest[:], time.Now().Add(15*time.Minute).Unix(), createdBy); err != nil {
		writeMapped(w, r, err)
		return
	}
	// The bearer is returned exactly once. It is not persisted or logged.
	created(w, map[string]any{"hostId": hostID, "name": name, "enrollmentToken": token, "expiresInSeconds": 900})
}

// RevokeAgentHost invalidates credentials and immediately terminates any live connection.
func (s *Server) RevokeAgentHost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "hostID")
	if err := s.store.RevokeAgentHost(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	s.disconnectAgent(id)
	noContent(w)
}

func (s *Server) agentEnrollmentHTTPS(r *http.Request) bool {
	if s.tls != nil && s.tls.EffectiveMode() != "off" {
		return authz.IsHTTPS(r, s.cfg.TrustProxy)
	}
	// Enrollment API may trust an explicitly configured TLS terminator. The agent
	// transport itself does not: its listener must be directly TLS-protected.
	return s.cfg.TrustProxy && authz.IsHTTPS(r, true)
}

func (s *Server) pollRemoteHost(ctx context.Context, hostID string, p *docker.DockerProvider) {
	if s.manager != nil {
		s.manager.RunRemoteDockerPoller(ctx, hostID, p)
	}
}

const agentMaxFrame = 4096
const agentMaxTunnelFrame = 5 + 32<<10

type agentFrame struct {
	Type      string `json:"type"`
	Version   string `json:"version,omitempty"`
	HostID    string `json:"hostId,omitempty"`
	Token     string `json:"token,omitempty"`
	PublicKey string `json:"publicKey,omitempty"`
	Signature string `json:"signature,omitempty"`
}

// AgentConnect is outside browser/session authentication. This protocol
// authenticates a machine, not a user action, and carries no Docker requests.
func (s *Server) AgentConnect(w http.ResponseWriter, r *http.Request) {
	if r.TLS == nil {
		http.Error(w, "TLS required", http.StatusUpgradeRequired)
		return
	}
	if r.TLS.Version < tls.VersionTLS12 {
		http.Error(w, "TLS 1.2 or newer required", http.StatusUpgradeRequired)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		http.Error(w, "query parameters are not accepted", http.StatusBadRequest)
		return
	}
	// Agents never send Origin. Reject it rather than expanding the browser
	// WebSocket origin policy onto this independently authenticated endpoint.
	if r.Header.Get("Origin") != "" {
		http.Error(w, "agent endpoint does not accept browser origins", http.StatusForbidden)
		return
	}
	select {
	case s.agentLimit <- struct{}{}:
		defer func() { <-s.agentLimit }()
	default:
		http.Error(w, "agent connection capacity reached", http.StatusServiceUnavailable)
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(agentMaxTunnelFrame)

	handshakeCtx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	challenge, err := newAgentChallenge()
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, "internal error")
		return
	}
	if err := wsjson.Write(handshakeCtx, conn, map[string]string{"type": "challenge", "nonce": base64.RawURLEncoding.EncodeToString(challenge)}); err != nil {
		return
	}
	var hello agentFrame
	if err := readAgentFrame(handshakeCtx, conn, &hello); err != nil || hello.Type != "hello" {
		_ = conn.Close(websocket.StatusPolicyViolation, "invalid agent handshake")
		return
	}
	publicKey, err := base64.RawURLEncoding.DecodeString(hello.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		_ = conn.Close(websocket.StatusPolicyViolation, "invalid agent identity")
		return
	}
	if hello.Token != "" && (len(hello.Token) != 43 || strings.ContainsAny(hello.Token, "\r\n\x00")) {
		_ = conn.Close(websocket.StatusPolicyViolation, "invalid agent credential")
		return
	}
	if !validAgentVersion(hello.Version) {
		_ = conn.Close(websocket.StatusPolicyViolation, "invalid agent version")
		return
	}
	if (hello.Token != "" && hello.HostID != "") || (hello.Token == "" && hello.HostID == "") {
		_ = conn.Close(websocket.StatusPolicyViolation, "invalid agent identity")
		return
	}
	signature, err := base64.RawURLEncoding.DecodeString(hello.Signature)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), agentChallengeMessage(challenge, hello.HostID), signature) {
		_ = conn.Close(websocket.StatusPolicyViolation, "agent proof failed")
		return
	}

	var hostID string
	if hello.Token != "" {
		digest := sha256.Sum256([]byte(hello.Token))
		hostID, err = s.store.RedeemAgentEnrollment(handshakeCtx, digest[:], publicKey)
		if err == store.ErrNotFound && hello.HostID == "" {
			// Token may already have been atomically redeemed by a prior connection
			// whose ready frame was lost. Recovery is identity-bound, never token-only.
			hostID, err = s.store.FindAgentHostByPublicKey(handshakeCtx, publicKey)
		}
	} else if hello.HostID != "" {
		var bound []byte
		bound, err = s.store.AgentPublicKey(handshakeCtx, hello.HostID)
		if err == nil && subtle.ConstantTimeCompare(bound, publicKey) == 1 {
			hostID = hello.HostID
		} else if err == nil {
			err = store.ErrNotFound
		}
	} else {
		err = store.ErrNotFound
	}
	if err != nil || hostID == "" || (hello.HostID != "" && hello.HostID != hostID) {
		_ = conn.Close(websocket.StatusPolicyViolation, "agent authentication failed")
		return
	}
	if !s.registerAgentConnection(hostID, conn) {
		_ = conn.Close(websocket.StatusPolicyViolation, "agent already connected")
		return
	}
	defer s.setAgentDown(hostID)
	defer s.unregisterAgentConnection(hostID, conn)
	tunnel := agent.NewTunnel(r.Context(), conn)
	s.setAgentTunnel(hostID, conn, tunnel)
	defer tunnel.Close()
	remoteProvider, providerErr := docker.NewRemote(r.Context(), hostID, docker.Config{}, func(ctx context.Context, _, _ string) (net.Conn, error) {
		return s.OpenAgentStream(ctx, hostID)
	})
	if providerErr != nil {
		_ = conn.Close(websocket.StatusInternalError, "Docker provider unavailable")
		return
	}
	s.reg.Register(remoteProvider)
	if err := s.store.SetAgentConnectionState(r.Context(), hostID, "connected"); err != nil {
		if p, ok := s.reg.Unregister(hostID); ok {
			if closer, ok := p.(interface{ Close() error }); ok {
				_ = closer.Close()
			}
		}
		_ = conn.Close(websocket.StatusPolicyViolation, "agent revoked")
		return
	}
	if err := s.store.SetAgentVersion(r.Context(), hostID, hello.Version); err != nil {
		_ = conn.Close(websocket.StatusInternalError, "agent metadata unavailable")
		return
	}
	s.touchAgent(hostID, conn)
	go s.heartbeatAgent(r.Context(), hostID, conn)
	if err := s.writeAgentJSON(r.Context(), hostID, conn, map[string]string{"type": "ready", "hostId": hostID}); err != nil {
		return
	}
	go s.pollRemoteHost(r.Context(), hostID, remoteProvider)

	// The authenticated socket multiplexes fixed-purpose Docker byte streams and
	// heartbeats. No stream frame contains or selects a network destination.
	for {
		typ, payload, err := conn.Read(r.Context())
		if err != nil {
			break
		}
		if typ == websocket.MessageBinary {
			if err := tunnel.HandleFrame(payload, nil); err != nil {
				_ = conn.Close(websocket.StatusUnsupportedData, "invalid tunnel frame")
				return
			}
			s.touchAgent(hostID, conn)
			continue
		}
		if typ != websocket.MessageText {
			_ = conn.Close(websocket.StatusUnsupportedData, "invalid agent message")
			return
		}
		if s.agentRevoked(hostID) {
			_ = conn.Close(websocket.StatusPolicyViolation, "agent revoked")
			return
		}
		var frame struct {
			Type string `json:"type"`
		}
		if typ != websocket.MessageText || len(payload) == 0 || len(payload) > agentMaxFrame || json.Unmarshal(payload, &frame) != nil {
			break
		}
		if frame.Type != "heartbeat" {
			_ = conn.Close(websocket.StatusUnsupportedData, "unsupported agent frame")
			return
		}
		s.touchAgent(hostID, conn)
		if err := s.writeAgentJSON(r.Context(), hostID, conn, map[string]string{"type": "heartbeat"}); err != nil {
			return
		}
	}
}

func validAgentVersion(value string) bool {
	if len(value) > 64 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune(".+_-", r) {
			continue
		}
		return false
	}
	return true
}

func newAgentChallenge() ([]byte, error) {
	nonce := make([]byte, 32)
	_, err := rand.Read(nonce)
	return nonce, err
}

func agentChallengeMessage(nonce []byte, hostID string) []byte {
	// Domain-separate the signature and bind it to this host (empty during first enrollment).
	return []byte("castor-agent-v1\x00" + hostID + "\x00" + base64.RawURLEncoding.EncodeToString(nonce))
}

func readAgentFrame(ctx context.Context, conn *websocket.Conn, dst any) error {
	typ, payload, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	if typ != websocket.MessageText || len(payload) == 0 || len(payload) > agentMaxFrame {
		return websocket.CloseError{Code: websocket.StatusUnsupportedData, Reason: "invalid agent frame"}
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("trailing agent frame data")
	}
	return nil
}

// requireLocalHost rejects endpoints that are still implemented by the local Docker manager.
func (s *Server) requireLocalHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hostID := chi.URLParam(r, "hostID")
		if hostID == "" || hostID == "local" {
			next.ServeHTTP(w, r)
			return
		}
		if _, err := s.store.GetHost(r.Context(), hostID); err != nil {
			writeMapped(w, r, err)
			return
		}
		authz.SetAuditTarget(r, "host", hostID, hostID)
		authz.WriteError(w, r, authz.ErrUnavailable)
	})
}

// requireActiveHostDockerProvider prevents unavailable hosts from falling through to local Docker.
func (s *Server) requireActiveHostDockerProvider(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "hostID")
		if id == "" {
			writeMapped(w, r, authz.ErrNotFound)
			return
		}
		if id == "local" {
			next.ServeHTTP(w, r)
			return
		}
		h, err := s.store.GetHost(r.Context(), id)
		if err != nil {
			writeMapped(w, r, err)
			return
		}
		if h.Status == "revoked" {
			writeMapped(w, r, authz.ErrNotFound)
			return
		}
		if h.Connection != "remote-agent" {
			if _, ok := s.reg.Get(id); !ok {
				writeMapped(w, r, authz.ErrUnavailable)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if !s.agentHostLive(id) {
			authz.SetAuditTarget(r, "host", id, h.Name)
			authz.WriteError(w, r, authz.ErrUnavailable)
			return
		}
		if _, ok := s.reg.Get(id); !ok {
			authz.SetAuditTarget(r, "host", id, h.Name)
			authz.WriteError(w, r, authz.ErrUnavailable)
			return
		}
		authz.SetAuditTarget(r, "host", id, h.Name)
		next.ServeHTTP(w, r)
	})
}
