package api

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
)

//go:embed all:agent-binaries/*
var agentBinaries embed.FS

// DownloadAgent serves only the agent binaries shipped with this Castor build.
// It is authenticated because the agent runs with root-equivalent Docker access.
func (s *Server) DownloadAgent(w http.ResponseWriter, r *http.Request) {
	arch := chi.URLParam(r, "arch")
	if arch != "amd64" && arch != "arm64" {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	name := "castor-agent-linux-" + arch
	data, err := agentBinaries.ReadFile("agent-binaries/" + name)
	if err != nil {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	if len(data) < 4 || string(data[:4]) != "\x7fELF" {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	digest := sha256.Sum256(data)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Castor-SHA256", hex.EncodeToString(digest[:]))
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
