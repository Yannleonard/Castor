// Castor by IT Leonard
// Package compose parses and plans Docker Compose YAML into the SDK-agnostic
// docker.DeploySpec slice that the Docker provider can create+start. It is PURE
// Go (no docker CLI, no daemon access) per ADR-CASTOR-002: the distroless image
// ships no `docker` binary, so compose support is implemented in-process.
//
// Only the subset of the Compose spec Castor supports is modeled here
// (services: image, container_name, ports, environment, volumes, networks,
// restart, command, depends_on; top-level networks: name, driver, internal,
// attachable, enable_ipv6, external, ipam, driver_opts). Unknown top-level keys
// (version, etc.) are tolerated and ignored; unknown service keys are rejected
// so a typo surfaces as a clear validation error rather than silently doing
// nothing.
package compose

import (
	"net"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Model is the parsed, validated compose document. Services keys are the service
// names exactly as written in the YAML; Networks keys are the top-level network
// names as written (nil when the document declares none).
type Model struct {
	Services map[string]Service    `yaml:"services" json:"services"`
	Networks map[string]NetworkDef `yaml:"networks,omitempty" json:"networks,omitempty"`
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
	// NetworkAttach carries the per-network detail behind Networks (one entry
	// per name, same order): static addresses and aliases from the mapping form.
	// It is derived from `networks` on parse, so it is not marshaled back.
	NetworkAttach []ServiceNetwork `yaml:"-" json:"networkAttach,omitempty"`
	Restart       string           `yaml:"restart" json:"restart"`
	Command       []string         `yaml:"command" json:"command"`
	DependsOn     []string         `yaml:"depends_on" json:"dependsOn"`
}

// ServiceNetwork is one service-to-network attachment with the options the
// mapping form of `networks:` allows per network. The list form yields
// attachments with only Name set.
type ServiceNetwork struct {
	Name    string   `json:"name"`
	IPv4    string   `json:"ipv4,omitempty"`
	IPv6    string   `json:"ipv6,omitempty"`
	Aliases []string `json:"aliases,omitempty"`
}

// NetworkDef is one top-level `networks:` declaration. Unknown network keys are
// tolerated: the section used to be ignored entirely, so rejecting them would
// break documents that parsed before.
type NetworkDef struct {
	// Name is the declared network name: the YAML key unless overridden by
	// `name:` or the legacy `external: {name: ...}` form.
	Name string `yaml:"name,omitempty" json:"name"`
	// ExplicitName reports that Name was written in the document. Compose then
	// uses it verbatim as the daemon network name instead of "<project>_<key>",
	// even when it equals the key.
	ExplicitName bool   `yaml:"-" json:"-"`
	Driver       string `yaml:"driver,omitempty" json:"driver"`
	Internal     bool   `yaml:"internal,omitempty" json:"internal"`
	Attachable   bool   `yaml:"attachable,omitempty" json:"attachable"`
	EnableIPv6   bool   `yaml:"enable_ipv6,omitempty" json:"enableIPv6"`
	// External marks a pre-existing network the stack joins by its real name
	// and never creates or removes.
	External bool              `yaml:"external,omitempty" json:"external"`
	IPAM     IPAM              `yaml:"ipam,omitempty" json:"ipam"`
	Options  map[string]string `yaml:"driver_opts,omitempty" json:"options,omitempty"`
}

// IPAM is a network's address-management block.
type IPAM struct {
	Driver string       `yaml:"driver,omitempty" json:"driver"`
	Config []IPAMConfig `yaml:"config,omitempty" json:"config,omitempty"`
}

// IPAMConfig is one address pool: a subnet plus optional gateway, allocation
// range and reserved auxiliary addresses. Values are kept as written and
// checked by validate.
type IPAMConfig struct {
	Subnet       string            `yaml:"subnet,omitempty" json:"subnet"`
	Gateway      string            `yaml:"gateway,omitempty" json:"gateway"`
	IPRange      string            `yaml:"ip_range,omitempty" json:"ipRange"`
	AuxAddresses map[string]string `yaml:"aux_addresses,omitempty" json:"auxAddresses,omitempty"`
}

// rawDocument mirrors the compose top-level shape but decodes each service and
// network into a yaml.Node so the flexible fields (environment, command, ports,
// depends_on, external) can be normalized from their multiple YAML
// representations. Unknown top-level keys are tolerated.
type rawDocument struct {
	Services map[string]yaml.Node `yaml:"services"`
	Networks map[string]yaml.Node `yaml:"networks"`
}

// rawNetwork is the per-network decode target. External is a node because
// compose accepts both `external: true` and the legacy `external: {name: x}`.
type rawNetwork struct {
	Name       string            `yaml:"name"`
	Driver     string            `yaml:"driver"`
	Internal   bool              `yaml:"internal"`
	Attachable bool              `yaml:"attachable"`
	EnableIPv6 bool              `yaml:"enable_ipv6"`
	External   yaml.Node         `yaml:"external"`
	IPAM       IPAM              `yaml:"ipam"`
	DriverOpts map[string]string `yaml:"driver_opts"`
}

// rawServiceNetwork is the decode target for one value of the mapping form of
// a service's `networks:`. Other per-network options are ignored.
type rawServiceNetwork struct {
	IPv4    string    `yaml:"ipv4_address"`
	IPv6    string    `yaml:"ipv6_address"`
	Aliases yaml.Node `yaml:"aliases"`
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
	dec.KnownFields(false) // tolerate unknown TOP-LEVEL keys (version, volumes, x-*)
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

	if len(doc.Networks) > 0 {
		m.Networks = make(map[string]NetworkDef, len(doc.Networks))
		for name, node := range doc.Networks {
			if strings.TrimSpace(name) == "" {
				return nil, validationf("Network names must be non-empty.")
			}
			def, err := decodeNetwork(name, &node)
			if err != nil {
				return nil, err
			}
			m.Networks[name] = def
		}
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
	nets, attach, err := normalizeNetworks(name, &rs.Networks)
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
		NetworkAttach: attach,
		Restart:       strings.TrimSpace(rs.Restart),
		Command:       cmd,
		DependsOn:     deps,
	}, nil
}

// decodeNetwork decodes one top-level network node. A null node (`backend:`
// with no body) is a plain default-driver declaration.
func decodeNetwork(name string, node *yaml.Node) (NetworkDef, error) {
	def := NetworkDef{Name: name}
	if node.Kind == 0 || (node.Kind == yaml.ScalarNode && node.Tag == "!!null") {
		return def, nil
	}
	if node.Kind != yaml.MappingNode {
		return NetworkDef{}, validationf("Network %q must be a mapping.", name)
	}
	var rn rawNetwork
	if err := node.Decode(&rn); err != nil {
		return NetworkDef{}, validationf("Network %q: %s", name, oneLine(err.Error()))
	}
	if n := strings.TrimSpace(rn.Name); n != "" {
		def.Name = n
		def.ExplicitName = true
	}
	def.Driver = strings.TrimSpace(rn.Driver)
	def.Internal = rn.Internal
	def.Attachable = rn.Attachable
	def.EnableIPv6 = rn.EnableIPv6
	def.IPAM = trimIPAM(rn.IPAM)
	def.Options = rn.DriverOpts

	switch rn.External.Kind {
	case 0:
	case yaml.ScalarNode:
		if rn.External.Tag == "!!null" {
			break
		}
		var ext bool
		if err := rn.External.Decode(&ext); err != nil {
			return NetworkDef{}, validationf("Network %q: external must be a boolean.", name)
		}
		def.External = ext
	case yaml.MappingNode:
		// Legacy form: external: {name: real_name}.
		var legacy struct {
			Name string `yaml:"name"`
		}
		if err := rn.External.Decode(&legacy); err != nil {
			return NetworkDef{}, validationf("Network %q: external: %s", name, oneLine(err.Error()))
		}
		def.External = true
		if n := strings.TrimSpace(legacy.Name); n != "" {
			def.Name = n
			def.ExplicitName = true
		}
	default:
		return NetworkDef{}, validationf("Network %q: external must be a boolean or a mapping.", name)
	}
	return def, nil
}

// trimIPAM trims every address string in an ipam block so validation and the
// deploy path see canonical input.
func trimIPAM(in IPAM) IPAM {
	out := IPAM{Driver: strings.TrimSpace(in.Driver)}
	if len(in.Config) == 0 {
		return out
	}
	out.Config = make([]IPAMConfig, 0, len(in.Config))
	for _, c := range in.Config {
		cfg := IPAMConfig{
			Subnet:  strings.TrimSpace(c.Subnet),
			Gateway: strings.TrimSpace(c.Gateway),
			IPRange: strings.TrimSpace(c.IPRange),
		}
		if len(c.AuxAddresses) > 0 {
			cfg.AuxAddresses = make(map[string]string, len(c.AuxAddresses))
			for k, v := range c.AuxAddresses {
				cfg.AuxAddresses[strings.TrimSpace(k)] = strings.TrimSpace(v)
			}
		}
		out.Config = append(out.Config, cfg)
	}
	return out
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
// form (network name -> options) and returns the network names plus one
// ServiceNetwork per name. The mapping form's ipv4_address, ipv6_address and
// aliases are captured; its other per-network options are ignored.
func normalizeNetworks(svc string, node *yaml.Node) ([]string, []ServiceNetwork, error) {
	if node == nil || node.Kind == 0 {
		return nil, nil, nil
	}
	if node.Kind == yaml.MappingNode {
		names := make([]string, 0, len(node.Content)/2)
		attach := make([]ServiceNetwork, 0, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			n := strings.TrimSpace(node.Content[i].Value)
			sn, err := decodeServiceNetwork(svc, n, node.Content[i+1])
			if err != nil {
				return nil, nil, err
			}
			names = append(names, n)
			attach = append(attach, sn)
		}
		return names, attach, nil
	}
	names, err := normalizeStringList(svc, "networks", node)
	if err != nil {
		return nil, nil, err
	}
	var attach []ServiceNetwork
	if len(names) > 0 {
		attach = make([]ServiceNetwork, 0, len(names))
		for _, n := range names {
			attach = append(attach, ServiceNetwork{Name: n})
		}
	}
	return names, attach, nil
}

// decodeServiceNetwork decodes the value of one mapping-form network entry. A
// null value (`backend:` with no body) is a plain attachment.
func decodeServiceNetwork(svc, netName string, val *yaml.Node) (ServiceNetwork, error) {
	sn := ServiceNetwork{Name: netName}
	if val == nil || val.Kind != yaml.MappingNode {
		return sn, nil
	}
	var opts rawServiceNetwork
	if err := val.Decode(&opts); err != nil {
		return ServiceNetwork{}, validationf("Service %q: network %q: %s", svc, netName, oneLine(err.Error()))
	}
	aliases, err := normalizeStringList(svc, "networks."+netName+".aliases", &opts.Aliases)
	if err != nil {
		return ServiceNetwork{}, err
	}
	sn.IPv4 = strings.TrimSpace(opts.IPv4)
	sn.IPv6 = strings.TrimSpace(opts.IPv6)
	sn.Aliases = aliases
	return sn, nil
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

// validate runs cross-service semantic checks: every service has an image,
// every depends_on target names a real service, and network addressing is
// consistent.
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
	return m.validateNetworks()
}

// validateNetworks checks every top-level ipam declaration (subnet, gateway,
// ip_range and aux_addresses parse and nest correctly) and every static
// address a service requests against the pools of the network it names. A
// static address on a network that declares no pool of its family is not an
// error here: the section used to be ignored entirely, so BuildPlan drops
// such an address with a warning instead (see Plan.Warnings). Iteration is
// sorted so the first error reported is deterministic.
func (m *Model) validateNetworks() error {
	pools, err := m.networkPools()
	if err != nil {
		return err
	}
	for _, svcName := range m.ServiceNamesSorted() {
		for _, att := range m.Services[svcName].NetworkAttach {
			if att.IPv4 != "" {
				if err := validateStaticIP(svcName, att.Name, "ipv4_address", att.IPv4, false, pools[att.Name]); err != nil {
					return err
				}
			}
			if att.IPv6 != "" {
				if err := validateStaticIP(svcName, att.Name, "ipv6_address", att.IPv6, true, pools[att.Name]); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// networkPools parses the ipam pools of every top-level network, keyed by
// the YAML network name, validating each (validateIPAMConfig).
func (m *Model) networkPools() (map[string][]*net.IPNet, error) {
	pools := make(map[string][]*net.IPNet, len(m.Networks))
	for _, name := range sortedKeys(m.Networks) {
		def := m.Networks[name]
		for i, cfg := range def.IPAM.Config {
			subnet, err := validateIPAMConfig(name, i, cfg)
			if err != nil {
				return nil, err
			}
			if subnet != nil {
				pools[name] = append(pools[name], subnet)
			}
		}
	}
	return pools, nil
}

// hasPoolFamily reports whether pools holds a subnet of the given family.
func hasPoolFamily(pools []*net.IPNet, v6 bool) bool {
	for _, p := range pools {
		if (p.IP.To4() == nil) == v6 {
			return true
		}
	}
	return false
}

// validateIPAMConfig checks one ipam pool and returns its parsed subnet (nil
// for an entry that declares nothing).
func validateIPAMConfig(netName string, idx int, cfg IPAMConfig) (*net.IPNet, error) {
	if cfg.Subnet == "" {
		if cfg.Gateway != "" || cfg.IPRange != "" || len(cfg.AuxAddresses) > 0 {
			return nil, validationf("Network %q: ipam config #%d needs a subnet.", netName, idx+1)
		}
		return nil, nil
	}
	_, subnet, err := net.ParseCIDR(cfg.Subnet)
	if err != nil {
		return nil, validationf("Network %q: invalid ipam subnet %q.", netName, cfg.Subnet)
	}
	if cfg.Gateway != "" {
		gw := net.ParseIP(cfg.Gateway)
		if gw == nil || !sameFamily(gw, subnet.IP) {
			return nil, validationf("Network %q: invalid ipam gateway %q.", netName, cfg.Gateway)
		}
		if !subnet.Contains(gw) {
			return nil, validationf("Network %q: ipam gateway %q is not inside subnet %q.", netName, cfg.Gateway, cfg.Subnet)
		}
	}
	if cfg.IPRange != "" {
		_, rng, rerr := net.ParseCIDR(cfg.IPRange)
		if rerr != nil {
			return nil, validationf("Network %q: invalid ipam ip_range %q.", netName, cfg.IPRange)
		}
		if !cidrWithin(rng, subnet) {
			return nil, validationf("Network %q: ipam ip_range %q is not inside subnet %q.", netName, cfg.IPRange, cfg.Subnet)
		}
	}
	for _, host := range sortedKeys(cfg.AuxAddresses) {
		addr := cfg.AuxAddresses[host]
		ip := net.ParseIP(addr)
		if ip == nil || !sameFamily(ip, subnet.IP) {
			return nil, validationf("Network %q: invalid ipam aux_address %q for %q.", netName, addr, host)
		}
		if !subnet.Contains(ip) {
			return nil, validationf("Network %q: ipam aux_address %q for %q is not inside subnet %q.", netName, addr, host, cfg.Subnet)
		}
	}
	return subnet, nil
}

// validateStaticIP checks one ipv4_address/ipv6_address: it must parse in the
// family its field names and, when the named network declares pools of that
// family, fall inside one of them. With no such pool the address is accepted
// here (an external network's pools live outside the document; on any other
// network BuildPlan drops it with a warning).
func validateStaticIP(svc, netName, field, addr string, v6 bool, pools []*net.IPNet) error {
	ip := net.ParseIP(addr)
	if ip == nil || (ip.To4() == nil) != v6 {
		return validationf("Service %q: invalid %s %q on network %q.", svc, field, addr, netName)
	}
	family := make([]*net.IPNet, 0, len(pools))
	for _, p := range pools {
		if (p.IP.To4() == nil) == v6 {
			family = append(family, p)
		}
	}
	if len(family) == 0 {
		return nil
	}
	cidrs := make([]string, 0, len(family))
	for _, p := range family {
		if p.Contains(ip) {
			return nil
		}
		cidrs = append(cidrs, p.String())
	}
	return validationf("Service %q: %s %q is outside the subnet of network %q (%s).", svc, field, addr, netName, strings.Join(cidrs, ", "))
}

// sameFamily reports whether both addresses are IPv4 or both IPv6.
func sameFamily(a, b net.IP) bool {
	return (a.To4() == nil) == (b.To4() == nil)
}

// cidrWithin reports whether inner is fully contained in outer.
func cidrWithin(inner, outer *net.IPNet) bool {
	if !sameFamily(inner.IP, outer.IP) {
		return false
	}
	innerOnes, _ := inner.Mask.Size()
	outerOnes, _ := outer.Mask.Size()
	return innerOnes >= outerOnes && outer.Contains(inner.IP)
}

// sortedKeys returns a map's keys in alphabetical order.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
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
