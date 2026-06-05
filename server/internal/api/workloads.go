package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider"
)

// timeoutRequest is the optional body for stop/restart.
type timeoutRequest struct {
	TimeoutSeconds *int `json:"timeoutSeconds"`
}

// removeRequest is the optional admin-override body for DELETE on a protected
// (labelled, non-self) workload.
type removeRequest struct {
	Confirm bool   `json:"confirm"`
	Reason  string `json:"reason"`
}

// Workloads serves the unified workload list FROM CACHE (never an inline daemon
// call), filtered by kind/group/namespace/labelSelector.
func (s *Server) Workloads(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	snap, ok := s.manager.Store().Get(hostID)
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}

	q := r.URL.Query()
	kind := q.Get("kind")
	group := q.Get("group")
	namespace := q.Get("namespace")
	includeAll := q.Get("all") == "true"
	labelSel := parseLabelSelector(q.Get("labelSelector"))

	var combined []provider.Workload
	if kind == "" || kind == "docker" {
		combined = append(combined, snap.Workloads...)
	}
	if kind == "" || kind == "swarm" {
		combined = append(combined, snap.Swarm...)
	}
	if kind == "" || kind == "kubernetes" {
		combined = append(combined, snap.Kube...)
	}

	out := make([]provider.Workload, 0, len(combined))
	for _, wl := range combined {
		if !includeAll && wl.Kind == provider.KindDocker && wl.State == provider.StateStopped {
			// default view hides stopped docker containers unless all=true
			continue
		}
		if group != "" && wl.Group != group {
			continue
		}
		if namespace != "" && wl.Kind == provider.KindKubernetes && !strings.HasPrefix(wl.ID, namespace+"/") {
			continue
		}
		if !matchesLabels(wl.Labels, labelSel) {
			continue
		}
		out = append(out, wl)
	}
	respondWorkloads(w, out)
}

// WorkloadDetail returns one workload's inspect detail. The id may contain '/'
// (k8s "<ns>/<pod>") so it is captured as the trailing wildcard segment.
func (s *Server) WorkloadDetail(w http.ResponseWriter, r *http.Request) {
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
	detail, err := p.InspectWorkload(r.Context(), id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}

	// Mask secret-like env values in the raw inspect unless the caller holds the
	// admin-only docker.container.inspect.secrets permission.
	u := authz.UserFrom(r)
	if !u.Can("docker.container.inspect.secrets", authz.Scope{Type: "global"}) {
		detail.Raw = maskSecretEnv(detail.Raw)
	}
	authz.WriteJSON(w, http.StatusOK, detail)
}

// resolveForMutation finds the workload, resolves its provider, and rejects
// read-only providers up front (defense alongside the provider's ErrUnsupported).
func (s *Server) resolveForMutation(w http.ResponseWriter, r *http.Request) (provider.Provider, provider.Workload, bool) {
	hostID := chi.URLParam(r, "hostID")
	id := workloadID(r)

	wl, found := s.manager.Store().FindWorkload(hostID, id)
	if !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return nil, provider.Workload{}, false
	}
	authz.SetAuditTarget(r, "container", wl.ID, wl.Name)

	p, ok := s.reg.Get(wl.ProviderID)
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return nil, provider.Workload{}, false
	}
	if p.Capabilities().Has(provider.CapReadOnly) {
		authz.WriteError(w, r, authz.ErrMethodNotAllowed)
		return nil, provider.Workload{}, false
	}
	return p, wl, true
}

