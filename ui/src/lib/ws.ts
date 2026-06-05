// ui/src/lib/ws.ts
// Single WebSocket client per browser tab implementing the ADR-001 envelope.
//
// Responsibilities (per the locked WS contract):
//  - one socket at /api/v1/ws, lazily opened.
//  - generate a unique subId per subscription, route incoming frames by subId.
//  - ack/data/error/end demux to per-subscription handlers.
//  - one-live-stats-rule aware: on error{superseded}+end for a stats subId, the
//    caller's onError/onEnd fire and the sub is dropped silently. The server is the
//    enforcer; the client never assumes it must unsubscribe first.
//  - reconnect with backoff (1s → cap 30s) and RESUBSCRIBE open subscriptions.
//  - send `unsubscribe` when a view closes (sub.close()).

import type {
  WsChannel,
  WsEnvelope,
  WsErrorPayload,
  WsEventsPayload,
  WsExecOutPayload,
  WsExecSubscribePayload,
  WsLogsPayload,
  WsLogsSubscribePayload,
  WsRef,
  WsStatsPayload,
} from "./types";

type AnyPayload =
  | WsStatsPayload
  | WsLogsPayload
  | WsEventsPayload
  | WsExecOutPayload
  | WsErrorPayload
  | null;

export interface SubHandlers<P = AnyPayload> {
  onAck?: () => void;
  onData?: (payload: P, frame: WsEnvelope<P>) => void;
  onError?: (err: WsErrorPayload) => void;
  onEnd?: () => void;
}

export interface SubscribeArgs {
  channel: WsChannel;
  hostId: string;
  ref?: WsRef;
  // subscribe payload: exec (cmd/tty/container/...) for channel === "exec", or
  // logs options (tail/container) for channel === "logs". Forwarded as-is.
  payload?: WsExecSubscribePayload | WsLogsSubscribePayload | null;
}

export interface Subscription {
  readonly subId: string;
  readonly channel: WsChannel;
  /** send a data frame on this sub (exec stdin / resize). */
  send(payload: unknown): void;
  /** close: emit unsubscribe (if connected) and detach handlers. */
  close(): void;
}

type ConnState = "idle" | "connecting" | "open" | "closed";

interface InternalSub {
  subId: string;
  args: SubscribeArgs;
  handlers: SubHandlers<any>;
  acked: boolean;
  closed: boolean;
}

