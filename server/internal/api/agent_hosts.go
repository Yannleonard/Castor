package api

import (
	"context"
	"time"

	"github.com/coder/websocket"
)

const agentConnectionFreshness = 30 * time.Second

// agentHostLive reports only a websocket with recent authenticated activity as connected.
func (s *Server) agentHostLive(hostID string) bool {
	s.agentMu.Lock()
	state, ok := s.agentConns[hostID]
	s.agentMu.Unlock()
	if !ok {
		return false
	}
	if time.Since(time.Unix(0, state.lastSeen.Load())) >= agentConnectionFreshness {
		return false
	}
	if _, ok := s.reg.Get(hostID); !ok {
		return false
	}
	select {
	case <-state.done:
		return false
	default:
	}
	return true
}

func (s *Server) touchAgent(hostID string, conn *websocket.Conn) {
	s.agentMu.Lock()
	state, ok := s.agentConns[hostID]
	s.agentMu.Unlock()
	if ok && state.conn == conn {
		state.lastSeen.Store(time.Now().UnixNano())
	}
}

func (s *Server) agentRevoked(hostID string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	host, err := s.store.GetHost(ctx, hostID)
	return err != nil || host.Status == "revoked"
}

func (s *Server) disconnectAgent(id string) {
	s.agentMu.Lock()
	state := s.agentConns[id]
	delete(s.agentConns, id)
	s.agentMu.Unlock()
	if state != nil {
		if state.tunnel != nil {
			state.tunnel.Close()
		}
		state.closeOnce.Do(func() { close(state.done) })
		_ = state.conn.CloseNow()
	}
	s.closeAgentProvider(id)
	if s.manager != nil {
		s.manager.Store().Remove(id)
	}
}

func (s *Server) CloseAgentConnections() {
	s.agentMu.Lock()
	type hostConnection struct {
		id    string
		state *agentConnection
	}
	connections := make([]hostConnection, 0, len(s.agentConns))
	for id, state := range s.agentConns {
		connections = append(connections, hostConnection{id: id, state: state})
		delete(s.agentConns, id)
	}
	s.agentMu.Unlock()
	for _, item := range connections {
		state := item.state
		if state.tunnel != nil {
			state.tunnel.Close()
		}
		state.closeOnce.Do(func() { close(state.done) })
		_ = state.conn.Close(websocket.StatusGoingAway, "server shutting down")
	}
	for _, item := range connections {
		s.closeAgentProvider(item.id)
		if s.manager != nil {
			s.manager.Store().Remove(item.id)
		}
	}
}

func (s *Server) closeAgentProvider(id string) {
	if p, ok := s.reg.Unregister(id); ok {
		if closer, ok := p.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
	}
}

func (s *Server) setAgentDown(hostID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.store.SetAgentConnectionState(ctx, hostID, "down")
	if s.manager != nil {
		s.manager.Store().Remove(hostID)
	}
}

func (s *Server) heartbeatAgent(ctx context.Context, hostID string, conn *websocket.Conn) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		s.agentMu.Lock()
		state, ok := s.agentConns[hostID]
		s.agentMu.Unlock()
		if !ok || state.conn != conn {
			return
		}
		if s.agentRevoked(hostID) {
			_ = conn.Close(websocket.StatusPolicyViolation, "agent revoked")
			return
		}
		pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := conn.Ping(pingCtx)
		cancel()
		if err != nil {
			_ = conn.Close(websocket.StatusGoingAway, "heartbeat timeout")
			return
		}
	}
}
