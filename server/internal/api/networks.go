// Castor by IT Leonard
package api

import (
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
)

// defaultBridgeNetwork is the daemon's built-in bridge. It has no user-defined
// subnet and no embedded DNS, so the daemon refuses static addresses and
// network-scoped aliases on it; the attach paths answer that up front instead
// of round-tripping.
const defaultBridgeNetwork = "bridge"

// castorProtectedLabel is the default label marking a container as protected
// from destructive actions (mirrors the provider's Protected flag).
const castorProtectedLabel = "io.castor.protected"

// msgAliasesDefaultBridge is the 422 message for aliases on the default bridge.
const msgAliasesDefaultBridge = "Network aliases are not supported on the default bridge network; use a user-defined network."

// networkView is one network in the list response: the snapshot summary plus
// the number of snapshot containers configured on it (all states, so stopped
// containers count too; the detail lists the same set).
type networkView struct {
	docker.NetworkInfo
	ContainerCount int `json:"containerCount"`
}

// networkDetailView is the inspect response: the daemon view whose container
// list is merged with the snapshot (see networkContainers), plus its length as
// containerCount so list and detail agree.
type networkDetailView struct {
	docker.NetworkDetail
	ContainerCount int `json:"containerCount"`
}

// networkConnectRequest is the POST .../networks/{id}/connect body.
type networkConnectRequest struct {
	ContainerID string   `json:"containerId"`
	IPv4        string   `json:"ipv4"`
	IPv6        string   `json:"ipv6"`
	Aliases     []string `json:"aliases"`
}

// networkDisconnectRequest is the POST .../networks/{id}/disconnect body.
// Force also detaches an endpoint the daemon still holds for a gone container.
type networkDisconnectRequest struct {
	ContainerID string `json:"containerId"`
	Force       bool   `json:"force"`
}

// networkDrivers is the set of drivers a create request may name. The daemon
// accepts plugin drivers too, but an unknown name here is far more often a
// typo than a plugin, and the host-interface gate below relies on knowing the
// driver.
var networkDrivers = map[string]struct{}{
	"bridge": {}, "overlay": {}, "macvlan": {}, "ipvlan": {},
}

// l2NetworkDrivers are the drivers that bind a network to a host interface by
// design: their containers get raw layer-2 access to the host's segment,
// bypassing the daemon's NAT and firewall rules.
var l2NetworkDrivers = map[string]struct{}{"macvlan": {}, "ipvlan": {}}

// networkOptionsAllowed are the driver options any holder of
// docker.network.create may set. Everything else is refused (unknown key) or
// reserved to superusers (networkOptionsHostInterface).
var networkOptionsAllowed = map[string]struct{}{
	"com.docker.network.bridge.enable_icc":           {},
	"com.docker.network.bridge.enable_ip_masquerade": {},
	"com.docker.network.bridge.host_binding_ipv4":    {},
	"com.docker.network.driver.mtu":                  {},
	"com.docker.network.container_iface_prefix":      {},
	"encrypted": {},
	"com.docker.network.driver.overlay.vxlanid_list": {},
}

// networkOptionsHostInterface are the driver options that name or tune a host
// interface, for any driver: they let a network adopt an existing interface
// (or a bridge by name) and are reserved to superusers.
var networkOptionsHostInterface = map[string]struct{}{
	"parent":                         {},
	"macvlan_mode":                   {},
	"ipvlan_mode":                    {},
	"ipvlan_flag":                    {},
	"com.docker.network.bridge.name": {},
}

// Networks lists networks from the cache snapshot, each with the count of
// snapshot containers attached to it. No daemon call.
func (s *Server) Networks(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	ok2json(w, networkViews(snap))
}

// networkViews enriches the snapshot's networks with containerCount: the
// number of docker workloads whose NetworkNames include the network's name,
// whatever their state (the same set the detail lists). Never nil, so the
// JSON is an array.
func networkViews(snap cache.Snapshot) []networkView {
	counts := make(map[string]int, len(snap.Networks))
	for i := range snap.Workloads {
		for _, n := range snap.Workloads[i].NetworkNames {
			counts[n]++
		}
	}
	out := make([]networkView, 0, len(snap.Networks))
	for _, n := range snap.Networks {
		out = append(out, networkView{NetworkInfo: n, ContainerCount: counts[n.Name]})
	}
	return out
}

