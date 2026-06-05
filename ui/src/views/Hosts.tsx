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
import { IconHosts, IconRefresh, IconExternal } from "../components/icons";
import type { Capability, HostSummaryEntry, ProviderInfo } from "../lib/types";

export function Hosts() {
  const hostsQ = useHosts();
  const providersQ = useProviders();

  if (hostsQ.isLoading) return <LoadingFill label="Loading hosts…" />;

  const hosts = hostsQ.data ?? [];
  const providers = providersQ.data ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Hosts"
        subtitle="Connected engines and the orchestrators they expose."
        actions={
          <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => hostsQ.refetch()}>
            <IconRefresh size={16} />
          </ActionButton>
        }
      />

      {hosts.length === 0 ? (
        <EmptyState icon={<IconHosts size={40} />} title="No hosts registered" />
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
  const navigate = useNavigate();
  const setSelectedHost = useHostStore((s) => s.setSelectedHost);
  const detailQ = useHost(host.id);
  const s = detailQ.data?.summary;
  // Engine capacity/inventory (CPU/RAM/OS/engine). Prefer the detail payload,
  // fall back to the list payload so the card fills in as soon as either arrives.
  const e = detailQ.data?.engine ?? host.engine ?? null;

  const owned = providers.filter((p) => host.providerIds.includes(p.id));

  const statusLabel =
    host.status === "connected" ? "Connected" : host.status === "pending" ? "Pending" : "Down";

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
          {host.degraded ? " · degraded" : ""}
        </span>
      </div>
      <div className="card-body col" style={{ gap: "var(--sp-4)" }}>
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">Orchestrators</span>
          <div className="row-wrap">
            {owned.map((p) => (
              <OrchestratorBadge key={p.id} kind={p.kind} readonly={p.capabilities.includes("readonly")} />
            ))}
            {owned.length === 0 ? <span className="muted text-sm">None</span> : null}
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">Capabilities</span>
          <div className="row-wrap" style={{ gap: 4 }}>
            {unionCaps(owned).map((c) => (
              <span key={c} className="chip text-xs" title={`capability: ${c}`}>
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">System</span>
          <div className="kv-grid">
            <Counter label="CPU" value={e ? `${e.ncpu} vCPU` : "—"} />
            <Counter label="Memory" value={e ? fmtBytes(e.memTotalBytes) : "—"} />
            <Counter label="Engine" value={e?.engineVersion ? `v${e.engineVersion}` : "—"} />
            <Counter label="API" value={e?.apiVersion ? `v${e.apiVersion}` : "—"} />
            <Counter label="OS" value={e?.osType || "—"} />
            <Counter label="Arch" value={e?.architecture || "—"} />
            <Counter label="Kernel" value={e?.kernelVersion || "—"} />
            <Counter label="Hostname" value={e?.name || "—"} />
          </div>
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="text-xs muted">Summary</span>
          <div className="kv-grid">
            <Counter label="Containers" value={s ? `${s.running}/${s.containers}` : "—"} />
            <Counter label="Images" value={s ? s.images : "—"} />
            <Counter label="Networks" value={s ? s.networks : "—"} />
            <Counter label="Volumes" value={s ? s.volumes : "—"} />
            <Counter label="Swarm tasks" value={s ? s.swarmTasks : "—"} />
            <Counter label="K8s pods" value={s ? s.k8sPods : "—"} />
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
            Open workloads
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
