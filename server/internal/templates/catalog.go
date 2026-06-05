// Package templates exposes the built-in app-template catalog. The 50-entry
// catalog.json is embedded into the binary at build time (//go:embed) so the
// marketplace works with zero external dependencies. Operator-authored custom
// templates are layered on TOP of these by the API/store layers; the built-in
// catalog itself is read-only and never persisted in SQLite.
package templates

import (
	_ "embed"
	"encoding/json"
	"sync"
)

//go:embed catalog.json
var catalogJSON []byte

// EnvVar is a single environment-variable spec for a template. Required vars
// must be supplied (with a non-empty value) at deploy time; Value is the
// suggested default.
type EnvVar struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Required bool   `json:"required"`
}

// Template is one built-in catalog entry. Ports are container ports the image
// exposes; Volumes are container paths to persist. Logo is a UI-served path
// ("/templates/logos/<slug>.svg") or empty when the template has no logo
// (the UI then renders an initials fallback).
type Template struct {
	Name        string   `json:"name"`
	Slug        string   `json:"slug"`
	Category    string   `json:"category"`
	Image       string   `json:"image"`
	Description string   `json:"description"`
	Ports       []int    `json:"ports"`
	Env         []EnvVar `json:"env"`
	Volumes     []string `json:"volumes"`
	Logo        string   `json:"logo"`
}

var (
	builtinOnce sync.Once
	builtin     []Template
)

// BuiltinTemplates returns the embedded built-in catalog. The slice is parsed
// once and the returned value is shared read-only; callers MUST NOT mutate it.
// Nil-ish slices (ports/env/volumes) are normalized to empty so JSON output is
// arrays, never null, matching the locked REST contract.
func BuiltinTemplates() []Template {
	builtinOnce.Do(func() {
		var parsed []Template
		if err := json.Unmarshal(catalogJSON, &parsed); err != nil {
			// A malformed embedded asset is a build-time bug; degrade to empty
			// rather than panic so the rest of the app still serves.
			builtin = []Template{}
			return
		}
		for i := range parsed {
			if parsed[i].Ports == nil {
				parsed[i].Ports = []int{}
			}
			if parsed[i].Env == nil {
				parsed[i].Env = []EnvVar{}
			}
			if parsed[i].Volumes == nil {
				parsed[i].Volumes = []string{}
			}
		}
		builtin = parsed
	})
	return builtin
}
