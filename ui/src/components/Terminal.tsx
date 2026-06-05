// ui/src/components/Terminal.tsx
//
// xterm.js terminal wired to the WS `exec` channel (Docker only). The parent
// supplies an open Subscription; this component:
//   - renders xterm with the FitAddon and brand colors,
//   - writes server `data` chunks (stdout/stderr) into the terminal,
//   - sends keystrokes as exec stdin data frames,
//   - sends resize frames on fit,
//   - shows the exit code and disables input when the stream ends.
//
// Exec data.payload (server→client): {stream, data} for output; a final
// {exitCode} data frame precedes the `end`. Client→server stdin:
// {payload:{stdin:"<utf8>"}}, resize: {payload:{resize:{rows,cols}}}.

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Subscription } from "../lib/ws";
import type { WsExecOutPayload } from "../lib/types";

interface Props {
  /** factory creating the exec subscription; called once on mount with handlers. */
  connect: (handlers: {
    onData: (p: WsExecOutPayload) => void;
    onAck: () => void;
    onError: (msg: string) => void;
    onEnd: () => void;
  }) => Subscription;
  onExit?: (code: number | null) => void;
  height?: number;
}

const TERM_THEME = {
  background: "#061320", // --bg-inset
  foreground: "#E6EEF6",
  cursor: "#2496ED",
  cursorAccent: "#061320",
  selectionBackground: "rgba(36,150,237,0.35)",
  black: "#0A2540",
  red: "#E5484D",
  green: "#13A688",
  yellow: "#E0A106",
  blue: "#2496ED",
  magenta: "#9B6DE0",
  cyan: "#4FB0FF",
  white: "#A8BED4",
  brightBlack: "#6E8AA6",
  brightWhite: "#E6EEF6",
};

export function Terminal({ connect, onExit, height = 460 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const subRef = useRef<Subscription | null>(null);
  const exitedRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      fontFamily: 'var(--font-mono), "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: TERM_THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      /* ignore early fit */
    }
    termRef.current = term;
    fitRef.current = fit;

    term.writeln("\x1b[38;5;245mConnecting to container shell…\x1b[0m");

    const sub = connect({
      onAck: () => {
        term.writeln("\x1b[38;5;245mConnected. Type 'exit' to close.\x1b[0m\r\n");
        sendResize();
        term.focus();
      },
      onData: (p) => {
        if (typeof p.exitCode === "number") {
          exitedRef.current = true;
          term.writeln(`\r\n\x1b[38;5;245m[process exited with code ${p.exitCode}]\x1b[0m`);
          onExit?.(p.exitCode);
          return;
        }
        if (p.data) {
          // server always base64-encodes stdout (ws.go exec goroutine). Decode to
          // raw bytes and let xterm decode UTF-8 — passing the Latin-1 byte-string
          // from atob() directly would mojibake multi-byte sequences.
          const bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0));
          term.write(bytes);
        }
      },
      onError: (msg) => {
        term.writeln(`\r\n\x1b[31m[exec error] ${msg}\x1b[0m`);
      },
      onEnd: () => {
        if (!exitedRef.current) {
          term.writeln("\r\n\x1b[38;5;245m[session closed]\x1b[0m");
          onExit?.(null);
        }
      },
    });
    subRef.current = sub;

    const sendResize = () => {
      const s = subRef.current;
      if (!s || exitedRef.current) return;
      s.send({ resize: { rows: term.rows, cols: term.cols } });
    };

    const dataDisp = term.onData((data) => {
      if (exitedRef.current) return;
      subRef.current?.send({ stdin: data });
    });

    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      sendResize();
    };
    const ro = new ResizeObserver(onResize);
    if (hostRef.current) ro.observe(hostRef.current);
    window.addEventListener("resize", onResize);

    return () => {
      dataDisp.dispose();
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      subRef.current?.close();
      subRef.current = null;
      term.dispose();
      termRef.current = null;
    };
    // connect is stable per-mount (parent memoizes); deliberate single-run effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      style={{
        height,
        background: "var(--bg-inset)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--sp-2)",
      }}
    />
  );
}
