// Package compose parses and plans Docker Compose YAML into the SDK-agnostic
// docker.DeploySpec slice that the Docker provider can create+start. It is PURE
// Go (no docker CLI, no daemon access) per ADR-CASTOR-002: the distroless image
// ships no `docker` binary, so compose support is implemented in-process.
//
// Only the subset of the Compose spec Castor supports is modeled here
// (services: image, container_name, ports, environment, volumes, networks,
// restart, command, depends_on). Unknown top-level keys (version, etc.) are
// tolerated and ignored; unknown service keys are rejected so a typo surfaces as
// a clear validation error rather than silently doing nothing.
package compose

import (
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Model is the parsed, validated compose document. Services keys are the service
// names exactly as written in the YAML.
type Model struct {
	Services map[string]Service `yaml:"services" json:"services"`
}

// Service is one compose service. Environment is normalized to an ordered list
// of "KEY=VALUE" pairs on parse so both the map and list YAML forms are handled
// uniformly downstream.
type Service struct {
	Image         string   `yaml:"image" json:"image"`
	ContainerName string   `yaml:"container_name" json:"containerName"`
	Ports         []string `yaml:"ports" json:"ports"`
	Environment   []string `yaml:"environment" json:"environment"`
	Volumes       []string `yaml:"volumes" json:"volumes"`
	Networks      []string `yaml:"networks" json:"networks"`
	Restart       string   `yaml:"restart" json:"restart"`
	Command       []string `yaml:"command" json:"command"`
	DependsOn     []string `yaml:"depends_on" json:"dependsOn"`
}

// rawDocument mirrors the compose top-level shape but decodes each service into
// a yaml.Node so the flexible fields (environment, command, ports, depends_on)
// can be normalized from their multiple YAML representations. Unknown top-level
// keys are tolerated.
type rawDocument struct {
	Services map[string]yaml.Node `yaml:"services"`
}

// rawService is the strict per-service decode target. KnownFields is enforced so
// an unsupported/misspelled service key produces a clear error instead of being
// silently dropped.
type rawService struct {
	Image         string    `yaml:"image"`
	ContainerName string    `yaml:"container_name"`
	Ports         yaml.Node `yaml:"ports"`
	Environment   yaml.Node `yaml:"environment"`
	Volumes       yaml.Node `yaml:"volumes"`
	Networks      yaml.Node `yaml:"networks"`
	Restart       string    `yaml:"restart"`
	Command       yaml.Node `yaml:"command"`
	Entrypoint    yaml.Node `yaml:"entrypoint"`
	DependsOn     yaml.Node `yaml:"depends_on"`
	// Tolerated-but-ignored common keys so a typical real compose file parses.
	Build       yaml.Node `yaml:"build"`
	Labels      yaml.Node `yaml:"labels"`
	Healthcheck yaml.Node `yaml:"healthcheck"`
	Deploy      yaml.Node `yaml:"deploy"`
	Expose      yaml.Node `yaml:"expose"`
	WorkingDir  string    `yaml:"working_dir"`
	User        string    `yaml:"user"`
	Hostname    string    `yaml:"hostname"`
	Privileged  bool      `yaml:"privileged"`
	TTY         bool      `yaml:"tty"`
	StdinOpen   bool      `yaml:"stdin_open"`
}

// Parse decodes compose YAML into a validated Model. It returns a ValidationError
// (its message is safe to surface to the API caller) on any structural or
// semantic problem.
func Parse(src []byte) (*Model, error) {
	if len(strings.TrimSpace(string(src))) == 0 {
		return nil, validationf("Compose document is empty.")
	}

	var doc rawDocument
	dec := yaml.NewDecoder(strings.NewReader(string(src)))
	dec.KnownFields(false) // tolerate unknown TOP-LEVEL keys (version, networks, volumes, x-*)
	if err := dec.Decode(&doc); err != nil {
		return nil, validationf("Invalid compose YAML: %s", oneLine(err.Error()))
	}
	if len(doc.Services) == 0 {
		return nil, validationf("Compose document defines no services.")
	}

	m := &Model{Services: make(map[string]Service, len(doc.Services))}
	for name, node := range doc.Services {
		if !validServiceName(name) {
			return nil, validationf("Invalid service name %q (use letters, digits, '.', '_' or '-').", name)
		}
		svc, err := decodeService(name, &node)
		if err != nil {
			return nil, err
		}
		m.Services[name] = svc
	}

	if err := m.validate(); err != nil {
		return nil, err
	}
	return m, nil
}

// decodeService strictly decodes one service node, normalizing its flexible
// fields. Unknown service keys are rejected via KnownFields(true).
func decodeService(name string, node *yaml.Node) (Service, error) {
	var rs rawService
	// A null/empty service node decodes to the zero value; image-required check
	// in validate() will catch a serviceless entry.
	if node.Kind != 0 {
		// Re-decode the node with strict key checking so typos surface.
		if err := node.Decode(&rs); err != nil {
			// yaml.v3 with KnownFields is enforced on the Decoder, not the Node,
			// so do a second strict pass below; this pass catches type errors.
			return Service{}, validationf("Service %q: %s", name, oneLine(err.Error()))
		}
		if err := strictUnknownKeys(name, node); err != nil {
			return Service{}, err
		}
	}

	env, err := normalizeEnvironment(name, &rs.Environment)
	if err != nil {
		return Service{}, err
	}
	ports, err := normalizeStringList(name, "ports", &rs.Ports)
	if err != nil {
		return Service{}, err
	}
	vols, err := normalizeStringList(name, "volumes", &rs.Volumes)
	if err != nil {
		return Service{}, err
	}
	nets, err := normalizeNetworks(name, &rs.Networks)
	if err != nil {
		return Service{}, err
	}
	cmd, err := normalizeCommand(name, "command", &rs.Command)
	if err != nil {
		return Service{}, err
	}
	deps, err := normalizeDependsOn(name, &rs.DependsOn)
	if err != nil {
		return Service{}, err
	}

	return Service{
		Image:         strings.TrimSpace(rs.Image),
		ContainerName: strings.TrimSpace(rs.ContainerName),
		Ports:         ports,
		Environment:   env,
		Volumes:       vols,
		Networks:      nets,
		Restart:       strings.TrimSpace(rs.Restart),
		Command:       cmd,
		DependsOn:     deps,
	}, nil
}

// knownServiceKeys is the set of service keys decodeService understands or
// deliberately tolerates. Any other key is a hard validation error.
var knownServiceKeys = map[string]struct{}{
	"image": {}, "container_name": {}, "ports": {}, "environment": {},
	"volumes": {}, "networks": {}, "restart": {}, "command": {}, "entrypoint": {},
	"depends_on": {}, "build": {}, "labels": {}, "healthcheck": {}, "deploy": {},
	"expose": {}, "working_dir": {}, "user": {}, "hostname": {}, "privileged": {},
	"tty": {}, "stdin_open": {},
}

// strictUnknownKeys walks a service mapping node and rejects keys not in
// knownServiceKeys. yaml.v3's KnownFields applies to a Decoder, not a Node
// decode, so this enforces the same guarantee at the node level.
func strictUnknownKeys(name string, node *yaml.Node) error {
	if node.Kind != yaml.MappingNode {
		if node.Kind == yaml.ScalarNode && node.Tag == "!!null" {
			return nil
		}
		return validationf("Service %q must be a mapping.", name)
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		key := node.Content[i].Value
		if _, ok := knownServiceKeys[key]; !ok {
			return validationf("Service %q: unsupported key %q.", name, key)
		}
	}
	return nil
}

// normalizeStringList accepts either a YAML sequence of scalars or a single
// scalar and returns a trimmed []string. nil/empty -> nil.
func normalizeStringList(svc, field string, node *yaml.Node) ([]string, error) {
	if node == nil || node.Kind == 0 {
		return nil, nil
	}
	switch node.Kind {
	case yaml.ScalarNode:
		if node.Tag == "!!null" || strings.TrimSpace(node.Value) == "" {
			return nil, nil
		}
		return []string{strings.TrimSpace(node.Value)}, nil
	case yaml.SequenceNode:
		out := make([]string, 0, len(node.Content))
		for _, it := range node.Content {
			if it.Kind != yaml.ScalarNode {
				return nil, validationf("Service %q: %s entries must be scalars.", svc, field)
			}
			v := strings.TrimSpace(it.Value)
			if v != "" {
				out = append(out, v)
			}
		}
		return out, nil
	default:
		return nil, validationf("Service %q: %s must be a list.", svc, field)
	}
}

// normalizeNetworks accepts the list form (sequence of names) or the mapping
// form (network name -> options) and returns the network names. The mapping
// form's per-network options are ignored (only attachment matters in V1).
func normalizeNetworks(svc string, node *yaml.Node) ([]string, error) {
	if node == nil || node.Kind == 0 {
		return nil, nil
	}
	if node.Kind == yaml.MappingNode {
		out := make([]string, 0, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			out = append(out, strings.TrimSpace(node.Content[i].Value))
		}
		return out, nil
	}
	return normalizeStringList(svc, "networks", node)
}

// normalizeCommand accepts the string (shell) form or the list (exec) form and
// returns the argv slice. The shell form is split on whitespace (a pragmatic
// approximation; quoted args are not re-tokenized — operators needing precise
// argv should use the list form).
func normalizeCommand(svc, field string, node *yaml.Node) ([]string, error) {
	if node == nil || node.Kind == 0 {
		return nil, nil
	}
	switch node.Kind {
	case yaml.ScalarNode:
		if node.Tag == "!!null" {
			return nil, nil
		}
		fields := strings.Fields(node.Value)
		if len(fields) == 0 {
			return nil, nil
		}
		return fields, nil
	case yaml.SequenceNode:
		out := make([]string, 0, len(node.Content))
		for _, it := range node.Content {
			if it.Kind != yaml.ScalarNode {
				return nil, validationf("Service %q: %s entries must be scalars.", svc, field)
			}
			out = append(out, it.Value)
		}
		return out, nil
	default:
		return nil, validationf("Service %q: %s must be a string or list.", svc, field)
	}
}

// normalizeDependsOn accepts the short list form ([a, b]) or the long mapping
// form (a: {condition: ...}) and returns the dependency service names.
func normalizeDependsOn(svc string, node *yaml.Node) ([]string, error) {
	if node == nil || node.Kind == 0 {
		return nil, nil
	}
	if node.Kind == yaml.MappingNode {
		out := make([]string, 0, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			out = append(out, strings.TrimSpace(node.Content[i].Value))
		}
		return out, nil
	}
	return normalizeStringList(svc, "depends_on", node)
}

// normalizeEnvironment accepts the mapping form (KEY: VALUE) or the list form
// (["KEY=VALUE", ...]) and returns an ordered []string of "KEY=VALUE" pairs.
// For the mapping form, keys are emitted in sorted order for deterministic
// output (compose itself is order-insensitive for env maps).
func normalizeEnvironment(svc string, node *yaml.Node) ([]string, error) {
	if node == nil || node.Kind == 0 {
		return nil, nil
	}
	switch node.Kind {
	case yaml.MappingNode:
		type kv struct{ k, v string }
		pairs := make([]kv, 0, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			k := strings.TrimSpace(node.Content[i].Value)
			val := node.Content[i+1]
			v := ""
			if val.Kind == yaml.ScalarNode && val.Tag != "!!null" {
				v = val.Value
			}
			if k == "" {
				return nil, validationf("Service %q: environment keys must be non-empty.", svc)
			}
			pairs = append(pairs, kv{k, v})
		}
		sort.Slice(pairs, func(i, j int) bool { return pairs[i].k < pairs[j].k })
		out := make([]string, 0, len(pairs))
		for _, p := range pairs {
			out = append(out, p.k+"="+p.v)
		}
		return out, nil
	case yaml.SequenceNode:
		out := make([]string, 0, len(node.Content))
		for _, it := range node.Content {
			if it.Kind != yaml.ScalarNode {
				return nil, validationf("Service %q: environment entries must be scalars.", svc)
			}
			e := strings.TrimSpace(it.Value)
			if e == "" {
				continue
			}
			if !strings.Contains(e, "=") {
				// "KEY" (pass-through from host) is allowed by compose; Castor has
				// no host env to inherit, so treat it as KEY= (empty value).
				e += "="
			}
			out = append(out, e)
		}
		return out, nil
	default:
		return nil, validationf("Service %q: environment must be a mapping or list.", svc)
	}
}

// validate runs cross-service semantic checks: every service has an image, and
// every depends_on target names a real service.
func (m *Model) validate() error {
	for name, svc := range m.Services {
		if svc.Image == "" {
			return validationf("Service %q: 'image' is required (build is not supported).", name)
		}
		if svc.ContainerName != "" && !validContainerName(svc.ContainerName) {
			return validationf("Service %q: invalid container_name %q.", name, svc.ContainerName)
		}
		for _, dep := range svc.DependsOn {
			if _, ok := m.Services[dep]; !ok {
				return validationf("Service %q depends_on unknown service %q.", name, dep)
			}
			if dep == name {
				return validationf("Service %q cannot depend on itself.", name)
			}
		}
	}
	return nil
}

// ServiceNamesSorted returns the service names in deterministic alphabetical
// order (used for stable summaries independent of map iteration order).
func (m *Model) ServiceNamesSorted() []string {
	names := make([]string, 0, len(m.Services))
	for n := range m.Services {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// --- small validation helpers (local to compose; the api package has its own
// container-name validator — these are duplicated intentionally so the compose
// package has no dependency on api/docker) ---

func validServiceName(name string) bool {
	if name == "" || len(name) > 63 {
		return false
	}
	for i, c := range name {
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
		if i > 0 {
			ok = ok || c == '_' || c == '.' || c == '-'
		}
		if !ok {
			return false
		}
	}
	return true
}

func validContainerName(name string) bool {
	if name == "" || len(name) > 255 {
		return false
	}
	for i, c := range name {
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
		if i > 0 {
			ok = ok || c == '_' || c == '.' || c == '-'
		}
		if !ok {
			return false
		}
	}
	return true
}

// oneLine collapses a multi-line yaml error into a single line for the envelope.
func oneLine(s string) string {
	s = strings.ReplaceAll(s, "\n", "; ")
	s = strings.ReplaceAll(s, "  ", " ")
	return strings.TrimSpace(s)
}
