package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/updates"
)

// updateCheckRequestTimeout caps a synchronous on-demand check (per-registry
// requests are already capped at 15s inside the checker).
const updateCheckRequestTimeout = 2 * time.Minute

// recreateTimeout caps one pull+recreate (mirrors PullImage's generous cap).
const recreateTimeout = 10 * time.Minute

// ListUpdates returns the last computed image-update statuses for a host (perm
// docker.container.read). Served from the manager's in-memory results — never
// an inline registry call.
func (s *Server) ListUpdates(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, found := s.manager.Store().Get(hostID); !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ok(w, s.manager.UpdateStatuses(hostID))
}

// CheckUpdates triggers an immediate update check (perm docker.image.pull —
// it performs outbound registry I/O with stored credentials, like a pull) and
// returns the fresh statuses.
func (s *Server) CheckUpdates(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, found := s.manager.Store().Get(hostID); !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	authz.SetAuditTarget(r, "host", hostID, hostID)

	cctx, cancel := contextWithTimeout(r, updateCheckRequestTimeout)
	defer cancel()
	if err := s.manager.CheckUpdatesOnce(cctx); err != nil {
		// A sweep can run for minutes; a second caller must not queue behind it.
		if errors.Is(err, cache.ErrUpdateCheckRunning) {
			authz.WriteError(w, r, authz.Errorf(authz.ErrConflict,
				"An update check is already running. Retry once it finishes."))
			return
		}
		writeMapped(w, r, err)
		return
	}
	ok(w, s.manager.UpdateStatuses(hostID))
}

// UpdateWorkload recreates a docker container on the newest image for its
// original reference (perm docker.container.update). A recreate is a
// stop+remove+create, so it runs the SAME destructive-action guard as
// stop/remove: self-protection plus the configurable protected labels
// (security.protected_labels setting), with the stop/remove admin-override
// semantics ({confirm, reason} body). The provider refuses hard-protected
// targets again (defense-in-depth).
func (s *Server) UpdateWorkload(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := workloadID(r)

	wl, found := s.manager.Store().FindWorkload(hostID, id)
	if !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	authz.SetAuditTarget(r, "container", wl.ID, wl.Name)

	if wl.Kind != provider.KindDocker {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation,
			"Only standalone Docker containers can be updated in place."))
		return
	}
	var req removeRequest
	_ = optionalJSON(r, &req)
	if err := s.guardContainer(r, wl, req.Confirm, req.Reason); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	dp := s.manager.Docker()
	if dp == nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	// The pull+recreate must not be aborted midway by a dropped client
	// connection (that could strand the container renamed aside), so detach
	// from the request context (mirrors PullImage) with a hard cap.
	rctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), recreateTimeout)
	defer cancel()
	if _, err := dp.RecreateWithImage(rctx, wl.ID); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// registryCredentials builds the updates.CredentialFunc used by the checker:
// it matches the registry host against stored registries and unseals the
// credential just-in-time. Unsealing stays in the API layer (which owns the
// secret key), mirroring the registries.go pattern; the plaintext never leaves
// the returned closure.
func registryCredentials(st *store.Store, secretKey []byte) updates.CredentialFunc {
	return func(ctx context.Context, host string) (string, string, bool) {
		regs, err := st.ListRegistries(ctx)
		if err != nil {
			return "", "", false
		}
		for _, rg := range regs {
			if !rg.HasSecret() || !registryMatchesHost(rg, host) {
				continue
			}
			secret, err := authz.OpenSecret(secretKey, rg.SecretEnc)
			if err != nil {
				continue
			}
			return rg.Username, string(secret), true
		}
		return "", "", false
	}
}

// registryMatchesHost reports whether a stored registry credential applies to
// the given registry host (the normalized image-ref domain).
func registryMatchesHost(rg *store.Registry, host string) bool {
	if u := strings.TrimSpace(rg.URL); u != "" {
		u = strings.TrimPrefix(u, "https://")
		u = strings.TrimPrefix(u, "http://")
		if i := strings.IndexByte(u, '/'); i >= 0 {
			u = u[:i]
		}
		if strings.EqualFold(u, host) {
			return true
		}
	}
	switch rg.Type {
	case "dockerhub":
		return host == "docker.io"
	case "ghcr":
		return host == "ghcr.io"
	case "quay":
		return host == "quay.io"
	}
	return false
}
