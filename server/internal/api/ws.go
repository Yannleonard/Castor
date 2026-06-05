package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/store"
)

// wsConn is one browser-tab WebSocket connection. It multiplexes many
// subscriptions (by subId+channel) over a single socket through a mutex-guarded
// writer. A read pump dispatches client frames; each active stream runs in its
// own goroutine and writes back through writeFrame.
type wsConn struct {
	srv  *Server
	conn *websocket.Conn
	user *authz.User

	// sessionKey scopes the one-live-stats rule to this UI session (the session
	// hash id; all of a tab's subs share it).
	sessionKey string

	writeMu sync.Mutex

	mu   sync.Mutex
	subs map[string]*wsSub // keyed by subId

	// execStreams maps an exec subId to its live ExecStream so client stdin /
	// resize data frames can reach it.
	execStreams sync.Map // map[string]provider.ExecStream

	ctx    context.Context
	cancel context.CancelFunc
}

// wsSub tracks one active subscription's cancel func.
type wsSub struct {
	channel string
	cancel  context.CancelFunc
}

// HandleWS upgrades the connection (AFTER SessionAuth + Origin check, enforced
// by the route's middleware + the explicit origin check here) and runs the hub.
func (s *Server) HandleWS(w http.ResponseWriter, r *http.Request) {
	// Re-validate the session at upgrade time (the route is behind SessionAuth,
	// so UserFrom is populated; this is defense-in-depth).
	user := authz.UserFrom(r)
	if user == nil {
		authz.WriteError(w, r, authz.ErrUnauthenticated)
		return
	}
	// Origin allowlist BEFORE Accept.
	if !s.authz.CheckOrigin(r) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrCSRFFailed, "Origin not allowed for WebSocket."))
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Origin is validated above; the request Host is always authorized by
		// the library, and we pass our allowlist for belt-and-suspenders.
		OriginPatterns: originPatterns(s.cfg.AllowedOrigins),
	})
	if err != nil {
		return // Accept already wrote the HTTP error.
	}
	conn.SetReadLimit(1 << 20) // 1 MiB frames max

	ctx, cancel := context.WithCancel(r.Context())
	wc := &wsConn{
		srv:        s,
		conn:       conn,
		user:       user,
		sessionKey: user.SessionHashID,
		subs:       make(map[string]*wsSub),
		ctx:        ctx,
		cancel:     cancel,
	}
	wc.run()
}

// run is the read pump. It reads client frames until the socket closes, then
// tears down all subscriptions and the session's stream registry entry.
func (wc *wsConn) run() {
	defer func() {
		wc.cancel()
		wc.closeAllSubs()
		wc.srv.manager.Streams().CloseSession(wc.sessionKey)
		_ = wc.conn.CloseNow()
	}()

	for {
		var env wsEnvelope
		if err := wsjson.Read(wc.ctx, wc.conn, &env); err != nil {
			return // client closed or error
		}
		// Re-validate the session liveness on each inbound frame; close on revoke.
		if !wc.sessionLive() {
			wc.writeFrame(wsEnvelope{V: wsVersion, Type: wsTypeError, Payload: map[string]any{
				"code": wsErrSessionRevoked, "message": "Session revoked.",
			}})
			_ = wc.conn.Close(websocket.StatusPolicyViolation, wsErrSessionRevoked)
			return
		}
		wc.dispatch(env)
	}
}

// sessionLive reports whether the backing session is still valid (not revoked
// or expired).
func (wc *wsConn) sessionLive() bool {
	sess, err := wc.srv.store.GetSession(wc.ctx, wc.sessionKey)
	if err != nil {
		return false
	}
	if sess.RevokedAt != nil || sess.ExpiresAt < time.Now().Unix() {
		return false
	}
	return true
}

