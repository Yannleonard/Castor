// ui/src/lib/version.ts
//
// The version shown in the UI comes from the SERVER (`/api/v1/healthz`), which
// is stamped at build time from the git tag, so the footer can never drift from
// the running binary. package.json only provides the pre-fetch fallback.
import { useQuery } from "@tanstack/react-query";
import pkg from "../../package.json";
import { api } from "./api";

const FALLBACK = (pkg as { version?: string }).version ?? "0.0.0";

function display(v: string): string {
  return v.startsWith("v") ? v : `v${v}`;
}

export const version = {
  ui: FALLBACK,
  short: display(FALLBACK),
};

/** Server build version ("v1.3.1"); falls back to the UI package version until
 *  healthz has answered. Cached for the session — it cannot change at runtime. */
export function useServerVersion(): string {
  const q = useQuery({
    queryKey: ["healthz", "version"],
    queryFn: () => api.healthz(),
    staleTime: Infinity,
    retry: 1,
  });
  return display(q.data?.version || FALLBACK);
}
