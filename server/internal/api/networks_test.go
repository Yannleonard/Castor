package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/store"
)

// errCode decodes the envelope's error code from a response body.
func errCode(t *testing.T, body map[string]any) string {
	t.Helper()
	errObj, _ := body["error"].(map[string]any)
	code, _ := errObj["code"].(string)
	return code
}

// errMessage decodes the envelope's error message from a response body.
func errMessage(t *testing.T, body map[string]any) string {
	t.Helper()
	errObj, _ := body["error"].(map[string]any)
	msg, _ := errObj["message"].(string)
	return msg
}

// TestMapErrorNetworkCodes locks the code/status for every network sentinel,
// both bare and wrapped the way the provider wraps them, and checks each is
// matched before the generic sentinel it wraps.
func TestMapErrorNetworkCodes(t *testing.T) {
	cases := []struct {
		in     error
		code   string
		status int
		msg    string
	}{
		{provider.ErrNetworkExists, "network_exists", 409, provider.MsgNetworkExists},
		{provider.ErrSubnetOverlap, "subnet_overlap", 409, provider.MsgSubnetOverlap},
		{provider.ErrIPInUse, "ip_in_use", 409, provider.MsgIPInUse},
		{provider.ErrAlreadyConnected, "already_connected", 409, provider.MsgAlreadyConnected},
		{provider.ErrNotConnected, "not_connected", 404, provider.MsgNotConnected},
		{provider.ErrStaticIPUnsupported, "static_ip_unsupported", 409, provider.MsgStaticIPUnsupported},
		{provider.ErrNetworkInUse, "network_in_use", 409, provider.MsgNetworkInUse},
		{provider.ErrAliasUnsupported, "alias_unsupported", 409, provider.MsgAliasUnsupported},
		{provider.ErrIPPoolExhausted, "ip_pool_exhausted", 409, provider.MsgIPPoolExhausted},
		{fmt.Errorf("docker: connect abc to network: %w", provider.ErrIPInUse), "ip_in_use", 409, provider.MsgIPInUse},
		{fmt.Errorf("docker: connect abc to network: %w", provider.ErrIPPoolExhausted), "ip_pool_exhausted", 409, provider.MsgIPPoolExhausted},
		{fmt.Errorf("docker: disconnect abc from network: %w", provider.ErrNotConnected), "not_connected", 404, provider.MsgNotConnected},
		// Generic sentinels keep their generic codes.
		{provider.ErrConflict, "conflict", 409, ""},
		{provider.ErrNotFound, "not_found", 404, ""},
	}
	for _, tc := range cases {
		t.Run(tc.code+"/"+tc.in.Error(), func(t *testing.T) {
			var ae *authz.APIError
			if !errors.As(mapError(tc.in), &ae) {
				t.Fatalf("mapError(%v) is not an APIError", tc.in)
			}
			if ae.Code != tc.code || ae.Status != tc.status {
				t.Errorf("code/status = %s/%d want %s/%d", ae.Code, ae.Status, tc.code, tc.status)
			}
			if tc.msg != "" && ae.Message != tc.msg {
				t.Errorf("message = %q want %q", ae.Message, tc.msg)
			}
		})
	}
}

// TestMapErrorInvalidNetworkConfig locks the 422 shape: the daemon's cleaned
// explanation is kept when the wrap carries one (through the provider's extra
// prefix too), and the canonical message is used otherwise.
func TestMapErrorInvalidNetworkConfig(t *testing.T) {
	wrapped := fmt.Errorf("docker: connect abc to network: %w",
		fmt.Errorf("%w: invalid subnet 10.0.0.0/33: invalid CIDR block notation", provider.ErrInvalidNetworkConfig))
	var ae *authz.APIError
	if !errors.As(mapError(wrapped), &ae) {
		t.Fatal("not an APIError")
	}
	if ae.Code != "invalid_network_config" || ae.Status != 422 {
		t.Errorf("code/status = %s/%d", ae.Code, ae.Status)
	}
	if !strings.HasSuffix(ae.Message, "invalid subnet 10.0.0.0/33: invalid CIDR block notation") {
		t.Errorf("daemon detail lost: %q", ae.Message)
	}
	if strings.Contains(ae.Message, "provider:") {
		t.Errorf("internal prefix leaked: %q", ae.Message)
	}

	if !errors.As(mapError(provider.ErrInvalidNetworkConfig), &ae) {
		t.Fatal("not an APIError")
	}
	if ae.Message != authz.ErrInvalidNetworkConfig.Message {
		t.Errorf("bare sentinel message = %q want canonical", ae.Message)
	}
}

