// This file makes the Swarm provider WRITABLE. It adds the swarm-specific
// service/node lifecycle mutations that go through dedicated API endpoints
// (NOT the generic container-style Provider mutation interface, which stays
// ErrUnsupported for swarm — those operate on containers, not services).
//
// Every update follows the inspect-then-update rule: the Docker Swarm Engine
// API requires the current object Version.Index on ServiceUpdate/NodeUpdate, or
// it rejects the call with "update out of sequence". We therefore always
// inspect immediately before mutating and pass back the freshly-read index.
package swarm

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/docker/docker/api/types/swarm"

	"github.com/gtek-it/castor/server/internal/provider"
)

// SwarmPort is a published port mapping for a service (published:target/proto).
type SwarmPort struct {
	Published uint32 `json:"published"`
	Target    uint32 `json:"target"`
	Protocol  string `json:"protocol"` // "tcp" (default) | "udp" | "sctp"
}

// SwarmSecretRef attaches an existing swarm secret to a service as a file under
// /run/secrets. Identify the secret by id (preferred) or name; targetFile is the
// in-container filename (defaults to the secret name when empty). The mounted
// file is mode 0444 (read-only).
type SwarmSecretRef struct {
	SecretID   string `json:"secretId"`
	SecretName string `json:"secretName"`
	TargetFile string `json:"targetFile"`
}

// SwarmConfigRef attaches an existing swarm config to a service as a file under
// /<targetFile> (default /<configName>). Like secrets it is mounted mode 0444.
type SwarmConfigRef struct {
	ConfigID   string `json:"configId"`
	ConfigName string `json:"configName"`
	TargetFile string `json:"targetFile"`
}

// ServiceCreateSpec is the normalized input for creating a swarm service.
type ServiceCreateSpec struct {
	Name     string      `json:"name"`
	Image    string      `json:"image"`
	Replicas uint64      `json:"replicas"`
	Env      []string    `json:"env"`
	Ports    []SwarmPort `json:"ports"`
	Networks []string    `json:"networks"`
	Restart  string      `json:"restart"` // "any" (default) | "on-failure" | "none"

	// Optional per-task resource limits/reservations (<=0 means unset). CPU
	// values are cores (NanoCPUs = cores*1e9); memory values are bytes. These map
	// to TaskTemplate.Resources.{Limits,Reservations}.
	CpuLimit               float64 `json:"cpuLimit"`
	MemoryLimitBytes       int64   `json:"memoryLimitBytes"`
	CpuReservation         float64 `json:"cpuReservation"`
	MemoryReservationBytes int64   `json:"memoryReservationBytes"`

	// Optional secret/config attachments. Each entry references an EXISTING
	// swarm secret/config (by id or name); the data is never carried here. Only
	// applied when non-empty.
	Secrets []SwarmSecretRef `json:"secrets"`
	Configs []SwarmConfigRef `json:"configs"`
}

// ServiceUpdateInput is the normalized partial-update input. Nil pointers mean
// "leave unchanged"; a non-nil Env slice replaces the env entirely. Resource
// fields are applied with the same <=0 == unset rule as on create; on update a
// positive value sets that knob and a non-positive value clears it (so the UI
// can drop a previously-set limit by sending 0).
//
// Secrets/Configs are pointers-to-slice so the JSON can distinguish "omitted"
// (nil -> leave the existing attachments untouched) from an explicit empty list
// ("secrets":[] -> detach all). A non-nil slice REPLACES the full attachment set.
type ServiceUpdateInput struct {
	Image    *string  `json:"image"`
	Env      []string `json:"env"`
	Replicas *uint64  `json:"replicas"`

	CpuLimit               float64 `json:"cpuLimit"`
	MemoryLimitBytes       int64   `json:"memoryLimitBytes"`
	CpuReservation         float64 `json:"cpuReservation"`
	MemoryReservationBytes int64   `json:"memoryReservationBytes"`

	Secrets *[]SwarmSecretRef `json:"secrets"`
	Configs *[]SwarmConfigRef `json:"configs"`
}

