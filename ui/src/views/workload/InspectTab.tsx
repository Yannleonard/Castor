// ui/src/views/workload/InspectTab.tsx
//
// Inspect tab: pretty-printed engine-native inspect JSON (detail.raw). Secret env
// is already masked server-side unless the caller holds
// docker.container.inspect.secrets. Provides copy + a client-side filter.

import { useMemo, useState } from "react";
import { prettyJson } from "../../lib/format";
import { ActionButton } from "../../components/ActionButton";
import { IconCopy, IconSearch } from "../../components/icons";
import { toast } from "../../lib/toast";

interface Props {
  raw: unknown;
}

export function InspectTab({ raw }: Props) {
  const [filter, setFilter] = useState("");
  const full = useMemo(() => prettyJson(raw), [raw]);

  const shown = useMemo(() => {
    if (!filter.trim()) return full;
    const f = filter.toLowerCase();
    return full
      .split("\n")
      .filter((l) => l.toLowerCase().includes(f))
      .join("\n");
  }, [full, filter]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      toast.success("Copied", "Inspect JSON copied to clipboard.");
    } catch {
      toast.error("Copy failed", "Clipboard is unavailable.");
    }
  };

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-header" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
        <div className="row" style={{ flex: 1 }}>
          <span className="muted">
            <IconSearch size={15} />
          </span>
          <input
            className="input input-mono"
            style={{ height: 30, maxWidth: 360 }}
            placeholder="Filter JSON lines…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="text-xs muted" style={{ marginLeft: 8 }}>
            Secret env masked unless granted.
          </span>
        </div>
        <ActionButton size="sm" variant="ghost" onClick={copy}>
          <IconCopy size={14} />
          Copy
        </ActionButton>
      </div>
      <pre className="code-block" style={{ borderRadius: 0, border: "none", maxHeight: "68vh" }}>
        {shown || "// no matching lines"}
      </pre>
    </div>
  );
}