// NetworkDetail inspects one network by id or name (perm docker.network.read).
// The daemon's live endpoints are merged with the snapshot's configured
// memberships so stopped containers show too.
func (s *Server) NetworkDetail(w http.ResponseWriter, r *http.Request) {
	snap, found := s.manager.Store().Get(chi.URLParam(r, "hostID"))
	if !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	dp := s.manager.Docker()
	if dp == nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	detail, err := dp.InspectNetwork(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	detail.Containers = s.networkContainers(snap, detail)
	ok(w, networkDetailView{NetworkDetail: *detail, ContainerCount: len(detail.Containers)})
}

// networkContainers merges the daemon's live endpoints with the snapshot: an
// endpoint the snapshot knows takes its state and protected flag from there
// (Running stays true, the daemon's view is fresher); a snapshot container
// configured on the network (NetworkNames) but absent from the inspect is
// appended with Running=false, its last-polled state and the IPv4 the
// snapshot holds for it, if any. Sorted by name then id. Never nil.
func (s *Server) networkContainers(snap cache.Snapshot, detail *docker.NetworkDetail) []docker.NetworkEndpoint {
	byID := make(map[string]provider.Workload, len(snap.Workloads))
	for i := range snap.Workloads {
		byID[snap.Workloads[i].ID] = snap.Workloads[i]
	}
	out := make([]docker.NetworkEndpoint, 0, len(detail.Containers))
	seen := make(map[string]struct{}, len(detail.Containers))
	for _, ep := range detail.Containers {
		seen[ep.ContainerID] = struct{}{}
		if wl, known := byID[ep.ContainerID]; known {
			if wl.State != "" {
				ep.State = string(wl.State)
			}
			if ep.Name == "" {
				ep.Name = wl.Name
			}
			ep.Protected = s.workloadProtected(wl)
		}
		out = append(out, ep)
	}
	for i := range snap.Workloads {
		wl := snap.Workloads[i]
		if _, dup := seen[wl.ID]; dup || !containsString(wl.NetworkNames, detail.Name) {
			continue
		}
		out = append(out, docker.NetworkEndpoint{
			ContainerID: wl.ID,
			Name:        wl.Name,
			IPv4:        snapshotNetworkIPv4(wl, detail.NetworkInfo),
			Running:     false,
			State:       string(wl.State),
			Protected:   s.workloadProtected(wl),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ContainerID < out[j].ContainerID
	})
	return out
}

// snapshotNetworkIPv4 returns the IPv4 the snapshot holds for wl on the given
// network: the per-network detail when the row carries one, else the row's
// first address when this network is the first the row is on (IPAddress is
// the first IPv4 in NetworkNames order, so it belongs to that network).
func snapshotNetworkIPv4(wl provider.Workload, n docker.NetworkInfo) string {
	for _, wn := range wl.Networks {
		if wn.Name == n.Name || (n.ID != "" && wn.NetworkID == n.ID) {
			return wn.IPv4
		}
	}
	if len(wl.NetworkNames) > 0 && wl.NetworkNames[0] == n.Name {
		return wl.IPAddress
	}
	return ""
}

// workloadProtected reports whether a snapshot container is Castor's own or
// carries the protected label: the provider's flag, the label itself (for
// rows seeded without the flag), or an id match with the guard's self id.
func (s *Server) workloadProtected(wl provider.Workload) bool {
	if wl.Protected {
		return true
	}
	if v, ok := wl.Labels[castorProtectedLabel]; ok && strings.EqualFold(strings.TrimSpace(v), "true") {
		return true
	}
	self := s.guard.SelfContainerID()
	if self == "" || wl.ID == "" {
		return false
	}
	if wl.ID == self {
		return true
	}
	return len(wl.ID) >= 12 && len(self) >= 12 && (strings.HasPrefix(wl.ID, self) || strings.HasPrefix(self, wl.ID))
}

// CreateNetwork creates a Docker network (perm docker.network.create; operator).
// Body: {name (required), driver? (bridge|overlay|macvlan|ipvlan, default
// bridge), internal?, attachable?, enableIPv6?, options?, ipam?, labels?}.
// authorizeNetworkCreate checks the driver and the option allowlist and gates
// anything bound to a host interface behind superuser; the IPAM pools are
// checked here so a bad address gets a precise 422 before the daemon sees it.
// Returns the created summary.
func (s *Server) CreateNetwork(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.manager.Store().Get(chi.URLParam(r, "hostID")); !ok {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	var spec docker.NetworkSpec
	if err := decodeJSON(w, r, &spec); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	spec.Name = strings.TrimSpace(spec.Name)
	if !validVolumeName(spec.Name) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "Invalid network name."))
		return
	}
	authz.SetAuditTarget(r, "network", spec.Name, spec.Name)

	if err := s.authorizeNetworkCreate(r, &spec); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if err := validateIPAM(spec.IPAM); err != nil {
		authz.WriteError(w, r, err)
		return
	}

	dp := s.manager.Docker()
	if dp == nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	info, err := dp.CreateNetwork(r.Context(), spec)
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "network", info.ID, info.Name)
	ok(w, info)
}

