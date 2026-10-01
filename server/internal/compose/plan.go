// Castor by IT Leonard
package compose

import (
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/gtek-it/castor/server/internal/provider/docker"
)

// Compose object-label keys, matching the docker compose CLI so the resulting
// containers are discoverable/teardownable exactly like CLI-deployed stacks.
const (
	LabelProject        = "com.docker.compose.project"
	LabelService        = "com.docker.compose.service"
	LabelContainerNum   = "com.docker.compose.container-number"
	LabelManagedBy      = "com.docker.compose.oneoff" // present=false marker for non-oneoff
	LabelCastorStack    = "io.castor.stack"           // Castor marker (=project)
	LabelCastorManaged  = "io.castor.managed"         // "true" on everything Castor deploys
	LabelCastorTemplate = "io.castor.template"        // marketplace template slug a container was deployed from
)

// defaultNetworkKey is the compose name of the implicit project network: a
// service that lists no network joins it, and a service may list it
// explicitly next to others.
const defaultNetworkKey = "default"

// Plan is the ordered deployment plan derived from a compose Model: the specs
// to create+start (in dependency order) plus the network set they join.
//
// Networks are referenced by their project-scoped key, "<project>_<name>"
// (the compose name sanitized; "default" for the implicit project network).
// NetworkNames maps each key to the daemon network name: the key itself
// unless the declaration sets `name:` (created under that exact name) or is
// external (joined by its real name, never created or removed).
type Plan struct {
	Project string
	// Specs are in topological order: a service's dependencies appear before it.
	// Each spec's Networks holds exactly its primary membership (the first
	// network of Memberships, by daemon name, with the ipv4_address and the
	// aliases it carries): the network ContainerCreate hands the container.
	Specs []docker.DeploySpec
	// Aliases maps a spec Name (== sanitized container name) to the network
	// aliases it should be reachable as on every network it joins. The service
	// name is always an alias so intra-stack DNS by service name works.
	Aliases map[string][]string
	// Memberships maps a spec Name to the keys of every network the service
	// joins, in declaration order and de-duplicated: the first is the primary
	// (mirrored in Specs), the rest are connected after create. A service that
	// lists no network joins the project default only; one that lists networks
	// joins exactly those (the default too only when listed).
	Memberships map[string][]string
	// Networks is the de-duplicated set of keys the services join, in first-use
	// order: every one must exist before the containers are created. A declared
	// network no service joins is not in it.
	Networks []string
	// NetworkNames maps every key in Networks (and every declared network) to
	// its daemon network name; see the type comment.
	NetworkNames map[string]string
	// NetworkDefs maps every top-level network declaration to its definition,
	// keyed like Networks. A network a service references without a top-level
	// declaration has no entry: the deploy path creates it as a plain bridge.
	NetworkDefs map[string]NetworkDef
	// StaticIPs maps a spec Name to the per-network addressing it requested
	// (ipv4_address, ipv6_address, extra aliases), keyed by network key.
	// Attachments that request nothing are absent; an address the plan dropped
	// (see Warnings) is absent too.
	StaticIPs map[string]map[string]ServiceNetwork
	// Warnings lists what the plan left out of a valid document, one message
	// per item: a static address on a network that declares no subnet of its
	// family (the daemon assigns one instead), or an ipv6_address on a
	// service's primary network (only ipv4 is carried at create).
	Warnings []string
}

