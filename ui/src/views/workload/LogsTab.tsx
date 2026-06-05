// ui/src/views/workload/LogsTab.tsx
//
// Logs tab: opens a WS `logs` subscription (follow), demuxed into the LogViewer.
// On mount it also fetches the recent tail via the one-shot REST endpoint so the
// view isn't empty before the stream warms up. Multiple logs subs are allowed
// (scoped to open views); the sub closes on unmount.

import { useEffect, useRef, useState } from "react";
import { subscribeLogs } from "../../lib/ws";
import { api } from "../../lib/api";
import { LogViewer, type LogLine } from "../../components/LogViewer";
import { toastError } from "../../lib/toast";
import type { WsRefKind } from "../../lib/types";

interface Props {
  hostId: string;
  workloadId: string;
  refKind: WsRefKind;
  // K8s multi-container pods: selectable container names (spec.containers[].name).
  // Empty for Docker/Swarm and single-container pods — the picker is then hidden
  // and the provider's default/first container is streamed.
  containers: string[];
}

const MAX_LINES = 5000;

export function LogsTab({ hostId, workloadId, refKind, containers }: Props) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [containerIdx, setContainerIdx] = useState(0);
  const seqRef = useRef(0);

  // Only K8s pods with >1 container expose a picker; otherwise stream the default.
  const showContainerPicker = refKind === "pod" && containers.length > 1;
  const container = showContainerPicker ? (containers[containerIdx] ?? "") : "";

  const append = (incoming: LogLine[]) => {
    setLines((prev) => {
      const next = prev.concat(incoming);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  };

  // initial tail via REST one-shot. Reset on a container switch so the backlog
  // belongs to the newly selected container before the WS stream warms up.
  useEffect(() => {
    let alive = true;
    setLines([]);
    seqRef.current = 0;
    api
      .logsOnce(hostId, workloadId, { tail: 200, timestamps: false, container })
      .then((text) => {
        if (!alive || !text) return;
        const initial = text
          .split("\n")
          .filter((l) => l.length > 0)
          .map<LogLine>((line) => ({ seq: ++seqRef.current, stream: "stdout", line }));
        append(initial);
      })
      .catch(() => {
        /* tail is best-effort; WS will provide live output */
      });
    return () => {
      alive = false;
    };
  }, [hostId, workloadId, container]);

  // live follow via WS
  useEffect(() => {
    setError("");
    const sub = subscribeLogs(
      hostId,
      { kind: refKind, id: workloadId },
      {
        onAck: () => setConnected(true),
        onData: (payload) => {
          append([{ seq: ++seqRef.current, stream: payload.stream, line: payload.line }]);
        },
        onError: (err) => {
          setError(err.message || err.code);
          setConnected(false);
          if (err.code === "forbidden" || err.code === "unsupported") {
            toastError("Logs", new Error(err.message || err.code));
          }
        },
        onEnd: () => setConnected(false),
      },
      container ? { container } : undefined,
    );
    return () => sub.close();
  }, [hostId, workloadId, refKind, container]);

  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      {showContainerPicker ? (
        <div className="row-wrap" style={{ gap: "var(--sp-2)" }}>
          <span className="text-sm muted">Container</span>
          <select
            className="select"
            style={{ width: 180 }}
            value={containerIdx}
            onChange={(e) => setContainerIdx(Number(e.target.value))}
          >
            {containers.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {error ? (
        <div className="banner danger">
          Log stream error: {error}
        </div>
      ) : null}
      <LogViewer
        lines={lines}
        follow={follow}
        onToggleFollow={setFollow}
        onClear={() => setLines([])}
        status={connected ? "streaming" : "connecting…"}
      />
    </div>
  );
}
