// ui/src/lib/auth.tsx
// AuthProvider + useAuth/useMe hooks + CSRF token wiring.
//
// Boot flow: AuthProvider fetches GET /auth/me once on mount. The result drives
// route guards. The csrfToken from /auth/me (and login/totp responses) is stored
// in the api client so mutations carry X-Castor-CSRF.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, setCsrfToken } from "./api";
import { wsClient } from "./ws";
import type { Amr, MeResponse, RoleRef, SessionUser } from "./types";
import { can as canPerm } from "./rbac";

export interface AuthState {
  status: "loading" | "authenticated" | "unauthenticated";
  user: SessionUser | null;
  amr: Amr | null;
  permissions: string[];
  roles: RoleRef[];
  /** True when session has only pwd and TOTP step is pending. */
  needsTotp: boolean;
}

interface AuthContextValue extends AuthState {
  /** Re-fetch /auth/me and refresh cached state + csrf token. */
  refresh: () => Promise<MeResponse | null>;
  /** Apply a freshly minted session (login/totp) without a round-trip. */
  applySession: (me: Partial<MeResponse> & { csrfToken: string }) => void;
  /** Set the pending-TOTP flag (after login returns requiresTotp). */
  setNeedsTotp: (v: boolean) => void;
  /** Clear local state + shut the websocket (used by logout). */
  clear: () => void;
  /** Permission check bound to the current user's permissions. */
  can: (perm: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const INITIAL: AuthState = {
  status: "loading",
  user: null,
  amr: null,
  permissions: [],
  roles: [],
  needsTotp: false,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL);

  const applyMe = useCallback((me: MeResponse) => {
    setCsrfToken(me.csrfToken);
    setState({
      status: "authenticated",
      user: me.user,
      amr: me.amr,
      permissions: me.permissions ?? [],
      roles: me.roles ?? [],
      needsTotp: me.amr === "pwd" && !!me.user.totpEnabled,
    });
  }, []);

  const refresh = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const me = await api.me({ noAuthRedirect: true });
      applyMe(me);
      return me;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setState({ ...INITIAL, status: "unauthenticated" });
      } else {
        // network/other — treat as unauthenticated for routing but keep silent.
        setState({ ...INITIAL, status: "unauthenticated" });
      }
      return null;
    }
  }, [applyMe]);

  const applySession = useCallback(
    (me: Partial<MeResponse> & { csrfToken: string }) => {
      setCsrfToken(me.csrfToken);
      if (me.user && me.amr) {
        setState({
          status: "authenticated",
          user: me.user,
          amr: me.amr,
          permissions: me.permissions ?? [],
          roles: me.roles ?? [],
          needsTotp: me.amr === "pwd" && !!me.user.totpEnabled,
        });
      }
    },
    [],
  );

  const setNeedsTotp = useCallback((v: boolean) => {
    setState((s) => ({ ...s, needsTotp: v }));
  }, []);

  const clear = useCallback(() => {
    setCsrfToken("");
    wsClient.shutdown();
    setState({ ...INITIAL, status: "unauthenticated" });
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const can = useCallback((perm: string) => canPerm(state.permissions, perm), [state.permissions]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, refresh, applySession, setNeedsTotp, clear, can }),
    [state, refresh, applySession, setNeedsTotp, clear, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

/** Convenience: current user (or null). */
export function useMe(): SessionUser | null {
  return useAuth().user;
}

/** Convenience: bound permission checker. */
export function useCan(): (perm: string) => boolean {
  return useAuth().can;
}
