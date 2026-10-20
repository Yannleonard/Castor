package agent

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestTunnelMultiplexesBoundedBidirectionalStreams(t *testing.T) {
	serverConn := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		serverConn <- conn
		<-r.Context().Done()
	}))
	defer server.Close()
	clientConn, _, err := websocket.Dial(context.Background(), "ws"+server.URL[len("http"):], nil)
	if err != nil {
		t.Fatal(err)
	}
	defer clientConn.CloseNow()
	remoteConn := <-serverConn
	defer remoteConn.CloseNow()

	serverTunnel := NewTunnel(context.Background(), remoteConn)
	clientTunnel := NewTunnel(context.Background(), clientConn)
	defer serverTunnel.Close()
	defer clientTunnel.Close()

	serveFrames := func(conn *websocket.Conn, tunnel *Tunnel, onOpen func(net.Conn)) {
		t.Helper()
		for {
			_, frame, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			if err := tunnel.HandleFrame(frame, onOpen); err != nil {
				t.Errorf("handle tunnel frame: %v", err)
				return
			}
		}
	}
	go serveFrames(clientConn, clientTunnel, func(stream net.Conn) {
		defer stream.Close()
		if _, err := io.Copy(stream, stream); err != nil && err != io.EOF {
			t.Errorf("echo stream: %v", err)
		}
		if halfCloser, ok := stream.(interface{ CloseWrite() error }); ok {
			_ = halfCloser.CloseWrite()
		}
	})
	go serveFrames(remoteConn, serverTunnel, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	stream, err := serverTunnel.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	payload := []byte("remote docker engine stream")
	if _, err := stream.Write(payload); err != nil {
		t.Fatal(err)
	}
	if halfCloser, ok := stream.(interface{ CloseWrite() error }); ok {
		if err := halfCloser.CloseWrite(); err != nil {
			t.Fatal(err)
		}
	}
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(stream, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("echo=%q, want %q", got, payload)
	}
}

func TestTunnelEnforcesFrameAndStreamBounds(t *testing.T) {
	tunnel := &Tunnel{streams: make(map[uint32]*TunnelConn)}
	if err := tunnel.HandleFrame(make([]byte, tunnelFrameHeader+tunnelChunkSize+1), nil); err == nil {
		t.Fatal("oversized frame was accepted")
	}
	for id := uint32(1); id <= tunnelMaxStreams; id++ {
		tunnel.streams[id] = newTunnelConn(tunnel, id)
	}
	if _, err := tunnel.Open(context.Background()); err == nil {
		t.Fatal("stream beyond configured maximum was accepted")
	}
	for _, stream := range tunnel.streams {
		stream.remoteClose()
	}
}
