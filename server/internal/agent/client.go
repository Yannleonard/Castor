// Package agent implements Castor's outbound machine authentication and a
// bounded multiplexed tunnel to the fixed local Docker Unix socket.
package agent

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	DockerSocketPath = "/var/run/docker.sock"
	maxFrameBytes    = 4096
	maxStateBytes    = 4096
)

type state struct {
	PrivateKey string `json:"privateKey"`
	HostID     string `json:"hostId,omitempty"`
}

type frame struct {
	Type      string `json:"type"`
	Version   string `json:"version,omitempty"`
	Nonce     string `json:"nonce,omitempty"`
	HostID    string `json:"hostId,omitempty"`
	Token     string `json:"token,omitempty"`
	PublicKey string `json:"publicKey,omitempty"`
	Signature string `json:"signature,omitempty"`
}

type Client struct {
	serverURL *url.URL
	statePath string
	token     string
	tlsConfig *tls.Config
	stateMu   sync.Mutex
	runMu     sync.Mutex
	heartbeat time.Duration
}

// New validates and pins the destination to the configured WSS agent endpoint.
// TLS verification remains enabled; caFile may add an explicit private CA.
func New(serverURL, statePath, enrollmentToken, caFile string) (*Client, error) {
	u, err := url.Parse(serverURL)
	if err != nil || u.Scheme != "wss" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" || (u.Path != "/api/v1/agent/ws" && u.Path != "") {
		return nil, errors.New("agent: server URL must be a wss:// URL for /api/v1/agent/ws")
	}
	if enrollmentToken != "" && (len(enrollmentToken) != 43 || strings.ContainsAny(enrollmentToken, "\r\n\x00")) {
		return nil, errors.New("agent: invalid enrollment credential")
	}
	if statePath == "" {
		return nil, errors.New("agent: identity state path is required")
	}
	if statePath, err = filepath.Abs(statePath); err != nil {
		return nil, errors.New("agent: invalid identity state path")
	}
	u.Path = "/api/v1/agent/ws"
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("agent: read CA file: %w", err)
		}
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("agent: CA file contains no usable certificates")
		}
		tlsCfg.RootCAs = pool
	}
	return &Client{serverURL: u, statePath: statePath, token: enrollmentToken, tlsConfig: tlsCfg, heartbeat: 10 * time.Second}, nil
}

// ClearEnrollmentToken drops the in-memory one-time credential after it has
// been durably bound to the host identity.
func (c *Client) ClearEnrollmentToken() { c.token = "" }

// RequireEnrolled prevents a non-interactive service process from creating a
// new identity or retrying forever when its enrollment has not completed.
func (c *Client) RequireEnrolled() error {
	st, _, err := c.loadOrCreateState()
	if err != nil {
		return err
	}
	if st.HostID == "" {
		return errors.New("agent: service mode requires an enrolled identity")
	}
	return nil
}