// TestNetworkViewsContainerCount covers the list enrichment: containerCount is
// the number of docker workloads attached (by name) to each network, computed
// from the snapshot alone, and an empty snapshot yields an empty array.
func TestNetworkViewsContainerCount(t *testing.T) {
	snap := cache.Snapshot{
		Networks: []docker.NetworkInfo{
			{ID: "n1", Name: "front"},
			{ID: "n2", Name: "back"},
			{ID: "n3", Name: "lonely"},
		},
		Workloads: []provider.Workload{
			{ID: "c1", Name: "web", NetworkNames: []string{"front", "back"}},
			{ID: "c2", Name: "db", NetworkNames: []string{"back"}},
			{ID: "c3", Name: "old", State: provider.StateStopped, NetworkNames: []string{"back"}},
		},
	}
	views := networkViews(snap)
	if len(views) != 3 {
		t.Fatalf("views = %d want 3", len(views))
	}
	want := map[string]int{"front": 1, "back": 3, "lonely": 0}
	for _, v := range views {
		if v.ContainerCount != want[v.Name] {
			t.Errorf("%s containerCount = %d want %d", v.Name, v.ContainerCount, want[v.Name])
		}
	}
	if got := networkViews(cache.Snapshot{}); got == nil || len(got) != 0 {
		t.Errorf("empty snapshot must yield an empty (non-nil) slice, got %#v", got)
	}
}

// TestNetworkContainersMerge covers the detail's container list: live
// endpoints keep Running=true and take state/protected from the snapshot when
// known; snapshot containers configured on the network but absent from the
// inspect are appended with Running=false, their state and the snapshot's
// IPv4 for that network (the per-network detail when the row has one, else
// the row's first address when this is its first network); the result is
// sorted by name and its length is the containerCount the list computes for
// the same snapshot.
func TestNetworkContainersMerge(t *testing.T) {
	e := newTestEnv(t)
	snap := cache.Snapshot{
		Networks: []docker.NetworkInfo{{ID: "n1", Name: "front"}, {ID: "n2", Name: "back"}},
		Workloads: []provider.Workload{
			{ID: "c1", Name: "web", State: provider.StateRunning, NetworkNames: []string{"back", "front"}},
			{ID: "c2", Name: "cache", State: provider.StatePaused, NetworkNames: []string{"front"},
				Labels: map[string]string{"io.castor.protected": "true"}},
			{ID: "c3", Name: "old", State: provider.StateStopped, NetworkNames: []string{"front"}, IPAddress: "10.10.0.7"},
			{ID: "c4", Name: "detailed", State: provider.StateStopped, NetworkNames: []string{"back", "front"}, IPAddress: "10.20.0.4",
				Networks: []provider.WorkloadNetwork{{Name: "back", IPv4: "10.20.0.4"}, {Name: "front", IPv4: "10.10.0.8"}}},
			{ID: "c5", Name: "elsewhere", State: provider.StateStopped, NetworkNames: []string{"back"}},
			{ID: "self", Name: "castor", State: provider.StateRunning, NetworkNames: []string{"front"}},
		},
	}
	detail := &docker.NetworkDetail{
		NetworkInfo: docker.NetworkInfo{ID: "n1", Name: "front"},
		Containers: []docker.NetworkEndpoint{
			{ContainerID: "c1", Name: "web", IPv4: "10.10.0.5", Running: true, State: "running"},
			{ContainerID: "c2", Name: "cache", IPv4: "10.10.0.6", Running: true, State: "running"},
			{ContainerID: "c7", Name: "fresh", IPv4: "10.10.0.9", Running: true, State: "running"},
			{ContainerID: "self", Name: "castor", IPv4: "10.10.0.2", Running: true, State: "running"},
		},
	}
	got := e.srv.networkContainers(snap, detail)

	want := []struct {
		id, name, ipv4, state string
		running, protected    bool
	}{
		{"c2", "cache", "10.10.0.6", "paused", true, true},
		{"self", "castor", "10.10.0.2", "running", true, true},
		{"c4", "detailed", "10.10.0.8", "stopped", false, false},
		{"c7", "fresh", "10.10.0.9", "running", true, false},
		{"c3", "old", "10.10.0.7", "stopped", false, false},
		{"c1", "web", "10.10.0.5", "running", true, false},
	}
	if len(got) != len(want) {
		t.Fatalf("containers = %+v want %d entries", got, len(want))
	}
	for i, w := range want {
		g := got[i]
		if g.ContainerID != w.id || g.Name != w.name || g.IPv4 != w.ipv4 || g.State != w.state || g.Running != w.running || g.Protected != w.protected {
			t.Errorf("#%d = %+v want %+v", i, g, w)
		}
	}
	// The list's containerCount for "front" is the configured set: the same
	// containers minus the live endpoint the snapshot has not seen yet.
	for _, v := range networkViews(snap) {
		if v.Name == "front" && v.ContainerCount != len(got)-1 {
			t.Errorf("list containerCount = %d want %d", v.ContainerCount, len(got)-1)
		}
	}
	if empty := e.srv.networkContainers(cache.Snapshot{}, &docker.NetworkDetail{}); empty == nil || len(empty) != 0 {
		t.Errorf("empty inputs must yield an empty (non-nil) slice, got %#v", empty)
	}
}