// ServiceCreate creates a new replicated swarm service and returns its id.
func (p *SwarmProvider) ServiceCreate(ctx context.Context, in ServiceCreateSpec) (string, error) {
	name := strings.TrimSpace(in.Name)
	image := strings.TrimSpace(in.Image)
	if name == "" || image == "" {
		return "", fmt.Errorf("swarm: service create requires name and image")
	}

	replicas := in.Replicas
	spec := swarm.ServiceSpec{
		Annotations: swarm.Annotations{Name: name},
		TaskTemplate: swarm.TaskSpec{
			ContainerSpec: &swarm.ContainerSpec{
				Image: image,
				Env:   in.Env,
			},
			RestartPolicy: restartPolicy(in.Restart),
			Networks:      networkAttachments(in.Networks),
			Resources: resourceRequirements(
				in.CpuLimit, in.MemoryLimitBytes,
				in.CpuReservation, in.MemoryReservationBytes,
			),
		},
		Mode: swarm.ServiceMode{
			Replicated: &swarm.ReplicatedService{Replicas: &replicas},
		},
	}
	if ep := endpointSpec(in.Ports); ep != nil {
		spec.EndpointSpec = ep
	}
	// Only set the attachment slices when provided, so a service with no secrets/
	// configs sends nil (not an empty slice) to the engine.
	if refs := secretReferences(in.Secrets); refs != nil {
		spec.TaskTemplate.ContainerSpec.Secrets = refs
	}
	if refs := configReferences(in.Configs); refs != nil {
		spec.TaskTemplate.ContainerSpec.Configs = refs
	}

	resp, err := p.cli.ServiceCreate(ctx, spec, swarm.ServiceCreateOptions{})
	if err != nil {
		return "", mapSwarmConflict(err)
	}
	return resp.ID, nil
}

// ServiceScale sets the replica count of a replicated service. Global services
// are rejected (they cannot be scaled).
func (p *SwarmProvider) ServiceScale(ctx context.Context, serviceID string, replicas uint64) error {
	svc, _, err := p.cli.ServiceInspectWithRaw(ctx, serviceID, swarmServiceInspectOptions())
	if err != nil {
		return mapSwarmNotFound(err)
	}
	if svc.Spec.Mode.Replicated == nil {
		return fmt.Errorf("%w: only replicated services can be scaled", provider.ErrConflict)
	}
	spec := svc.Spec
	r := replicas
	spec.Mode.Replicated = &swarm.ReplicatedService{Replicas: &r}

	if _, err := p.cli.ServiceUpdate(ctx, svc.ID, svc.Version, spec, swarm.ServiceUpdateOptions{}); err != nil {
		return mapSwarmConflict(err)
	}
	return nil
}

// ServiceUpdateSpec applies a partial update (image / env / replicas). An image
// change triggers Swarm's rolling update. Inspect-then-update for the version.
func (p *SwarmProvider) ServiceUpdateSpec(ctx context.Context, serviceID string, in ServiceUpdateInput) error {
	svc, _, err := p.cli.ServiceInspectWithRaw(ctx, serviceID, swarmServiceInspectOptions())
	if err != nil {
		return mapSwarmNotFound(err)
	}
	spec := svc.Spec
	if spec.TaskTemplate.ContainerSpec == nil {
		spec.TaskTemplate.ContainerSpec = &swarm.ContainerSpec{}
	}
	if in.Image != nil {
		img := strings.TrimSpace(*in.Image)
		if img == "" {
			return fmt.Errorf("swarm: image must not be empty")
		}
		spec.TaskTemplate.ContainerSpec.Image = img
	}
	if in.Env != nil {
		spec.TaskTemplate.ContainerSpec.Env = in.Env
	}
	if in.Replicas != nil {
		if spec.Mode.Replicated == nil {
			return fmt.Errorf("%w: only replicated services can change replicas", provider.ErrConflict)
		}
		r := *in.Replicas
		spec.Mode.Replicated = &swarm.ReplicatedService{Replicas: &r}
	}
	// Resources are always (re)applied from the update input: a positive value
	// sets that knob, a non-positive value clears it. This lets the UI raise,
	// lower, or remove a previously-configured limit in a single update.
	spec.TaskTemplate.Resources = resourceRequirements(
		in.CpuLimit, in.MemoryLimitBytes,
		in.CpuReservation, in.MemoryReservationBytes,
	)
	// Secret/config attachments: nil pointer leaves the current set untouched; a
	// non-nil slice (including empty) replaces it wholesale (empty -> detach all).
	if in.Secrets != nil {
		spec.TaskTemplate.ContainerSpec.Secrets = secretReferences(*in.Secrets)
	}
	if in.Configs != nil {
		spec.TaskTemplate.ContainerSpec.Configs = configReferences(*in.Configs)
	}

	if _, err := p.cli.ServiceUpdate(ctx, svc.ID, svc.Version, spec, swarm.ServiceUpdateOptions{}); err != nil {
		return mapSwarmConflict(err)
	}
	return nil
}

