package api

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

func TestAuthenticatedAgentTunnelCarriesDockerSDKAndHijackedStreams(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "docker.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go serveFakeDocker(t, listener)

	e := newTestEnv(t)
	server := httptest.NewTLSServer(e.mux)
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}}
	wsURL := "wss:" + strings.TrimPrefix(server.URL, "https:") + "/api/v1/agent/ws"
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	token := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	digest := sha256.Sum256([]byte(token))
	const hostID = "e2e-remote-docker"
	if err := e.st.CreateAgentHostEnrollment(t.Context(), hostID, "e2e", digest[:], time.Now().Add(time.Minute).Unix(), ""); err != nil {
		t.Fatal(err)
	}
	conn := dialAndAuthenticateAgent(t, wsURL, client, "", token, pub, priv, hostID)
	defer conn.CloseNow()
	conn.SetReadLimit(agentMaxFrame + 5 + 32<<10)
	go runFakeAgentTunnel(t, conn, socketPath)

	providerValue, ok := e.srv.reg.Get(hostID)
	if !ok || providerValue.Kind() != provider.KindDocker {
		t.Fatal("authenticated remote Docker provider was not registered")
	}
	remoteProvider, ok := providerValue.(*docker.DockerProvider)
	if !ok || remoteProvider.ID() != hostID {
		t.Fatalf("registered provider type=%T", providerValue)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	workloads, err := remoteProvider.ListWorkloads(ctx, provider.ListOptions{All: true})
	if err != nil || len(workloads) != 0 {
		t.Fatalf("remote SDK list workloads=%v err=%v", workloads, err)
	}
	info, err := remoteProvider.Info(ctx)
	if err != nil || info.Name != "remote-e2e" {
		t.Fatalf("remote SDK info=%#v err=%v", info, err)
	}

	// Exercise a Docker HTTP upgrade over the production server-side tunnel.
	stream, err := e.srv.OpenAgentStream(ctx, hostID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.WriteString(stream, "GET /v1.47/containers/e2e/attach?stdin=1&stdout=1 HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
	if err != nil {
		t.Fatal(err)
	}
	streamReader := bufio.NewReader(stream)
	response, err := http.ReadResponse(streamReader, nil)
	if err != nil {
		t.Fatalf("read tunneled upgrade: %v", err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("Docker attach status=%d", response.StatusCode)
	}
	body := make([]byte, len("hijack-ok"))
	if _, err := io.ReadFull(streamReader, body); err != nil || string(body) != "hijack-ok" {
		t.Fatalf("Docker attach stream=%q err=%v", body, err)
	}
	_ = stream.Close()
}

// runFakeAgentTunnel implements the agent side of the production binary tunnel
// while redirecting its fixed Docker socket to this test's Unix listener.
func runFakeAgentTunnel(t *testing.T, conn *websocket.Conn, socketPath string) {
	t.Helper()
	var writeMu sync.Mutex
	var streamsMu sync.Mutex
	streams := make(map[uint32]net.Conn)
	writeFrame := func(kind byte, id uint32, data []byte) error {
		payload := make([]byte, 5+len(data))
		payload[0] = kind
		binary.BigEndian.PutUint32(payload[1:5], id)
		copy(payload[5:], data)
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.Write(context.Background(), websocket.MessageBinary, payload)
	}
	for {
		typ, payload, err := conn.Read(t.Context())
		if err != nil {
			return
		}
		if typ != websocket.MessageBinary || len(payload) < 5 {
			continue
		}
		kind, id := payload[0], binary.BigEndian.Uint32(payload[1:5])
		switch kind {
		case 1: // Server OPEN: connect only to this test's fixed Docker socket.
			remote, err := (&net.Dialer{}).DialContext(t.Context(), "unix", socketPath)
			if err != nil {
				return
			}
			streamsMu.Lock()
			streams[id] = remote
			streamsMu.Unlock()
			if err := writeFrame(1, id, nil); err != nil {
				_ = remote.Close()
				return
			}
			go func(id uint32, remote net.Conn) {
				buf := make([]byte, 32<<10)
				for {
					n, err := remote.Read(buf)
					if n > 0 && writeFrame(2, id, buf[:n]) != nil {
						return
					}
					if err != nil {
						_ = writeFrame(3, id, nil)
						return
					}
				}
			}(id, remote)
		case 2:
			streamsMu.Lock()
			remote := streams[id]
			streamsMu.Unlock()
			if remote != nil {
				_, _ = remote.Write(payload[5:])
			}
		case 3:
			streamsMu.Lock()
			remote := streams[id]
			streamsMu.Unlock()
			if half, ok := remote.(interface{ CloseWrite() error }); ok {
				_ = half.CloseWrite()
			}
		case 4:
			streamsMu.Lock()
			remote := streams[id]
			delete(streams, id)
			streamsMu.Unlock()
			if remote != nil {
				_ = remote.Close()
			}
		}
	}
}

func serveFakeDocker(t *testing.T, listener net.Listener) {
	t.Helper()
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go func() {
			defer conn.Close()
			reader := bufio.NewReader(conn)
			for {
				req, err := http.ReadRequest(reader)
				if err != nil {
					return
				}
				path := req.URL.Path
				if strings.HasSuffix(path, "/_ping") {
					body := "OK"
					if req.Method == http.MethodHead {
						body = ""
					}
					_, _ = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nApi-Version: 1.47\r\nDocker-Experimental: false\r\nOstype: linux\r\nContent-Length: 2\r\n\r\n%s", body)
					continue
				}
				if strings.HasSuffix(path, "/version") {
					body := []byte(`{"ApiVersion":"1.47","Version":"test"}`)
					_, _ = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", len(body), body)
					continue
				}
				if strings.HasSuffix(path, "/info") {
					body, _ := json.Marshal(map[string]any{"Name": "remote-e2e", "NCPU": 4, "MemTotal": 1024})
					_, _ = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", len(body), body)
					continue
				}
				if strings.Contains(path, "/containers/json") {
					_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n[]")
					continue
				}
				if strings.Contains(path, "/containers/e2e/attach") {
					_, _ = io.WriteString(conn, "HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\nhijack-ok")
					return
				}
				_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
			}
		}()
	}
}
