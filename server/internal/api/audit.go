package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/store"
)

type auditItemView struct {
	ID         int64           `json:"id"`
	TS         string          `json:"ts"`
	TSEpoch    int64           `json:"tsEpoch"`
	ActorID    string          `json:"actorId"`
	ActorName  string          `json:"actorName"`
	ActorIP    string          `json:"actorIp"`
	Action     string          `json:"action"`
	TargetType string          `json:"targetType"`
	TargetID   string          `json:"targetId"`
	TargetName string          `json:"targetName"`
	ScopeType  string          `json:"scopeType"`
	ScopeID    string          `json:"scopeId"`
	Result     string          `json:"result"`
	HTTPStatus int             `json:"httpStatus"`
	Detail     json.RawMessage `json:"detail"`
	RequestID  string          `json:"requestId"`
}

// Audit returns audit rows (newest-first) with keyset pagination. perm audit.read.
func (s *Server) Audit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.AuditFilter{
		ActorID:    q.Get("actorId"),
		Action:     q.Get("action"),
		TargetType: q.Get("targetType"),
		TargetID:   q.Get("targetId"),
		Result:     q.Get("result"),
		From:       parseEpoch(q.Get("from")),
		To:         parseEpoch(q.Get("to")),
		Limit:      parseIntDefault(q.Get("limit"), 100),
		Cursor:     parseEpoch(q.Get("cursor")),
	}

	entries, next, err := s.store.ListAudit(r.Context(), f)
	if err != nil {
		writeMapped(w, r, err)
		return
	}

	items := make([]auditItemView, 0, len(entries))
	for _, e := range entries {
		detail := json.RawMessage("null")
		if e.Detail != "" && json.Valid([]byte(e.Detail)) {
			detail = json.RawMessage(e.Detail)
		}
		items = append(items, auditItemView{
			ID:         e.ID,
			TS:         time.Unix(e.TS, 0).UTC().Format(time.RFC3339),
			TSEpoch:    e.TS,
			ActorID:    e.ActorID,
			ActorName:  e.ActorName,
			ActorIP:    e.ActorIP,
			Action:     e.Action,
			TargetType: e.TargetType,
			TargetID:   e.TargetID,
			TargetName: e.TargetName,
			ScopeType:  e.ScopeType,
			ScopeID:    e.ScopeID,
			Result:     e.Result,
			HTTPStatus: e.HTTPStatus,
			Detail:     detail,
			RequestID:  e.RequestID,
		})
	}

	var nextCursor any
	if next > 0 {
		nextCursor = strconv.FormatInt(next, 10)
	}
	authz.WriteJSON(w, http.StatusOK, map[string]any{
		"items":      items,
		"nextCursor": nextCursor,
	})
}

func parseEpoch(s string) int64 {
	if s == "" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}