// TestNetworksListRouteServesArray checks the list route end to end: it is
// served from the snapshot with no daemon, as a JSON array even when empty.
func TestNetworksListRouteServesArray(t *testing.T) {
	e := newTestEnv(t)
	cookies, _ := adminSession(t, e)
	e.srv.manager.Store().SeedSnapshotForTest(cache.HostID,
		provider.Workload{ID: "c1", Name: "web", Kind: provider.KindDocker, ProviderID: "local-docker", NetworkNames: []string{"bridge"}},
	)
	rec := e.do(t, http.MethodGet, "/api/v1/hosts/local/networks", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list = %d (%s)", rec.Code, rec.Body.String())
	}
	// The test snapshot has no networks: an empty JSON array, never null.
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %s want []", rec.Body.String())
	}
}

// TestValidateIPAM covers the create-side address checks with their precise
// messages, plus the passing shapes (v4, v6, aux addresses, empty pool).
func TestValidateIPAM(t *testing.T) {
	if err := validateIPAM(nil); err != nil {
		t.Errorf("nil ipam: %v", err)
	}
	good := &docker.IPAMSpec{Config: []docker.IPAMConfig{
		{Subnet: " 10.10.0.0/24 ", Gateway: "10.10.0.1", IPRange: "10.10.0.128/25", AuxAddresses: map[string]string{"router": " 10.10.0.2 "}},
		{Subnet: "fd00:10::/64", Gateway: "fd00:10::1"},
		{},
	}}
	if err := validateIPAM(good); err != nil {
		t.Fatalf("valid ipam rejected: %v", err)
	}
	if good.Config[0].Subnet != "10.10.0.0/24" || good.Config[0].AuxAddresses["router"] != "10.10.0.2" {
		t.Errorf("values not trimmed: %+v", good.Config[0])
	}

	cases := []struct {
		name string
		cfg  docker.IPAMConfig
		want string
	}{
		{"bad subnet", docker.IPAMConfig{Subnet: "10.0.0.0/33"}, `Invalid subnet "10.0.0.0/33"`},
		{"gateway outside", docker.IPAMConfig{Subnet: "10.1.0.0/24", Gateway: "10.0.0.1"}, "Gateway 10.0.0.1 is not inside subnet 10.1.0.0/24."},
		{"bad gateway", docker.IPAMConfig{Subnet: "10.1.0.0/24", Gateway: "nope"}, `Invalid gateway "nope".`},
		{"range outside", docker.IPAMConfig{Subnet: "10.1.0.0/24", IPRange: "10.2.0.0/25"}, "IP range 10.2.0.0/25 is not inside subnet 10.1.0.0/24."},
		{"range wider", docker.IPAMConfig{Subnet: "10.1.0.0/24", IPRange: "10.1.0.0/16"}, "IP range 10.1.0.0/16 is not inside subnet 10.1.0.0/24."},
		{"bad range", docker.IPAMConfig{Subnet: "10.1.0.0/24", IPRange: "10.1.0.5"}, `Invalid IP range "10.1.0.5"`},
		{"aux outside", docker.IPAMConfig{Subnet: "10.1.0.0/24", AuxAddresses: map[string]string{"nas": "192.168.1.9"}}, "Auxiliary address 192.168.1.9 (nas) is not inside subnet 10.1.0.0/24."},
		{"bad aux", docker.IPAMConfig{Subnet: "10.1.0.0/24", AuxAddresses: map[string]string{"nas": "x"}}, `Invalid auxiliary address "x" for "nas".`},
		{"gateway without subnet", docker.IPAMConfig{Gateway: "10.1.0.1"}, "IPAM pool #1 needs a subnet."},
		{"v6 gateway in v4 subnet", docker.IPAMConfig{Subnet: "10.1.0.0/24", Gateway: "fd00::1"}, "Gateway fd00::1 is not inside subnet 10.1.0.0/24."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateIPAM(&docker.IPAMSpec{Config: []docker.IPAMConfig{tc.cfg}})
			var ae *authz.APIError
			if !errors.As(err, &ae) || ae.Status != 422 {
				t.Fatalf("want 422 APIError, got %v", err)
			}
			if !strings.Contains(ae.Message, tc.want) {
				t.Errorf("message = %q want it to contain %q", ae.Message, tc.want)
			}
		})
	}
}