// dispatch routes a client frame by type.
func (wc *wsConn) dispatch(env wsEnvelope) {
	switch env.Type {
	case wsTypeSubscribe:
		wc.handleSubscribe(env)
	case wsTypeUnsubscribe:
		wc.handleUnsubscribe(env)
	case wsTypeData:
		wc.handleData(env)
	default:
		wc.sendError(env.Channel, env.SubID, wsErrBadRequest, "Unknown frame type.")
	}
}

// handleSubscribe validates permission for the channel AT subscribe time, then
// opens the appropriate stream goroutine.
func (wc *wsConn) handleSubscribe(env wsEnvelope) {
	if env.SubID == "" {
		wc.sendError(env.Channel, env.SubID, wsErrBadRequest, "subscribe requires subId.")
		return
	}
	// A ref is required for the per-workload channels (stats/logs/exec) but NOT
	// for the fleet-wide events channel, which subscribes with no ref.
	if env.Channel != wsChannelEvents && env.Ref == nil {
		wc.sendError(env.Channel, env.SubID, wsErrBadRequest, "subscribe requires ref.")
		return
	}
	hostID := env.HostID
	if hostID == "" {
		hostID = cache.HostID
	}

	switch env.Channel {
	case wsChannelStats:
		wc.subscribeStats(env, hostID)
	case wsChannelLogs:
		wc.subscribeLogs(env, hostID)
	case wsChannelEvents:
		wc.subscribeEvents(env)
	case wsChannelExec:
		wc.subscribeExec(env, hostID)
	default:
		wc.sendError(env.Channel, env.SubID, wsErrBadRequest, "Unknown channel.")
	}
}

// handleUnsubscribe cancels the named subscription. subId is authoritative.
func (wc *wsConn) handleUnsubscribe(env wsEnvelope) {
	wc.mu.Lock()
	sub, ok := wc.subs[env.SubID]
	if ok {
		delete(wc.subs, env.SubID)
	}
	wc.mu.Unlock()
	if ok {
		sub.cancel()
		if sub.channel == wsChannelStats {
			wc.srv.manager.Streams().ReleaseStats(wc.sessionKey, env.SubID)
		}
	}
}

// registerSub records a subscription's cancel func, returning false if the
// subId is already in use.
func (wc *wsConn) registerSub(subID, channel string, cancel context.CancelFunc) bool {
	wc.mu.Lock()
	defer wc.mu.Unlock()
	if _, exists := wc.subs[subID]; exists {
		return false
	}
	wc.subs[subID] = &wsSub{channel: channel, cancel: cancel}
	return true
}

// removeSub deletes a subscription record (called when a stream ends).
func (wc *wsConn) removeSub(subID string) {
	wc.mu.Lock()
	delete(wc.subs, subID)
	wc.mu.Unlock()
}

func (wc *wsConn) closeAllSubs() {
	wc.mu.Lock()
	subs := wc.subs
	wc.subs = make(map[string]*wsSub)
	wc.mu.Unlock()
	for _, sub := range subs {
		sub.cancel()
	}
}

// resolveWorkload finds the target workload + provider for a sub.
func (wc *wsConn) resolveWorkload(hostID, id string) (provider.Provider, provider.Workload, bool) {
	wl, found := wc.srv.manager.Store().FindWorkload(hostID, id)
	if !found {
		return nil, provider.Workload{}, false
	}
	p, ok := wc.srv.reg.Get(wl.ProviderID)
	if !ok {
		return nil, provider.Workload{}, false
	}
	return p, wl, true
}

// --- stats channel (one-live-stats rule) ---

