// ui/src/lib/toast.ts — tiny zustand toast store.
import { create } from "zustand";
import { ApiError } from "./api";
import { t as translate } from "../i18n";
import { errorsDict } from "../i18n/locales/errors";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  /** auto-dismiss ms; 0 = sticky */
  ttl: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let seq = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `t${++seq}`;
    const toast: Toast = { ttl: 4500, ...t, id };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (toast.ttl > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      }, toast.ttl);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helpers usable outside React. */
export const toast = {
  success: (title: string, message?: string) =>
    useToastStore.getState().push({ kind: "success", title, message }),
  error: (title: string, message?: string) =>
    useToastStore.getState().push({ kind: "error", title, message, ttl: 7000 }),
  info: (title: string, message?: string) =>
    useToastStore.getState().push({ kind: "info", title, message }),
  warning: (title: string, message?: string) =>
    useToastStore.getState().push({ kind: "warning", title, message }),
};

/** Map an unknown error (likely ApiError) to a user-facing toast. Known error
 *  codes get a localized, actionable message; any other code falls back to the
 *  server-supplied message so nothing is ever hidden. */
export function toastError(prefix: string, err: unknown): void {
  if (err instanceof ApiError) {
    // Localize by machine code when we have a phrasing for it; otherwise keep the
    // server message. `translate` returns the key itself when the code is absent,
    // which lets us detect "no localized entry" and fall back.
    const localized = translate(errorsDict, err.code);
    const body = localized !== err.code ? localized : err.message;
    toast.error(prefix, `${body}${err.requestId ? ` (req ${err.requestId})` : ""}`);
  } else if (err instanceof Error) {
    toast.error(prefix, err.message);
  } else {
    toast.error(prefix, String(err));
  }
}
