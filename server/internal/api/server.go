// Package api wires the chi router and the REST/WebSocket handlers. Handlers
// here NEVER import the docker/k8s SDKs directly — reads come from the cache
// snapshot and mutations go through the provider.Registry / cache.Manager.
package api

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
)

// Server bundles the dependencies shared by all handlers.
type Server struct {
	cfg     *config.Config
	store   *store.Store
	authz   *authz.Deps
	guard   *authz.Guard
	manager *cache.Manager
	reg     *provider.Registry
}

// NewServer constructs the API server.
func NewServer(cfg *config.Config, st *store.Store, az *authz.Deps, guard *authz.Guard, mgr *cache.Manager, reg *provider.Registry) *Server {
	return &Server{
		cfg:     cfg,
		store:   st,
		authz:   az,
		guard:   guard,
		manager: mgr,
		reg:     reg,
	}
}

// maxBodyBytes caps request bodies to a sane size (anti-DoS).
const maxBodyBytes = 1 << 20 // 1 MiB

// decodeJSON strictly decodes a JSON request body into dst, enforcing the body
// size cap and rejecting unknown fields and trailing data.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if err == io.EOF {
			return authz.Errorf(authz.ErrValidation, "Request body is empty.")
		}
		return authz.Errorf(authz.ErrValidation, "Invalid request body: "+err.Error())
	}
	// Ensure there is no trailing JSON.
	if dec.More() {
		return authz.Errorf(authz.ErrValidation, "Unexpected trailing data in request body.")
	}
	return nil
}

// noContent writes a 204 with no-store.
func noContent(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// ok writes a 200 JSON response.
func ok(w http.ResponseWriter, v any) { authz.WriteJSON(w, http.StatusOK, v) }

// created writes a 201 JSON response.
func created(w http.ResponseWriter, v any) { authz.WriteJSON(w, http.StatusCreated, v) }

// ActionResult is the body for a successful mutating action.
type ActionResult struct {
	OK bool `json:"ok"`
}

// contextWithTimeout derives a timeout context from the request.
func contextWithTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}

// readPlainLines reads newline-delimited text and invokes fn per line (no
// stdcopy demux). Used for K8s logs, which are already plain text.
func readPlainLines(rc io.Reader, fn func(line string)) {
	sc := bufio.NewScanner(rc)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		fn(sc.Text())
	}
}
