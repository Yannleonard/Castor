package authz

import (
	"context"
	"net/http"
	"sync"
)

// auditRecord is the mutable per-request audit accumulator. Handlers and
// middlewares enrich it; AuditWrap persists it once at the end on mutating
// routes. It is concurrency-guarded because a handler and the recover path may
// both touch it.
type auditRecord struct {
	mu         sync.Mutex
	Action     string
	TargetType string
	TargetID   string
	TargetName string
	ScopeType  string
	ScopeID    string
	Result     string // "success" | "denied" | "error"
	Detail     map[string]any
	// set true once an explicit result was recorded; otherwise AuditWrap infers
	// from the HTTP status.
	resultSet bool
}

type ctxAuditKey struct{}

// withAudit attaches a fresh audit record to the context.
func withAudit(ctx context.Context) (context.Context, *auditRecord) {
	rec := &auditRecord{Detail: map[string]any{}}
	return context.WithValue(ctx, ctxAuditKey{}, rec), rec
}

// auditFrom returns the request's audit record, or nil if none was attached
// (i.e. a non-mutating route).
func auditFrom(r *http.Request) *auditRecord {
	rec, _ := r.Context().Value(ctxAuditKey{}).(*auditRecord)
	return rec
}

// SetAuditTarget records the target of a mutating action (called by handlers
// before invoking the provider). Safe to call on non-mutating routes (no-op).
func SetAuditTarget(r *http.Request, targetType, targetID, targetName string) {
	if rec := auditFrom(r); rec != nil {
		rec.mu.Lock()
		rec.TargetType = targetType
		rec.TargetID = targetID
		rec.TargetName = targetName
		rec.mu.Unlock()
	}
}

// SetAuditScope records the scope of a mutating action.
func SetAuditScope(r *http.Request, scopeType, scopeID string) {
	if rec := auditFrom(r); rec != nil {
		rec.mu.Lock()
		rec.ScopeType = scopeType
		rec.ScopeID = scopeID
		rec.mu.Unlock()
	}
}

// AddAuditDetail merges a sanitized key/value into the audit detail. Callers
// MUST NOT pass secrets; values are redacted defensively before persistence.
func AddAuditDetail(r *http.Request, key string, value any) {
	if rec := auditFrom(r); rec != nil {
		rec.mu.Lock()
		rec.Detail[key] = value
		rec.mu.Unlock()
	}
}

// SetAuditResult forces the audit result ("success" | "denied" | "error") for a
// mutating/audited route whose final HTTP status would otherwise be inferred
// incorrectly. The canonical case is a 302 redirect (e.g. the OIDC login
// callback): AuditWrap infers "error" from a non-2xx status, so a successful or
// explicitly-denied browser-redirect flow must record its real outcome here.
// Safe (no-op) on non-audited routes.
func SetAuditResult(r *http.Request, result string) {
	markResult(r, result, nil)
}

// markDenied records an authorization denial on the audit record.
func markDenied(r *http.Request, perm string) {
	if rec := auditFrom(r); rec != nil {
		rec.mu.Lock()
		rec.Result = "denied"
		rec.resultSet = true
		rec.Detail["missingPermission"] = perm
		rec.mu.Unlock()
	}
}

// markResult forces an explicit audit result (e.g. "denied" from the guard).
func markResult(r *http.Request, result string, detail map[string]any) {
	if rec := auditFrom(r); rec != nil {
		rec.mu.Lock()
		rec.Result = result
		rec.resultSet = true
		for k, v := range detail {
			rec.Detail[k] = v
		}
		rec.mu.Unlock()
	}
}
