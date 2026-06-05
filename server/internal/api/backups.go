package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// backupRequest is the body for POST /hosts/{hostID}/backups.
type backupRequest struct {
	Kind   string `json:"kind"`   // "volume" (V1)
	Target string `json:"target"` // volume name to back up
}

// restoreRequest is the body for POST /hosts/{hostID}/backups/{id}/restore.
type restoreRequest struct {
	Target string `json:"target"` // volume name to restore into
}

// backupMaxDuration caps a single backup/restore so a wedged helper container
// cannot hold the request (and the destination file handle) open forever.
const backupMaxDuration = 30 * time.Minute

// backupsDir returns the server-side directory where tar archives are stored,
// derived from the SQLite DB path (defaults to /data/backups alongside
// /data/castor.db). It is created if missing.
func (s *Server) backupsDir() (string, error) {
	base := filepath.Dir(s.cfg.DBPath)
	if base == "" || base == "." {
		base = "/data"
	}
	dir := filepath.Join(base, "backups")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	return dir, nil
}

// validVolumeName reports whether name is a plausible Docker volume name (anti
// path-traversal / injection: the value flows into a docker mount Source and is
// echoed in audit). Docker volume names match [a-zA-Z0-9][a-zA-Z0-9_.-]*.
func validVolumeName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 255 {
		return false
	}
	for i, c := range name {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case (c == '_' || c == '.' || c == '-') && i > 0:
		default:
			return false
		}
	}
	return true
}

// CreateBackup backs up a Docker volume to a tar archive on the server
// (perm docker.volume.backup). It records a row, streams the volume contents to
// /data/backups/<id>.tar.gz via the alpine helper, and finalizes the row with
// the size + completed/failed status.
func (s *Server) CreateBackup(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, ok := s.manager.Store().Get(hostID); !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}

	var req backupRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Kind == "" {
		req.Kind = "volume"
	}
	if req.Kind != "volume" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Only kind \"volume\" is supported."))
		return
	}
	if !validVolumeName(req.Target) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Invalid volume name."))
		return
	}
	authz.SetAuditTarget(r, "volume", req.Target, req.Target)

	dir, err := s.backupsDir()
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	id := store.NewUUID()
	filePath := filepath.Join(dir, id+".tar.gz")
	rec := &store.Backup{
		ID:         id,
		Kind:       "volume",
		HostID:     hostID,
		TargetName: req.Target,
		FilePath:   filePath,
		Status:     "pending",
		CreatedBy:  actorID(r),
	}
	if err := s.store.CreateBackup(r.Context(), rec); err != nil {
		writeMapped(w, r, err)
		return
	}

	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		_ = s.store.UpdateBackupResult(r.Context(), id, "failed", 0, "create archive file: "+err.Error())
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	// The archival may outlive a slow request but must not be cancelled when the
	// handler returns; bind to a detached, time-capped context.
	bgCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), backupMaxDuration)
	defer cancel()

	n, berr := s.manager.Docker().BackupVolume(bgCtx, req.Target, f)
	closeErr := f.Close()
	if berr != nil {
		msg := berr.Error()
		_ = s.store.UpdateBackupResult(r.Context(), id, "failed", n, msg)
		_ = os.Remove(filePath)
		writeMapped(w, r, berr)
		return
	}
	if closeErr != nil {
		_ = s.store.UpdateBackupResult(r.Context(), id, "failed", n, "flush archive: "+closeErr.Error())
		_ = os.Remove(filePath)
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	rec.Status = "completed"
	rec.SizeBytes = n
	if err := s.store.UpdateBackupResult(r.Context(), id, "completed", n, ""); err != nil {
		writeMapped(w, r, err)
		return
	}
	created(w, rec)
}

// Backups lists a host's backups (perm docker.volume.read).
func (s *Server) Backups(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	if _, ok := s.manager.Store().Get(hostID); !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	list, err := s.store.ListBackups(r.Context(), hostID)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if list == nil {
		list = []*store.Backup{}
	}
	ok(w, list)
}

// DownloadBackup streams a backup archive as an attachment (perm
// docker.volume.read).
func (s *Server) DownloadBackup(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := chi.URLParam(r, "id")
	b, err := s.store.GetBackup(r.Context(), hostID, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if b.Status != "completed" || b.FilePath == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "Backup is not available for download."))
		return
	}
	f, err := os.Open(b.FilePath)
	if err != nil {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}

	fname := fmt.Sprintf("%s-%s.tar.gz", b.TargetName, b.ID)
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+sanitizeFilename(fname)+"\"")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, fname, info.ModTime(), f)
}

// RestoreBackup restores a backup archive into a volume (perm
// docker.volume.restore). The target defaults to the originally backed-up
// volume but may be overridden in the body.
func (s *Server) RestoreBackup(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := chi.URLParam(r, "id")

	b, err := s.store.GetBackup(r.Context(), hostID, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	if b.Status != "completed" || b.FilePath == "" {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "Backup is not available for restore."))
		return
	}

	var req restoreRequest
	_ = optionalJSON(r, &req)
	target := strings.TrimSpace(req.Target)
	if target == "" {
		target = b.TargetName
	}
	if !validVolumeName(target) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Invalid volume name."))
		return
	}
	authz.SetAuditTarget(r, "volume", target, target)

	f, err := os.Open(b.FilePath)
	if err != nil {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	defer func() { _ = f.Close() }()

	bgCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), backupMaxDuration)
	defer cancel()

	if err := s.manager.Docker().RestoreVolume(bgCtx, target, f); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// DeleteBackup removes a backup row and its archive file (perm
// docker.volume.backup).
func (s *Server) DeleteBackup(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	id := chi.URLParam(r, "id")

	b, err := s.store.GetBackup(r.Context(), hostID, id)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "backup", b.ID, b.TargetName)

	if err := s.store.DeleteBackup(r.Context(), hostID, id); err != nil {
		writeMapped(w, r, err)
		return
	}
	if b.FilePath != "" {
		_ = os.Remove(b.FilePath)
	}
	ok2(w)
}

// actorID returns the authenticated user's id, or "" if absent.
func actorID(r *http.Request) string {
	if u := authz.UserFrom(r); u != nil {
		return u.ID
	}
	return ""
}

// sanitizeFilename strips characters that could break the Content-Disposition
// header or enable header injection in the download filename.
func sanitizeFilename(name string) string {
	return strings.Map(func(c rune) rune {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
			return c
		case c == '.' || c == '-' || c == '_':
			return c
		default:
			return '_'
		}
	}, name)
}
