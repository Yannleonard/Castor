package agent

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

const (
	tunnelFrameHeader = 5
	tunnelChunkSize   = 32 << 10
	tunnelQueueDepth  = 16
	tunnelMaxStreams  = 64
	writeFrame        = byte(1)
	writeData         = byte(2)
	writeFIN          = byte(3)
	writeClose        = byte(4)
)

// Tunnel multiplexes bounded full-duplex byte streams over an authenticated
// agent WebSocket. The agent side may open streams only to DockerSocketPath.
type Tunnel struct {
	ctx     context.Context
	cancel  context.CancelFunc
	conn    *websocket.Conn
	writeMu sync.Mutex
	mu      sync.Mutex
	streams map[uint32]*TunnelConn
	nextID  atomic.Uint32
	closed  bool
}

// NewTunnel binds a tunnel to one authenticated WebSocket connection.
func NewTunnel(parent context.Context, conn *websocket.Conn) *Tunnel {
	ctx, cancel := context.WithCancel(parent)
	return &Tunnel{ctx: ctx, cancel: cancel, conn: conn, streams: make(map[uint32]*TunnelConn)}
}

// Open creates a logical byte stream from the server to this agent.
func (t *Tunnel) Open(ctx context.Context) (net.Conn, error) {
	id := t.nextID.Add(1)
	if id == 0 {
		id = t.nextID.Add(1)
	}
	stream := newTunnelConn(t, id)
	t.mu.Lock()
	if t.closed || len(t.streams) >= tunnelMaxStreams {
		t.mu.Unlock()
		return nil, errors.New("agent: tunnel unavailable or stream limit reached")
	}
	t.streams[id] = stream
	t.mu.Unlock()
	if err := t.send(writeFrame, id, nil); err != nil {
		t.remove(id)
		return nil, err
	}
	go func() {
		select {
		case <-ctx.Done():
			_ = stream.Close()
		case <-stream.done:
		case <-t.ctx.Done():
		}
	}()
	return stream, nil
}

// HandleFrame consumes a binary tunnel frame. onOpen is invoked only for a
// server-requested stream; pass nil on the server, which never accepts opens.
func (t *Tunnel) HandleFrame(payload []byte, onOpen func(net.Conn)) error {
	if len(payload) < tunnelFrameHeader || len(payload) > tunnelFrameHeader+tunnelChunkSize {
		return errors.New("agent: invalid tunnel frame size")
	}
	kind := payload[0]
	id := binary.BigEndian.Uint32(payload[1:tunnelFrameHeader])
	if id == 0 {
		return errors.New("agent: invalid tunnel stream id")
	}
	if kind == writeClose && len(payload) != tunnelFrameHeader {
		return errors.New("agent: invalid tunnel close")
	}
	if kind == writeClose {
		t.mu.Lock()
		stream := t.streams[id]
		t.mu.Unlock()
		if stream == nil {
			return nil
		}
		stream.remoteClose()
		return nil
	}
	t.mu.Lock()
	stream := t.streams[id]
	if stream == nil && kind == writeFIN {
		t.mu.Unlock()
		return nil
	}
	if stream == nil && kind == writeData {
		// The peer may have closed its endpoint after sending the final bytes;
		// the stream is already gone, so discard in-flight trailing data.
		t.mu.Unlock()
		return nil
	}
	if kind == writeFrame {
		if stream != nil {
			// A matching OPEN acknowledges a server-created stream.
			t.mu.Unlock()
			return nil
		}
		if onOpen == nil || len(t.streams) >= tunnelMaxStreams || len(payload) != tunnelFrameHeader {
			t.mu.Unlock()
			return errors.New("agent: unexpected tunnel open")
		}
		stream = newTunnelConn(t, id)
		t.streams[id] = stream
		t.mu.Unlock()
		if err := t.send(writeFrame, id, nil); err != nil {
			t.remove(id)
			stream.remoteClose()
			return err
		}
		go onOpen(stream)
		return nil
	}
	t.mu.Unlock()
	if stream == nil {
		return fmt.Errorf("agent: unknown tunnel stream")
	}
	switch kind {
	case writeData:
		if len(payload) == tunnelFrameHeader {
			return errors.New("agent: empty tunnel data")
		}
		select {
		case stream.in <- append([]byte(nil), payload[tunnelFrameHeader:]...):
			return nil
		default:
			_ = stream.Close()
			return errors.New("agent: tunnel receive queue full")
		}
	case writeFIN:
		if len(payload) != tunnelFrameHeader {
			return errors.New("agent: invalid tunnel FIN")
		}
		stream.remoteCloseWrite()
		return nil
	case writeClose:
		return errors.New("agent: invalid tunnel close")
	default:
		return errors.New("agent: unknown tunnel frame")
	}
}

