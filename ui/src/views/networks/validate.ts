// ui/src/views/networks/validate.ts
//
// Client-side mirror of the backend network validation (server/internal/api/
// networks.go: validVolumeName, validateIPAM, networkAttachOptions,
// isL2Network) so the create and connect forms can flag a bad value under its
// field before the request leaves the browser. Errors are machine codes; the
// components map them to localized text. The backend stays the enforcer:
// anything accepted here is re-checked server-side.
//
// The IP parsing follows Go's netip.ParseAddr / net.ParseCIDR: dotted-quad
// IPv4 without leading zeros, RFC 4291 IPv6 with one "::" and an optional
// embedded IPv4 tail, no zones. An IPv4-mapped IPv6 address counts as IPv4,
// like net.IP.To4().

import type { CreateNetworkRequest, IPAMConfig, NetworkConnectRequest } from "../../lib/types";

export const NETWORK_DRIVERS = ["bridge", "overlay", "macvlan", "ipvlan"] as const;
export type NetworkDriver = (typeof NETWORK_DRIVERS)[number];

// Docker's built-in networks: never deleted, and only the bridge accepts
// container attachments (host/none share the host namespace).
export const SYSTEM_NETWORKS: ReadonlySet<string> = new Set(["bridge", "host", "none"]);
export const DEFAULT_BRIDGE = "bridge";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const NAME_MAX = 255;

/* ===================== IP parsing ===================== */

export interface ParsedIP {
  family: 4 | 6;
  // 4 bytes for IPv4, 16 for IPv6.
  bytes: number[];
}

export interface ParsedCIDR {
  family: 4 | 6;
  // The network number (address with the host bits cleared).
  network: number[];
  prefix: number;
}

const V4_OCTET_RE = /^(0|[1-9][0-9]{0,2})$/;
const V6_GROUP_RE = /^[0-9a-fA-F]{1,4}$/;

export function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!V4_OCTET_RE.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

