package store

import (
	"context"
	"database/sql"
	"strings"
)

// AuditInput is the data written for one audit_log row. detail must already be
// sanitized (no secrets) by the caller (authz.redact).
type AuditInput struct {
	TS         int64
	ActorID    string
	ActorName  string
	ActorIP    string
	Action     string
	TargetType string
	TargetID   string
	TargetName string
	ScopeType  string
	ScopeID    string
	Result     string // "success" | "denied" | "error"
	HTTPStatus int
	Detail     string // sanitized JSON
	RequestID  string
}

// InsertAudit appends one audit row. The audit_log is append-only.
func (s *Store) InsertAudit(ctx context.Context, a AuditInput) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO audit_log (ts, actor_id, actor_name, actor_ip, action,
			target_type, target_id, target_name, scope_type, scope_id, result,
			http_status, detail, request_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.TS, nullStr(a.ActorID), a.ActorName, nullStr(a.ActorIP), a.Action,
		a.TargetType, nullStr(a.TargetID), nullStr(a.TargetName),
		nullStr(a.ScopeType), nullStr(a.ScopeID), a.Result,
		nullIntZero(a.HTTPStatus), nullStr(a.Detail), nullStr(a.RequestID),
	)
	return err
}

// AuditFilter narrows the audit query. Zero-value fields are ignored.
type AuditFilter struct {
	ActorID    string
	Action     string
	TargetType string
	TargetID   string
	Result     string
	From       int64 // epoch, 0 = unbounded
	To         int64 // epoch, 0 = unbounded
	Limit      int   // default 100, max 500
	Cursor     int64 // keyset: return rows with id < cursor (0 = newest)
}

// ListAudit returns audit rows newest-first (id desc) with keyset pagination.
// It returns the rows and the next cursor (id of the last row, 0 if exhausted).
func (s *Store) ListAudit(ctx context.Context, f AuditFilter) ([]*AuditEntry, int64, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	var (
		where []string
		args  []any
	)
	if f.ActorID != "" {
		where = append(where, "actor_id = ?")
		args = append(args, f.ActorID)
	}
	if f.Action != "" {
		where = append(where, "action = ?")
		args = append(args, f.Action)
	}
	if f.TargetType != "" {
		where = append(where, "target_type = ?")
		args = append(args, f.TargetType)
	}
	if f.TargetID != "" {
		where = append(where, "target_id = ?")
		args = append(args, f.TargetID)
	}
	if f.Result != "" {
		where = append(where, "result = ?")
		args = append(args, f.Result)
	}
	if f.From > 0 {
		where = append(where, "ts >= ?")
		args = append(args, f.From)
	}
	if f.To > 0 {
		where = append(where, "ts <= ?")
		args = append(args, f.To)
	}
	if f.Cursor > 0 {
		where = append(where, "id < ?")
		args = append(args, f.Cursor)
	}

	q := `SELECT id, ts, actor_id, actor_name, actor_ip, action, target_type,
		target_id, target_name, scope_type, scope_id, result, http_status,
		detail, request_id FROM audit_log`
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += " ORDER BY id DESC LIMIT ?"
	args = append(args, limit+1) // fetch one extra to compute the next cursor

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = rows.Close() }()

	var out []*AuditEntry
	for rows.Next() {
		var e AuditEntry
		var actorID, actorIP, targetID, targetName, scopeType, scopeID, detail, reqID sql.NullString
		var httpStatus sql.NullInt64
		if err := rows.Scan(
			&e.ID, &e.TS, &actorID, &e.ActorName, &actorIP, &e.Action, &e.TargetType,
			&targetID, &targetName, &scopeType, &scopeID, &e.Result, &httpStatus,
			&detail, &reqID,
		); err != nil {
			return nil, 0, err
		}
		e.ActorID = actorID.String
		e.ActorIP = actorIP.String
		e.TargetID = targetID.String
		e.TargetName = targetName.String
		e.ScopeType = scopeType.String
		e.ScopeID = scopeID.String
		e.Detail = detail.String
		e.RequestID = reqID.String
		e.HTTPStatus = int(httpStatus.Int64)
		out = append(out, &e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	var next int64
	if len(out) > limit {
		out = out[:limit]
		next = out[len(out)-1].ID
	}
	return out, next, nil
}

func nullIntZero(n int) any {
	if n == 0 {
		return nil
	}
	return n
}
