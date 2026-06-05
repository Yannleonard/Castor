// ui/src/views/marketplace/RowEditors.tsx
//
// Reusable repeating-row editors shared by the deploy modal and the custom
// template editor: port maps (host:container/proto), environment variables
// (key=value, with required + secret-masking), and volume mounts (source ->
// container path). Each is a controlled component over a typed row array.

import { IconPlus, IconTrash, IconLock } from "../../components/icons";

// Keys whose value should render as a password input (masked).
export const SECRET_KEY_RE = /PASSWORD|TOKEN|SECRET|KEY/i;

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
            placeholder="host (auto)"
            aria-label="Host port"
            value={r.host}
            onChange={(e) => update(i, { host: e.target.value.replace(/[^0-9]/g, "") })}
          />
          <span className="mkt-row-sep">:</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="container"
            aria-label="Container port"
            value={r.container}
            onChange={(e) => update(i, { container: e.target.value.replace(/[^0-9]/g, "") })}
          />
          <select
            className="select mkt-row-proto"
            aria-label="Protocol"
            value={r.proto}
            onChange={(e) => update(i, { proto: e.target.value })}
          >
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
          <RmButton onClick={() => remove(i)} label="Remove port" />
        </div>
      ))}
      <AddButton onClick={add} label="Add port" />
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
                placeholder="KEY"
                aria-label="Variable name"
                value={r.key}
                disabled={!editableKeys}
                onChange={(e) => update(i, { key: e.target.value })}
                style={{ flex: 1, minWidth: 0 }}
              />
              {r.required ? (
                <span className="mkt-row-req" title="Required">
                  *
                </span>
              ) : null}
            </span>
            <input
              className="input"
              type={secret ? "password" : "text"}
              placeholder={r.required ? "required" : "value"}
              aria-label="Variable value"
              autoComplete="off"
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            {showRequiredToggle ? (
              <label className="checkbox-row" title="Required" style={{ justifyContent: "center" }}>
                <input
                  type="checkbox"
                  checked={r.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                  aria-label="Required"
                />
              </label>
            ) : (
              <RmButton onClick={() => remove(i)} label="Remove variable" />
            )}
          </div>
        );
      })}
      <AddButton onClick={add} label="Add variable" />
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
            placeholder="volume name or /host/path"
            aria-label="Volume source"
            value={r.source}
            onChange={(e) => update(i, { source: e.target.value })}
          />
          <span className="mkt-row-sep">→</span>
          <input
            className="input input-mono"
            placeholder="/container/path"
            aria-label="Container path"
            value={r.target}
            onChange={(e) => update(i, { target: e.target.value })}
          />
          <RmButton onClick={() => remove(i)} label="Remove volume" />
        </div>
      ))}
      <AddButton onClick={add} label="Add volume" />
    </div>
  );
}