// TestCreateNetworkRejectsBeforeDaemon covers the create validations that
// answer without a daemon: a bad name, an unknown driver, and a bad IPAM pool
// (each a 422 through the real route, as an admin).
func TestCreateNetworkRejectsBeforeDaemon(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{"bad name", map[string]any{"name": "../etc"}, "Invalid network name."},
		{"unknown driver", map[string]any{"name": "front", "driver": "weave"}, `Unsupported network driver "weave"`},
		{"unknown option", map[string]any{"name": "front", "options": map[string]string{"com.docker.network.bridge.default_bridge": "true"}},
			`Unsupported network option "com.docker.network.bridge.default_bridge"`},
		{"empty option key", map[string]any{"name": "front", "options": map[string]string{" ": "x"}}, "Network option keys must not be empty."},
		{"gateway outside", map[string]any{"name": "front", "ipam": map[string]any{
			"config": []map[string]any{{"subnet": "10.1.0.0/24", "gateway": "10.0.0.1"}},
		}}, "Gateway 10.0.0.1 is not inside subnet 10.1.0.0/24."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks", tc.body, cookies, csrf)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("code = %d want 422 (%s)", rec.Code, rec.Body.String())
			}
			body := decodeBody(t, rec)
			if errCode(t, body) != "validation_failed" {
				t.Errorf("code = %q want validation_failed", errCode(t, body))
			}
			if !strings.Contains(errMessage(t, body), tc.want) {
				t.Errorf("message = %q want it to contain %q", errMessage(t, body), tc.want)
			}
		})
	}
}