// Run keeps one authenticated connection alive and reconnects with bounded
// exponential backoff. Context cancellation stops retries and active I/O.
func (c *Client) Run(ctx context.Context) error {
	if !c.runMu.TryLock() {
		return errors.New("agent: client already running")
	}
	defer c.runMu.Unlock()
	// The socket path is a compile-time constant; no server frame or CLI option
	// can redirect the future Docker tunnel to an arbitrary local endpoint.
	socket, err := net.DialTimeout("unix", DockerSocketPath, 5*time.Second)
	if err != nil {
		return errors.New("agent: fixed Docker socket unavailable")
	}
	_ = socket.Close()
	backoff := time.Second
	for {
		err := c.connectOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// The error is intentionally not logged: transport and remote failures are
		// reported only as a generic retry state, never including request details.
		_ = err
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (c *Client) connectOnce(ctx context.Context) error {
	st, privateKey, err := c.loadOrCreateState()
	if err != nil {
		return err
	}
	if st.HostID == "" && c.token == "" {
		return errors.New("agent: enrollment token required until identity is bound")
	}
	if st.HostID == "" && c.token != "" {
		decoded, decodeErr := base64.RawURLEncoding.DecodeString(c.token)
		if decodeErr != nil || len(decoded) != 32 {
			return errors.New("agent: invalid enrollment token")
		}
	}
	parentCtx := ctx
	handshakeCtx, cancelHandshake := context.WithTimeout(parentCtx, 45*time.Second)
	defer cancelHandshake()
	httpClient := &http.Client{Transport: &http.Transport{
		TLSClientConfig:       c.tlsConfig,
		Proxy:                 http.ProxyFromEnvironment,
		ResponseHeaderTimeout: 15 * time.Second,
	}}
	conn, _, err := websocket.Dial(handshakeCtx, c.serverURL.String(), &websocket.DialOptions{HTTPClient: httpClient})
	if err != nil {
		return err
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(maxFrameBytes + tunnelFrameHeader + tunnelChunkSize)
	_, data, err := conn.Read(handshakeCtx)
	if err != nil {
		return err
	}
	var challenge frame
	if err := decodeFrame(data, &challenge); err != nil || challenge.Type != "challenge" {
		return errors.New("agent: invalid server challenge")
	}
	nonce, err := base64.RawURLEncoding.DecodeString(challenge.Nonce)
	if err != nil || len(nonce) != 32 {
		return errors.New("agent: invalid server challenge")
	}
	pub := privateKey.Public().(ed25519.PublicKey)
	proofHost := st.HostID
	if st.HostID == "" {
		proofHost = ""
	}
	sig := ed25519.Sign(privateKey, challengeMessage(nonce, proofHost))
	// A token is valid only for the first enrollment handshake. A supervisor may
	// restart the agent with the same environment still present after enrollment;
	// never combine that stale bearer with an already-bound host identity.
	enrollmentToken := ""
	if st.HostID == "" {
		enrollmentToken = c.token
	}
	hello := frame{
		Type: "hello", Version: Version, HostID: st.HostID, Token: enrollmentToken,
		PublicKey: base64.RawURLEncoding.EncodeToString(pub),
		Signature: base64.RawURLEncoding.EncodeToString(sig),
	}
	payload, err := json.Marshal(hello)
	if err != nil {
		return err
	}
	if err := conn.Write(handshakeCtx, websocket.MessageText, payload); err != nil {
		return err
	}
	// Do not retain the one-time enrollment token after the first authenticated
	// response; durable reconnect uses the bound host ID and private key only.
	_, data, err = conn.Read(handshakeCtx)
	if err != nil {
		return err
	}
	var ready frame
	if err := decodeFrame(data, &ready); err != nil || ready.Type != "ready" || ready.HostID == "" {
		return errors.New("agent: server did not authenticate enrollment")
	}
	if st.HostID != "" && ready.HostID != st.HostID {
		return errors.New("agent: server returned a different host identity")
	}
	st.HostID = ready.HostID
	if err := c.saveState(st); err != nil {
		return err
	}
	c.token = ""
	cancelHandshake()
	tunnel := NewTunnel(parentCtx, conn)
	defer tunnel.Close()

	readErrors := make(chan error, 1)
	go func() {
		for {
			typ, payload, err := conn.Read(parentCtx)
			if err != nil {
				select {
				case readErrors <- err:
				case <-parentCtx.Done():
				}
				return
			}
			if typ == websocket.MessageBinary {
				if err := tunnel.HandleFrame(payload, RelayAgentOpen); err != nil {
					select {
					case readErrors <- err:
					case <-parentCtx.Done():
					}
					return
				}
				continue
			}
			if typ != websocket.MessageText || len(payload) == 0 || len(payload) > maxFrameBytes {
				select {
				case readErrors <- errors.New("agent: unsupported server frame"):
				case <-parentCtx.Done():
				}
				return
			}
			var serverFrame frame
			if decodeFrame(payload, &serverFrame) != nil || (serverFrame.Type != "heartbeat" && serverFrame.Type != "ready") {
				select {
				case readErrors <- errors.New("agent: server sent an unexpected frame"):
				case <-parentCtx.Done():
				}
				return
			}
			if serverFrame.Type == "heartbeat" {
				readErrors <- nil
			}
		}
	}()
	heartbeat := time.NewTicker(c.heartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-parentCtx.Done():
			return parentCtx.Err()
		case err := <-readErrors:
			if err != nil {
				return err
			}
		case <-heartbeat.C:
			heartbeatCtx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
			payload, _ := json.Marshal(frame{Type: "heartbeat"})
			err := tunnel.SendText(heartbeatCtx, payload)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func (c *Client) loadOrCreateState() (state, ed25519.PrivateKey, error) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	var st state
	f, err := os.Open(c.statePath)
	if err == nil {
		defer func() { _ = f.Close() }()
		info, statErr := f.Stat()
		if statErr != nil || !info.Mode().IsRegular() {
			return st, nil, errors.New("agent: identity state must be a regular file")
		}
		if info.Size() <= 0 || info.Size() > maxStateBytes {
			return st, nil, errors.New("agent: invalid identity state")
		}
		if info.Mode().Perm()&0o077 != 0 {
			return st, nil, errors.New("agent: identity state permissions are not private; protect or remove it and re-enroll")
		}
		data, readErr := io.ReadAll(io.LimitReader(f, maxStateBytes+1))
		if readErr != nil || len(data) == 0 || len(data) > maxStateBytes || json.Unmarshal(data, &st) != nil {
			return st, nil, errors.New("agent: invalid identity state")
		}
		key, err := base64.RawURLEncoding.DecodeString(st.PrivateKey)
		if err != nil || len(key) != ed25519.PrivateKeySize {
			return st, nil, errors.New("agent: invalid identity state")
		}
		return st, ed25519.PrivateKey(key), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return st, nil, err
	}
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return st, nil, err
	}
	st.PrivateKey = base64.RawURLEncoding.EncodeToString(privateKey)
	if err := c.saveStateUnderLock(st); err != nil {
		return state{}, nil, err
	}
	return st, privateKey, nil
}

func (c *Client) saveState(st state) error {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	return c.saveStateUnderLock(st)
}

// saveStateUnderLock writes identity state while stateMu is already held.
func (c *Client) saveStateUnderLock(st state) error {
	data, err := json.Marshal(st)
	if err != nil {
		return err
	}
	dir := filepath.Dir(c.statePath)
	if info, err := os.Lstat(dir); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("agent: identity directory must not be a symlink")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".castor-agent-identity-*")
	if err != nil {
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), c.statePath); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

// ChallengeMessage returns the exact domain-separated bytes signed by the agent.
func ChallengeMessage(nonce []byte, hostID string) []byte {
	return challengeMessage(nonce, hostID)
}

func decodeFrame(data []byte, dst any) error {
	if len(data) == 0 || len(data) > maxFrameBytes {
		return errors.New("agent: invalid frame size")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("agent: trailing frame data")
	}
	return nil
}

func challengeMessage(nonce []byte, hostID string) []byte {
	return []byte("castor-agent-v1\x00" + hostID + "\x00" + base64.RawURLEncoding.EncodeToString(nonce))
}