// DeleteNetwork removes a network by id (perm docker.network.delete; admin).
func (s *Server) DeleteNetwork(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	authz.SetAuditTarget(r, "network", id, id)

	dp := s.manager.Docker()
	if dp == nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	if err := dp.DeleteNetwork(r.Context(), id); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// ConnectNetwork attaches a container to a network (perm
// docker.network.connect). Body: {containerId (required), ipv4?, ipv6?,
// aliases?}. A static address (409) or an alias (422) on the default bridge is
// refused up front (the daemon cannot honor either). The container must be a
// docker workload known to the snapshot and passes the destructive-action
// guard: Castor's own container and protected containers are never rewired.
// The network must exist in the snapshot, and joining one bound to a host
// interface (authorizeNetworkAttach) is reserved to superusers.
func (s *Server) ConnectNetwork(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	netID := chi.URLParam(r, "id")
	snap, found := s.manager.Store().Get(hostID)
	if !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	authz.SetAuditTarget(r, "network", netID, snapshotNetworkName(snap, netID))

	var req networkConnectRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	opts, err := networkAttachOptions(&req)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if isDefaultBridge(snap, netID) {
		if opts.IPv4 != "" || opts.IPv6 != "" {
			authz.WriteError(w, r, authz.Errorf(authz.ErrStaticIPUnsupported, provider.MsgStaticIPUnsupported))
			return
		}
		if len(opts.Aliases) > 0 {
			authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, msgAliasesDefaultBridge))
			return
		}
	}

	wl, err := s.resolveNetworkContainer(r, snap, req.ContainerID)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	info, err := s.authorizeNetworkAttach(r, hostID, netID)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	dp := s.manager.Docker()
	if dp == nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	// The resolved id, not the caller's reference: what was authorized is
	// exactly what gets attached, even if the name was rebound meanwhile.
	if err := dp.ConnectContainerToNetwork(r.Context(), info.ID, wl.ID, opts); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// DisconnectNetwork detaches a container from a network (perm
// docker.network.disconnect). Body: {containerId (required), force?}. A
// container the snapshot knows passes the same protection guard as
// ConnectNetwork; with force, an unknown one (an endpoint the daemon still
// holds for a gone container) is passed to the daemon as given.
func (s *Server) DisconnectNetwork(w http.ResponseWriter, r *http.Request) {
	hostID := chi.URLParam(r, "hostID")
	netID := chi.URLParam(r, "id")
	snap, found := s.manager.Store().Get(hostID)
	if !found {
		authz.WriteError(w, r, authz.ErrNotFound)
		return
	}
	authz.SetAuditTarget(r, "network", netID, snapshotNetworkName(snap, netID))

	var req networkDisconnectRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	containerID, err := s.resolveDisconnectContainer(r, snap, req.ContainerID, req.Force)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	if req.Force {
		authz.AddAuditDetail(r, "force", true)
	}
	dp := s.manager.Docker()
	if dp == nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	if err := dp.DisconnectContainerFromNetwork(r.Context(), netID, containerID, req.Force); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok2(w)
}

