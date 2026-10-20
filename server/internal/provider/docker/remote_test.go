package docker

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/provider"
)

func TestRemoteProviderUsesOnlyBoundDockerTransport(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "docker.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	requests := make(chan string, 4)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				req, err := http.ReadRequest(bufio.NewReader(conn))
				if err != nil {
					return
				}
				requests <- req.Method + " " + req.URL.Path
				switch {
				case req.URL.Path == "/_ping" || strings.HasSuffix(req.URL.Path, "/_ping"):
					_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nApi-Version: 1.47\r\nDocker-Experimental: false\r\nOstype: linux\r\nContent-Length: 2\r\n\r\nOK")
				case strings.HasSuffix(req.URL.Path, "/version"):
					_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 30\r\n\r\n{\"ApiVersion\":\"1.47\",\"Version\":\"test\"}")
				case strings.Contains(req.URL.Path, "/containers/json"):
					_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n[]")
				case strings.HasSuffix(req.URL.Path, "/info"):
					payload, _ := json.Marshal(map[string]any{"Name": "edge-docker", "NCPU": 4, "MemTotal": 1024})
					_, _ = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", len(payload), payload)
				default:
					_, _ = io.WriteString(conn, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
				}
			}()
		}
	}()

	p, err := NewRemote(context.Background(), "host-edge", Config{}, func(ctx context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" || address != "docker:80" {
			t.Errorf("unexpected SDK destination: %s %s", network, address)
		}
		return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	workloads, err := p.ListWorkloads(ctx, provider.ListOptions{All: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(workloads) != 0 {
		t.Fatalf("expected empty workload list, got %d", len(workloads))
	}
	info, err := p.Info(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "edge-docker" || info.NCPU != 4 {
		t.Fatalf("unexpected engine info: %#v", info)
	}
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		select {
		case request := <-requests:
			seen[request] = true
		case <-ctx.Done():
			t.Fatal("timed out waiting for SDK requests")
		}
	}
	if !seen["HEAD /_ping"] || !seen["GET /v1.47/containers/json"] || !seen["GET /v1.47/info"] {
		t.Fatalf("fake Unix socket did not receive expected Docker API calls: %#v", seen)
	}
}
