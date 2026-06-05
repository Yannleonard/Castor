package api

import "time"

// WS protocol constants (ADR-CASTOR-001 envelope).
const (
	wsVersion = 1

	wsTypeSubscribe   = "subscribe"
	wsTypeUnsubscribe = "unsubscribe"
	wsTypeData        = "data"
	wsTypeAck         = "ack"
	wsTypeError       = "error"
	wsTypeEnd         = "end"

	wsChannelStats  = "stats"
	wsChannelLogs   = "logs"
	wsChannelEvents = "events"
	wsChannelExec   = "exec"
)

// wsRef identifies the target workload of a subscription.
type wsRef struct {
	Kind string `json:"kind"` // container|service|node|task|pod
	ID   string `json:"id"`
}

// wsEnvelope is the single frame shape for both directions.
type wsEnvelope struct {
	V       int            `json:"v"`
	Type    string         `json:"type"`
	Channel string         `json:"channel,omitempty"`
	SubID   string         `json:"subId,omitempty"`
	HostID  string         `json:"hostId,omitempty"`
	Ref     *wsRef         `json:"ref,omitempty"`
	TS      string         `json:"ts,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
}

// WS error codes on the error frame.
const (
	wsErrSuperseded     = "superseded"
	wsErrForbidden      = "forbidden"
	wsErrNotFound       = "not_found"
	wsErrUnsupported    = "unsupported"
	wsErrSessionRevoked = "session_revoked"
	wsErrBadRequest     = "bad_request"
	// wsErrAALRequired mirrors the REST aal_required (403) error: the exec
	// subscription needs TOTP step-up that the session has not satisfied.
	wsErrAALRequired = "aal_required"
)

// nowRFC3339 returns the current time as an RFC3339 string for data frames.
func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }
