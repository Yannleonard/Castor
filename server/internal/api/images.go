package api

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

type imagePullRequest struct {
	Ref string `json:"ref"`
}

// Images lists images from the cache snapshot.
func (s *Server) Images(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	imgs := snap.Images
	if imgs == nil {
		imgs = []docker.ImageInfo{}
	}
	ok2json(w, imgs)
}

// PullImage pulls an image by validated ref (anti-SSRF: image refs only, no
// URLs). It drains the progress stream and returns 202 once started; live
// progress is surfaced via WS events.
func (s *Server) PullImage(w http.ResponseWriter, r *http.Request) {
	var req imagePullRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if !docker.ValidImageRef(req.Ref) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Invalid image reference."))
		return
	}
	authz.SetAuditTarget(r, "image", req.Ref, req.Ref)

	// The pull outlives this request: we return 202 immediately and the daemon
	// keeps streaming layers. Bind it to a DETACHED context (NOT r.Context(),
	// which net/http cancels the moment the handler returns — that would abort
	// the pull after only a few bytes). A generous timeout caps a stuck pull.
	pullCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Minute)

	rc, err := s.manager.Docker().PullImage(pullCtx, req.Ref)
	if err != nil {
		cancel()
		writeMapped(w, r, err)
		return
	}
	// Drain (and discard) the progress stream so the pull runs to completion; the
	// cache watcher emits image events that the UI consumes.
	go func() {
		defer cancel()
		defer func() { _ = rc.Close() }()
		buf := make([]byte, 32*1024)
		for {
			if _, rerr := rc.Read(buf); rerr != nil {
				return
			}
		}
	}()

	authz.WriteJSON(w, http.StatusAccepted, map[string]any{"ok": true, "ref": req.Ref})
}

// DeleteImage removes an image by id (perm docker.image.delete; admin).
func (s *Server) DeleteImage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	force := r.URL.Query().Get("force") == "true"
	authz.SetAuditTarget(r, "image", id, id)

	if err := s.manager.Docker().DeleteImage(r.Context(), id, force); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// ok2json writes a 200 array response, never null.
func ok2json(w http.ResponseWriter, v any) { authz.WriteJSON(w, http.StatusOK, v) }