// TestCreateNetworkL2RequiresSuperuser proves the host-interface gate: a
// non-admin holding docker.network.create cannot create a macvlan/ipvlan
// network nor pass a host-interface option (parent, the *vlan modes, or a
// bridge adopting a host bridge by name) on any driver. Each denial is 403
// with an explicit message and an audited "denied" row, before any daemon
// call.
func TestCreateNetworkL2RequiresSuperuser(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.network.create"})

	bodies := []map[string]any{
		{"name": "lan", "driver": "macvlan", "options": map[string]string{"parent": "eth0"}},
		{"name": "lan2", "driver": "ipvlan"},
		{"name": "lan3", "driver": "bridge", "options": map[string]string{"Parent": "eth0"}},
		{"name": "lan4", "driver": "bridge", "options": map[string]string{"com.docker.network.bridge.name": "br0"}},
		{"name": "lan5", "driver": "bridge", "options": map[string]string{"ipvlan_mode": "l2"}},
	}
	for _, body := range bodies {
		rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks", body, cookies, csrf)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%v: code = %d want 403 (%s)", body, rec.Code, rec.Body.String())
		}
		b := decodeBody(t, rec)
		if errCode(t, b) != "forbidden" || !strings.Contains(errMessage(t, b), "administrator") {
			t.Errorf("%v: envelope = %v", body, b["error"])
		}
	}

	entries, _, err := e.st.ListAudit(context.Background(), store.AuditFilter{Action: "docker.network.create"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != len(bodies) {
		t.Fatalf("audit rows = %d want %d", len(entries), len(bodies))
	}
	for _, en := range entries {
		if en.Result != "denied" || en.HTTPStatus != http.StatusForbidden {
			t.Errorf("audit row result=%q status=%d want denied/403", en.Result, en.HTTPStatus)
		}
	}
}

// TestIsL2Network locks the classifier the attach gate and the stack guard
// share: the two L2 drivers, and any host-interface option on any driver.
func TestIsL2Network(t *testing.T) {
	if isL2Network("bridge", nil) || isL2Network("", nil) || isL2Network("overlay", map[string]string{"encrypted": "true"}) ||
		isL2Network("bridge", map[string]string{"com.docker.network.driver.mtu": "1400"}) {
		t.Error("plain drivers must not be L2")
	}
	if !isL2Network("macvlan", nil) || !isL2Network("IPvlan", nil) || !isL2Network("bridge", map[string]string{"parent": "eth0"}) {
		t.Error("macvlan/ipvlan/parent must be L2")
	}
	for _, opt := range []string{"com.docker.network.bridge.name", "macvlan_mode", "ipvlan_mode", "ipvlan_flag", " PARENT "} {
		if !isL2Network("bridge", map[string]string{opt: "x"}) {
			t.Errorf("option %q must be L2", opt)
		}
	}
}

// TestAuthorizeNetworkCreate covers the create policy on the helper itself,
// with real principals: the option allowlist is enforced for everyone (422,
// keys and values trimmed), a host-interface option or driver is a 403 for an
// operator and for a missing principal, and a superuser passes both.
func TestAuthorizeNetworkCreate(t *testing.T) {
	e := newTestEnv(t)
	anon := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/networks", nil)
	opCookies, _, _ := loginLimited(t, e, []string{"docker.network.create"})
	op := anon.WithContext(authz.WithUser(anon.Context(), sessionUser(t, e, opCookies)))
	adminCookies, _ := adminSession(t, e)
	admin := anon.WithContext(authz.WithUser(anon.Context(), sessionUser(t, e, adminCookies)))

	// Operator: every allowlisted option on a bridge/overlay, trimmed in place.
	spec := docker.NetworkSpec{Name: "front", Driver: " overlay ", Options: map[string]string{
		" com.docker.network.driver.mtu ": " 1400 ",
		"encrypted":                       "true",
		"com.docker.network.driver.overlay.vxlanid_list": "4097",
		"com.docker.network.bridge.enable_icc":           "false",
		"com.docker.network.bridge.enable_ip_masquerade": "true",
		"com.docker.network.bridge.host_binding_ipv4":    "127.0.0.1",
		"com.docker.network.container_iface_prefix":      "cst",
	}}
	if err := e.srv.authorizeNetworkCreate(op, &spec); err != nil {
		t.Fatalf("operator with allowlisted options: %v", err)
	}
	if spec.Driver != "overlay" || spec.Options["com.docker.network.driver.mtu"] != "1400" || len(spec.Options) != 7 {
		t.Errorf("spec not normalized: %+v", spec)
	}
	empty := docker.NetworkSpec{Name: "plain"}
	if err := e.srv.authorizeNetworkCreate(op, &empty); err != nil || empty.Driver != "bridge" || empty.Options != nil {
		t.Errorf("empty spec: err=%v driver=%q options=%v", err, empty.Driver, empty.Options)
	}

	denied := []docker.NetworkSpec{
		{Name: "lan", Driver: "macvlan"},
		{Name: "lan", Driver: "ipvlan", Options: map[string]string{"ipvlan_mode": "l3"}},
		{Name: "lan", Driver: "bridge", Options: map[string]string{"parent": "eth0"}},
		{Name: "lan", Driver: "bridge", Options: map[string]string{"com.docker.network.bridge.name": "br0"}},
		{Name: "lan", Driver: "bridge", Options: map[string]string{"macvlan_mode": "bridge"}},
		{Name: "lan", Driver: "bridge", Options: map[string]string{"ipvlan_flag": "private"}},
	}
	for _, r := range []*http.Request{op, anon} {
		for _, d := range denied {
			s := d
			var ae *authz.APIError
			if err := e.srv.authorizeNetworkCreate(r, &s); !errors.As(err, &ae) || ae.Status != http.StatusForbidden {
				t.Errorf("%+v without superuser: got %v want 403", d, err)
			}
		}
	}
	for _, d := range denied {
		s := d
		if err := e.srv.authorizeNetworkCreate(admin, &s); err != nil {
			t.Errorf("%+v as superuser: %v", d, err)
		}
	}

	// The allowlist binds superusers too: an unknown key is a 422 for everyone.
	for _, r := range []*http.Request{op, admin} {
		s := docker.NetworkSpec{Name: "x", Options: map[string]string{"com.docker.network.bridge.default_bridge": "true"}}
		var ae *authz.APIError
		if err := e.srv.authorizeNetworkCreate(r, &s); !errors.As(err, &ae) || ae.Status != http.StatusUnprocessableEntity ||
			!strings.Contains(ae.Message, `Unsupported network option "com.docker.network.bridge.default_bridge"`) {
			t.Errorf("unknown option: got %v want 422", err)
		}
	}
	// Unknown driver and a key set twice after trimming are 422 too.
	s := docker.NetworkSpec{Name: "x", Driver: "weave"}
	var ae *authz.APIError
	if err := e.srv.authorizeNetworkCreate(admin, &s); !errors.As(err, &ae) || ae.Status != http.StatusUnprocessableEntity {
		t.Errorf("unknown driver: got %v want 422", err)
	}
	s = docker.NetworkSpec{Name: "x", Options: map[string]string{"encrypted": "true", " encrypted": "false"}}
	if err := e.srv.authorizeNetworkCreate(admin, &s); !errors.As(err, &ae) || !strings.Contains(ae.Message, "set twice") {
		t.Errorf("duplicate key: got %v want 422 set twice", err)
	}
}

// attachSnapshot is the snapshot the attach-policy tests resolve against.
func attachSnapshot() cache.Snapshot {
	return cache.Snapshot{
		HostID: cache.HostID,
		Networks: []docker.NetworkInfo{
			{ID: "id-bridge", Name: "bridge", Driver: "bridge", Options: map[string]string{"com.docker.network.bridge.default_bridge": "true"}},
			{ID: "id-front", Name: "front", Driver: "bridge", Options: map[string]string{"com.docker.network.driver.mtu": "1400"}},
			{ID: "id-lan", Name: "lan", Driver: "macvlan", Options: map[string]string{"parent": "eth0"}},
			{ID: "id-vlan", Name: "vlan", Driver: "ipvlan"},
			{ID: "id-br0", Name: "br0", Driver: "bridge", Options: map[string]string{"com.docker.network.bridge.name": "br0"}},
			{ID: "id-adopt", Name: "adopt", Driver: "bridge", Options: map[string]string{"Parent": "eth1"}},
		},
	}
}

// TestAuthorizeNetworkAttach covers the attach policy on the helper itself:
// resolution by name or id, an unknown network as a 422 naming it, and the
// host-interface gate (L2 driver, or a host-interface option carried by a
// plain bridge) as a 403 for an operator and a missing principal but not for
// a superuser.
func TestAuthorizeNetworkAttach(t *testing.T) {
	e := newTestEnv(t)
	snap := attachSnapshot()
	anon := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/networks/x/connect", nil)
	opCookies, _, _ := loginLimited(t, e, []string{"docker.network.connect"})
	op := anon.WithContext(authz.WithUser(anon.Context(), sessionUser(t, e, opCookies)))
	adminCookies, _ := adminSession(t, e)
	admin := anon.WithContext(authz.WithUser(anon.Context(), sessionUser(t, e, adminCookies)))

	for _, ref := range []string{"front", "id-front", " front "} {
		info, err := e.srv.authorizeSnapshotNetworkAttach(anon, snap, ref)
		if err != nil || info == nil || info.ID != "id-front" {
			t.Errorf("resolve %q: info=%+v err=%v", ref, info, err)
		}
	}
	var ae *authz.APIError
	if _, err := e.srv.authorizeSnapshotNetworkAttach(op, snap, "ghost"); !errors.As(err, &ae) ||
		ae.Status != http.StatusUnprocessableEntity || ae.Message != "Unknown network ghost on this host." {
		t.Errorf("unknown network: got %v", err)
	}

	l2 := []string{"lan", "id-lan", "vlan", "br0", "adopt"}
	for _, r := range []*http.Request{op, anon} {
		for _, ref := range l2 {
			info, err := e.srv.authorizeSnapshotNetworkAttach(r, snap, ref)
			if !errors.As(err, &ae) || ae.Status != http.StatusForbidden || info != nil {
				t.Errorf("%s without superuser: info=%+v err=%v want 403", ref, info, err)
				continue
			}
			if !strings.Contains(ae.Message, "administrator") {
				t.Errorf("%s: message = %q", ref, ae.Message)
			}
		}
	}
	for _, ref := range l2 {
		if info, err := e.srv.authorizeSnapshotNetworkAttach(admin, snap, ref); err != nil || info == nil {
			t.Errorf("%s as superuser: info=%+v err=%v", ref, info, err)
		}
	}

	// The contract entry point reads the host's snapshot: an unknown host is a
	// 404, and the test host (no networks seeded) yields the 422.
	if _, err := e.srv.authorizeNetworkAttach(admin, "nope", "front"); !errors.As(err, &ae) || ae.Status != http.StatusNotFound {
		t.Errorf("unknown host: got %v want 404", err)
	}
	if _, err := e.srv.authorizeNetworkAttach(admin, cache.HostID, "front"); !errors.As(err, &ae) || ae.Status != http.StatusUnprocessableEntity {
		t.Errorf("network missing from the host snapshot: got %v want 422", err)
	}
}

// TestConnectNetworkValidation covers the connect body checks that never reach
// the daemon: missing containerId, malformed addresses, and a static address
// on the default bridge (409 static_ip_unsupported).
func TestConnectNetworkValidation(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)
	seedWorkload(e)

	cases := []struct {
		name   string
		net    string
		body   map[string]any
		status int
		code   string
	}{
		{"missing container", "front", map[string]any{}, 422, "validation_failed"},
		{"bad ipv4", "front", map[string]any{"containerId": "c1", "ipv4": "10.0.0"}, 422, "validation_failed"},
		{"v6 in ipv4", "front", map[string]any{"containerId": "c1", "ipv4": "fd00::1"}, 422, "validation_failed"},
		{"bad ipv6", "front", map[string]any{"containerId": "c1", "ipv6": "10.0.0.1"}, 422, "validation_failed"},
		{"static ip on default bridge", "bridge", map[string]any{"containerId": "c1", "ipv4": "172.17.0.9"}, 409, "static_ip_unsupported"},
		{"aliases on default bridge", "bridge", map[string]any{"containerId": "c1", "aliases": []string{"www"}}, 422, "validation_failed"},
		{"unknown field", "front", map[string]any{"containerId": "c1", "force": true}, 422, "validation_failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks/"+tc.net+"/connect", tc.body, cookies, csrf)
			if rec.Code != tc.status {
				t.Fatalf("code = %d want %d (%s)", rec.Code, tc.status, rec.Body.String())
			}
			if got := errCode(t, decodeBody(t, rec)); got != tc.code {
				t.Errorf("code = %q want %q", got, tc.code)
			}
		})
	}
}

