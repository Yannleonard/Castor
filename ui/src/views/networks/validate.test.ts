// Castor by IT Leonard
// ui/src/views/networks/validate.test.ts
// Coverage for the client-side mirror of the backend network validation: IP /
// CIDR parsing (Go netip semantics), containment, the create + connect draft
// validators and the request builders.
import { describe, it, expect } from "vitest";
import {
  parseIP,
  parseCIDR,
  cidrContains,
  cidrWithin,
  validateCreateDraft,
  validateConnectDraft,
  buildCreateRequest,
  buildConnectRequest,
  emptyCreateDraft,
  emptyPool,
  splitAliases,
  subnetFamily,
  type CreateNetworkDraft,
} from "./validate";

describe("parseIP", () => {
  it("parses dotted-quad IPv4", () => {
    expect(parseIP("10.10.0.1")).toEqual({ family: 4, bytes: [10, 10, 0, 1] });
    expect(parseIP(" 192.168.255.0 ")).toEqual({ family: 4, bytes: [192, 168, 255, 0] });
  });

  it("rejects malformed IPv4 (octet range, leading zeros, field count)", () => {
    for (const bad of ["", "10.0.0", "10.0.0.0.1", "256.0.0.1", "010.0.0.1", "10.0.0.a", "10..0.1"]) {
      expect(parseIP(bad)).toBeNull();
    }
  });

  it("parses IPv6 with compression and an embedded IPv4 tail", () => {
    expect(parseIP("::1")?.bytes).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIP("fd00::")?.family).toBe(6);
    expect(parseIP("2001:db8:0:0:0:0:0:1")?.bytes.slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
    expect(parseIP("64:ff9b::192.0.2.33")?.bytes.slice(12)).toEqual([192, 0, 2, 33]);
  });

  it("treats an IPv4-mapped IPv6 address as IPv4 (like net.IP.To4)", () => {
    expect(parseIP("::ffff:10.0.0.5")).toEqual({ family: 4, bytes: [10, 0, 0, 5] });
  });

  it("rejects malformed IPv6 (double ::, too many groups, zones, stray colons)", () => {
    for (const bad of ["1::2::3", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8::", "fe80::1%eth0", ":1::2", "1::2:", "12345::", "g::1"]) {
      expect(parseIP(bad)).toBeNull();
    }
  });
});

describe("parseCIDR", () => {
  it("returns the network number and prefix", () => {
    expect(parseCIDR("10.10.0.5/24")).toEqual({ family: 4, network: [10, 10, 0, 0], prefix: 24 });
    expect(parseCIDR("10.10.0.200/25")).toEqual({ family: 4, network: [10, 10, 0, 128], prefix: 25 });
    expect(parseCIDR("fd00:abcd::1/64")?.prefix).toBe(64);
    expect(parseCIDR("0.0.0.0/0")?.prefix).toBe(0);
  });

  it("rejects a missing or out-of-range prefix and a bare address", () => {
    for (const bad of ["10.10.0.0", "10.10.0.0/33", "10.10.0.0/-1", "10.10.0.0/2x", "/24", "fd00::/129", "10.10.0.0/ 24"]) {
      expect(parseCIDR(bad)).toBeNull();
    }
  });
});

describe("cidrContains / cidrWithin", () => {
  const net = parseCIDR("10.10.0.0/24")!;
  it("checks membership within the family", () => {
    expect(cidrContains(net, parseIP("10.10.0.1")!)).toBe(true);
    expect(cidrContains(net, parseIP("10.10.0.255")!)).toBe(true);
    expect(cidrContains(net, parseIP("10.10.1.1")!)).toBe(false);
    expect(cidrContains(net, parseIP("fd00::1")!)).toBe(false);
  });

  it("requires a longer-or-equal prefix inside the outer network", () => {
    expect(cidrWithin(parseCIDR("10.10.0.128/25")!, net)).toBe(true);
    expect(cidrWithin(parseCIDR("10.10.0.0/24")!, net)).toBe(true);
    expect(cidrWithin(parseCIDR("10.10.0.0/16")!, net)).toBe(false);
    expect(cidrWithin(parseCIDR("10.10.1.0/25")!, net)).toBe(false);
    expect(cidrWithin(parseCIDR("fd00::/64")!, net)).toBe(false);
  });
});

function draft(patch: Partial<CreateNetworkDraft> = {}): CreateNetworkDraft {
  return { ...emptyCreateDraft(), name: "app-net", ...patch };
}

describe("validateCreateDraft", () => {
  const user = { isSuperuser: false };
  const admin = { isSuperuser: true };

  it("accepts a minimal bridge network", () => {
    const e = validateCreateDraft(draft(), user);
    expect(e.valid).toBe(true);
    expect(e.name).toBeUndefined();
  });

  it("validates the name like the backend (first char alnum, then [alnum_.-], max 255)", () => {
    expect(validateCreateDraft(draft({ name: "" }), user).name).toBe("name.required");
    expect(validateCreateDraft(draft({ name: "-bad" }), user).name).toBe("name.invalid");
    expect(validateCreateDraft(draft({ name: "has space" }), user).name).toBe("name.invalid");
    expect(validateCreateDraft(draft({ name: "a".repeat(256) }), user).name).toBe("name.invalid");
    expect(validateCreateDraft(draft({ name: "ok_net.1-x" }), user).name).toBeUndefined();
  });

  it("reserves macvlan/ipvlan to superusers and requires a parent interface", () => {
    expect(validateCreateDraft(draft({ driver: "macvlan", parent: "eth0" }), user).driver).toBe("driver.forbidden");
    const noParent = validateCreateDraft(draft({ driver: "ipvlan" }), admin);
    expect(noParent.driver).toBeUndefined();
    expect(noParent.parent).toBe("parent.required");
    expect(noParent.valid).toBe(false);
    expect(validateCreateDraft(draft({ driver: "macvlan", parent: "eth 0" }), admin).parent).toBe("parent.invalid");
    expect(validateCreateDraft(draft({ driver: "macvlan", parent: "eth0.100" }), admin).valid).toBe(true);
    expect(validateCreateDraft(draft({ driver: "vxlan" }), admin).driver).toBe("driver.invalid");
  });

  it("checks each IPAM pool: subnet CIDR, gateway/range/aux inside it", () => {
    const pool = { ...emptyPool(), subnet: "10.10.0.0/24", gateway: "10.10.0.1", ipRange: "10.10.0.128/25", aux: [{ key: "router", value: "10.10.0.254" }] };
    expect(validateCreateDraft(draft({ pools: [pool] }), user).valid).toBe(true);

    const bad = validateCreateDraft(
      draft({
        pools: [
          { ...pool, subnet: "10.10.0.0" },
          { ...pool, gateway: "10.10.1.1" },
          { ...pool, gateway: "nope" },
          { ...pool, ipRange: "10.10.1.0/25" },
          { ...pool, ipRange: "10.10.0.0/16" },
          { ...pool, aux: [{ key: "r", value: "10.11.0.1" }, { key: "", value: "10.10.0.9" }, { key: "r", value: "x" }, { key: "s", value: "" }] },
        ],
      }),
      user,
    );
    expect(bad.valid).toBe(false);
    expect(bad.pools[0].subnet).toBe("subnet.invalid");
    expect(bad.pools[1].gateway).toBe("gateway.outside");
    expect(bad.pools[2].gateway).toBe("gateway.invalid");
    expect(bad.pools[3].ipRange).toBe("ipRange.outside");
    expect(bad.pools[4].ipRange).toBe("ipRange.outside");
    expect(bad.pools[5].aux[0].value).toBe("aux.outside");
    expect(bad.pools[5].aux[1].key).toBe("aux.keyRequired");
    expect(bad.pools[5].aux[2].key).toBe("aux.keyDuplicate");
    expect(bad.pools[5].aux[2].value).toBe("aux.invalid");
    expect(bad.pools[5].aux[3].value).toBe("aux.valueRequired");
  });

  it("requires a subnet once a pool declares anything else, and ignores blank pools", () => {
    const e = validateCreateDraft(draft({ pools: [emptyPool(), { ...emptyPool(), gateway: "10.0.0.1" }] }), user);
    expect(e.pools[0].subnet).toBeUndefined();
    expect(e.pools[1].subnet).toBe("subnet.required");
    expect(e.valid).toBe(false);
    expect(validateCreateDraft(draft({ pools: [emptyPool()] }), user).valid).toBe(true);
  });

  it("checks driver options: key required, unique, and 'parent' policy", () => {
    const e = validateCreateDraft(
      draft({ options: [{ key: "", value: "x" }, { key: "a", value: "1" }, { key: "a", value: "2" }, { key: "Parent", value: "eth0" }, { key: "", value: "" }] }),
      user,
    );
    expect(e.options[0].key).toBe("option.keyRequired");
    expect(e.options[1].key).toBeUndefined();
    expect(e.options[2].key).toBe("option.keyDuplicate");
    expect(e.options[3].key).toBe("option.parentForbidden");
    expect(e.options[4].key).toBeUndefined();
    expect(e.valid).toBe(false);

    // A superuser may pass "parent" on a bridge; on macvlan the dedicated field owns it.
    expect(validateCreateDraft(draft({ options: [{ key: "parent", value: "eth0" }] }), admin).valid).toBe(true);
    expect(validateCreateDraft(draft({ driver: "macvlan", parent: "eth0", options: [{ key: "parent", value: "eth1" }] }), admin).options[0].key).toBe("option.parentReserved");
  });
});

describe("validateConnectDraft", () => {
  it("requires a container and a well-formed IPv4", () => {
    expect(validateConnectDraft({ containerId: "", ipv4: "", aliases: "" }, { isDefaultBridge: false }).containerId).toBe("container.required");
    expect(validateConnectDraft({ containerId: "c1", ipv4: "", aliases: "" }, { isDefaultBridge: false }).valid).toBe(true);
    expect(validateConnectDraft({ containerId: "c1", ipv4: "10.10.0.20", aliases: "" }, { isDefaultBridge: false }).valid).toBe(true);
    expect(validateConnectDraft({ containerId: "c1", ipv4: "fd00::1", aliases: "" }, { isDefaultBridge: false }).ipv4).toBe("ipv4.invalid");
    expect(validateConnectDraft({ containerId: "c1", ipv4: "10.10.0", aliases: "" }, { isDefaultBridge: false }).ipv4).toBe("ipv4.invalid");
  });

  it("refuses a static address on the default bridge", () => {
    expect(validateConnectDraft({ containerId: "c1", ipv4: "172.17.0.9", aliases: "" }, { isDefaultBridge: true }).ipv4).toBe("ipv4.unsupported");
    expect(validateConnectDraft({ containerId: "c1", ipv4: "", aliases: "" }, { isDefaultBridge: true }).valid).toBe(true);
  });
});

describe("request builders", () => {
  it("omits ipam/options when nothing is configured", () => {
    expect(buildCreateRequest(draft({ pools: [emptyPool()], options: [{ key: "", value: "" }] }))).toEqual({
      name: "app-net",
      driver: "bridge",
      internal: false,
      attachable: false,
      enableIPv6: false,
    });
  });

  it("maps pools, aux addresses, options and the L2 parent", () => {
    const req = buildCreateRequest(
      draft({
        name: " lan ",
        driver: "macvlan",
        parent: "eth0",
        internal: true,
        pools: [{ subnet: " 10.10.0.0/24 ", gateway: "10.10.0.1", ipRange: "", aux: [{ key: "router", value: "10.10.0.254" }, { key: "", value: "" }] }],
        options: [{ key: "macvlan_mode", value: "bridge" }],
      }),
    );
    expect(req).toEqual({
      name: "lan",
      driver: "macvlan",
      internal: true,
      attachable: false,
      enableIPv6: false,
      options: { macvlan_mode: "bridge", parent: "eth0" },
      ipam: { config: [{ subnet: "10.10.0.0/24", gateway: "10.10.0.1", auxAddresses: { router: "10.10.0.254" } }] },
    });
  });

  it("builds the connect body with trimmed aliases", () => {
    expect(splitAliases(" db, postgres ,, ")).toEqual(["db", "postgres"]);
    expect(buildConnectRequest({ containerId: "c1", ipv4: "", aliases: "" })).toEqual({ containerId: "c1" });
    expect(buildConnectRequest({ containerId: "c1", ipv4: " 10.10.0.20 ", aliases: "db, pg" })).toEqual({
      containerId: "c1",
      ipv4: "10.10.0.20",
      aliases: ["db", "pg"],
    });
  });

  it("reports the subnet family for the IPv6 hint", () => {
    expect(subnetFamily("fd00::/64")).toBe(6);
    expect(subnetFamily("10.0.0.0/8")).toBe(4);
    expect(subnetFamily("garbage")).toBeUndefined();
  });
});
