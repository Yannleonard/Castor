package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

// sessionTTLFloorSeconds is the minimum sliding session lifetime accepted on
// write. It mirrors authz.minSessionTTL (300s) and the min enforced by the UI.
const sessionTTLFloorSeconds = 300

// defaultAbsoluteTTLSeconds is the fallback ceiling for the persisted sliding
// TTL when the absolute cap is not configured. It mirrors config.Load's 24h
// default for CASTOR_SESSION_ABSOLUTE_TTL.
const defaultAbsoluteTTLSeconds = 24 * 60 * 60

// defaultSessionTTLSeconds is the fallback shown for session.ttl_seconds when
// neither a persisted override nor a configured CASTOR_SESSION_TTL is available.
// It mirrors config.Load's 12h default.
const defaultSessionTTLSeconds = 12 * 60 * 60

// clampSessionTTLSeconds bounds a requested sliding-session lifetime to
// [sessionTTLFloorSeconds, absolute-cap-seconds]. A non-positive cap falls back
// to the 24h default so the ceiling is always sane.
func clampSessionTTLSeconds(v int, absolute time.Duration) int {
	ceil := int(absolute.Seconds())
	if ceil <= 0 {
		ceil = defaultAbsoluteTTLSeconds
	}
	if v < sessionTTLFloorSeconds {
		v = sessionTTLFloorSeconds
	}
	if v > ceil {
		v = ceil
	}
	return v
}

// GetSettings returns the non-secret instance settings.
func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	all, err := s.store.AllSettings(ctx)
	if err != nil {
		writeMapped(w, r, err)
		return
	}

	// When no session.ttl_seconds override is persisted, surface the effective
	// env-derived sliding TTL (CASTOR_SESSION_TTL) so the UI shows what actually
	// governs rather than a magic literal. The row, once saved, takes precedence.
	ttlDefault := defaultSessionTTLSeconds
	if s.cfg.SessionTTL > 0 {
		ttlDefault = int(s.cfg.SessionTTL.Seconds())
	}

	out := map[string]any{
		"bootstrap.completed":           all[store.SettingBootstrapCompleted] == "true",
		"instance.id":                   all[store.SettingInstanceID],
		store.SettingTOTPRequiredForMut: all[store.SettingTOTPRequiredForMut] == "true",
		"session.ttl_seconds":           parseIntDefault(all[store.SettingSessionTTLSeconds], ttlDefault),
		"security.protected_labels":     parseJSONStringList(all[store.SettingProtectedLabels]),
	}
	authz.WriteJSON(w, http.StatusOK, out)
}

type updateSettingsRequest struct {
	TOTPRequiredForMutations *bool     `json:"security.totp_required_for_mutations"`
	SessionTTLSeconds        *int      `json:"session.ttl_seconds"`
	ProtectedLabels          *[]string `json:"security.protected_labels"`
}

// UpdateSettings updates the mutable settings subset (perm settings.update).
func (s *Server) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req updateSettingsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()

	// Persist each provided field. A write failure must surface as an error (and
	// be recorded as such in the audit row) rather than be silently swallowed —
	// otherwise the UI shows "saved" and the audit log shows success for a change
	// that never landed.
	if req.TOTPRequiredForMutations != nil {
		if err := s.store.SetSetting(ctx, store.SettingTOTPRequiredForMut, strconv.FormatBool(*req.TOTPRequiredForMutations)); err != nil {
			writeMapped(w, r, err)
			return
		}
	}
	if req.SessionTTLSeconds != nil {
		// Clamp to sane bounds: a floor of 300s (matches authz.minSessionTTL) and a
		// ceiling of the configured absolute cap — a sliding window longer than the
		// hard session lifetime is meaningless and resolveUser would clamp it anyway.
		v := clampSessionTTLSeconds(*req.SessionTTLSeconds, s.cfg.SessionAbsoluteTTL)
		if err := s.store.SetSetting(ctx, store.SettingSessionTTLSeconds, strconv.Itoa(v)); err != nil {
			writeMapped(w, r, err)
			return
		}
	}
	if req.ProtectedLabels != nil {
		b, _ := json.Marshal(*req.ProtectedLabels)
		if err := s.store.SetSetting(ctx, store.SettingProtectedLabels, string(b)); err != nil {
			writeMapped(w, r, err)
			return
		}
	}

	s.GetSettings(w, r)
}

func parseJSONStringList(s string) []string {
	if s == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(s), &out); err != nil || out == nil {
		return []string{}
	}
	return out
}