func (wc *wsConn) subscribeStats(env wsEnvelope, hostID string) {
	if !wc.user.Can("docker.container.stats", authz.Scope{Type: "global"}) {
		wc.sendError(wsChannelStats, env.SubID, wsErrForbidden, "Missing docker.container.stats.")
		return
	}
	p, wl, ok := wc.resolveWorkload(hostID, env.Ref.ID)
	if !ok {
		wc.sendError(wsChannelStats, env.SubID, wsErrNotFound, "Workload not found.")
		return
	}
	if !p.Capabilities().Has(provider.CapStats) {
		wc.sendError(wsChannelStats, env.SubID, wsErrUnsupported, "Stats unsupported for this orchestrator.")
		return
	}

	// One-live-stats rule: acquiring cancels+supersedes any prior stats stream
	// for this session and notifies the old subId.
	streamCtx := wc.srv.manager.Streams().AcquireStats(wc.ctx, wc.sessionKey, env.SubID, func(oldSubID string) {
		wc.sendError(wsChannelStats, oldSubID, wsErrSuperseded, "Superseded by a new stats subscription.")
		wc.sendEnd(wsChannelStats, oldSubID)
		wc.removeSub(oldSubID)
	})

	subCtx, cancel := context.WithCancel(streamCtx)
	if !wc.registerSub(env.SubID, wsChannelStats, cancel) {
		cancel()
		wc.sendError(wsChannelStats, env.SubID, wsErrBadRequest, "subId already in use.")
		return
	}

	ch, err := p.Stats(subCtx, wl.ID)
	if err != nil {
		cancel()
		wc.removeSub(env.SubID)
		wc.srv.manager.Streams().ReleaseStats(wc.sessionKey, env.SubID)
		wc.sendStreamError(wsChannelStats, env.SubID, err)
		return
	}
	wc.sendAck(wsChannelStats, env.SubID, hostID)

	go func() {
		defer wc.removeSub(env.SubID)
		defer wc.srv.manager.Streams().ReleaseStats(wc.sessionKey, env.SubID)

		ref := &wsRef{Kind: "container", ID: wl.ID}
		ticker := time.NewTicker(wc.srv.cfg.StatsSampleRate)
		defer ticker.Stop()
		var latest *provider.StatSample
		for {
			select {
			case <-subCtx.Done():
				wc.sendEnd(wsChannelStats, env.SubID)
				return
			case sample, open := <-ch:
				if !open {
					wc.sendEnd(wsChannelStats, env.SubID)
					return
				}
				s := sample
				latest = &s
			case <-ticker.C:
				if latest == nil {
					continue
				}
				wc.writeFrame(wsEnvelope{
					V: wsVersion, Type: wsTypeData, Channel: wsChannelStats,
					SubID: env.SubID, HostID: hostID, Ref: ref, TS: nowRFC3339(),
					Payload: statsPayload(latest),
				})
			}
		}
	}()
}

func statsPayload(s *provider.StatSample) map[string]any {
	memPct := 0.0
	if s.MemLimitBytes > 0 {
		memPct = float64(s.MemUsageBytes) / float64(s.MemLimitBytes) * 100.0
	}
	return map[string]any{
		"cpuPct":   s.CPUPercent,
		"memUsed":  s.MemUsageBytes,
		"memLimit": s.MemLimitBytes,
		"memPct":   memPct,
		"netRx":    s.NetRxBytes,
		"netTx":    s.NetTxBytes,
		"blkRead":  s.BlkReadBytes,
		"blkWrite": s.BlkWriteBytes,
	}
}

// --- logs channel ---

