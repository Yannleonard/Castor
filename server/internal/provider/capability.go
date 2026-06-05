package provider

// Capability is a bitset of operations a Provider supports. The API serializes
// the active flags to the UI (as a string array) so write affordances are
// greyed out BEFORE the user clicks — never "click then 405".
type Capability uint32

const (
	// CapList — ListWorkloads.
	CapList Capability = 1 << iota
	// CapInspect — InspectWorkload.
	CapInspect
	// CapLogs — Logs (stream).
	CapLogs
	// CapStats — Stats (stream).
	CapStats
	// CapStart — Start.
	CapStart
	// CapStop — Stop.
	CapStop
	// CapRestart — Restart.
	CapRestart
	// CapRemove — Remove.
	CapRemove
	// CapExec — Exec.
	CapExec
	// CapEvents — engine event stream (Docker V1 only).
	CapEvents
	// CapImages — image management (Docker V1 only).
	CapImages
	// CapNetworks — network management (Docker V1 only).
	CapNetworks
	// CapVolumes — volume management (Docker V1 only).
	CapVolumes
	// CapReadOnly — marker: provider performs NO mutations.
	CapReadOnly
)

// Has reports whether all bits in want are set in c.
func (c Capability) Has(want Capability) bool { return c&want == want }

// capTokens maps each capability bit to its stable lowercase wire token, in a
// deterministic order matching the locked REST contract.
var capTokens = []struct {
	bit   Capability
	token string
}{
	{CapList, "list"},
	{CapInspect, "inspect"},
	{CapLogs, "logs"},
	{CapStats, "stats"},
	{CapStart, "start"},
	{CapStop, "stop"},
	{CapRestart, "restart"},
	{CapRemove, "remove"},
	{CapExec, "exec"},
	{CapEvents, "events"},
	{CapImages, "images"},
	{CapNetworks, "networks"},
	{CapVolumes, "volumes"},
	{CapReadOnly, "readonly"},
}

// Strings returns the active capabilities as stable lowercase tokens for the
// API/UI (e.g. ["list","inspect","logs","stats"]). Order is deterministic.
func (c Capability) Strings() []string {
	out := make([]string, 0, len(capTokens))
	for _, ct := range capTokens {
		if c.Has(ct.bit) {
			out = append(out, ct.token)
		}
	}
	return out
}