// TestNetworkAttachOptions checks the body -> provider options mapping: trimmed
// addresses, aliases with empties dropped.
func TestNetworkAttachOptions(t *testing.T) {
	opts, err := networkAttachOptions(&networkConnectRequest{
		IPv4: " 10.10.0.5 ", IPv6: "fd00:10::5", Aliases: []string{" web ", "", "www"},
	})
	if err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	if opts.IPv4 != "10.10.0.5" || opts.IPv6 != "fd00:10::5" {
		t.Errorf("addresses = %q / %q", opts.IPv4, opts.IPv6)
	}
	if len(opts.Aliases) != 2 || opts.Aliases[0] != "web" || opts.Aliases[1] != "www" {
		t.Errorf("aliases = %v", opts.Aliases)
	}
}

// TestConnectDisconnectUnknownContainer: a container the snapshot does not
// know is a 404 on both routes (the guard cannot vet it).
func TestConnectDisconnectUnknownContainer(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)
	seedWorkload(e)

	for _, verb := range []string{"connect", "disconnect"} {
		rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks/front/"+verb,
			map[string]any{"containerId": "ghost"}, cookies, csrf)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s unknown container = %d want 404 (%s)", verb, rec.Code, rec.Body.String())
		}
	}
}

// TestConnectNetworkUnknownNetwork: through the real route, connecting a
// known, unprotected container to a network the host snapshot does not have
// is a 422 naming the network (the test env has no daemon, so the check
// provably runs before any daemon call).
func TestConnectNetworkUnknownNetwork(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)
	seedWorkload(e)

	rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks/front/connect",
		map[string]any{"containerId": "c1"}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("connect to unknown network = %d want 422 (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if errCode(t, body) != "validation_failed" || !strings.Contains(errMessage(t, body), "Unknown network front on this host") {
		t.Errorf("envelope = %v", body["error"])
	}
}