// resolveNetworkContainer finds the docker container a connect targets (by
// id, then by name) in the snapshot, records it on the audit row and runs the
// destructive-action guard on it. An unknown container is a 404: the guard
// needs its labels and protected flag, and it default-denies on ambiguity
// rather than rewiring something it cannot vet.
func (s *Server) resolveNetworkContainer(r *http.Request, snap cache.Snapshot, ref string) (provider.Workload, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return provider.Workload{}, authz.Errorf(authz.ErrValidation, "containerId is required.")
	}
	wl, found := findDockerWorkload(snap, ref)
	if !found {
		return provider.Workload{}, authz.Errorf(authz.ErrNotFound, "Container not found on this host.")
	}
	authz.AddAuditDetail(r, "containerId", wl.ID)
	authz.AddAuditDetail(r, "containerName", wl.Name)
	if err := s.guardContainer(r, wl, false, ""); err != nil {
		return provider.Workload{}, err
	}
	return wl, nil
}

// resolveDisconnectContainer returns the container id a disconnect sends to
// the daemon. A container the snapshot knows goes through
// resolveNetworkContainer (guard included, force or not). One it does not
// know is a 404, unless force is set: the daemon then gets the reference as
// given, so a stale endpoint of a removed container can be detached.
func (s *Server) resolveDisconnectContainer(r *http.Request, snap cache.Snapshot, ref string, force bool) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", authz.Errorf(authz.ErrValidation, "containerId is required.")
	}
	if _, found := findDockerWorkload(snap, ref); found || !force {
		wl, err := s.resolveNetworkContainer(r, snap, ref)
		if err != nil {
			return "", err
		}
		return wl.ID, nil
	}
	authz.AddAuditDetail(r, "containerId", ref)
	authz.AddAuditDetail(r, "orphanEndpoint", true)
	return ref, nil
}

// findDockerWorkload looks a docker container up in the snapshot by id first,
// then by name (the daemon accepts either; the guard needs the snapshot row).
func findDockerWorkload(snap cache.Snapshot, ref string) (provider.Workload, bool) {
	for i := range snap.Workloads {
		if snap.Workloads[i].ID == ref {
			return snap.Workloads[i], true
		}
	}
	for i := range snap.Workloads {
		if snap.Workloads[i].Name == ref {
			return snap.Workloads[i], true
		}
	}
	return provider.Workload{}, false
}

// findSnapshotNetwork looks a network up in the snapshot by id first, then by
// name.
func findSnapshotNetwork(snap cache.Snapshot, ref string) (docker.NetworkInfo, bool) {
	for i := range snap.Networks {
		if snap.Networks[i].ID == ref {
			return snap.Networks[i], true
		}
	}
	for i := range snap.Networks {
		if snap.Networks[i].Name == ref {
			return snap.Networks[i], true
		}
	}
	return docker.NetworkInfo{}, false
}

// snapshotNetworkName returns the name of the snapshot network matching ref by
// id or name, or ref itself when unknown (the audit row then carries what the
// caller sent).
func snapshotNetworkName(snap cache.Snapshot, ref string) string {
	if n, found := findSnapshotNetwork(snap, ref); found {
		return n.Name
	}
	return ref
}

// isDefaultBridge reports whether ref names the daemon's default bridge, by
// name or by the id the snapshot holds for it.
func isDefaultBridge(snap cache.Snapshot, ref string) bool {
	return snapshotNetworkName(snap, ref) == defaultBridgeNetwork
}

