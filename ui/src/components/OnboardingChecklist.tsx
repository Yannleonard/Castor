// Castor by IT Leonard
// ui/src/components/OnboardingChecklist.tsx
//
// "Getting started" card shown at the top of the Dashboard until every step
// is complete (then it hides itself for good) or the user dismisses it.
// Completion is derived from data the Dashboard already keeps warm (metrics,
// providers) plus light one-shot lookups (stacks, users, TLS status — the
// last two fetched only when the caller may read them). Dismissal persists in
// localStorage.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDashboardMetrics, useProviders, useStacks, useTlsStatus, qk } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { IconCheck } from "./icons";
import { useT } from "../i18n";
import { onboardingDict } from "../i18n/locales/onboarding";
import type { UserRecord } from "../lib/types";

const DISMISS_KEY = "castor.onboarding.dismissed";

interface Step {
  key: string;
  labelKey: string;
  to: string;
  done: boolean;
}

export function OnboardingChecklist() {
  const t = useT(onboardingDict);
  const hostId = useSelectedHost();
  const { user, can } = useAuth();

  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  const canReadUsers = can("rbac.user.read");
  const canReadStacks = can("docker.container.read");
  const canReadSettings = can("settings.read");

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
  // Shares its cache with the Settings card; one-shot here (no poll).
  const tlsQ = useTlsStatus({
    enabled: !dismissed && canReadSettings,
    refetchInterval: false,
    staleTime: 60_000,
  });

  const steps: Step[] = [
    {
      key: "totp",
      labelKey: "step.totp",
      to: "/profile",
      done: !!user?.totpEnabled,
    },
    {
      // Done once visitors get a browser-trusted certificate: an imported one
      // or Let's Encrypt actually serving (effectiveMode, not the configured
      // mode — a pending ACME issuance still serves the self-signed default).
      // "off" counts too: HTTPS is then terminated by a reverse proxy that
      // carries its own certificate, and there is nothing to do in Castor.
      key: "tls",
      labelKey: "step.tls",
      to: "/settings",
      done:
        tlsQ.data?.effectiveMode === "custom" ||
        tlsQ.data?.effectiveMode === "acme" ||
        tlsQ.data?.effectiveMode === "off",
    },
    {
      key: "deploy",
      labelKey: "step.deploy",
      to: "/marketplace",
      done: (metricsQ.data?.containers.total ?? 0) > 0,
    },
    {
      key: "stack",
      labelKey: "step.stack",
      to: "/stacks",
      done: (stacksQ.data ?? []).length > 0,
    },
    {
      key: "team",
      labelKey: "step.team",
      to: "/users",
      done: canReadUsers && (usersQ.data ?? []).length > 1,
    },
    {
      key: "orchestrator",
      labelKey: "step.orchestrator",
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
          <span className="card-title">{t("header.title")}</span>
          <span className="text-xs muted">
            {t("header.progress", { done: doneCount, total: steps.length })}
          </span>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={dismiss}>
          {t("header.dismiss")}
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
              <span className="muted">{t(s.labelKey)}</span>
            ) : (
              <Link to={s.to}>{t(s.labelKey)}</Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