const WS_PATH = "/api/v1/ws";
const BACKOFF_START = 1000;
const BACKOFF_CAP = 30000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${WS_PATH}`;
}

function genSubId(): string {
  // 16 random bytes hex; crypto if available.
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

class CastorWsClient {
  private socket: WebSocket | null = null;
  private state: ConnState = "idle";
  private subs = new Map<string, InternalSub>();
  private backoff = BACKOFF_START;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private stateListeners = new Set<(open: boolean) => void>();

  /** Subscribe to a channel. Opens the socket if needed. */
  subscribe(args: SubscribeArgs, handlers: SubHandlers<any>): Subscription {
    const subId = genSubId();
    const sub: InternalSub = { subId, args, handlers, acked: false, closed: false };
    this.subs.set(subId, sub);

    this.ensureOpen();
    if (this.state === "open") {
      this.sendSubscribe(sub);
    }

    return {
      subId,
      channel: args.channel,
      send: (payload: unknown) => this.sendData(subId, args.channel, payload),
      close: () => this.closeSub(subId),
    };
  }

  onStateChange(fn: (open: boolean) => void): () => void {
    this.stateListeners.add(fn);
    fn(this.state === "open");
    return () => this.stateListeners.delete(fn);
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  private emitState(open: boolean): void {
    for (const fn of this.stateListeners) fn(open);
  }

  private ensureOpen(): void {
    if (this.state === "open" || this.state === "connecting") return;
    this.connect();
  }

  private connect(): void {
    this.intentionalClose = false;
    this.state = "connecting";
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.state = "open";
      this.backoff = BACKOFF_START;
      this.emitState(true);
      // (Re)subscribe all open subs.
      for (const sub of this.subs.values()) {
        if (!sub.closed) {
          sub.acked = false;
          this.sendSubscribe(sub);
        }
      }
    };

    socket.onmessage = (ev) => this.onMessage(ev);

    socket.onclose = () => {
      this.state = "closed";
      this.socket = null;
      this.emitState(false);
      if (!this.intentionalClose && this.subs.size > 0) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onclose will follow; nothing to do here.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, BACKOFF_CAP);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subs.size > 0) this.connect();
    }, delay);
  }

  private writeFrame(frame: WsEnvelope): void {
    if (this.socket && this.state === "open") {
      try {
        this.socket.send(JSON.stringify(frame));
      } catch {
        /* dropped; reconnect will resync */
      }
    }
  }

  private sendSubscribe(sub: InternalSub): void {
    const frame: WsEnvelope = {
      v: 1,
      type: "subscribe",
      channel: sub.args.channel,
      subId: sub.subId,
      hostId: sub.args.hostId,
      ref: sub.args.ref,
      // Forward the subscribe payload for exec (cmd/tty/container) and logs
      // (tail/container); the other channels carry no subscribe payload.
      payload:
        sub.args.channel === "exec" || sub.args.channel === "logs"
          ? sub.args.payload ?? null
          : null,
    };
    this.writeFrame(frame);
  }

  private sendData(subId: string, channel: WsChannel, payload: unknown): void {
    const sub = this.subs.get(subId);
    if (!sub || sub.closed) return;
    this.writeFrame({
      v: 1,
      type: "data",
      channel,
      subId,
      hostId: sub.args.hostId,
      payload: payload as any,
    });
  }

  private closeSub(subId: string): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    sub.closed = true;
    this.writeFrame({ v: 1, type: "unsubscribe", subId });
    this.subs.delete(subId);
    // Close the socket entirely if no subs remain (keeps the tab tidy; reopens lazily).
    if (this.subs.size === 0) {
      this.intentionalClose = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.socket) {
        try {
          this.socket.close(1000, "no active subscriptions");
        } catch {
          /* ignore */
        }
      }
      this.socket = null;
      this.state = "idle";
    }
  }

  private onMessage(ev: MessageEvent): void {
    let frame: WsEnvelope<AnyPayload>;
    try {
      frame = JSON.parse(typeof ev.data === "string" ? ev.data : "") as WsEnvelope<AnyPayload>;
    } catch {
      return;
    }
    if (!frame || frame.v !== 1 || !frame.subId) return;

    const sub = this.subs.get(frame.subId);
    if (!sub) return;

    switch (frame.type) {
      case "ack":
        sub.acked = true;
        sub.handlers.onAck?.();
        break;
      case "data":
        sub.handlers.onData?.(frame.payload as any, frame as WsEnvelope<any>);
        break;
      case "error":
        sub.handlers.onError?.((frame.payload as WsErrorPayload) ?? { code: "unknown", message: "" });
        // The server typically follows a stats `superseded` error with an `end`;
        // we keep the sub registered until the end frame removes it.
        break;
      case "end":
        sub.handlers.onEnd?.();
        sub.closed = true;
        this.subs.delete(frame.subId);
        break;
      default:
        break;
    }
  }

  /** Hard shutdown — used on logout. */
  shutdown(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subs.clear();
    if (this.socket) {
      try {
        this.socket.close(1000, "client shutdown");
      } catch {
        /* ignore */
      }
    }
    this.socket = null;
    this.state = "idle";
  }
}

// Single shared client per tab.
export const wsClient = new CastorWsClient();

/* -------- typed convenience subscribe helpers -------- */

export function subscribeStats(
  hostId: string,
  ref: WsRef,
  handlers: SubHandlers<WsStatsPayload>,
): Subscription {
  return wsClient.subscribe({ channel: "stats", hostId, ref }, handlers);
}

export function subscribeLogs(
  hostId: string,
  ref: WsRef,
  handlers: SubHandlers<WsLogsPayload>,
  payload?: WsLogsSubscribePayload,
): Subscription {
  return wsClient.subscribe({ channel: "logs", hostId, ref, payload: payload ?? null }, handlers);
}

export function subscribeEvents(hostId: string, handlers: SubHandlers<WsEventsPayload>): Subscription {
  return wsClient.subscribe({ channel: "events", hostId }, handlers);
}

export function subscribeExec(
  hostId: string,
  ref: WsRef,
  payload: WsExecSubscribePayload,
  handlers: SubHandlers<WsExecOutPayload>,
): Subscription {
  return wsClient.subscribe({ channel: "exec", hostId, ref, payload }, handlers);
}