// BuildPlan converts a validated Model into an ordered deployment Plan for the
// given (raw) project name. It sanitizes the project name, topologically sorts
// services by depends_on (cycle -> error), parses port and volume strings,
// resolves the network set and stamps every spec with the compose object
// labels.
func BuildPlan(rawProject string, m *Model) (*Plan, error) {
	project := SanitizeProjectName(rawProject)
	if project == "" {
		return nil, validationf("Invalid project name (use letters, digits, '-' or '_').")
	}

	order, err := topoSort(m)
	if err != nil {
		return nil, err
	}
	// Parse already ran this; a Model built by hand has not been checked.
	if err := m.validateNetworks(); err != nil {
		return nil, err
	}
	pools, err := m.networkPools()
	if err != nil {
		return nil, err
	}

	plan := &Plan{
		Project:      project,
		Specs:        make([]docker.DeploySpec, 0, len(order)),
		Aliases:      make(map[string][]string, len(order)),
		Memberships:  make(map[string][]string, len(order)),
		NetworkNames: make(map[string]string, len(m.Networks)+1),
		NetworkDefs:  make(map[string]NetworkDef, len(m.Networks)),
		StaticIPs:    make(map[string]map[string]ServiceNetwork),
	}
	if err := plan.declareNetworks(m); err != nil {
		return nil, err
	}
	netSet := map[string]struct{}{}

	for _, name := range order {
		svc := m.Services[name]

		ports, perr := parsePorts(name, svc.Ports)
		if perr != nil {
			return nil, perr
		}
		vols, verr := parseVolumes(name, svc.Volumes)
		if verr != nil {
			return nil, verr
		}

		containerName := svc.ContainerName
		if containerName == "" {
			containerName = project + "-" + name
		}

		labels := map[string]string{
			LabelProject:       project,
			LabelService:       name,
			LabelContainerNum:  "1",
			LabelCastorStack:   project,
			LabelCastorManaged: "true",
		}

		// The service is always reachable by its compose service name; if the
		// container name differs, expose it as an alias too.
		aliases := []string{name}
		if containerName != name {
			aliases = append(aliases, containerName)
		}
		plan.Aliases[containerName] = aliases

		// Memberships in declaration order, the project default when none is
		// listed; a network listed twice counts once.
		var keys []string
		seen := map[string]struct{}{}
		for _, att := range svc.attachments() {
			key := plan.networkKey(att.Name)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			keys = append(keys, key)
			if _, listed := netSet[key]; !listed {
				netSet[key] = struct{}{}
				plan.Networks = append(plan.Networks, key)
			}
			if _, known := plan.NetworkNames[key]; !known {
				plan.NetworkNames[key] = key
			}
			att = plan.routableAddresses(name, att, m, pools[att.Name])
			if att.IPv4 != "" || att.IPv6 != "" || len(att.Aliases) > 0 {
				if plan.StaticIPs[containerName] == nil {
					plan.StaticIPs[containerName] = make(map[string]ServiceNetwork)
				}
				plan.StaticIPs[containerName][key] = att
			}
		}
		plan.Memberships[containerName] = keys

		// The primary membership travels with the spec so the container is
		// created on it and never touches the daemon's default bridge.
		primary := keys[0]
		att := plan.StaticIPs[containerName][primary]
		if att.IPv6 != "" {
			plan.warnf("Service %q: ipv6_address %q on its primary network %q is not applied (only ipv4_address and aliases are set at create; list another network first to keep it).",
				name, att.IPv6, att.Name)
		}
		spec := docker.DeploySpec{
			Image:         svc.Image,
			Name:          containerName,
			Env:           envMap(svc.Environment),
			Ports:         ports,
			Volumes:       vols,
			Labels:        labels,
			RestartPolicy: normalizeRestart(svc.Restart),
			Networks: []docker.NetworkAttach{{
				Name:    plan.NetworkNames[primary],
				IPv4:    att.IPv4,
				Aliases: append(append([]string{}, aliases...), att.Aliases...),
			}},
		}
		plan.Specs = append(plan.Specs, spec)
	}
	return plan, nil
}

// declareNetworks records the top-level declarations under their keys and
// resolves each one's daemon name. Two declarations collapsing onto the same
// key (names differing only in sanitized characters) or onto the same daemon
// name are rejected: they would silently share one network.
func (p *Plan) declareNetworks(m *Model) error {
	byKey := make(map[string]string, len(m.Networks))
	byName := make(map[string]string, len(m.Networks))
	for _, yamlName := range sortedKeys(m.Networks) {
		def := m.Networks[yamlName]
		key := p.networkKey(yamlName)
		if prev, dup := byKey[key]; dup {
			return validationf("Networks %q and %q both map to %q; rename one.", prev, yamlName, key)
		}
		byKey[key] = yamlName
		name := key
		if def.External || def.ExplicitName {
			name = def.Name
		}
		if prev, dup := byName[name]; dup {
			return validationf("Networks %q and %q both resolve to the network name %q; rename one.", prev, yamlName, name)
		}
		byName[name] = yamlName
		p.NetworkDefs[key] = def
		p.NetworkNames[key] = name
	}
	return nil
}

// networkKey returns the project-scoped key of a compose network name.
func (p *Plan) networkKey(name string) string {
	return p.Project + "_" + SanitizeNetworkSuffix(name)
}

// routableAddresses returns att without the static addresses the network
// cannot honor: an ipv4_address or ipv6_address on a network that declares no
// pool of that family (undeclared networks included) is dropped with a
// warning, the daemon then assigning an address. An external network keeps
// them: its pools live outside the document.
func (p *Plan) routableAddresses(svc string, att ServiceNetwork, m *Model, pools []*net.IPNet) ServiceNetwork {
	def, declared := m.Networks[att.Name]
	if declared && def.External {
		return att
	}
	if att.IPv4 != "" && !hasPoolFamily(pools, false) {
		p.warnf("Service %q: ipv4_address %q ignored: network %q declares no ipam subnet, so the daemon assigns the address.", svc, att.IPv4, att.Name)
		att.IPv4 = ""
	}
	if att.IPv6 != "" && !hasPoolFamily(pools, true) {
		p.warnf("Service %q: ipv6_address %q ignored: network %q declares no IPv6 ipam subnet, so the daemon assigns the address.", svc, att.IPv6, att.Name)
		att.IPv6 = ""
	}
	return att
}

