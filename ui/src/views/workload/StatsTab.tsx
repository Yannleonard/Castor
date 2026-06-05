// ui/src/views/workload/StatsTab.tsx
//
// Stats tab: opens EXACTLY ONE live WS `stats` subscription. The server enforces
// the one-live-stats-per-session rule — when another stats sub opens elsewhere,
// this one receives error{superseded}+end and we surface a quiet notice rather
// than crashing. Switching workloads relies on server superseded handling.
//
// k8s workloads never reach this tab (CapStats unset → tab hidden upstream).

import { useEffect, useRef, useState } from "react";
import { subscribeStats } from "../../lib/ws";
import { StatsChart } from "../../components/StatsChart";
import { formatBytes, formatPct, formatRate } from "../../lib/format";
import type { WsRefKind, WsStatsPayload } from "../../lib/types";

interface Props {
  hostId: string;
  workloadId: string;
  refKind: WsRefKind;
}

const WINDOW = 60; // samples retained (~1/sec → 60s)

export function StatsTab({ hostId, workloadId, refKind }: Props) {
  const [cpu, setCpu] = useState<number[]>([]);
  const [mem, setMem] = useState<number[]>([]);
  const [latest, setLatest] = useState<WsStatsPayload | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "superseded" | "error" | "ended">(
    "connecting",
  );
  const [errMsg, setErrMsg] = useState("");
  const supersededRef = useRef(false);

  useEffect(() => {
    supersededRef.current = false;
    setStatus("connecting");
    setErrMsg("");
    setCpu([]);
    setMem([]);
    setLatest(null);

    const sub = subscribeStats(
      hostId,
      { kind: refKind, id: workloadId },
      {
        onAck: () => setStatus("live"),
        onData: (p) => {
          setLatest(p);
          setCpu((prev) => trim([...prev, p.cpuPct]));
          setMem((prev) => trim([...prev, p.memPct]));
        },
        onError: (err) => {
          if (err.code === "superseded") {
            supersededRef.current = true;
            setStatus("superseded");
          } else {
            setStatus("error");
            setErrMsg(err.message || err.code);
          }
        },
        onEnd: () => {
          if (!supersededRef.current) setStatus((s) => (s === "error" ? s : "ended"));
        },
      },
    );
    return () => sub.close();
  }, [hostId, workloadId, refKind]);

  return (
    <div className="col" style={{ gap: "var(--sp-4)" }}>
      {status === "superseded" ? (
        <div className="banner warning">
          Live stats were taken over by another workload (one live stream per session). Reopen this tab to
          resume here.
        </div>
      ) : null}
      {status === "error" ? <div className="banner danger">Stats stream error: {errMsg}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--sp-4)" }}>
        <div className="card card-pad">
          <StatsChart
            data={cpu}
            color="var(--accent)"
            max={undefined}
            label="CPU"
            valueLabel={latest ? formatPct(latest.cpuPct) : "—"}
          />
        </div>
        <div className="card card-pad">
          <StatsChart
            data={mem}
            color="var(--success)"
            max={100}
            label="Memory"
            valueLabel={latest ? formatPct(latest.memPct) : "—"}
          />
        </div>
      </div>

      <div className="card card-pad">
        <div className="kv-grid">
          <Metric label="CPU" value={latest ? formatPct(latest.cpuPct) : "—"} />
          <Metric
            label="Memory"
            value={latest ? `${formatBytes(latest.memUsed)} / ${formatBytes(latest.memLimit)}` : "—"}
          />
          <Metric label="Net RX" value={latest ? formatRate(latest.netRx) : "—"} />
          <Metric label="Net TX" value={latest ? formatRate(latest.netTx) : "—"} />
          <Metric label="Block read" value={latest ? formatRate(latest.blkRead) : "—"} />
          <Metric label="Block write" value={latest ? formatRate(latest.blkWrite) : "—"} />
        </div>
      </div>

      <div className="text-xs muted">
        Status:{" "}
        <span style={{ color: status === "live" ? "var(--success)" : "var(--text-secondary)" }}>{status}</span>{" "}
        · one live stats stream per session (server-enforced).
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="text-xs muted">{label}</span>
      <span className="mono" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function trim(arr: number[]): number[] {
  return arr.length > WINDOW ? arr.slice(arr.length - WINDOW) : arr;
}
