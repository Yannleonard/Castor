// ui/src/views/marketplace/RowEditors.tsx
//
// Reusable repeating-row editors shared by the deploy modal and the custom
// template editor: port maps (host:container/proto), environment variables
// (key=value, with required + secret-masking), volume mounts (source ->
// container path) and network attachments (network / static IPv4 / aliases).
// Each is a controlled component over a typed row array.

import { IconPlus, IconTrash, IconLock } from "../../components/icons";
import { useT } from "../../i18n";
import { mktRowEditorsDict } from "../../i18n/locales/mktRowEditors";
import type { DockerNetwork } from "../../lib/types";

// Keys whose value should render as a password input (masked).
export const SECRET_KEY_RE = /PASSWORD|TOKEN|SECRET|KEY/i;

// The daemon's default bridge: it takes neither a static IP nor network-scoped
// aliases, so those fields are disabled (and cleared) when it is selected.
export const DEFAULT_BRIDGE = "bridge";

// Dotted-quad IPv4 with each octet in 0-255. A client-side check only: the
// daemon still requires the address to fall inside the network's subnet.
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIPv4(s: string): boolean {
  return IPV4_RE.test(s);
}

export interface PortRow {
  host: string; // string for free editing; "" => ephemeral host port
  container: string;
  proto: string; // "tcp" | "udp"
}

export interface EnvRow {
  key: string;
  value: string;
  required: boolean;
}

export interface VolRow {
  source: string; // named volume or absolute host path; "" => anonymous
  target: string; // absolute in-container path
}

export interface NetRow {
  name: string; // network name; "" => row not chosen yet (dropped on submit)
  ipv4: string; // optional static IPv4; "" => the network assigns one
  aliases: string; // comma-separated DNS aliases; "" => none
}

function RmButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon btn-sm mkt-row-rm"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ color: "var(--danger)" }}
    >
      <IconTrash size={14} />
    </button>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onClick} style={{ alignSelf: "flex-start" }}>
      <IconPlus size={13} />
      {label}
    </button>
  );
}

/* ---------------- Ports ---------------- */

export function PortRowsEditor({
  rows,
  onChange,
}: {
  rows: PortRow[];
  onChange: (rows: PortRow[]) => void;
}) {
  const t = useT(mktRowEditorsDict);
  const update = (i: number, patch: Partial<PortRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { host: "", container: "", proto: "tcp" }]);

  return (
    <div className="mkt-rows">
      {rows.map((r, i) => (
        <div key={i} className="mkt-row mkt-row-port">
          <input
            className="input"
            inputMode="numeric"
            placeholder={t("port.hostPlaceholder")}
            aria-label={t("port.hostLabel")}
            value={r.host}
            onChange={(e) => update(i, { host: e.target.value.replace(/[^0-9]/g, "") })}
          />
          <span className="mkt-row-sep">:</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder={t("port.containerPlaceholder")}
            aria-label={t("port.containerLabel")}
            value={r.container}
            onChange={(e) => update(i, { container: e.target.value.replace(/[^0-9]/g, "") })}
          />
          <select
            className="select mkt-row-proto"
            aria-label={t("port.protoLabel")}
            value={r.proto}
            onChange={(e) => update(i, { proto: e.target.value })}
          >
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
          <RmButton onClick={() => remove(i)} label={t("port.remove")} />
        </div>
      ))}
      <AddButton onClick={add} label={t("port.add")} />
    </div>
  );
}

/* ---------------- Environment ---------------- */

export function EnvRowsEditor({
  rows,
  onChange,
  editableKeys = true,
  showRequiredToggle = false,
}: {
  rows: EnvRow[];
  onChange: (rows: EnvRow[]) => void;
  /** when false, the key field is locked (template-driven env in the deploy modal) */
  editableKeys?: boolean;
  /** when true, render a "required" checkbox per row (custom template editor) */
  showRequiredToggle?: boolean;
}) {
  const t = useT(mktRowEditorsDict);
  const update = (i: number, patch: Partial<EnvRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: "", value: "", required: false }]);

  return (
    <div className="mkt-rows">
      {rows.map((r, i) => {
        const secret = SECRET_KEY_RE.test(r.key);
        return (
          <div key={i} className="mkt-row mkt-row-env">
            <span className="row" style={{ gap: 4, minWidth: 0 }}>
              {secret ? <IconLock size={12} /> : null}
              <input
                className="input input-mono"
                placeholder={t("env.keyPlaceholder")}
                aria-label={t("env.keyLabel")}
                value={r.key}
                disabled={!editableKeys}
                onChange={(e) => update(i, { key: e.target.value })}
                style={{ flex: 1, minWidth: 0 }}
              />
              {r.required ? (
                <span className="mkt-row-req" title={t("env.requiredHint")}>
                  *
                </span>
              ) : null}
            </span>
            <input
              className="input"
              type={secret ? "password" : "text"}
              placeholder={r.required ? t("env.valueRequiredPlaceholder") : t("env.valuePlaceholder")}
              aria-label={t("env.valueLabel")}
              autoComplete="off"
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            {showRequiredToggle ? (
              <label className="checkbox-row" title={t("env.requiredLabel")} style={{ justifyContent: "center" }}>
                <input
                  type="checkbox"
                  checked={r.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                  aria-label={t("env.requiredLabel")}
                />
              </label>
            ) : (
              <RmButton onClick={() => remove(i)} label={t("env.remove")} />
            )}
          </div>
        );
      })}
      <AddButton onClick={add} label={t("env.add")} />
    </div>
  );
}

