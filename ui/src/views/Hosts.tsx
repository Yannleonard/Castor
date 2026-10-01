// Castor by IT Leonard
// ui/src/views/Hosts.tsx
//
// Registered hosts list with status + capability chips. V1 has a single "local"
// host exposing up to three providers (docker/swarm/kubernetes). Each card shows
// status, the providers it owns, capability chips, and live summary counts.

import { useNavigate } from "react-router-dom";
import { useHosts, useProviders, useHost } from "../lib/hooks";
import { useHostStore } from "../lib/hostStore";
import { PageHeader } from "../components/PageHeader";
import { StatusDot } from "../components/StatusDot";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { LoadingFill } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { ActionButton } from "../components/ActionButton";
import { HelpButton } from "../components/HelpButton";
import { IconHosts, IconRefresh, IconExternal } from "../components/icons";
import { useT } from "../i18n";
import { hostsDict } from "../i18n/locales/hosts";
import type { Capability, HostSummaryEntry, ProviderInfo } from "../lib/types";

export function Hosts() {
  const t = useT(hostsDict);
  const hostsQ = useHosts();
  const providersQ = useProviders();

  if (hostsQ.isLoading) return <LoadingFill label={t("header.loading")} />;

  const hosts = hostsQ.data ?? [];
  const providers = providersQ.data ?? [];

  return (
    <div className="page">
      <PageHeader
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => hostsQ.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="dashboard" />
          </div>
        }
      />

      {hosts.length === 0 ? (
        <EmptyState icon={<IconHosts size={40} />} title={t("empty.title")} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "var(--sp-4)" }}>
          {hosts.map((h) => (
            <HostCard key={h.id} host={h} providers={providers} />
          ))}
        </div>
      )}
    </div>
  );
}

function HostCard({ host, providers }: { host: HostSummaryEntry; providers: ProviderInfo[] }) {
  const t = useT(hostsDict);
  const navigate = useNavigate();
  const setSelectedHost = useHostStore((s) => s.setSelectedHost);
  const detailQ = useHost(host.id);
  const s = detailQ.data?.summary;
  // Engine capacity/inventory (CPU/RAM/OS/engine). Prefer the detail payload,
  // fall back to the list payload so the card fills in as soon as either arrives.
  const e = detailQ.data?.engine ?? host.engine ?? null;

  const owned = providers.filter((p) => host.providerIds.includes(p.id));

  const statusLabel =
    host.status === "connected" ? t("status.connected") : host.status === "pending" ? t("status.pending") : t("status.down");

  return (
    <div className="card">
      <div className="card-header">
        <div className="row" style={{ gap: "var(--sp-3)" }}>
          <StatusDot hostStatus={host.status} />
          <div className="col" style={{ gap: 0 }}>
            <span className="card-title">{host.name}</span>
            <span className="text-xs muted mono">{host.connection}</span>
          </div>
        </div>
        <span
          className="pill"
          style={{
            color: host.status === "connected" ? "var(--success)" : host.status === "down" ? "var(--danger)" : "var(--state-pending)",
            background: "transparent",
            borderColor: "var(--border-strong)",
          }}
        >
          {statusLabel}
          {host.degraded ? ` · ${t("status.degraded")}` : ""}
        </span>
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-4)" }}>
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">{t("section.orchestrators")}</span>
          <div className="row-wrap">
            {owned.map((p) => (
              <OrchestratorBadge key={p.id} kind={p.kind} readonly={p.capabilities.includes("readonly")} />
            ))}
            {owned.length === 0 ? <span className="muted text-sm">{t("section.orchestratorsNone")}</span> : null}
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">{t("section.capabilities")}</span>
          <div className="row-wrap" style={{ gap: 4 }}>
            {unionCaps(owned).map((c) => (
              <span key={c} className="chip text-xs" title={t("chip.capability", { name: c })}>
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">{t("section.system")}</span>
          <div className="kv-grid">
            <Counter label={t("sys.cpu")} value={e ? `${e.ncpu} vCPU` : "—"} />
            <Counter label={t("sys.memory")} value={e ? fmtBytes(e.memTotalBytes) : "—"} />
            <Counter label={t("sys.engine")} value={e?.engineVersion ? `v${e.engineVersion}` : "—"} />
            <Counter label={t("sys.api")} value={e?.apiVersion ? `v${e.apiVersion}` : "—"} />
            <Counter label={t("sys.os")} value={e?.osType || "—"} />
            <Counter label={t("sys.arch")} value={e?.architecture || "—"} />
            <Counter label={t("sys.kernel")} value={e?.kernelVersion || "—"} />
            <Counter label={t("sys.hostname")} value={e?.name || "—"} />
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">{t("section.summary")}</span>
          <div className="kv-grid">
            <Counter label={t("summary.containers")} value={s ? `${s.running}/${s.containers}` : "—"} />
            <Counter label={t("summary.images")} value={s ? s.images : "—"} />
            <Counter label={t("summary.networks")} value={s ? s.networks : "—"} />
            <Counter label={t("summary.volumes")} value={s ? s.volumes : "—"} />
            <Counter label={t("summary.swarmTasks")} value={s ? s.swarmTasks : "—"} />
            <Counter label={t("summary.k8sPods")} value={s ? s.k8sPods : "—"} />
          </div>
        </div>

        <div className="row">
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedHost(host.id);
              navigate("/workloads");
            }}
          >
            <IconExternal size={14} />
            {t("action.openWorkloads")}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function unionCaps(providers: ProviderInfo[]): Capability[] {
  const set = new Set<Capability>();
  for (const p of providers) for (const c of p.capabilities) set.add(c);
  return Array.from(set);
}

// fmtBytes renders a byte count as a human-readable binary size (e.g. 128 GB).
function fmtBytes(n: number): string {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function Counter({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="text-xs muted">{label}</span>
      <span className="mono" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
