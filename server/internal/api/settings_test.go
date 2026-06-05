package api

import (
	"testing"
	"time"
)

// TestClampSessionTTLSeconds locks the write-path bounds for session.ttl_seconds:
// a 300s floor and a ceiling of the configured absolute cap (with a 24h fallback
// when the cap is not configured).
func TestClampSessionTTLSeconds(t *testing.T) {
	const day = 24 * 60 * 60
	cases := []struct {
		name     string
		in       int
		absolute time.Duration
		want     int
	}{
		{"below floor clamps up", 1, 24 * time.Hour, 300},
		{"zero clamps to floor", 0, 24 * time.Hour, 300},
		{"negative clamps to floor", -100, 24 * time.Hour, 300},
		{"in range passes through", 3600, 24 * time.Hour, 3600},
		{"at floor passes through", 300, 24 * time.Hour, 300},
		{"above cap clamps to cap", day + 1, 24 * time.Hour, day},
		{"unset cap falls back to 24h ceiling", 7 * day, 0, day},
		{"smaller cap is honored", 12 * 3600, 6 * time.Hour, 6 * 3600},
		{"floor wins even with tiny cap", 1, 6 * time.Hour, 300},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := clampSessionTTLSeconds(c.in, c.absolute); got != c.want {
				t.Errorf("clampSessionTTLSeconds(%d, %v) = %d, want %d", c.in, c.absolute, got, c.want)
			}
		})
	}
}
