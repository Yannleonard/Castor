// ui/src/views/workload/OverviewTab.tsx
//
// Overview tab: normalized workload header fields plus labels and ports. Also
// shows a one-shot stats snapshot (REST) for Docker so the overview has numbers
// without opening the live stream.

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { StateBadge } from "../../components/StateBadge";
import { OrchestratorBadge } from "../../components/OrchestratorBadge";
import { ProtectedTag } from "../../components/ProtectedTag";
import { formatBytes, formatDateTime, formatPct, timeAgo } from "../../lib/format";
import type { Capability, StatSample, WorkloadDetail } from "../../lib/types";
import { gateStats } from "../../lib/rbac";

interface Props {
  hostId: string;
  detail: WorkloadDetail;
  caps: Capability[] | undefined;
  permissions: string[] | undefined;
}

export function OverviewTab({ hostId, detail, caps, permissions }: Props) {
  const [stat, setStat] = useState<StatSample | null>(null);
  const statsAllowed = gateStats(caps, permissions).allowed;

  useEffect(() => {
    if (!statsAllowed) return;
    let alive = true;
    api
      .statsOnce(hostId, detail.id)
      .then((s) => alive && setStat(s))
      .catch(() => {
        /* snapshot is best-effort */
      });
    return () => {
      alive = false;
    };
  }, [hostId, detail.id, statsAllowed]);

  const labels = Object.entries(detail.labels ?? {});

  return (
    <div className="col" style={{ gap: "var(--sp-5)" }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Overview</span>
          <div className="row">
            <OrchestratorBadge kind={detail.kind} readonly={caps?.includes("readonly")} />
            {detail.protected ? <ProtectedTag /> : null}
          </div>
        </div>
        <div className="card-body">
          <dl className="dl">
            <dt>State</dt>
            <dd>
              <StateBadge state={detail.state} raw={detail.stateRaw} />
              {detail.stateRaw ? <span className="text-xs muted" style={{ marginLeft: 8 }}>{detail.stateRaw}</span> : null}
            </dd>
            <dt>ID</dt>
            <dd className="mono">{detail.id}</dd>
            <dt>Image</dt>
            <dd className="mono">{detail.image || "—"}</dd>
            <dt>Node</dt>
            <dd>{detail.node || "—"}</dd>
            <dt>Provider</dt>
            <dd className="mono">{detail.providerId}</dd>
            {detail.group ? (
              <>
                <dt>Stack / group</dt>
                <dd>
                  <span className="chip">{detail.group}</span>
                </dd>
              </>
            ) : null}
            <dt>Created</dt>
            <dd>
              {formatDateTime(detail.createdAt)} <span className="text-xs muted">({timeAgo(detail.createdAt)})</span>
            </dd>
          </dl>
        </div>
      </div>

      {detail.ports && detail.ports.length ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Ports</span>
          </div>
          <div className="card-body">
            <div className="row-wrap">
              {detail.ports.map((p, i) => (
                <span key={i} className="chip chip-mono">
                  {p.public ? `${p.public} → ` : ""}
                  {p.private}/{p.protocol}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {statsAllowed ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Resource snapshot</span>
            <span className="text-xs muted">one-shot</span>
          </div>
          <div className="card-body">
            <div className="kv-grid">
              <Snap label="CPU" value={stat ? formatPct(stat.cpuPercent) : "—"} />
              <Snap
                label="Memory"
                value={stat ? `${formatBytes(stat.memUsageBytes)} / ${formatBytes(stat.memLimitBytes)}` : "—"}
              />
              <Snap label="Net RX" value={stat ? formatBytes(stat.netRxBytes) : "—"} />
              <Snap label="Net TX" value={stat ? formatBytes(stat.netTxBytes) : "—"} />
              <Snap label="Block read" value={stat ? formatBytes(stat.blkReadBytes) : "—"} />
              <Snap label="Block write" value={stat ? formatBytes(stat.blkWriteBytes) : "—"} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Labels</span>
          <span className="text-xs muted">{labels.length}</span>
        </div>
        <div className="card-body">
          {labels.length === 0 ? (
            <span className="muted text-sm">No labels.</span>
          ) : (
            <div className="col" style={{ gap: "var(--sp-1)" }}>
              {labels.map(([k, v]) => (
                <div key={k} className="row" style={{ gap: "var(--sp-2)", alignItems: "baseline" }}>
                  <span className="mono text-xs" style={{ color: "var(--text-link)" }}>
                    {k}
                  </span>
                  <span className="mono text-xs muted">=</span>
                  <span className="mono text-xs secondary truncate">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Snap({ label, value }: { label: string; value: string }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="text-xs muted">{label}</span>
      <span className="mono" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
