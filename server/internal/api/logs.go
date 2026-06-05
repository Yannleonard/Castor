package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

type logLineView struct {
	Stream string `json:"stream"`
	Line   string `json:"line"`
	TS     string `json:"ts,omitempty"`
}

// Logs serves one-shot (non-follow) logs over REST. follow=true returns a 426
// upgrade hint so the UI opens the WS logs channel instead.
func (s *Server) Logs(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := workloadID(r)
	q := r.URL.Query()

	if q.Get("follow") == "true" {
		authz.WriteError(w, r, authz.WithExtra(
			&authz.APIError{Code: "upgrade_required", Message: "Use the WebSocket logs channel to follow.", Status: http.StatusUpgradeRequired},
			map[string]any{"upgrade": "ws", "channel": "logs"},
		))
		return
	}

	wl, found := s.manager.Store().FindWorkload(hostID, id)
	if !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	p, ok := s.reg.Get(wl.ProviderID)
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}

	opts := provider.LogOptions{
		Follow:     false,
		Tail:       logsQueryTail(r, 200),
		Timestamps: q.Get("timestamps") == "true",
		// K8s multi-container pods: ?container= selects which container's logs to
		// read ("" => first/default). Ignored by the Docker/Swarm providers.
		Container: q.Get("container"),
	}
	if since := q.Get("since"); since != "" {
		if t, err := time.Parse(time.RFC3339, since); err == nil {
			opts.Since = t
		}
	}

	rc, err := p.Logs(r.Context(), wl.ID, opts)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	defer func() { _ = rc.Close() }()

	// Demux into structured lines. Use the docker demuxer for docker/swarm
	// (multiplexed stdcopy); k8s logs are already plain text.
	lines := make([]logLineView, 0, 256)
	hasTTY := false
	if dp, isDocker := p.(*docker.DockerProvider); isDocker {
		hasTTY = dp.ContainerHasTTY(r.Context(), wl.ID)
	}

	if wl.Kind == provider.KindKubernetes {
		readPlainLines(rc, func(line string) {
			lines = append(lines, logLineView{Stream: "stdout", Line: line})
		})
	} else {
		_ = docker.DemuxLogs(rc, hasTTY, func(ll docker.LogLine) bool {
			lines = append(lines, logLineView{Stream: ll.Stream, Line: ll.Line})
			return len(lines) < 10000 // hard cap on one-shot size
		})
	}

	authz.WriteJSON(w, http.StatusOK, map[string]any{"lines": lines})
}

// Stats serves a one-shot stats sample over REST (live stats are WS-only).
func (s *Server) Stats(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := workloadID(r)

	wl, found := s.manager.Store().FindWorkload(hostID, id)
	if !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	p, ok := s.reg.Get(wl.ProviderID)
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	if !p.Capabilities().Has(provider.CapStats) {
		authz.WriteError(w, r, authz.ErrMethodNotAllowed)
		return
	}

	// Open the stream, take the first sample, then cancel.
	ctx, cancel := contextWithTimeout(r, 10*time.Second)
	defer cancel()

	ch, err := p.Stats(ctx, wl.ID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	select {
	case sample, ok := <-ch:
		if !ok {
			authz.WriteError(w, r, authz.ErrNotFound)
			return
		}
		authz.WriteJSON(w, http.StatusOK, sample)
	case <-ctx.Done():
		authz.WriteError(w, r, authz.Errorf(authz.ErrInternal, "Timed out collecting a stats sample."))
	}
}