// ServiceRollingRestart forces a redeploy of every task without changing the
// spec, by bumping TaskTemplate.ForceUpdate (the CLI 'service update --force').
func (p *SwarmProvider) ServiceRollingRestart(ctx context.Context, serviceID string) error {
	svc, _, err := p.cli.ServiceInspectWithRaw(ctx, serviceID, swarmServiceInspectOptions())
	if err != nil {
		return mapSwarmNotFound(err)
	}
	spec := svc.Spec
	spec.TaskTemplate.ForceUpdate++

	if _, err := p.cli.ServiceUpdate(ctx, svc.ID, svc.Version, spec, swarm.ServiceUpdateOptions{}); err != nil {
		return mapSwarmConflict(err)
	}
	return nil
}

// ServiceRemove deletes a service (and, by extension, its tasks).
func (p *SwarmProvider) ServiceRemove(ctx context.Context, serviceID string) error {
	if err := p.cli.ServiceRemove(ctx, serviceID); err != nil {
		return mapSwarmNotFound(err)
	}
	return nil
}

// NodeUpdateAvailability sets a node's scheduling availability
// ("active" | "pause" | "drain"). Inspect-then-update for the version.
func (p *SwarmProvider) NodeUpdateAvailability(ctx context.Context, nodeID, availability string) error {
	avail, err := parseAvailability(availability)
	if err != nil {
		return err
	}
	node, _, err := p.cli.NodeInspectWithRaw(ctx, nodeID)
	if err != nil {
		return mapSwarmNotFound(err)
	}
	spec := node.Spec
	spec.Availability = avail

	if err := p.cli.NodeUpdate(ctx, node.ID, node.Version, spec); err != nil {
		return mapSwarmConflict(err)
	}
	return nil
}

// --- spec builders ---

// resourceRequirements builds a TaskTemplate.Resources from cpu (cores) and
// memory (bytes) limits/reservations. The Limits and Reservations sub-structs
// are only allocated when at least one of their values is positive, so an
// all-zero call returns nil (no resource constraints at all) and a call that
// sets only limits leaves Reservations nil. Inspect-then-update callers that
// pass the existing values therefore preserve them; passing 0 clears a knob.
func resourceRequirements(cpuLimit float64, memLimit int64, cpuRes float64, memRes int64) *swarm.ResourceRequirements {
	var req swarm.ResourceRequirements
	if cpuLimit > 0 || memLimit > 0 {
		lim := &swarm.Limit{}
		if cpuLimit > 0 {
			lim.NanoCPUs = int64(cpuLimit * 1e9)
		}
		if memLimit > 0 {
			lim.MemoryBytes = memLimit
		}
		req.Limits = lim
	}
	if cpuRes > 0 || memRes > 0 {
		res := &swarm.Resources{}
		if cpuRes > 0 {
			res.NanoCPUs = int64(cpuRes * 1e9)
		}
		if memRes > 0 {
			res.MemoryBytes = memRes
		}
		req.Reservations = res
	}
	if req.Limits == nil && req.Reservations == nil {
		return nil
	}
	return &req
}

// endpointSpec builds the published-port endpoint spec, or nil when there are
// no ports (so we don't send an empty EndpointSpec).
func endpointSpec(ports []SwarmPort) *swarm.EndpointSpec {
	if len(ports) == 0 {
		return nil
	}
	cfgs := make([]swarm.PortConfig, 0, len(ports))
	for _, p := range ports {
		cfgs = append(cfgs, swarm.PortConfig{
			Protocol:      portProtocol(p.Protocol),
			TargetPort:    p.Target,
			PublishedPort: p.Published,
			PublishMode:   swarm.PortConfigPublishModeIngress,
		})
	}
	return &swarm.EndpointSpec{Ports: cfgs}
}

// secretFileMode is the in-container mount mode for attached secrets/configs:
// 0444 (world-readable, no write), matching the docker CLI default.
const secretFileMode os.FileMode = 0o444