func (wc *wsConn) subscribeLogs(env wsEnvelope, hostID string) {
	if !wc.user.Can("docker.container.logs", authz.Scope{Type: "global"}) {
		wc.sendError(wsChannelLogs, env.SubID, wsErrForbidden, "Missing docker.container.logs.")
		return
	}
	p, wl, ok := wc.resolveWorkload(hostID, env.Ref.ID)
	if !ok {
		wc.sendError(wsChannelLogs, env.SubID, wsErrNotFound, "Workload not found.")
		return
	}

	tail := 200
	container := ""
	if env.Payload != nil {
		if t, ok := env.Payload["tail"].(float64); ok {
			tail = int(t)
		}
		// K8s multi-container pods: the client selects which container's logs to
		// stream (the Docker provider ignores it). "" => first/default container.
		if c, ok := env.Payload["container"].(string); ok {
			container = c
		}
	}

	subCtx, cancel := context.WithCancel(wc.ctx)
	if !wc.registerSub(env.SubID, wsChannelLogs, cancel) {
		cancel()
		wc.sendError(wsChannelLogs, env.SubID, wsErrBadRequest, "subId already in use.")
		return
	}

	rc, err := p.Logs(subCtx, wl.ID, provider.LogOptions{Follow: true, Tail: tail, Container: container})
	if err != nil {
		cancel()
		wc.removeSub(env.SubID)
		wc.sendStreamError(wsChannelLogs, env.SubID, err)
		return
	}
	wc.sendAck(wsChannelLogs, env.SubID, hostID)

	hasTTY := false
	if dp, isDocker := p.(*docker.DockerProvider); isDocker {
		hasTTY = dp.ContainerHasTTY(subCtx, wl.ID)
	}
	isKube := wl.Kind == provider.KindKubernetes

	go func() {
		defer wc.removeSub(env.SubID)
		defer func() { _ = rc.Close() }()
		ref := &wsRef{Kind: refKind(wl.Kind), ID: wl.ID}

		emit := func(stream, line string) bool {
			if subCtx.Err() != nil {
				return false
			}
			wc.writeFrame(wsEnvelope{
				V: wsVersion, Type: wsTypeData, Channel: wsChannelLogs,
				SubID: env.SubID, HostID: hostID, Ref: ref, TS: nowRFC3339(),
				Payload: map[string]any{"stream": stream, "line": line},
			})
			return true
		}

		if isKube {
			readPlainLines(rc, func(line string) { emit("stdout", line) })
		} else {
			_ = docker.DemuxLogs(rc, hasTTY, func(ll docker.LogLine) bool {
				return emit(ll.Stream, ll.Line)
			})
		}
		wc.sendEnd(wsChannelLogs, env.SubID)
	}()
}

// --- events channel ---

func (wc *wsConn) subscribeEvents(env wsEnvelope) {
	subCtx, cancel := context.WithCancel(wc.ctx)
	if !wc.registerSub(env.SubID, wsChannelEvents, cancel) {
		cancel()
		wc.sendError(wsChannelEvents, env.SubID, wsErrBadRequest, "subId already in use.")
		return
	}
	events, unsub := wc.srv.manager.Broker().Subscribe()
	wc.sendAck(wsChannelEvents, env.SubID, env.HostID)

	go func() {
		defer wc.removeSub(env.SubID)
		defer unsub()
		for {
			select {
			case <-subCtx.Done():
				wc.sendEnd(wsChannelEvents, env.SubID)
				return
			case ev, open := <-events:
				if !open {
					wc.sendEnd(wsChannelEvents, env.SubID)
					return
				}
				payload := map[string]any{
					"action": ev.Action,
					"kind":   ev.Kind,
					"id":     ev.ID,
				}
				if ev.SnapshotDelta != nil {
					payload["snapshotDelta"] = ev.SnapshotDelta
				}
				wc.writeFrame(wsEnvelope{
					V: wsVersion, Type: wsTypeData, Channel: wsChannelEvents,
					SubID: env.SubID, HostID: ev.HostID, TS: nowRFC3339(),
					Payload: payload,
				})
			}
		}
	}()
}

// --- exec channel (Docker only) ---

