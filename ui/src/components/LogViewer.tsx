// ui/src/components/LogViewer.tsx
//
// Virtualized log viewer. Holds a ring buffer of lines (stdout/stderr colored),
// supports a follow (auto-scroll) toggle and a client-side substring filter.
// Lines are fed in via the `lines` prop (the parent owns the WS subscription).

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { IconSearch, IconDownload } from "./icons";

export interface LogLine {
  seq: number;
  stream: "stdout" | "stderr";
  line: string;
  ts?: string;
}

interface Props {
  lines: LogLine[];
  follow: boolean;
  onToggleFollow: (v: boolean) => void;
  /** connection status badge text */
  status?: ReactNodeLike;
  onClear?: () => void;
  height?: number;
}

type ReactNodeLike = string | null;

const ROW_H = 18;
const OVERSCAN = 12;

export function LogViewer({ lines, follow, onToggleFollow, status, onClear, height = 480 }: Props) {
  const [filter, setFilter] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedBottom = useRef(true);

  const filtered = useMemo(() => {
    if (!filter.trim()) return lines;
    const f = filter.toLowerCase();
    return lines.filter((l) => l.line.toLowerCase().includes(f));
  }, [lines, filter]);

  // auto-scroll to bottom when following and new lines arrive.
  useEffect(() => {
    if (follow && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered.length, follow]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 2;
    pinnedBottom.current = atBottom;
    // if the user scrolls up, stop following automatically.
    if (!atBottom && follow) onToggleFollow(false);
  };

  const total = filtered.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visible = Math.ceil(height / ROW_H) + OVERSCAN * 2;
  const end = Math.min(total, start + visible);
  const padTop = start * ROW_H;
  const padBottom = (total - end) * ROW_H;

  const download = () => {
    const text = lines.map((l) => l.line).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-header" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
        <div className="row" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: "var(--text-muted)" }}>
            <IconSearch size={15} />
          </span>
          <input
            className="input input-mono"
            style={{ height: 30, maxWidth: 320 }}
            placeholder="Filter log lines…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter logs"
          />
          {status ? (
            <span className="chip" style={{ marginLeft: "var(--sp-2)" }}>
              {status}
            </span>
          ) : null}
          <span className="text-xs muted" style={{ marginLeft: "var(--sp-2)" }}>
            {total.toLocaleString()} {filter ? "matched" : "lines"}
          </span>
        </div>
        <div className="row">
          <label className="checkbox-row">
            <input type="checkbox" checked={follow} onChange={(e) => onToggleFollow(e.target.checked)} />
            <span>Follow</span>
          </label>
          <button className="btn btn-ghost btn-sm btn-icon" title="Download logs" onClick={download}>
            <IconDownload size={15} />
          </button>
          {onClear ? (
            <button className="btn btn-ghost btn-sm" onClick={onClear} title="Clear buffer">
              Clear
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="log-scroll"
        style={{
          height,
          overflow: "auto",
          background: "var(--bg-inset)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-sm)",
          lineHeight: `${ROW_H}px`,
        }}
      >
        {total === 0 ? (
          <div className="center-fill" style={{ minHeight: height }}>
            <span className="text-sm muted">{filter ? "No lines match the filter." : "Waiting for log output…"}</span>
          </div>
        ) : (
          <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
            {filtered.slice(start, end).map((l) => (
              <div
                key={l.seq}
                className={clsx("log-line")}
                style={{
                  height: ROW_H,
                  whiteSpace: "pre",
                  padding: "0 var(--sp-4)",
                  color: l.stream === "stderr" ? "var(--danger)" : "var(--text-on-accent)",
                }}
              >
                {l.ts ? <span style={{ color: "var(--text-on-accent)", opacity: 0.55 }}>{l.ts} </span> : null}
                {l.line || " "}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
