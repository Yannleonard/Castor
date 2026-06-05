// This file adds Swarm SECRET and CONFIG management on top of the read-only
// provider, reusing the shared Docker client against a manager socket (Swarm
// Engine API). Secrets and configs are cluster-level objects, not containers,
// so — like the service/node lifecycle in write.go — they are exposed through
// dedicated /swarm endpoints rather than the generic container Provider
// mutation interface.
//
// SECURITY: a secret's Data is write-only. The Swarm Engine API itself never
// returns secret Data on inspect/list (see SecretSpec.Data: "only used to
// create the secret, and is not returned by other endpoints"), and we never
// attempt to read or surface it — List and the per-object views expose only
// id/name/timestamps. Config Data is NOT secret (it is meant for non-sensitive
// files such as nginx.conf), so a single-object GetConfig MAY return it; the
// List path still stays metadata-only for parity and payload size.
package swarm

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/swarm"
)

// SwarmSecretInfo is the normalized Swarm secret summary the API exposes. It
// deliberately carries NO Data field — secret values are never returned on a
// read.
type SwarmSecretInfo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SwarmConfigInfo is the normalized Swarm config summary the API exposes. Like
// the secret summary it is metadata-only (the config payload is fetched via the
// single-object GetConfig, not the list).
type SwarmConfigInfo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SwarmConfigDetail is the single-object config view. Unlike secrets, a config
// payload is non-sensitive, so the (UTF-8) data is returned for display/edit.
type SwarmConfigDetail struct {
	SwarmConfigInfo
	Data string `json:"data"`
}

// listOptsSecrets / listOptsConfigs isolate the SDK option structs (SDK v28
// keeps these under api/types/swarm), mirroring extra.go's option helpers.
func listOptsSecrets() swarm.SecretListOptions {
	return swarm.SecretListOptions{Filters: filters.NewArgs()}
}
func listOptsConfigs() swarm.ConfigListOptions {
	return swarm.ConfigListOptions{Filters: filters.NewArgs()}
}

// ListSecrets returns normalized secret summaries (id/name/timestamps only).
// SECURITY: never returns secret Data — the Engine API does not surface it and
// neither do we.
func (p *SwarmProvider) ListSecrets(ctx context.Context) ([]SwarmSecretInfo, error) {
	secrets, err := p.cli.SecretList(ctx, listOptsSecrets())
	if err != nil {
		return nil, fmt.Errorf("swarm: secret list: %w", err)
	}
	out := make([]SwarmSecretInfo, 0, len(secrets))
	for i := range secrets {
		s := &secrets[i]
		out = append(out, SwarmSecretInfo{
			ID:        s.ID,
			Name:      s.Spec.Name,
			CreatedAt: s.CreatedAt.UTC(),
			UpdatedAt: s.UpdatedAt.UTC(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// CreateSecret creates a swarm secret from raw bytes and returns its id. The
// data is write-only after creation (Swarm never returns it again).
func (p *SwarmProvider) CreateSecret(ctx context.Context, name string, data []byte) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("swarm: secret create requires a name")
	}
	if len(data) == 0 {
		return "", fmt.Errorf("swarm: secret create requires data")
	}
	spec := swarm.SecretSpec{
		Annotations: swarm.Annotations{Name: name},
		Data:        data,
	}
	resp, err := p.cli.SecretCreate(ctx, spec)
	if err != nil {
		return "", mapSwarmConflict(err)
	}
	return resp.ID, nil
}

// DeleteSecret removes a secret by id. A secret still referenced by a service
// is rejected by the engine (in-use), which maps to ErrConflict (409).
func (p *SwarmProvider) DeleteSecret(ctx context.Context, id string) error {
	if err := p.cli.SecretRemove(ctx, id); err != nil {
		return mapSwarmConflict(err)
	}
	return nil
}

// ListConfigs returns normalized config summaries (id/name/timestamps only).
func (p *SwarmProvider) ListConfigs(ctx context.Context) ([]SwarmConfigInfo, error) {
	configs, err := p.cli.ConfigList(ctx, listOptsConfigs())
	if err != nil {
		return nil, fmt.Errorf("swarm: config list: %w", err)
	}
	out := make([]SwarmConfigInfo, 0, len(configs))
	for i := range configs {
		c := &configs[i]
		out = append(out, SwarmConfigInfo{
			ID:        c.ID,
			Name:      c.Spec.Name,
			CreatedAt: c.CreatedAt.UTC(),
			UpdatedAt: c.UpdatedAt.UTC(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// GetConfig returns a single config WITH its payload. Configs are non-secret
// (intended for files like nginx.conf), so returning the data here is safe; it
// is still gated by the swarm.config.read permission at the API layer.
func (p *SwarmProvider) GetConfig(ctx context.Context, id string) (*SwarmConfigDetail, error) {
	cfg, _, err := p.cli.ConfigInspectWithRaw(ctx, id)
	if err != nil {
		return nil, mapSwarmNotFound(err)
	}
	return &SwarmConfigDetail{
		SwarmConfigInfo: SwarmConfigInfo{
			ID:        cfg.ID,
			Name:      cfg.Spec.Name,
			CreatedAt: cfg.CreatedAt.UTC(),
			UpdatedAt: cfg.UpdatedAt.UTC(),
		},
		Data: string(cfg.Spec.Data),
	}, nil
}

// CreateConfig creates a swarm config from raw bytes and returns its id.
func (p *SwarmProvider) CreateConfig(ctx context.Context, name string, data []byte) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("swarm: config create requires a name")
	}
	if len(data) == 0 {
		return "", fmt.Errorf("swarm: config create requires data")
	}
	spec := swarm.ConfigSpec{
		Annotations: swarm.Annotations{Name: name},
		Data:        data,
	}
	resp, err := p.cli.ConfigCreate(ctx, spec)
	if err != nil {
		return "", mapSwarmConflict(err)
	}
	return resp.ID, nil
}

// DeleteConfig removes a config by id. An in-use config is rejected by the
// engine, mapping to ErrConflict (409).
func (p *SwarmProvider) DeleteConfig(ctx context.Context, id string) error {
	if err := p.cli.ConfigRemove(ctx, id); err != nil {
		return mapSwarmConflict(err)
	}
	return nil
}
