package api

import (
	"encoding/json"
	"strings"

	"github.com/gtek-it/castor/server/internal/authz"
)

// maskSecretEnv parses a raw engine inspect document and masks the values of
// environment variables whose key looks secret (Config.Env: ["KEY=value", ...]).
// It returns the original bytes unchanged if the structure is not as expected,
// so non-Docker raw docs pass through untouched.
func maskSecretEnv(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		return raw
	}
	cfgRaw, ok := doc["Config"]
	if !ok {
		return raw
	}
	var cfg map[string]json.RawMessage
	if err := json.Unmarshal(cfgRaw, &cfg); err != nil {
		return raw
	}
	envRaw, ok := cfg["Env"]
	if !ok {
		return raw
	}
	var env []string
	if err := json.Unmarshal(envRaw, &env); err != nil {
		return raw
	}

	changed := false
	for i, kv := range env {
		eq := strings.IndexByte(kv, '=')
		if eq <= 0 {
			continue
		}
		key := kv[:eq]
		if authz.IsSecretKey(key) {
			env[i] = key + "=[REDACTED]"
			changed = true
		}
	}
	if !changed {
		return raw
	}

	newEnv, err := json.Marshal(env)
	if err != nil {
		return raw
	}
	cfg["Env"] = newEnv
	newCfg, err := json.Marshal(cfg)
	if err != nil {
		return raw
	}
	doc["Config"] = newCfg
	out, err := json.Marshal(doc)
	if err != nil {
		return raw
	}
	return out
}