func (wc *wsConn) subscribeExec(env wsEnvelope, hostID string) {
	if !wc.user.Can("docker.container.exec", authz.Scope{Type: "global"}) {
		wc.sendError(wsChannelExec, env.SubID, wsErrForbidden, "Missing docker.container.exec.")
		return
	}
	// Step-up gate: an interactive exec opens a root-capable shell — a mutation in
	// every sense — so it MUST satisfy the same TOTP/AAL check REST mutations do
	// (authz RequireAAL). Without this, a pwd-only session could bypass step-up by
	// opening exec over the WebSocket. Read-only stats/logs are not gated here.
	if wc.srv.authz.StepUpRequired(wc.ctx, wc.user) {
		wc.sendError(wsChannelExec, env.SubID, wsErrAALRequired, "Two-factor verification required to open a shell.")
		return
	}
	p, wl, ok := wc.resolveWorkload(hostID, env.Ref.ID)
	if !ok {
		wc.sendError(wsChannelExec, env.SubID, wsErrNotFound, "Workload not found.")
		return
	}
	if p.Capabilities().Has(provider.CapReadOnly) || !p.Capabilities().Has(provider.CapExec) {
		wc.sendError(wsChannelExec, env.SubID, wsErrUnsupported, "Exec unsupported for this orchestrator.")
		return
	}

	opts := provider.ExecOptions{Cmd: []string{"/bin/sh"}, Tty: true}
	if env.Payload != nil {
		if cmd := toStringSlice(env.Payload["cmd"]); len(cmd) > 0 {
			opts.Cmd = cmd
		}
		if tty, ok := env.Payload["tty"].(bool); ok {
			opts.Tty = tty
		}
		if envv := toStringSlice(env.Payload["env"]); len(envv) > 0 {
			opts.Env = envv
		}
		if wd, ok := env.Payload["workingDir"].(string); ok {
			opts.WorkingDir = wd
		}
		// K8s pods host multiple containers; the client selects which one to exec
		// into via "container" (the Docker provider ignores it). "" lets the
		// apiserver pick the pod's default/first container.
		if c, ok := env.Payload["container"].(string); ok {
			opts.Container = c
		}
	}

	subCtx, cancel := context.WithCancel(wc.ctx)
	if !wc.registerSub(env.SubID, wsChannelExec, cancel) {
		cancel()
		wc.sendError(wsChannelExec, env.SubID, wsErrBadRequest, "subId already in use.")
		return
	}

	stream, err := p.Exec(subCtx, wl.ID, opts)
	if err != nil {
		cancel()
		wc.removeSub(env.SubID)
		wc.sendStreamError(wsChannelExec, env.SubID, err)
		return
	}
	// Audit the exec (distinct, always-audited action).
	wc.auditExec(wl, opts)
	wc.sendAck(wsChannelExec, env.SubID, hostID)

	// Track the stream so client data frames (stdin/resize) reach it.
	wc.execStreams.Store(env.SubID, stream)

	go func() {
		defer wc.removeSub(env.SubID)
		defer wc.execStreams.Delete(env.SubID)
		defer func() { _ = stream.Close() }()

		ref := &wsRef{Kind: refKind(wl.Kind), ID: wl.ID}
		buf := make([]byte, 32*1024)
		for {
			if subCtx.Err() != nil {
				return
			}
			n, rerr := stream.Read(buf)
			if n > 0 {
				wc.writeFrame(wsEnvelope{
					V: wsVersion, Type: wsTypeData, Channel: wsChannelExec,
					SubID: env.SubID, HostID: hostID, Ref: ref, TS: nowRFC3339(),
					Payload: map[string]any{
						"stream": "stdout",
						"data":   base64.StdEncoding.EncodeToString(buf[:n]),
					},
				})
			}
			if rerr != nil {
				code, _ := stream.ExitCode(context.Background())
				wc.writeFrame(wsEnvelope{
					V: wsVersion, Type: wsTypeData, Channel: wsChannelExec,
					SubID: env.SubID, HostID: hostID, Ref: ref, TS: nowRFC3339(),
					Payload: map[string]any{"exitCode": code},
				})
				wc.sendEnd(wsChannelExec, env.SubID)
				return
			}
		}
	}()
}

