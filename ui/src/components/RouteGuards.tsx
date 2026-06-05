// ui/src/components/RouteGuards.tsx
//
// Route protection. RequireAuth enforces a fully authenticated session
// (amr === "pwd+totp" when the user has TOTP, otherwise "pwd" suffices) before
// rendering the app shell. RequirePerm renders a 403 panel if the user lacks a
// permission (defense-in-depth UX; backend is authoritative).

import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { LoadingFill } from "./Spinner";
import { EmptyState } from "./EmptyState";
import { IconLock } from "./icons";
import { canAny } from "../lib/rbac";

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "loading") {
    return (
      <div className="auth-screen">
        <LoadingFill label="Loading session…" />
      </div>
    );
  }
  if (auth.status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  // Authenticated at pwd but TOTP enrollment requires a second factor.
  if (auth.needsTotp && auth.amr === "pwd") {
    return <Navigate to="/totp" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export function RequirePerm({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { permissions } = useAuth();
  if (!canAny(permissions, anyOf)) {
    return (
      <div className="page">
        <EmptyState
          icon={<IconLock size={36} />}
          title="Access denied"
          message="You do not have permission to view this section. Contact an administrator if you believe this is an error."
        />
      </div>
    );
  }
  return <>{children}</>;
}
