package api

import (
	"net/http"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

// pruneRequest is the body for POST /hosts/{hostID}/prune. Target selects which
// unused resources to reclaim; dangling only applies to target "images"
// (true = untagged images only, the Docker default; false = all unused images).
type pruneRequest struct {
	Target   string `json:"target"`
	Dangling *bool  `json:"dangling"`
}

// pruneResponse is the summary returned by a prune: the ids/names removed and the
// disk space reclaimed in bytes.
type pruneResponse struct {
	Removed        []string `json:"removed"`
	SpaceReclaimed uint64   `json:"spaceReclaimed"`
}

// Prune reclaims unused Docker resources (perm docker.system.prune; operator).
// Body: {target: "images"|"containers"|"volumes"|"networks", dangling?: bool}.
func (s *Server) Prune(w http.ResponseWriter, r *http.Request) {
	var req pruneRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "system", req.Target, req.Target)

	// dangling defaults to true (untagged-only) when omitted, matching the Docker
	// CLI default for `docker image prune`.
	dangling := true
	if req.Dangling != nil {
		dangling = *req.Dangling
	}

	var (
		rep *docker.PruneReport
		err error
	)
	switch req.Target {
	case "images":
		rep, err = s.manager.Docker().PruneImages(r.Context(), dangling)
	case "containers":
		rep, err = s.manager.Docker().PruneContainers(r.Context())
	case "volumes":
		rep, err = s.manager.Docker().PruneVolumes(r.Context())
	case "networks":
		rep, err = s.manager.Docker().PruneNetworks(r.Context())
	default:
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation,
			"Invalid prune target (want images|containers|volumes|networks)."))
		return
	}
	if err != nil {
		writeMapped(w, r, err)
		return
	}

	removed := rep.Removed
	if removed == nil {
		removed = []string{}
	}
	ok(w, pruneResponse{Removed: removed, SpaceReclaimed: rep.SpaceReclaimed})
}
