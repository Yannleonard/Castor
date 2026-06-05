package cache

import (
	"context"
	"sync"
)

// MaxLiveStatsPerSession is the hard cap on concurrent live stats streams per UI
// session (ADR-CASTOR-001 one-live-stats rule). It is NOT configurable.
const MaxLiveStatsPerSession = 1

// SupersededFn is invoked by the registry when it cancels a prior stats stream
// to make room for a new one. The WS hub uses it to emit the error{superseded}
// + end frames on the OLD subId before the new stream opens.
type SupersededFn func(oldSubID string)

// statsHandle tracks one active live stats stream within a session.
type statsHandle struct {
	subID  string
	cancel context.CancelFunc
}

// sessionStreams holds the per-session active stream handles.
type sessionStreams struct {
	mu         sync.Mutex
	activeStat *statsHandle
}

// Registry maps a session key to its active streams, enforcing the
// one-live-stats rule across all of that session's WS connections.
type Registry struct {
	mu       sync.Mutex
	sessions map[string]*sessionStreams
}

// NewRegistry returns an empty stream registry.
func NewRegistry() *Registry {
	return &Registry{sessions: make(map[string]*sessionStreams)}
}

func (r *Registry) sessionFor(key string) *sessionStreams {
	r.mu.Lock()
	defer r.mu.Unlock()
	ss, ok := r.sessions[key]
	if !ok {
		ss = &sessionStreams{}
		r.sessions[key] = ss
	}
	return ss
}

// AcquireStats registers a new live stats stream for a session, returning a
// child context that is cancelled when the stream is superseded or released.
// Per the one-live-stats rule, any PRIOR stats stream for the session is
// cancelled first and onSuperseded is invoked with the old subId so the hub can
// notify that subscriber. This NEVER trusts the client to unsubscribe first.
func (r *Registry) AcquireStats(parent context.Context, sessionKey, subID string, onSuperseded SupersededFn) context.Context {
	ss := r.sessionFor(sessionKey)
	ss.mu.Lock()
	defer ss.mu.Unlock()

	if ss.activeStat != nil {
		old := ss.activeStat
		old.cancel()
		if onSuperseded != nil && old.subID != subID {
			onSuperseded(old.subID)
		}
		ss.activeStat = nil
	}

	ctx, cancel := context.WithCancel(parent)
	ss.activeStat = &statsHandle{subID: subID, cancel: cancel}
	return ctx
}

// ReleaseStats cancels and clears the active stats stream for a session if (and
// only if) it matches subID (the stream that is ending). Idempotent.
func (r *Registry) ReleaseStats(sessionKey, subID string) {
	ss := r.sessionFor(sessionKey)
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.activeStat != nil && ss.activeStat.subID == subID {
		ss.activeStat.cancel()
		ss.activeStat = nil
	}
}

// CloseSession cancels all streams for a session and forgets it (called when the
// WS connection closes or the session is revoked).
func (r *Registry) CloseSession(sessionKey string) {
	r.mu.Lock()
	ss, ok := r.sessions[sessionKey]
	if ok {
		delete(r.sessions, sessionKey)
	}
	r.mu.Unlock()
	if !ok {
		return
	}
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.activeStat != nil {
		ss.activeStat.cancel()
		ss.activeStat = nil
	}
}