// secretReferences maps SwarmSecretRef inputs to swarm SecretReference file
// targets. Entries with neither id nor name are skipped. The mounted file name
// defaults to the secret name when targetFile is empty (Swarm mounts it under
// /run/secrets/<name>). Returns nil for an empty/all-skipped list so callers can
// avoid sending an empty slice.
func secretReferences(refs []SwarmSecretRef) []*swarm.SecretReference {
	if len(refs) == 0 {
		return nil
	}
	out := make([]*swarm.SecretReference, 0, len(refs))
	for _, ref := range refs {
		id := strings.TrimSpace(ref.SecretID)
		name := strings.TrimSpace(ref.SecretName)
		if id == "" && name == "" {
			continue
		}
		target := strings.TrimSpace(ref.TargetFile)
		if target == "" {
			target = name
		}
		out = append(out, &swarm.SecretReference{
			SecretID:   id,
			SecretName: name,
			File: &swarm.SecretReferenceFileTarget{
				Name: target,
				UID:  "0",
				GID:  "0",
				Mode: secretFileMode,
			},
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// configReferences maps SwarmConfigRef inputs to swarm ConfigReference file
// targets (mounted at /<targetFile>, default /<configName>). Same skip/nil rules
// as secretReferences.
func configReferences(refs []SwarmConfigRef) []*swarm.ConfigReference {
	if len(refs) == 0 {
		return nil
	}
	out := make([]*swarm.ConfigReference, 0, len(refs))
	for _, ref := range refs {
		id := strings.TrimSpace(ref.ConfigID)
		name := strings.TrimSpace(ref.ConfigName)
		if id == "" && name == "" {
			continue
		}
		target := strings.TrimSpace(ref.TargetFile)
		if target == "" {
			target = name
		}
		out = append(out, &swarm.ConfigReference{
			ConfigID:   id,
			ConfigName: name,
			File: &swarm.ConfigReferenceFileTarget{
				Name: target,
				UID:  "0",
				GID:  "0",
				Mode: secretFileMode,
			},
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// networkAttachments maps network names/ids to task-level attachments. Returns
// nil for an empty list.
func networkAttachments(networks []string) []swarm.NetworkAttachmentConfig {
	if len(networks) == 0 {
		return nil
	}
	out := make([]swarm.NetworkAttachmentConfig, 0, len(networks))
	for _, n := range networks {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		out = append(out, swarm.NetworkAttachmentConfig{Target: n})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// restartPolicy maps the request restart string to a swarm RestartPolicy. An
// empty/unknown value defaults to "any" (the swarm default for services).
func restartPolicy(s string) *swarm.RestartPolicy {
	cond := swarm.RestartPolicyConditionAny
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "any":
		cond = swarm.RestartPolicyConditionAny
	case "on-failure", "on_failure", "onfailure":
		cond = swarm.RestartPolicyConditionOnFailure
	case "none", "no":
		cond = swarm.RestartPolicyConditionNone
	}
	return &swarm.RestartPolicy{Condition: cond}
}

// portProtocol maps a protocol string to the swarm enum (default tcp).
func portProtocol(s string) swarm.PortConfigProtocol {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "udp":
		return swarm.PortConfigProtocolUDP
	case "sctp":
		return swarm.PortConfigProtocolSCTP
	default:
		return swarm.PortConfigProtocolTCP
	}
}

// parseAvailability validates and maps the availability string.
func parseAvailability(s string) (swarm.NodeAvailability, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "active":
		return swarm.NodeAvailabilityActive, nil
	case "pause":
		return swarm.NodeAvailabilityPause, nil
	case "drain":
		return swarm.NodeAvailabilityDrain, nil
	default:
		return "", fmt.Errorf("swarm: invalid availability %q (want active|pause|drain)", s)
	}
}

// mapSwarmConflict maps an "update out of sequence" / in-use style engine error
// to provider.ErrConflict (HTTP 409); not-found maps to ErrNotFound; otherwise
// the raw error is returned (HTTP 500).
func mapSwarmConflict(err error) error {
	if err == nil {
		return nil
	}
	if mapped := mapSwarmNotFound(err); mapped == provider.ErrNotFound {
		return provider.ErrNotFound
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "out of sequence") ||
		strings.Contains(msg, "update out of sequence") ||
		strings.Contains(msg, "already exists") ||
		strings.Contains(msg, "name conflicts") {
		return fmt.Errorf("%w: %s", provider.ErrConflict, err.Error())
	}
	return err
}