/* ---------------- Volumes ---------------- */

export function VolRowsEditor({
  rows,
  onChange,
}: {
  rows: VolRow[];
  onChange: (rows: VolRow[]) => void;
}) {
  const t = useT(mktRowEditorsDict);
  const update = (i: number, patch: Partial<VolRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { source: "", target: "" }]);

  return (
    <div className="mkt-rows">
      {rows.map((r, i) => (
        <div key={i} className="mkt-row mkt-row-vol">
          <input
            className="input input-mono"
            placeholder={t("vol.sourcePlaceholder")}
            aria-label={t("vol.sourceLabel")}
            value={r.source}
            onChange={(e) => update(i, { source: e.target.value })}
          />
          <span className="mkt-row-sep">→</span>
          <input
            className="input input-mono"
            placeholder={t("vol.targetPlaceholder")}
            aria-label={t("vol.targetLabel")}
            value={r.target}
            onChange={(e) => update(i, { target: e.target.value })}
          />
          <RmButton onClick={() => remove(i)} label={t("vol.remove")} />
        </div>
      ))}
      <AddButton onClick={add} label={t("vol.add")} />
    </div>
  );
}

/* ---------------- Networks ---------------- */

// The grid lives inline: global.css only defines the port/env/vol variants.
const NET_ROW_COLUMNS = "minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.3fr) 32px";

export function NetRowsEditor({
  rows,
  onChange,
  networks,
  loading = false,
}: {
  rows: NetRow[];
  onChange: (rows: NetRow[]) => void;
  /** attachable networks of the host (the caller already drops host/none) */
  networks: DockerNetwork[];
  /** when true, the empty option reads "loading" instead of "select" */
  loading?: boolean;
}) {
  const t = useT(mktRowEditorsDict);
  const update = (i: number, patch: Partial<NetRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { name: "", ipv4: "", aliases: "" }]);
  // Switching to the default bridge drops the fields it cannot honour.
  const pick = (i: number, name: string) =>
    update(i, name === DEFAULT_BRIDGE ? { name, ipv4: "", aliases: "" } : { name });

  const label = (n: DockerNetwork) =>
    n.subnets.length ? `${n.name} (${n.driver}, ${n.subnets.join(", ")})` : `${n.name} (${n.driver})`;

  return (
    <div className="mkt-rows">
      {rows.map((r, i) => {
        // Each network may be attached once: hide the other rows' picks.
        const taken = new Set(rows.filter((_, idx) => idx !== i).map((o) => o.name));
        const options = networks.filter((n) => !taken.has(n.name));
        // Keep a selection visible even if the network vanished from the list.
        const orphan = r.name !== "" && !networks.some((n) => n.name === r.name);
        const isBridge = r.name === DEFAULT_BRIDGE;
        const ipv4 = r.ipv4.trim();
        const ipv4Bad = ipv4 !== "" && !isIPv4(ipv4);
        return (
          <div key={i} className="mkt-row" style={{ gridTemplateColumns: NET_ROW_COLUMNS }}>
            <select
              className="select"
              aria-label={t("net.networkLabel")}
              value={r.name}
              onChange={(e) => pick(i, e.target.value)}
            >
              <option value="">{loading ? t("net.networkLoading") : t("net.networkPlaceholder")}</option>
              {orphan ? <option value={r.name}>{r.name}</option> : null}
              {options.map((n) => (
                <option key={n.id} value={n.name}>
                  {label(n)}
                </option>
              ))}
            </select>
            <input
              className="input input-mono"
              inputMode="decimal"
              placeholder={t("net.ipv4Placeholder")}
              aria-label={t("net.ipv4Label")}
              aria-invalid={ipv4Bad || undefined}
              title={isBridge ? t("net.bridgeLocked") : ipv4Bad ? t("net.ipv4Invalid") : undefined}
              disabled={isBridge}
              value={r.ipv4}
              onChange={(e) => update(i, { ipv4: e.target.value.replace(/[^0-9.]/g, "") })}
              style={ipv4Bad ? { borderColor: "var(--danger)" } : undefined}
            />
            <input
              className="input input-mono"
              placeholder={t("net.aliasesPlaceholder")}
              aria-label={t("net.aliasesLabel")}
              title={isBridge ? t("net.bridgeLocked") : undefined}
              disabled={isBridge}
              value={r.aliases}
              onChange={(e) => update(i, { aliases: e.target.value })}
            />
            <RmButton onClick={() => remove(i)} label={t("net.remove")} />
          </div>
        );
      })}
      <AddButton onClick={add} label={t("net.add")} />
    </div>
  );
}