// networkAttachOptions validates a connect body into the provider options:
// addresses must parse in the family their field names, aliases are trimmed
// and empties dropped.
func networkAttachOptions(req *networkConnectRequest) (docker.NetworkAttachOptions, error) {
	var opts docker.NetworkAttachOptions
	if v := strings.TrimSpace(req.IPv4); v != "" {
		if ip := net.ParseIP(v); ip == nil || ip.To4() == nil {
			return opts, authz.Errorf(authz.ErrValidation, fmt.Sprintf("Invalid IPv4 address %q.", v))
		}
		opts.IPv4 = v
	}
	if v := strings.TrimSpace(req.IPv6); v != "" {
		if ip := net.ParseIP(v); ip == nil || ip.To4() != nil {
			return opts, authz.Errorf(authz.ErrValidation, fmt.Sprintf("Invalid IPv6 address %q.", v))
		}
		opts.IPv6 = v
	}
	opts.Aliases = trimAll(req.Aliases)
	return opts, nil
}

// authorizeNetworkCreate validates and authorizes a create request in place:
// the driver must be one of networkDrivers (422, "bridge" when empty), every
// option key must be in networkOptionsAllowed or networkOptionsHostInterface
// (422 otherwise; keys and values are trimmed), and a network bound to a host
// interface, by driver (macvlan/ipvlan) or by option, is reserved to a global
// superuser (403, audited as denied). Returns nil or an *authz.APIError.
func (s *Server) authorizeNetworkCreate(r *http.Request, spec *docker.NetworkSpec) error {
	spec.Driver = strings.TrimSpace(spec.Driver)
	if spec.Driver == "" {
		spec.Driver = "bridge"
	}
	if _, known := networkDrivers[spec.Driver]; !known {
		return authz.Errorf(authz.ErrValidation,
			fmt.Sprintf("Unsupported network driver %q (use bridge, overlay, macvlan or ipvlan).", spec.Driver))
	}
	auditDetail(r, "driver", spec.Driver)

	options, hostIface, err := classifyNetworkOptions(spec.Options)
	if err != nil {
		return err
	}
	spec.Options = options

	_, l2Driver := l2NetworkDrivers[spec.Driver]
	if !l2Driver && len(hostIface) == 0 {
		return nil
	}
	if isSuperuser(r) {
		auditDetail(r, "l2Network", true)
		if len(hostIface) > 0 {
			auditDetail(r, "hostInterfaceOptions", hostIface)
		}
		return nil
	}
	auditDenied(r, "l2_network")
	return authz.Errorf(authz.ErrForbidden,
		"macvlan/ipvlan networks and the host-interface options (parent, macvlan_mode, ipvlan_mode, ipvlan_flag, com.docker.network.bridge.name) attach containers directly to a host interface; they require administrator privileges.")
}