// StartWorkload starts a container (perm docker.container.start).
func (s *Server) StartWorkload(w http.ResponseWriter, r *http.Request) {
	p, wl, ok := s.resolveForMutation(w, r)
	if !ok {
		return
	}
	if err := p.Start(r.Context(), wl.ID); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// StopWorkload stops a container (perm docker.container.stop). Guarded.
func (s *Server) StopWorkload(w http.ResponseWriter, r *http.Request) {
	p, wl, okv := s.resolveForMutation(w, r)
	if !okv {
		return
	}
	var req timeoutRequest
	_ = optionalJSON(r, &req)

	if err := s.guardContainer(r, wl, false, ""); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := p.Stop(r.Context(), wl.ID, durationPtr(req.TimeoutSeconds)); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// RestartWorkload restarts a container (perm docker.container.restart). Guarded.
func (s *Server) RestartWorkload(w http.ResponseWriter, r *http.Request) {
	p, wl, okv := s.resolveForMutation(w, r)
	if !okv {
		return
	}
	var req timeoutRequest
	_ = optionalJSON(r, &req)

	if err := s.guardContainer(r, wl, false, ""); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := p.Restart(r.Context(), wl.ID, durationPtr(req.TimeoutSeconds)); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// RemoveWorkload removes a container (perm docker.container.remove). Guarded;
// protected -> 409. Admin override on a labelled (non-self) container requires
// {confirm:true, reason}.
func (s *Server) RemoveWorkload(w http.ResponseWriter, r *http.Request) {
	p, wl, okv := s.resolveForMutation(w, r)
	if !okv {
		return
	}
	q := r.URL.Query()
	force := q.Get("force") == "true"
	volumes := q.Get("volumes") == "true"

	var req removeRequest
	_ = optionalJSON(r, &req)

	if err := s.guardContainer(r, wl, req.Confirm, req.Reason); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := p.Remove(r.Context(), wl.ID, provider.RemoveOptions{Force: force, RemoveVolumes: volumes}); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// guardContainer runs GuardDestructive for a workload target.
func (s *Server) guardContainer(r *http.Request, wl provider.Workload, confirm bool, reason string) error {
	ref := authz.ContainerRef{
		ID:        wl.ID,
		Name:      wl.Name,
		Labels:    wl.Labels,
		Protected: wl.Protected,
		Kind:      "container",
	}
	return s.guard.GuardDestructive(r.Context(), r, ref, authz.UserFrom(r), confirm, reason)
}

// --- helpers ---

// workloadID extracts the workload id from the {id} route param. For k8s
// "<ns>/<pod>" ids the UI URL-encodes the slash (%2F); chi does NOT decode
// encoded slashes in a path segment, so we unescape here before lookup.
func workloadID(r *http.Request) string {
	raw := chi.URLParam(r, "id")
	if dec, err := url.PathUnescape(raw); err == nil {
		return dec
	}
	return raw
}

func durationPtr(seconds *int) *time.Duration {
	if seconds == nil {
		return nil
	}
	d := time.Duration(*seconds) * time.Second
	return &d
}

// ok2 writes the standard ActionResult success body.
func ok2(w http.ResponseWriter) { authz.WriteJSON(w, http.StatusOK, ActionResult{OK: true}) }

// respondWorkloads writes a workload slice, guaranteeing a JSON array (not null).
func respondWorkloads(w http.ResponseWriter, wls []provider.Workload) {
	if wls == nil {
		wls = []provider.Workload{}
	}
	ok(w, wls)
}

func parseLabelSelector(s string) map[string]string {
	if s == "" {
		return nil
	}
	out := map[string]string{}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) == 2 {
			out[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		} else {
			out[part] = ""
		}
	}
	return out
}

func matchesLabels(labels, selector map[string]string) bool {
	if len(selector) == 0 {
		return true
	}
	for k, v := range selector {
		got, ok := labels[k]
		if !ok {
			return false
		}
		if v != "" && got != v {
			return false
		}
	}
	return true
}

// optionalJSON decodes an optional JSON body; an empty body is not an error.
func optionalJSON(r *http.Request, dst any) error {
	if r.Body == nil || r.ContentLength == 0 {
		return nil
	}
	lr := io.LimitReader(r.Body, maxBodyBytes)
	dec := json.NewDecoder(lr)
	if err := dec.Decode(dst); err != nil && err != io.EOF {
		return err
	}
	return nil
}

// logsQueryTail parses the tail query param with a default.
func logsQueryTail(r *http.Request, def int) int {
	if v := r.URL.Query().Get("tail"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return def
}
