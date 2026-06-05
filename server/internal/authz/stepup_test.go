package authz

import (
	"context"
	"testing"

	"github.com/gtek-it/castor/server/internal/store"
)

// TestStepUpRequired exercises the predicate the exec WebSocket shares with the
// REST RequireAAL middleware: step-up is required only when the user has TOTP
// enabled AND the instance requires TOTP for mutations AND the session is not yet
// pwd+totp. A nil user fails closed.
func TestStepUpRequired(t *testing.T) {
	d := &Deps{}
	env := newResolveEnv(t, d) // wires d.Store to a fresh seeded store
	ctx := context.Background()

	totpUser := func(amr string) *User {
		return buildUser(&store.User{ID: "u", Username: "u", TOTPEnabled: true}, "s", amr, nil)
	}
	noTOTPUser := buildUser(&store.User{ID: "u2", Username: "u2", TOTPEnabled: false}, "s", AMRPassword, nil)

	// Setting defaults to "false" (seeded). With the instance NOT requiring TOTP,
	// no one needs step-up regardless of enrollment/AMR.
	if d.StepUpRequired(ctx, totpUser(AMRPassword)) {
		t.Error("no step-up when instance does not require TOTP")
	}

	// Turn on the instance-wide requirement.
	if err := env.st.SetSetting(ctx, store.SettingTOTPRequiredForMut, "true"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	// TOTP-enabled user with only pwd MUST step up.
	if !d.StepUpRequired(ctx, totpUser(AMRPassword)) {
		t.Error("TOTP-enabled pwd-only session must require step-up when instance requires TOTP")
	}
	// Same user after completing TOTP (pwd+totp) is satisfied.
	if d.StepUpRequired(ctx, totpUser(AMRPasswordTOTP)) {
		t.Error("pwd+totp session must NOT require step-up")
	}
	// A user without TOTP enrolled cannot be forced to step up (nothing to do).
	if d.StepUpRequired(ctx, noTOTPUser) {
		t.Error("user without TOTP enabled must not be blocked")
	}
	// Nil user fails closed.
	if !d.StepUpRequired(ctx, nil) {
		t.Error("nil user must require step-up (fail closed)")
	}
}