// warnf appends a formatted message to Warnings.
func (p *Plan) warnf(format string, args ...any) {
	p.Warnings = append(p.Warnings, fmt.Sprintf(format, args...))
}

// attachments returns the service's network attachments in declaration
// order: NetworkAttach when Parse produced it, else one plain attachment per
// Networks entry (a Model built by hand), else the implicit project default.
func (s Service) attachments() []ServiceNetwork {
	if len(s.Networks) == 0 && len(s.NetworkAttach) == 0 {
		return []ServiceNetwork{{Name: defaultNetworkKey}}
	}
	if len(s.Networks) == 0 {
		return s.NetworkAttach
	}
	byName := make(map[string]ServiceNetwork, len(s.NetworkAttach))
	for _, att := range s.NetworkAttach {
		byName[att.Name] = att
	}
	out := make([]ServiceNetwork, 0, len(s.Networks))
	for _, n := range s.Networks {
		att, ok := byName[n]
		if !ok {
			att = ServiceNetwork{Name: n}
		}
		out = append(out, att)
	}
	return out
}

// DefaultNetworkName is the key of the implicit project network every service
// without an explicit network list joins (matches docker compose's
// "<project>_default"). NetworkNames gives its daemon name, which differs when
// the document declares `networks: default:` with `name:` or `external:`.
func (p *Plan) DefaultNetworkName() string { return p.networkKey(defaultNetworkKey) }

// HostMountSources returns every host bind-mount source declared across all of
// the plan's services, in spec order. It is the single place the deploy path
// asks "does this stack want host mounts?" so the host-mount escalation guard
// (see api.authorizePlanHostMounts and docker.ValidateMounts) is consistent with
// how the plan is built. BuildPlan itself does NOT reject host mounts — that
// would break the pure validate/teardown paths that also build a Plan — so the
// privilege-aware rejection lives at the handler + provider layers, both of which
// classify binds via docker.HostMountSources / docker.ValidateMounts.
func (p *Plan) HostMountSources() []string {
	var out []string
	for i := range p.Specs {
		out = append(out, docker.HostMountSources(p.Specs[i].Volumes)...)
	}
	return out
}

// topoSort returns the service names ordered so each service follows all of its
// depends_on targets. It uses Kahn's algorithm over the dependency DAG and
// returns a ValidationError if a cycle is detected. Ties are broken
// alphabetically for deterministic output.
func topoSort(m *Model) ([]string, error) {
	// indegree[x] = number of unsatisfied dependencies of x.
	indegree := make(map[string]int, len(m.Services))
	// dependents[d] = services that depend on d (edges d -> x).
	dependents := make(map[string][]string, len(m.Services))

	names := m.ServiceNamesSorted()
	for _, n := range names {
		if _, ok := indegree[n]; !ok {
			indegree[n] = 0
		}
		for _, dep := range m.Services[n].DependsOn {
			indegree[n]++
			dependents[dep] = append(dependents[dep], n)
		}
	}

	// Seed the queue with zero-indegree nodes, in alphabetical order.
	queue := make([]string, 0, len(names))
	for _, n := range names {
		if indegree[n] == 0 {
			queue = append(queue, n)
		}
	}

	out := make([]string, 0, len(names))
	for len(queue) > 0 {
		// Pop the alphabetically-smallest ready node for determinism.
		min := 0
		for i := 1; i < len(queue); i++ {
			if queue[i] < queue[min] {
				min = i
			}
		}
		n := queue[min]
		queue = append(queue[:min], queue[min+1:]...)
		out = append(out, n)

		for _, x := range dependents[n] {
			indegree[x]--
			if indegree[x] == 0 {
				queue = append(queue, x)
			}
		}
	}

	if len(out) != len(names) {
		return nil, validationf("depends_on contains a cycle; services cannot be ordered.")
	}
	return out, nil
}