// parseGroups expands one side of a "::" into 16-bit groups. An embedded IPv4
// is only legal as the last group of the whole address.
function parseV6Groups(part: string, allowV4Tail: boolean): number[] | null {
  if (part === "") return [];
  const groups = part.split(":");
  const out: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (i === groups.length - 1 && allowV4Tail && g.includes(".")) {
      const v4 = parseIPv4(g);
      if (!v4) return null;
      out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      continue;
    }
    if (!V6_GROUP_RE.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

export function parseIPv6(s: string): number[] | null {
  if (s.includes("%") || !s.includes(":")) return null;
  const dbl = s.indexOf("::");
  if (dbl !== -1 && s.indexOf("::", dbl + 1) !== -1) return null;
  const head = dbl === -1 ? s : s.slice(0, dbl);
  const tail = dbl === -1 ? "" : s.slice(dbl + 2);
  const h = parseV6Groups(head, dbl === -1);
  const t = parseV6Groups(tail, true);
  if (!h || !t) return null;
  let groups: number[];
  if (dbl === -1) {
    if (h.length !== 8) return null;
    groups = h;
  } else {
    if (h.length + t.length > 7) return null;
    groups = [...h, ...new Array<number>(8 - h.length - t.length).fill(0), ...t];
  }
  const bytes: number[] = [];
  for (const g of groups) bytes.push(g >> 8, g & 0xff);
  return bytes;
}

// v4Mapped returns the IPv4 bytes of an ::ffff:a.b.c.d address, else null.
function v4Mapped(bytes16: number[]): number[] | null {
  for (let i = 0; i < 10; i++) if (bytes16[i] !== 0) return null;
  if (bytes16[10] !== 0xff || bytes16[11] !== 0xff) return null;
  return bytes16.slice(12);
}

export function parseIP(raw: string): ParsedIP | null {
  const s = raw.trim();
  if (s === "") return null;
  if (!s.includes(":")) {
    const v4 = parseIPv4(s);
    return v4 ? { family: 4, bytes: v4 } : null;
  }
  const v6 = parseIPv6(s);
  if (!v6) return null;
  const mapped = v4Mapped(v6);
  return mapped ? { family: 4, bytes: mapped } : { family: 6, bytes: v6 };
}

function maskByte(prefix: number, i: number): number {
  const hi = 8 * (i + 1);
  if (prefix >= hi) return 0xff;
  if (prefix <= 8 * i) return 0;
  return (0xff << (hi - prefix)) & 0xff;
}

export function parseCIDR(raw: string): ParsedCIDR | null {
  const s = raw.trim();
  const slash = s.indexOf("/");
  if (slash <= 0) return null;
  const ip = parseIP(s.slice(0, slash));
  const prefixStr = s.slice(slash + 1);
  if (!ip || !/^[0-9]{1,3}$/.test(prefixStr)) return null;
  const prefix = Number(prefixStr);
  const bits = ip.bytes.length * 8;
  if (prefix > bits) return null;
  const network = ip.bytes.map((b, i) => b & maskByte(prefix, i));
  return { family: ip.family, network, prefix };
}

export function cidrContains(net: ParsedCIDR, ip: ParsedIP): boolean {
  if (net.family !== ip.family) return false;
  for (let i = 0; i < net.network.length; i++) {
    const m = maskByte(net.prefix, i);
    if ((net.network[i] & m) !== (ip.bytes[i] & m)) return false;
  }
  return true;
}

// cidrWithin reports whether inner is fully contained in outer: same family,
// an inner prefix at least as long, and the inner network number inside outer.
export function cidrWithin(inner: ParsedCIDR, outer: ParsedCIDR): boolean {
  if (inner.family !== outer.family || inner.prefix < outer.prefix) return false;
  return cidrContains(outer, { family: inner.family, bytes: inner.network });
}

/* ===================== Drafts ===================== */

export interface KVRow {
  key: string;
  value: string;
}

export interface IPAMPoolDraft {
  subnet: string;
  gateway: string;
  ipRange: string;
  aux: KVRow[];
}

export interface CreateNetworkDraft {
  name: string;
  driver: string;
  // Host interface for macvlan/ipvlan (sent as the "parent" driver option).
  parent: string;
  internal: boolean;
  attachable: boolean;
  enableIPv6: boolean;
  pools: IPAMPoolDraft[];
  options: KVRow[];
}

export interface ConnectDraft {
  containerId: string;
  ipv4: string;
  // Comma-separated DNS aliases.
  aliases: string;
}

export function emptyPool(): IPAMPoolDraft {
  return { subnet: "", gateway: "", ipRange: "", aux: [] };
}

export function emptyCreateDraft(): CreateNetworkDraft {
  return {
    name: "",
    driver: "bridge",
    parent: "",
    internal: false,
    attachable: false,
    enableIPv6: false,
    pools: [],
    options: [],
  };
}

export function isL2Driver(driver: string): boolean {
  const d = driver.trim().toLowerCase();
  return d === "macvlan" || d === "ipvlan";
}

// A row with neither key nor value is padding, dropped at submit.
function isBlankRow(r: KVRow): boolean {
  return r.key.trim() === "" && r.value.trim() === "";
}

function isBlankPool(p: IPAMPoolDraft): boolean {
  return p.subnet.trim() === "" && p.gateway.trim() === "" && p.ipRange.trim() === "" && p.aux.every(isBlankRow);
}

/* ===================== Validation ===================== */

export type FieldError =
  | "name.required"
  | "name.invalid"
  | "driver.invalid"
  | "driver.forbidden"
  | "parent.required"
  | "parent.invalid"
  | "subnet.required"
  | "subnet.invalid"
  | "gateway.invalid"
  | "gateway.outside"
  | "ipRange.invalid"
  | "ipRange.outside"
  | "aux.keyRequired"
  | "aux.keyDuplicate"
  | "aux.valueRequired"
  | "aux.invalid"
  | "aux.outside"
  | "option.keyRequired"
  | "option.keyDuplicate"
  | "option.parentReserved"
  | "option.parentForbidden"
  | "container.required"
  | "ipv4.invalid"
  | "ipv4.unsupported";

export interface KVErrors {
  key?: FieldError;
  value?: FieldError;
}

export interface PoolErrors {
  subnet?: FieldError;
  gateway?: FieldError;
  ipRange?: FieldError;
  aux: KVErrors[];
}

export interface CreateDraftErrors {
  name?: FieldError;
  driver?: FieldError;
  parent?: FieldError;
  pools: PoolErrors[];
  options: KVErrors[];
  valid: boolean;
}

export interface ConnectDraftErrors {
  containerId?: FieldError;
  ipv4?: FieldError;
  valid: boolean;
}

function validateName(raw: string): FieldError | undefined {
  const name = raw.trim();
  if (name === "") return "name.required";
  if (name.length > NAME_MAX || !NAME_RE.test(name)) return "name.invalid";
  return undefined;
}

function validatePool(p: IPAMPoolDraft): PoolErrors {
  const errs: PoolErrors = { aux: p.aux.map(() => ({})) };
  const subnetStr = p.subnet.trim();
  if (subnetStr === "") {
    if (!isBlankPool(p)) errs.subnet = "subnet.required";
    return errs;
  }
  const subnet = parseCIDR(subnetStr);
  if (!subnet) {
    errs.subnet = "subnet.invalid";
    return errs;
  }
  const gw = p.gateway.trim();
  if (gw !== "") {
    const ip = parseIP(gw);
    if (!ip) errs.gateway = "gateway.invalid";
    else if (!cidrContains(subnet, ip)) errs.gateway = "gateway.outside";
  }
  const rangeStr = p.ipRange.trim();
  if (rangeStr !== "") {
    const rng = parseCIDR(rangeStr);
    if (!rng) errs.ipRange = "ipRange.invalid";
    else if (!cidrWithin(rng, subnet)) errs.ipRange = "ipRange.outside";
  }
  const seen = new Set<string>();
  p.aux.forEach((row, i) => {
    if (isBlankRow(row)) return;
    const key = row.key.trim();
    const value = row.value.trim();
    const e: KVErrors = {};
    if (key === "") e.key = "aux.keyRequired";
    else if (seen.has(key)) e.key = "aux.keyDuplicate";
    else seen.add(key);
    if (value === "") e.value = "aux.valueRequired";
    else {
      const ip = parseIP(value);
      if (!ip) e.value = "aux.invalid";
      else if (!cidrContains(subnet, ip)) e.value = "aux.outside";
    }
    errs.aux[i] = e;
  });
  return errs;
}

function validateOptions(rows: KVRow[], driver: string, isSuperuser: boolean): KVErrors[] {
  const seen = new Set<string>();
  const l2 = isL2Driver(driver);
  return rows.map((row) => {
    if (isBlankRow(row)) return {};
    const key = row.key.trim();
    const e: KVErrors = {};
    if (key === "") e.key = "option.keyRequired";
    else if (seen.has(key)) e.key = "option.keyDuplicate";
    else {
      seen.add(key);
      if (key.toLowerCase() === "parent") {
        if (l2) e.key = "option.parentReserved";
        else if (!isSuperuser) e.key = "option.parentForbidden";
      }
    }
    return e;
  });
}

export function validateCreateDraft(d: CreateNetworkDraft, ctx: { isSuperuser: boolean }): CreateDraftErrors {
  const errs: CreateDraftErrors = { pools: [], options: [], valid: true };
  errs.name = validateName(d.name);

  const driver = d.driver.trim();
  if (!(NETWORK_DRIVERS as readonly string[]).includes(driver)) errs.driver = "driver.invalid";
  else if (isL2Driver(driver) && !ctx.isSuperuser) errs.driver = "driver.forbidden";

  if (isL2Driver(driver)) {
    const parent = d.parent.trim();
    if (parent === "") errs.parent = "parent.required";
    else if (/[\s/]/.test(parent)) errs.parent = "parent.invalid";
  }

  errs.pools = d.pools.map(validatePool);
  errs.options = validateOptions(d.options, driver, ctx.isSuperuser);

  errs.valid =
    !errs.name &&
    !errs.driver &&
    !errs.parent &&
    errs.pools.every((p) => !p.subnet && !p.gateway && !p.ipRange && p.aux.every((a) => !a.key && !a.value)) &&
    errs.options.every((o) => !o.key && !o.value);
  return errs;
}

export function validateConnectDraft(d: ConnectDraft, ctx: { isDefaultBridge: boolean }): ConnectDraftErrors {
  const errs: ConnectDraftErrors = { valid: true };
  if (d.containerId.trim() === "") errs.containerId = "container.required";
  const ipv4 = d.ipv4.trim();
  if (ipv4 !== "") {
    const ip = parseIP(ipv4);
    if (!ip || ip.family !== 4) errs.ipv4 = "ipv4.invalid";
    else if (ctx.isDefaultBridge) errs.ipv4 = "ipv4.unsupported";
  }
  errs.valid = !errs.containerId && !errs.ipv4;
  return errs;
}

// subnetFamily reports the family of a pool's subnet when it parses (so the
// form can hint that an IPv6 pool needs the IPv6 flag), else undefined.
export function subnetFamily(subnet: string): 4 | 6 | undefined {
  return parseCIDR(subnet)?.family;
}

/* ===================== Request builders ===================== */

function rowsToRecord(rows: KVRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let n = 0;
  for (const r of rows) {
    if (isBlankRow(r)) continue;
    out[r.key.trim()] = r.value.trim();
    n++;
  }
  return n > 0 ? out : undefined;
}

// buildCreateRequest turns a validated draft into the POST body: blank pools
// and rows are dropped, the macvlan/ipvlan parent becomes the "parent" driver
// option, and IPAM is omitted entirely when no pool is configured so the
// daemon keeps picking subnets from its default pools.
export function buildCreateRequest(d: CreateNetworkDraft): CreateNetworkRequest {
  const driver = d.driver.trim();
  const options = rowsToRecord(d.options) ?? {};
  if (isL2Driver(driver) && d.parent.trim() !== "") options.parent = d.parent.trim();

  const config: IPAMConfig[] = [];
  for (const p of d.pools) {
    if (isBlankPool(p)) continue;
    const c: IPAMConfig = { subnet: p.subnet.trim() };
    if (p.gateway.trim()) c.gateway = p.gateway.trim();
    if (p.ipRange.trim()) c.ipRange = p.ipRange.trim();
    const aux = rowsToRecord(p.aux);
    if (aux) c.auxAddresses = aux;
    config.push(c);
  }

  const req: CreateNetworkRequest = {
    name: d.name.trim(),
    driver,
    internal: d.internal,
    attachable: d.attachable,
    enableIPv6: d.enableIPv6,
  };
  if (Object.keys(options).length > 0) req.options = options;
  if (config.length > 0) req.ipam = { config };
  return req;
}

export function splitAliases(csv: string): string[] {
  return csv
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "");
}

export function buildConnectRequest(d: ConnectDraft): NetworkConnectRequest {
  const req: NetworkConnectRequest = { containerId: d.containerId.trim() };
  if (d.ipv4.trim()) req.ipv4 = d.ipv4.trim();
  const aliases = splitAliases(d.aliases);
  if (aliases.length > 0) req.aliases = aliases;
  return req;
}