// classifyNetworkOptions trims the option keys and values, refuses any key
// outside the two known sets (422), and returns the cleaned map with the
// sorted host-interface keys it carries. A nil or empty map is returned as is.
func classifyNetworkOptions(options map[string]string) (map[string]string, []string, error) {
	if len(options) == 0 {
		return options, nil, nil
	}
	keys := make([]string, 0, len(options))
	for k := range options {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	clean := make(map[string]string, len(options))
	var hostIface []string
	for _, k := range keys {
		key := strings.TrimSpace(k)
		if key == "" {
			return nil, nil, authz.Errorf(authz.ErrValidation, "Network option keys must not be empty.")
		}
		if _, dup := clean[key]; dup {
			return nil, nil, authz.Errorf(authz.ErrValidation, fmt.Sprintf("Network option %q is set twice.", key))
		}
		switch {
		case isHostInterfaceOption(key):
			hostIface = append(hostIface, key)
		default:
			if _, allowed := networkOptionsAllowed[key]; !allowed {
				return nil, nil, authz.Errorf(authz.ErrValidation,
					fmt.Sprintf("Unsupported network option %q (allowed: %s; administrators may also set %s).",
						key, strings.Join(sortedKeys(networkOptionsAllowed), ", "), strings.Join(sortedKeys(networkOptionsHostInterface), ", ")))
			}
		}
		clean[key] = strings.TrimSpace(options[k])
	}
	return clean, hostIface, nil
}

// isHostInterfaceOption reports whether key (trimmed, any case) is one of the
// host-interface driver options. Case-insensitive on purpose: the daemon would
// ignore a miscased key, but the gate stays conservative.
func isHostInterfaceOption(key string) bool {
	key = strings.TrimSpace(key)
	for k := range networkOptionsHostInterface {
		if strings.EqualFold(k, key) {
			return true
		}
	}
	return false
}

// isL2Network reports whether a network definition binds to a host interface:
// the macvlan/ipvlan drivers do by design, and a host-interface option
// (parent, macvlan_mode, ipvlan_mode, ipvlan_flag, com.docker.network.bridge.name)
// does for any driver. Shared with the stack guard (authorizePlanNetworks);
// the create path goes through authorizeNetworkCreate, which also applies the
// option allowlist.
func isL2Network(driver string, options map[string]string) bool {
	if _, l2 := l2NetworkDrivers[strings.ToLower(strings.TrimSpace(driver))]; l2 {
		return true
	}
	for k := range options {
		if isHostInterfaceOption(k) {
			return true
		}
	}
	return false
}

// authorizeNetworkAttach resolves the network a container is about to join in
// the host's snapshot, by name or id (unknown: 422), and reserves a network
// bound to a host interface (macvlan/ipvlan driver, or a host-interface
// option such as parent or com.docker.network.bridge.name) to a global
// superuser (403, audited as denied). Shared by the connect and the deploy
// paths so no route attaches a container to such a network unchecked.
func (s *Server) authorizeNetworkAttach(r *http.Request, hostID, nameOrID string) (*docker.NetworkInfo, error) {
	snap, ok := s.manager.Store().Get(hostID)
	if !ok {
		return nil, authz.ErrNotFound
	}
	return s.authorizeSnapshotNetworkAttach(r, snap, nameOrID)
}

// authorizeSnapshotNetworkAttach is authorizeNetworkAttach on a snapshot the
// caller already holds.
func (s *Server) authorizeSnapshotNetworkAttach(r *http.Request, snap cache.Snapshot, nameOrID string) (*docker.NetworkInfo, error) {
	ref := strings.TrimSpace(nameOrID)
	info, found := findSnapshotNetwork(snap, ref)
	if !found {
		return nil, authz.Errorf(authz.ErrValidation, fmt.Sprintf("Unknown network %s on this host.", ref))
	}
	if !isL2Network(info.Driver, info.Options) {
		return &info, nil
	}
	if isSuperuser(r) {
		auditDetail(r, "l2Network", true)
		return &info, nil
	}
	auditDenied(r, "l2_network")
	return nil, authz.Errorf(authz.ErrForbidden,
		fmt.Sprintf("Network %s attaches containers directly to a host interface (%s); joining it requires administrator privileges.",
			info.Name, hostInterfaceReason(info)))
}

// hostInterfaceReason names what binds a network to a host interface, for the
// 403 message: its driver, or the option(s) it carries.
func hostInterfaceReason(info docker.NetworkInfo) string {
	if _, l2 := l2NetworkDrivers[strings.ToLower(strings.TrimSpace(info.Driver))]; l2 {
		return info.Driver + " driver"
	}
	var keys []string
	for k := range info.Options {
		if isHostInterfaceOption(k) {
			keys = append(keys, strings.TrimSpace(k))
		}
	}
	sort.Strings(keys)
	return "option " + strings.Join(keys, ", ")
}

// isSuperuser reports whether the request carries a global superuser. A nil
// request or no principal (the public webhook) is not one.
func isSuperuser(r *http.Request) bool {
	if r == nil {
		return false
	}
	u := authz.UserFrom(r)
	return u != nil && u.HasGlobalSuperuser()
}

// auditDetail is AddAuditDetail tolerant of a nil request.
func auditDetail(r *http.Request, key string, value any) {
	if r != nil {
		authz.AddAuditDetail(r, key, value)
	}
}

// auditDenied marks the audit row denied with the given reason, tolerant of a
// nil request.
func auditDenied(r *http.Request, reason string) {
	if r != nil {
		authz.AddAuditDetail(r, "denied", reason)
		authz.SetAuditResult(r, "denied")
	}
}

// sortedKeys returns a set's keys in sorted order.
func sortedKeys(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// containsString reports whether ss holds want.
func containsString(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}

// validateIPAM checks every IPAM pool of a create request in place: each
// subnet is a CIDR, and its gateway, allocation range and auxiliary addresses
// fall inside it. Values are trimmed. The daemon would reject these too, but
// with a terse message; here each failure names the offending value. Pools
// that declare nothing are left for the provider to drop.
func validateIPAM(ipam *docker.IPAMSpec) error {
	if ipam == nil {
		return nil
	}
	ipam.Driver = strings.TrimSpace(ipam.Driver)
	for i := range ipam.Config {
		c := &ipam.Config[i]
		c.Subnet = strings.TrimSpace(c.Subnet)
		c.Gateway = strings.TrimSpace(c.Gateway)
		c.IPRange = strings.TrimSpace(c.IPRange)
		if c.Subnet == "" {
			if c.Gateway != "" || c.IPRange != "" || len(c.AuxAddresses) > 0 {
				return authz.Errorf(authz.ErrValidation, fmt.Sprintf("IPAM pool #%d needs a subnet.", i+1))
			}
			continue
		}
		_, subnet, err := net.ParseCIDR(c.Subnet)
		if err != nil {
			return authz.Errorf(authz.ErrValidation,
				fmt.Sprintf("Invalid subnet %q (use CIDR notation, e.g. 10.10.0.0/24).", c.Subnet))
		}
		if c.Gateway != "" {
			gw := net.ParseIP(c.Gateway)
			if gw == nil {
				return authz.Errorf(authz.ErrValidation, fmt.Sprintf("Invalid gateway %q.", c.Gateway))
			}
			if !subnet.Contains(gw) {
				return authz.Errorf(authz.ErrValidation,
					fmt.Sprintf("Gateway %s is not inside subnet %s.", c.Gateway, c.Subnet))
			}
		}
		if c.IPRange != "" {
			_, rng, rerr := net.ParseCIDR(c.IPRange)
			if rerr != nil {
				return authz.Errorf(authz.ErrValidation,
					fmt.Sprintf("Invalid IP range %q (use CIDR notation).", c.IPRange))
			}
			if !cidrWithin(rng, subnet) {
				return authz.Errorf(authz.ErrValidation,
					fmt.Sprintf("IP range %s is not inside subnet %s.", c.IPRange, c.Subnet))
			}
		}
		if len(c.AuxAddresses) > 0 {
			aux := make(map[string]string, len(c.AuxAddresses))
			for k, v := range c.AuxAddresses {
				aux[strings.TrimSpace(k)] = strings.TrimSpace(v)
			}
			c.AuxAddresses = aux
			names := make([]string, 0, len(aux))
			for k := range aux {
				names = append(names, k)
			}
			sort.Strings(names)
			for _, name := range names {
				addr := aux[name]
				ip := net.ParseIP(addr)
				if ip == nil {
					return authz.Errorf(authz.ErrValidation,
						fmt.Sprintf("Invalid auxiliary address %q for %q.", addr, name))
				}
				if !subnet.Contains(ip) {
					return authz.Errorf(authz.ErrValidation,
						fmt.Sprintf("Auxiliary address %s (%s) is not inside subnet %s.", addr, name, c.Subnet))
				}
			}
		}
	}
	return nil
}

// cidrWithin reports whether inner is fully contained in outer (same family,
// inner prefix at least as long, inner base inside outer).
func cidrWithin(inner, outer *net.IPNet) bool {
	if (inner.IP.To4() == nil) != (outer.IP.To4() == nil) {
		return false
	}
	innerOnes, _ := inner.Mask.Size()
	outerOnes, _ := outer.Mask.Size()
	return innerOnes >= outerOnes && outer.Contains(inner.IP)
}