// parsePorts converts compose port strings into docker.PortMap. Accepted forms:
//
//	"8080:80"          host:container
//	"8080:80/udp"      host:container/proto
//	"80"               container only (ephemeral host port)
//	"80/udp"           container/proto only
//	"127.0.0.1:8080:80" ip:host:container (the ip is dropped; bind-all)
//
// Port ranges ("8000-8005:8000-8005") are rejected with a clear message (V1
// publishes discrete ports only).
func parsePorts(svc string, specs []string) ([]docker.PortMap, error) {
	if len(specs) == 0 {
		return nil, nil
	}
	out := make([]docker.PortMap, 0, len(specs))
	for _, raw := range specs {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}

		proto := "tcp"
		if i := strings.LastIndex(s, "/"); i >= 0 {
			proto = strings.ToLower(strings.TrimSpace(s[i+1:]))
			s = s[:i]
			if proto != "tcp" && proto != "udp" && proto != "sctp" {
				return nil, validationf("Service %q: invalid port protocol %q.", svc, proto)
			}
		}

		parts := strings.Split(s, ":")
		var hostStr, contStr string
		switch len(parts) {
		case 1:
			contStr = parts[0]
		case 2:
			hostStr, contStr = parts[0], parts[1]
		case 3:
			// ip:host:container — the bind IP is not modeled; bind to all.
			hostStr, contStr = parts[1], parts[2]
		default:
			return nil, validationf("Service %q: invalid port mapping %q.", svc, raw)
		}

		if strings.Contains(contStr, "-") || strings.Contains(hostStr, "-") {
			return nil, validationf("Service %q: port ranges are not supported (%q).", svc, raw)
		}

		cont, err := parsePortNum(contStr)
		if err != nil {
			return nil, validationf("Service %q: invalid container port in %q.", svc, raw)
		}
		host := 0
		if strings.TrimSpace(hostStr) != "" {
			host, err = parsePortNum(hostStr)
			if err != nil {
				return nil, validationf("Service %q: invalid host port in %q.", svc, raw)
			}
		}
		out = append(out, docker.PortMap{Host: host, Container: cont, Proto: proto})
	}
	return out, nil
}

// parsePortNum parses a 1..65535 port number.
func parsePortNum(s string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, err
	}
	if n < 1 || n > 65535 {
		return 0, fmt.Errorf("port out of range: %d", n)
	}
	return n, nil
}

// parseVolumes converts compose volume strings into docker.VolMount. Accepted
// forms:
//
//	"/abs/host:/container"        bind mount (host abs path -> container)
//	"named:/container"            named volume -> container
//	"named:/container:ro"         trailing mode flag is tolerated (and dropped)
//	"/container"                  anonymous volume at container path (Source="")
//
// The long object form (volumes: [{type, source, target}]) is not parsed here;
// it requires the mapping list, which the parser flattens to scalars only.
func parseVolumes(svc string, specs []string) ([]docker.VolMount, error) {
	if len(specs) == 0 {
		return nil, nil
	}
	out := make([]docker.VolMount, 0, len(specs))
	for _, raw := range specs {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		parts := strings.Split(s, ":")
		switch len(parts) {
		case 1:
			// Anonymous volume mounted at the given container path.
			out = append(out, docker.VolMount{Source: "", Target: parts[0]})
		case 2:
			out = append(out, docker.VolMount{Source: parts[0], Target: parts[1]})
		case 3:
			// src:dst:mode — drop the mode flag (ro/rw/z/Z) in V1.
			out = append(out, docker.VolMount{Source: parts[0], Target: parts[1]})
		default:
			return nil, validationf("Service %q: invalid volume mapping %q.", svc, raw)
		}
	}
	return out, nil
}

// envMap converts the ordered "KEY=VALUE" environment slice into the map the
// DeploySpec expects. A bare "KEY" (no '=') maps to an empty value.
func envMap(env []string) map[string]string {
	if len(env) == 0 {
		return nil
	}
	out := make(map[string]string, len(env))
	for _, e := range env {
		k, v, found := strings.Cut(e, "=")
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		if !found {
			v = ""
		}
		out[k] = v
	}
	return out
}

// normalizeRestart maps a compose restart value to the docker restart-policy
// enum. Compose's "no"/"always"/"on-failure"/"unless-stopped" map 1:1; an
// unknown/empty value yields "" (the provider defaults it to "no").
func normalizeRestart(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "always":
		return "always"
	case "on-failure":
		return "on-failure"
	case "unless-stopped":
		return "unless-stopped"
	case "no":
		return "no"
	default:
		return ""
	}
}

// SanitizeProjectName lowercases the input and keeps only [a-z0-9_-], collapsing
// any other run to a single '-' and trimming leading/trailing separators. This
// is the value stored as the compose project label and used to enumerate the
// stack's containers for teardown.
func SanitizeProjectName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevSep := false
	for _, c := range s {
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteRune(c)
			prevSep = false
		case c == '-' || c == '_':
			if b.Len() > 0 && !prevSep {
				b.WriteRune(c)
				prevSep = true
			}
		case c == ' ' || c == '.' || c == '/':
			if b.Len() > 0 && !prevSep {
				b.WriteByte('-')
				prevSep = true
			}
		}
	}
	return strings.Trim(b.String(), "-_")
}

// SanitizeNetworkSuffix sanitizes a user-declared network name into the suffix
// used to build the project-scoped network name. Same charset rules as the
// project name.
func SanitizeNetworkSuffix(s string) string {
	out := SanitizeProjectName(s)
	if out == "" {
		return "net"
	}
	return out
}