// TestResolveDisconnectContainer covers the disconnect target resolution: a
// snapshot container is resolved (and guarded) by id or name whether or not
// force is set; an unknown one is a 404 without force and passed through as
// given with force, so a stale endpoint can be detached.
func TestResolveDisconnectContainer(t *testing.T) {
	e := newTestEnv(t)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/hosts/local/networks/front/disconnect", nil)
	snap := cache.Snapshot{Workloads: []provider.Workload{
		{ID: "c1", Name: "web", Kind: provider.KindDocker, State: provider.StateRunning},
		{ID: "c9", Name: "vault", Kind: provider.KindDocker, State: provider.StateRunning, Protected: true},
	}}

	for _, force := range []bool{false, true} {
		for _, ref := range []string{"c1", "web", " web "} {
			if id, err := e.srv.resolveDisconnectContainer(r, snap, ref, force); err != nil || id != "c1" {
				t.Errorf("known %q force=%v: id=%q err=%v", ref, force, id, err)
			}
		}
		var ae *authz.APIError
		if _, err := e.srv.resolveDisconnectContainer(r, snap, "vault", force); !errors.As(err, &ae) || ae.Code != "protected_resource" {
			t.Errorf("protected force=%v: got %v want protected_resource", force, err)
		}
		if _, err := e.srv.resolveDisconnectContainer(r, snap, "", force); !errors.As(err, &ae) || ae.Status != http.StatusUnprocessableEntity {
			t.Errorf("empty ref force=%v: got %v want 422", force, err)
		}
	}
	var ae *authz.APIError
	if _, err := e.srv.resolveDisconnectContainer(r, snap, "ghost", false); !errors.As(err, &ae) || ae.Status != http.StatusNotFound {
		t.Errorf("unknown without force: got %v want 404", err)
	}
	if id, err := e.srv.resolveDisconnectContainer(r, snap, " 0123456789abcdef ", true); err != nil || id != "0123456789abcdef" {
		t.Errorf("orphan with force: id=%q err=%v want the trimmed reference passed through", id, err)
	}
}

