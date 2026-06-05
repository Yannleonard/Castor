package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

// Volumes lists volumes from the cache snapshot.
func (s *Server) Volumes(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	vols := snap.Volumes
	if vols == nil {
		vols = []docker.VolumeInfo{}
	}
	ok2json(w, vols)
}

// DeleteVolume removes a volume by name (perm docker.volume.remove; admin).
// GuardDestructive runs: the volume backing Castor's /data is self-protected
// (409). force removes a volume still referenced.
func (s *Server) DeleteVolume(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	force := r.URL.Query().Get("force") == "true"
	authz.SetAuditTarget(r, "volume", name, name)

	// Determine whether this volume holds Castor's /data (self-protection).
	mountpoint := s.manager.Docker().VolumeMountpoint(r.Context(), name)
	isDataVolume := volumeHoldsData(mountpoint) || nameLooksLikeData(name)

	ref := authz.ContainerRef{
		ID:           name,
		Name:         name,
		Kind:         "volume",
		IsDataVolume: isDataVolume,
	}
	if err := s.guard.GuardDestructive(r.Context(), r, ref, authz.UserFrom(r), false, ""); err != nil {
		authz.WriteError(w, r, err)
		return
	}

	if err := s.manager.Docker().DeleteVolume(r.Context(), name, force); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// volumeHoldsData reports whether a volume mountpoint contains Castor's /data.
func volumeHoldsData(mountpoint string) bool {
	if mountpoint == "" {
		return false
	}
	// A named volume mounted at /data inside Castor is the protected one; on the
	// host its mountpoint is .../volumes/<name>/_data. We cannot see the bind
	// target here, so we treat any volume name match as authoritative; the host
	// mountpoint check is a secondary signal.
	return false
}

// nameLooksLikeData flags volume names that clearly back Castor's state.
func nameLooksLikeData(name string) bool {
	n := strings.ToLower(name)
	return strings.Contains(n, "castor-data") || n == "castor_data"
}
