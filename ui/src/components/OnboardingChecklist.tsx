// ui/src/components/OnboardingChecklist.tsx
//
// "Getting started" card shown at the top of the Dashboard until every step
// is complete (then it hides itself for good) or the user dismisses it.
// Completion is derived from data the Dashboard already keeps warm (metrics,
// providers) plus light one-shot lookups (stacks, users — the latter fetched
// only when the caller may list users). Dismissal persists in localStorage.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDashboardMetrics, useProviders, useStacks, qk } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { IconCheck } from "./icons";
import type { UserRecord } from "../lib/types";

const DISMISS_KEY = "castor.onboarding.dismissed";

interface Step {
  key: string;
  label: string;
  to: string;
  done: boolean;
}

export function OnboardingChecklist() {
  const hostId = useSelectedHost();
  const { user, can } = useAuth();

  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  const canReadUsers = can("rbac.user.read");
  const canReadStacks = can("docker.container.read");

  // Metrics/providers share their cache with the Dashboard queries; stacks and
  // users are fetched once (no polling) and only while the card is visible.
  const metricsQ = useDashboardMetrics(hostId, { enabled: !dismissed });
  const providersQ = useProviders({ enabled: !dismissed });
  const stacksQ = useStacks(hostId, {
    enabled: !dismissed && canReadStacks,
    refetchInterval: false,
    staleTime: 60_000,
  });
  const usersQ = useQuery<UserRecord[]>({
    queryKey: qk.users,
    queryFn: () => api.users(),
    enabled: !dismissed && canReadUsers,
    staleTime: 60_000,
  });

  const steps: Step[] = [
    {
      key: "totp",
      label: "Secure your account with 2FA",
      to: "/profile",
      done: !!user?.totpEnabled,
    },
    {
      key: "deploy",
      label: "Deploy your first app from the Marketplace",
      to: "/marketplace",
      done: (metricsQ.data?.containers.total ?? 0) > 0,
    },
    {
      key: "stack",
      label: "Create a stack (compose)",
      to: "/stacks",
      done: (stacksQ.data ?? []).length > 0,
    },
    {
      key: "team",
      label: "Invite your team & assign roles",
      to: "/users",
      done: canReadUsers && (usersQ.data ?? []).length > 1,
    },
    {
      key: "orchestrator",
      label: "Connect Swarm or Kubernetes",
      to: "/swarm",
      done: (providersQ.data ?? []).some(
        (p) => p.kind === "swarm" || p.kind === "kubernetes",
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // Once every step is complete, the card never comes back.
  useEffect(() => {
    if (allDone) localStorage.setItem(DISMISS_KEY, "1");
  }, [allDone]);

  if (dismissed || allDone) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="row" style={{ gap: "var(--sp-3)" }}>
          <span className="card-title">Getting started</span>
          <span className="text-xs muted">
            {doneCount} of {steps.length} done
          </span>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
      <div className="card-body onboard-list">
        {steps.map((s) => (
          <div key={s.key} className="onboard-item">
            <span
              className={s.done ? "onboard-check done" : "onboard-check"}
              aria-hidden="true"
            >
              {s.done ? <IconCheck size={11} /> : null}
            </span>
            {s.done ? (
              <span className="muted">{s.label}</span>
            ) : (
              <Link to={s.to}>{s.label}</Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