// Close cancels streams and prevents further opens.
func (t *Tunnel) Close() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.closed = true
	streams := make([]*TunnelConn, 0, len(t.streams))
	for id, stream := range t.streams {
		delete(t.streams, id)
		streams = append(streams, stream)
	}
	t.mu.Unlock()
	t.cancel()
	for _, stream := range streams {
		stream.remoteClose()
	}
}

func (t *Tunnel) remove(id uint32) {
	t.mu.Lock()
	delete(t.streams, id)
	t.mu.Unlock()
}

func (t *Tunnel) send(kind byte, id uint32, data []byte) error {
	if len(data) > tunnelChunkSize {
		return errors.New("agent: tunnel frame too large")
	}
	frame := make([]byte, tunnelFrameHeader+len(data))
	frame[0] = kind
	binary.BigEndian.PutUint32(frame[1:tunnelFrameHeader], id)
	copy(frame[tunnelFrameHeader:], data)
	ctx, cancel := context.WithTimeout(t.ctx, 10*time.Second)
	defer cancel()
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	return t.conn.Write(ctx, websocket.MessageBinary, frame)
}

// SendText serializes small protocol text messages with tunnel frames so the
// WebSocket connection always has exactly one concurrent writer.
func (t *Tunnel) SendText(ctx context.Context, payload []byte) error {
	if len(payload) == 0 || len(payload) > maxFrameBytes {
		return errors.New("agent: invalid protocol text frame")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	return t.conn.Write(ctx, websocket.MessageText, payload)
}

type TunnelConn struct {
	tunnel        *Tunnel
	id            uint32
	in            chan []byte
	done          chan struct{}
	readFIN       chan struct{}
	close         sync.Once
	finOnce       sync.Once
	mu            sync.Mutex
	buf           []byte
	localFIN      bool
	remoteFIN     bool
	readDeadline  time.Time
	writeDeadline time.Time
	readClosed    bool
}

func newTunnelConn(t *Tunnel, id uint32) *TunnelConn {
	return &TunnelConn{tunnel: t, id: id, in: make(chan []byte, tunnelQueueDepth), done: make(chan struct{}), readFIN: make(chan struct{})}
}

func (c *TunnelConn) Read(p []byte) (int, error) {
	for {
		c.mu.Lock()
		if len(c.buf) > 0 {
			n := copy(p, c.buf)
			c.buf = c.buf[n:]
			c.mu.Unlock()
			return n, nil
		}
		deadline := c.readDeadline
		c.mu.Unlock()
		var timer <-chan time.Time
		var t *time.Timer
		if !deadline.IsZero() {
			d := time.Until(deadline)
			if d <= 0 {
				return 0, timeoutError{}
			}
			t = time.NewTimer(d)
			timer = t.C
		}
		select {
		case data := <-c.in:
			if t != nil {
				t.Stop()
			}
			c.mu.Lock()
			c.buf = data
			c.mu.Unlock()
		case <-c.done:
			if t != nil {
				t.Stop()
			}
			select {
			case data := <-c.in:
				c.mu.Lock()
				c.buf = data
				c.mu.Unlock()
			default:
				return 0, net.ErrClosed
			}
		case <-c.readFIN:
			if t != nil {
				t.Stop()
			}
			select {
			case data := <-c.in:
				c.mu.Lock()
				c.buf = data
				c.mu.Unlock()
			default:
				return 0, io.EOF
			}
		case <-timer:
			return 0, timeoutError{}
		case <-c.tunnel.ctx.Done():
			if t != nil {
				t.Stop()
			}
			return 0, net.ErrClosed
		}
	}
}

func (c *TunnelConn) Write(p []byte) (int, error) {
	c.mu.Lock()
	closed := c.localFIN
	deadline := c.writeDeadline
	c.mu.Unlock()
	if closed {
		return 0, net.ErrClosed
	}
	if !deadline.IsZero() && time.Now().After(deadline) {
		return 0, timeoutError{}
	}
	written := 0
	for len(p) > 0 {
		n := len(p)
		if n > tunnelChunkSize {
			n = tunnelChunkSize
		}
		if err := c.tunnel.send(writeData, c.id, p[:n]); err != nil {
			return written, err
		}
		written += n
		p = p[n:]
	}
	return written, nil
}

func (c *TunnelConn) Close() error {
	c.close.Do(func() {
		c.tunnel.remove(c.id)
		c.tunnel.mu.Lock()
		isClosed := c.tunnel.closed
		c.tunnel.mu.Unlock()
		if !isClosed {
			_ = c.tunnel.send(writeClose, c.id, nil)
		}
		close(c.done)
	})
	return nil
}

// CloseWrite sends a FIN while keeping the reverse direction open for hijacked
// Docker exec and attach streams.
func (c *TunnelConn) CloseWrite() error {
	c.mu.Lock()
	if c.localFIN {
		c.mu.Unlock()
		return nil
	}
	c.localFIN = true
	c.mu.Unlock()
	return c.tunnel.send(writeFIN, c.id, nil)
}

func (c *TunnelConn) remoteCloseWrite() {
	c.mu.Lock()
	if !c.remoteFIN {
		c.remoteFIN = true
		c.finOnce.Do(func() { close(c.readFIN) })
	}
	c.mu.Unlock()
}

func (c *TunnelConn) remoteClose() {
	c.close.Do(func() {
		c.finOnce.Do(func() { close(c.readFIN) })
		close(c.done)
		c.tunnel.remove(c.id)
	})
}

func (c *TunnelConn) LocalAddr() net.Addr  { return tunnelAddr("castor-agent") }
func (c *TunnelConn) RemoteAddr() net.Addr { return tunnelAddr("docker-engine") }
func (c *TunnelConn) SetDeadline(t time.Time) error {
	c.mu.Lock()
	c.readDeadline = t
	c.writeDeadline = t
	c.mu.Unlock()
	return nil
}
func (c *TunnelConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	c.readDeadline = t
	c.mu.Unlock()
	return nil
}
func (c *TunnelConn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	c.writeDeadline = t
	c.mu.Unlock()
	return nil
}

type tunnelAddr string

func (a tunnelAddr) Network() string { return "castor-agent" }
func (a tunnelAddr) String() string  { return string(a) }

type timeoutError struct{}

func (timeoutError) Error() string   { return "tunnel I/O timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

// RelayAgentOpen connects an accepted stream exclusively to the configured
// local Docker Unix socket and relays both directions with bounded buffers.
func RelayAgentOpen(conn net.Conn) {
	defer conn.Close()
	sock, err := net.DialTimeout("unix", DockerSocketPath, 5*time.Second)
	if err != nil {
		return
	}
	defer sock.Close()
	docker, ok := sock.(*net.UnixConn)
	if !ok {
		return
	}
	finished := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(docker, conn); _ = docker.CloseWrite(); finished <- struct{}{} }()
	go func() {
		_, _ = io.Copy(conn, docker)
		if cw, ok := conn.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}
		finished <- struct{}{}
	}()
	<-finished
	<-finished
}