// TestConnectDisconnectRefuseProtected proves Castor's own container and a
// protected container are never rewired: both routes answer 409
// protected_resource, before any daemon call. The self check holds even for
// an admin; the protected flag holds for a non-admin operator.
func TestConnectDisconnectRefuseProtected(t *testing.T) {
	e := newTestEnv(t)
	// The test guard resolves Castor's own container id as "self".
	e.srv.manager.Store().SeedSnapshotForTest(cache.HostID,
		provider.Workload{ID: "self", Name: "castor", Kind: provider.KindDocker, ProviderID: "local-docker", State: provider.StateRunning, Protected: true},
		provider.Workload{ID: "c9", Name: "vault", Kind: provider.KindDocker, ProviderID: "local-docker", State: provider.StateRunning, Protected: true},
		provider.Workload{ID: "c8", Name: "labelled", Kind: provider.KindDocker, ProviderID: "local-docker", State: provider.StateRunning,
			Labels: map[string]string{"io.castor.protected": "true"}},
	)

	adminCookies, adminCSRF := adminSession(t, e)
	for _, verb := range []string{"connect", "disconnect"} {
		// Admin, by id and by name: self is permanently protected.
		for _, ref := range []string{"self", "castor"} {
			rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks/front/"+verb,
				map[string]any{"containerId": ref}, adminCookies, adminCSRF)
			if rec.Code != http.StatusConflict {
				t.Fatalf("admin %s self(%s) = %d want 409 (%s)", verb, ref, rec.Code, rec.Body.String())
			}
			if got := errCode(t, decodeBody(t, rec)); got != "protected_resource" {
				t.Errorf("admin %s self(%s) code = %q want protected_resource", verb, ref, got)
			}
		}
	}

	// A non-admin operator with the connect/disconnect grants: protected
	// (flag or label) containers are refused.
	opCookies, opCSRF, _ := loginLimited(t, e, []string{"docker.network.connect", "docker.network.disconnect"})
	for _, verb := range []string{"connect", "disconnect"} {
		for _, ref := range []string{"c9", "c8"} {
			rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks/front/"+verb,
				map[string]any{"containerId": ref}, opCookies, opCSRF)
			if rec.Code != http.StatusConflict {
				t.Fatalf("operator %s %s = %d want 409 (%s)", verb, ref, rec.Code, rec.Body.String())
			}
			if got := errCode(t, decodeBody(t, rec)); got != "protected_resource" {
				t.Errorf("operator %s %s code = %q want protected_resource", verb, ref, got)
			}
		}
	}

	// Every refusal was audited under its own action with the container detail.
	for _, action := range []string{"docker.network.connect", "docker.network.disconnect"} {
		entries, _, err := e.st.ListAudit(context.Background(), store.AuditFilter{Action: action})
		if err != nil {
			t.Fatalf("ListAudit(%s): %v", action, err)
		}
		if len(entries) != 4 {
			t.Fatalf("%s audit rows = %d want 4", action, len(entries))
		}
		for _, en := range entries {
			if en.Result != "denied" || en.TargetType != "network" || en.TargetID != "front" {
				t.Errorf("%s audit row = result %q target %s/%s", action, en.Result, en.TargetType, en.TargetID)
			}
		}
	}
}

// TestNetworkConnectPermissions: the new verbs are real RBAC gates. A viewer
// (reads only) is denied 403 and audited; the operator seed carries both
// grants; the catalog validates them.
func TestNetworkConnectPermissions(t *testing.T) {
	e := newTestEnv(t)
	seedWorkload(e)
	cookies, csrf, _ := loginLimited(t, e, []string{"docker.network.read"})

	for _, verb := range []string{"connect", "disconnect"} {
		rec := e.do(t, http.MethodPost, "/api/v1/hosts/local/networks/front/"+verb,
			map[string]any{"containerId": "c1"}, cookies, csrf)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("viewer %s = %d want 403 (%s)", verb, rec.Code, rec.Body.String())
		}
		entries, _, err := e.st.ListAudit(context.Background(), store.AuditFilter{Action: "docker.network." + verb})
		if err != nil {
			t.Fatalf("ListAudit: %v", err)
		}
		if len(entries) != 1 || entries[0].Result != "denied" {
			t.Errorf("%s: expected one audited denial, got %+v", verb, entries)
		}
	}

	if err := validatePermissions([]string{"docker.network.connect", "docker.network.disconnect"}); err != nil {
		t.Errorf("catalog rejects the new permissions: %v", err)
	}
	op, err := e.st.GetRole(context.Background(), store.RoleIDOperator)
	if err != nil {
		t.Fatalf("GetRole(operator): %v", err)
	}
	for _, p := range []string{"docker.network.connect", "docker.network.disconnect"} {
		if !contains(op.Permissions, p) {
			t.Errorf("operator seed lacks %s", p)
		}
	}
	if contains(op.Permissions, "docker.network.delete") {
		t.Error("operator must not gain docker.network.delete")
	}
}

// TestNetworkDetailRouteGated: inspect is a read behind docker.network.read
// (a principal without it is 403) and an unknown host is 404, both before any
// daemon call.
func TestNetworkDetailRouteGated(t *testing.T) {
	e := newTestEnv(t)
	cookies, _, _ := loginLimited(t, e, []string{"docker.container.read"})
	rec := e.do(t, http.MethodGet, "/api/v1/hosts/local/networks/front", nil, cookies, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("inspect without network.read = %d want 403 (%s)", rec.Code, rec.Body.String())
	}
	admin, _ := adminSession(t, e)
	rec = e.do(t, http.MethodGet, "/api/v1/hosts/nope/networks/front", nil, admin, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("inspect on unknown host = %d want 404 (%s)", rec.Code, rec.Body.String())
	}
}