func (wc *wsConn) auditExec(wl provider.Workload, opts provider.ExecOptions) {
	detail, _ := jsonString(map[string]any{"cmd": opts.Cmd, "tty": opts.Tty, "container": opts.Container})
	// Target type tracks the orchestrator: a K8s pod exec is audited as "pod"
	// (matching the REST k8s.pod.* audit targets), Docker/Swarm as "container".
	targetType := "container"
	if wl.Kind == provider.KindKubernetes {
		targetType = "pod"
	}
	_ = wc.srv.store.InsertAudit(wc.ctx, store.AuditInput{
		TS:         time.Now().Unix(),
		ActorID:    wc.user.ID,
		ActorName:  wc.user.Username,
		Action:     "docker.container.exec",
		TargetType: targetType,
		TargetID:   wl.ID,
		TargetName: wl.Name,
		Result:     "success",
		HTTPStatus: 0,
		Detail:     detail,
	})
}

// handleData routes a client data frame (exec stdin / resize).
func (wc *wsConn) handleData(env wsEnvelope) {
	if env.Channel != wsChannelExec {
		return
	}
	v, ok := wc.execStreams.Load(env.SubID)
	if !ok {
		return
	}
	stream, _ := v.(provider.ExecStream)
	if stream == nil || env.Payload == nil {
		return
	}
	if stdin, ok := env.Payload["stdin"].(string); ok {
		// The client contract (Terminal.tsx) sends stdin as raw UTF-8 keystrokes,
		// never base64. Sniffing for base64 here would corrupt any multi-char
		// chunk that happens to be valid base64 (e.g. pasted text, fast typing).
		_, _ = stream.Write([]byte(stdin))
	}
	if resize, ok := env.Payload["resize"].(map[string]any); ok {
		rows, _ := resize["rows"].(float64)
		cols, _ := resize["cols"].(float64)
		_ = stream.Resize(wc.ctx, uint16(rows), uint16(cols))
	}
}

// --- frame writers (single mutex-guarded writer) ---

func (wc *wsConn) writeFrame(env wsEnvelope) {
	wc.writeMu.Lock()
	defer wc.writeMu.Unlock()
	writeCtx, cancel := context.WithTimeout(wc.ctx, 10*time.Second)
	defer cancel()
	_ = wsjson.Write(writeCtx, wc.conn, env)
}

func (wc *wsConn) sendAck(channel, subID, hostID string) {
	wc.writeFrame(wsEnvelope{V: wsVersion, Type: wsTypeAck, Channel: channel, SubID: subID, HostID: hostID})
}

func (wc *wsConn) sendEnd(channel, subID string) {
	wc.writeFrame(wsEnvelope{V: wsVersion, Type: wsTypeEnd, Channel: channel, SubID: subID})
}

func (wc *wsConn) sendError(channel, subID, code, msg string) {
	wc.writeFrame(wsEnvelope{
		V: wsVersion, Type: wsTypeError, Channel: channel, SubID: subID,
		Payload: map[string]any{"code": code, "message": msg},
	})
}

// sendStreamError maps a provider error to a WS error code.
func (wc *wsConn) sendStreamError(channel, subID string, err error) {
	code := wsErrBadRequest
	switch {
	case errors.Is(err, provider.ErrUnsupported):
		code = wsErrUnsupported
	case errors.Is(err, provider.ErrNotFound):
		code = wsErrNotFound
	}
	wc.sendError(channel, subID, code, "Stream error.")
}

// --- helpers ---

func refKind(k provider.OrchestratorKind) string {
	switch k {
	case provider.KindSwarm:
		return "task"
	case provider.KindKubernetes:
		return "pod"
	default:
		return "container"
	}
}

func toStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// originPatterns converts configured origins into host patterns for the library.
func originPatterns(origins []string) []string {
	if len(origins) == 0 {
		return nil
	}
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		// Strip scheme; the library matches against the Host header.
		host := o
		if i := indexOf(host, "://"); i >= 0 {
			host = host[i+3:]
		}
		out = append(out, host)
	}
	return out
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// jsonString marshals v to a compact JSON string for audit detail.
func jsonString(v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
