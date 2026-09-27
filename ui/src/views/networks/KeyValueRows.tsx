// ui/src/views/networks/KeyValueRows.tsx
//
// Controlled key=value row editor with a per-row error line, shared by the
// IPAM auxiliary addresses and the driver options of the create modal. Labels
// come from the caller so the component stays dictionary-agnostic.

import { IconPlus, IconTrash } from "../../components/icons";
import type { KVErrors, KVRow } from "./validate";

interface Labels {
  keyLabel: string;
  valueLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  removeLabel: string;
}

interface Props extends Labels {
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  errors?: KVErrors[];
  // Resolves an error code to its localized text.
  describe: (code: string) => string;
  disabled?: boolean;
}

const ROW_STYLE = { display: "grid", gridTemplateColumns: "1fr 1fr 32px", gap: "var(--sp-2)", alignItems: "center" } as const;
const INPUT_STYLE = { height: 32 } as const;

export function KeyValueRows({
  rows,
  onChange,
  errors,
  describe,
  disabled,
  keyLabel,
  valueLabel,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  removeLabel,
}: Props) {
  const update = (i: number, patch: Partial<KVRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: "", value: "" }]);

  return (
    <div className="col" style={{ gap: "var(--sp-2)" }}>
      {rows.map((r, i) => {
        const err = errors?.[i];
        const message = err?.key ? describe(err.key) : err?.value ? describe(err.value) : undefined;
        return (
          <div key={i} className="col" style={{ gap: 2 }}>
            <div style={ROW_STYLE}>
              <input
                className="input input-mono"
                style={INPUT_STYLE}
                placeholder={keyPlaceholder}
                aria-label={keyLabel}
                aria-invalid={err?.key ? true : undefined}
                value={r.key}
                disabled={disabled}
                onChange={(e) => update(i, { key: e.target.value })}
              />
              <input
                className="input input-mono"
                style={INPUT_STYLE}
                placeholder={valuePlaceholder}
                aria-label={valueLabel}
                aria-invalid={err?.value ? true : undefined}
                value={r.value}
                disabled={disabled}
                onChange={(e) => update(i, { value: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => remove(i)}
                aria-label={removeLabel}
                title={removeLabel}
                disabled={disabled}
                style={{ color: "var(--danger)" }}
              >
                <IconTrash size={14} />
              </button>
            </div>
            {message ? <span className="field-error">{message}</span> : null}
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={disabled} style={{ alignSelf: "flex-start" }}>
        <IconPlus size={13} />
        {addLabel}
      </button>
    </div>
  );
}
