// ui/src/views/workload/TerminalTab.tsx
//
// Terminal tab (Docker only, perm docker.container.exec). Lets the user pick a
// shell, then opens a WS `exec` subscription wired into the xterm Terminal.
// The subscription is created via a memoized `connect` callback so the Terminal
// mounts once per session.

import { useCallback, useMemo, useState } from "react";
import { subscribeExec } from "../../lib/ws";
import { Terminal } from "../../components/Terminal";
import { ActionButton } from "../../components/ActionButton";
import { IconTerminal } from "../../components/icons";
import type { WsRefKind } from "../../lib/types";

interface Props {
  hostId: string;
  workloadId: string;
  refKind: WsRefKind;
  // K8s multi-container pods: selectable container names (spec.containers[].name).
  // Empty for Docker/Swarm and single-container pods — the picker is then hidden
  // and the provider's default/first container is used.
  containers: string[];
}

const SHELLS = [
  { label: "/bin/sh", cmd: ["/bin/sh"] },
  { label: "/bin/bash", cmd: ["/bin/bash"] },
  { label: "/bin/ash", cmd: ["/bin/ash"] },
];

export function TerminalTab({ hostId, workloadId, refKind, containers }: Props) {
  const [shellIdx, setShellIdx] = useState(0);
  const [containerIdx, setContainerIdx] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [started, setStarted] = useState(false);
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);

  const shell = SHELLS[shellIdx]!;
  // Only K8s pods with >1 container expose a picker; otherwise stream the default.
  const showContainerPicker = refKind === "pod" && containers.length > 1;
  const container = showContainerPicker ? (containers[containerIdx] ?? "") : "";

  const connect = useCallback(
    (handlers: {
      onData: (p: any) => void;
      onAck: () => void;
      onError: (msg: string) => void;
      onEnd: () => void;
    }) => {
      return subscribeExec(
        hostId,
        { kind: refKind, id: workloadId },
        { cmd: shell.cmd, tty: true, env: [], workingDir: "", container },
        {
          onAck: handlers.onAck,
          onData: handlers.onData,
          onError: (err) => handlers.onError(err.message || err.code),
          onEnd: handlers.onEnd,
        },
      );
    },
    // capture the chosen shell/container/session at start time
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId, workloadId, refKind, sessionKey],
  );

  // Terminal memoized so it mounts once per session key.
  const term = useMemo(
    () => (
      <Terminal
        key={sessionKey}
        connect={connect}
        onExit={(code) => {
          setExitCode(code);
          setStarted(false);
        }}
      />
    ),
    [connect, sessionKey],
  );

  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      <div className="row-wrap" style={{ gap: "var(--sp-2)" }}>
        {showContainerPicker ? (
          <>
            <span className="text-sm muted">Container</span>
            <select
              className="select"
              style={{ width: 180 }}
              value={containerIdx}
              onChange={(e) => setContainerIdx(Number(e.target.value))}
              disabled={started}
            >
              {containers.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <span className="text-sm muted">Shell</span>
        <select
          className="select"
          style={{ width: 160 }}
          value={shellIdx}
          onChange={(e) => setShellIdx(Number(e.target.value))}
          disabled={started}
        >
          {SHELLS.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        {!started ? (
          <ActionButton
            variant="primary"
            onClick={() => {
              setExitCode(undefined);
              setSessionKey((k) => k + 1);
              setStarted(true);
            }}
          >
            <IconTerminal size={15} />
            Open session
          </ActionButton>
        ) : (
          <ActionButton variant="ghost" onClick={() => setSessionKey((k) => k + 1)}>
            Restart session
          </ActionButton>
        )}
        <span className="spacer" />
        {exitCode !== undefined ? (
          <span className="text-xs muted">
            Last session exited{exitCode === null ? "" : ` (code ${exitCode})`}
          </span>
        ) : null}
      </div>

      {started || sessionKey > 0 ? (
        term
      ) : (
        <div
          className="center-fill"
          style={{
            minHeight: 320,
            background: "var(--bg-inset)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <IconTerminal size={36} />
          <span className="text-sm muted">Pick a shell and open an interactive session.</span>
        </div>
      )}
    </div>
  );
}
