// ui/src/views/Dashboard.tsx
//
// BI dashboard for the selected host: a row of KPI tiles (running containers,
// CPU%, memory, images, volumes, networks) over a grid of Recharts cards
// (container-state donut, top-N by CPU / memory, CPU/RAM gauges, orchestrator
// counts) plus the recent-audit feed. KPI/aggregate numbers come from GET
// /hosts/{id}/dashboard/metrics (useDashboardMetrics); the host list + degraded
// banner come from /hosts; orchestrator availability from /providers; recent
// activity from /audit (only when the caller can read it).

import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { useAuth } from "../lib/auth";
import { useDashboardMetrics, useHosts, useProviders } from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { StatusDot } from "../components/StatusDot";
import { LoadingFill } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import {
  IconWorkloads,
  IconHosts,
  IconImages,
  IconNetworks,
  IconVolumes,
  IconStats,
  IconAudit,
} from "../components/icons";
import { formatBytes, formatPct, timeAgo } from "../lib/format";
import type { AuditResult, DashboardTopContainer } from "../lib/types";

const RESULT_COLOR: Record<AuditResult, string> = {
  success: "var(--success)",
  denied: "var(--warning)",
  error: "var(--danger)",
};

/** Read a chart-palette CSS variable into a concrete hex (so Recharts, which
 *  cannot consume `var(--x)` in SVG fills, gets a real color). */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** State -> palette color, matching the StatusDot --state-* mapping. */
function stateColor(state: string, chart: Record<string, string>): string {
  switch (state) {
    case "running":
      return chart.teal;
    case "paused":
      return chart.amber;
    case "restarting":
      return chart.blue;
    case "pending":
      return chart.violet;
    case "stopped":
    case "unknown":
    default:
      return chart.stopped;
  }
}

export function Dashboard() {
  const navigate = useNavigate();
  const hostId = useSelectedHost();
  const { can, user } = useAuth();

  const hostsQ = useHosts();
  const metricsQ = useDashboardMetrics(hostId);
  const providersQ = useProviders();

  const canAudit = can("audit.read");
  const auditQ = useQuery({
    queryKey: ["audit", "recent"],
    queryFn: () => api.audit({ limit: 8 }),
    enabled: canAudit,
    refetchInterval: 15000,
  });

  // Resolve the chart palette once per render from the design tokens.
  const chart = useMemo(
    () => ({
      blue: cssVar("--chart-1", "#2496ED"),
      teal: cssVar("--chart-2", "#13A688"),
      k8s: cssVar("--chart-3", "#326CE5"),
      beaver: cssVar("--chart-4", "#8B5E3C"),
      violet: cssVar("--chart-5", "#7C6BD0"),
      amber: cssVar("--chart-6", "#E08A00"),
      grid: cssVar("--chart-grid", "#E8EEF6"),
      axis: cssVar("--chart-axis", "#7C93AC"),
      stopped: cssVar("--state-stopped", "#93A6BC"),
      surface: cssVar("--bg-surface", "#FFFFFF"),
      accentSoft: cssVar("--accent-soft", "rgba(36,150,237,0.10)"),
    }),
    [],
  );

  const m = metricsQ.data;
  const anyDegraded = (hostsQ.data ?? []).some((h) => h.degraded || h.status !== "connected");

  if (metricsQ.isLoading && !m) {
    return <LoadingFill label="Loading dashboard…" />;
  }

  const c = m?.containers;
  const stopped = c ? c.stopped : 0;
  const cpuPct = m?.cpu.usedPercent ?? 0;
  const memPct = m?.memory.usedPercent ?? 0;

  // donut data: only states with a positive count.
  const stateData = (m?.stateBreakdown ?? [])
    .filter((b) => b.count > 0)
    .map((b) => ({ state: b.state, count: b.count, color: stateColor(b.state, chart) }));
  const stateTotal = stateData.reduce((acc, d) => acc + d.count, 0);

  return (
    <div className="page">
      <PageHeader
        title={`Welcome back, ${user?.username ?? ""}`.trim()}
        subtitle={`Live analytics for ${hostId}${m?.engine.version ? ` · Docker ${m.engine.version}` : ""}`}
      />

      {anyDegraded ? (
        <div className="banner warning">
          <IconHosts size={16} />
          <span>
            One or more hosts or providers are degraded. Cached data may be stale.{" "}
            <a href="/hosts" onClick={(e) => { e.preventDefault(); navigate("/hosts"); }}>
              Review hosts
            </a>
            .
          </span>
        </div>
      ) : null}

      {/* ---- KPI row ---- */}
      <div className="dash-kpis">
        <Kpi
          label="Running"
          icon={<IconWorkloads size={18} />}
          value={c ? c.running : "—"}
          onClick={() => navigate("/workloads")}
          sub={
            <span className="dash-kpi-sub">
              <span className="dot" style={{ background: "var(--state-stopped)" }} />
              {stopped} stopped · {c ? c.total : 0} total
            </span>
          }
        />
        <Kpi
          label="CPU usage"
          icon={<IconStats size={18} />}
          accent="var(--chart-1)"
          value={
            <>
              {formatPct(cpuPct).replace("%", "")}
              <span className="unit">%</span>
            </>
          }
          sub={
            <span className="dash-kpi-sub">
              across {m?.cpu.cores ?? m?.engine.ncpu ?? 0} cores
            </span>
          }
        />
        <Kpi
          label="Memory used"
          icon={<IconStats size={18} />}
          accent="var(--success)"
          value={formatBytes(m?.memory.usedBytes)}
          sub={
            <span className="dash-kpi-sub">
              {m && m.memory.totalBytes > 0
                ? `${formatPct(memPct)} of ${formatBytes(m.memory.totalBytes)}`
                : "capacity unknown"}
            </span>
          }
        />
        <Kpi
          label="Images"
          icon={<IconImages size={18} />}
          value={m ? m.images : "—"}
          onClick={() => navigate("/images")}
          sub={<span className="dash-kpi-sub">pulled on host</span>}
        />
        <Kpi
          label="Volumes"
          icon={<IconVolumes size={18} />}
          value={m ? m.volumes : "—"}
          onClick={() => navigate("/volumes")}
          sub={<span className="dash-kpi-sub">persistent data</span>}
        />
        <Kpi
          label="Networks"
          icon={<IconNetworks size={18} />}
          value={m ? m.networks : "—"}
          onClick={() => navigate("/networks")}
          sub={<span className="dash-kpi-sub">docker networks</span>}
        />
      </div>

      {/* ---- chart cards ---- */}
      <div className="dash-charts">
        {/* container state donut */}
        <ChartCard title="Container states" hint={`${stateTotal} total`}>
          {stateData.length === 0 ? (
            <EmptyState icon={<IconWorkloads size={28} />} title="No containers" />
          ) : (
            <>
              <div className="dash-chart-frame dash-donut-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stateData}
                      dataKey="count"
                      nameKey="state"
                      cx="50%"
                      cy="50%"
                      innerRadius="62%"
                      outerRadius="92%"
                      paddingAngle={stateData.length > 1 ? 2 : 0}
                      stroke={chart.surface}
                      strokeWidth={2}
                    >
                      {stateData.map((d) => (
                        <Cell key={d.state} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CountTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dash-donut-center">
                  <span className="big">{c ? c.running : 0}</span>
                  <span className="small">running</span>
                </div>
              </div>
              <div className="dash-legend">
                {stateData.map((d) => (
                  <span key={d.state} className="dash-legend-item">
                    <span className="swatch" style={{ background: d.color }} />
                    {d.state} <b>{d.count}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        {/* resource gauges */}
        <ChartCard title="Resource utilization" hint="live sample">
          <div className="dash-gauges">
            <Gauge label="CPU" valueText={formatPct(cpuPct)} pct={cpuPct} cap={100 * (m?.cpu.cores || 1)} color={chart.blue}
              foot={`${m?.cpu.cores ?? 0} cores`} />
            <Gauge label="Memory" valueText={m && m.memory.totalBytes > 0 ? formatPct(memPct) : formatBytes(m?.memory.usedBytes)} pct={memPct} cap={100} color={chart.teal}
              foot={m && m.memory.totalBytes > 0 ? `${formatBytes(m.memory.usedBytes)} / ${formatBytes(m.memory.totalBytes)}` : "limit unknown"} />
          </div>
        </ChartCard>

        {/* top by CPU */}
        <ChartCard title="Top containers by CPU" hint="%">
          <TopBar data={m?.topByCpu ?? []} metric="cpu" color={chart.blue} axis={chart.axis} grid={chart.grid} cursor={chart.accentSoft} />
        </ChartCard>

        {/* top by memory */}
        <ChartCard title="Top containers by memory" hint="bytes">
          <TopBar data={m?.topByMem ?? []} metric="mem" color={chart.teal} axis={chart.axis} grid={chart.grid} cursor={chart.accentSoft} />
        </ChartCard>
      </div>

      {/* ---- orchestrators + recent activity ---- */}
      <div className="dash-split">
        <div className="dash-card">
          <div className="dash-card-head">
            <span className="dash-card-title">Orchestrators</span>
            {m ? (
              <span className="dash-card-hint">
                {m.swarmServices} svc · {m.swarmTasks} tasks · {m.k8sPods} pods
              </span>
            ) : null}
          </div>
          <div className="dash-card-body">
            {providersQ.isLoading ? (
              <LoadingFill />
            ) : (
              <div className="dash-orch">
                {(providersQ.data ?? []).map((p) => (
                  <div key={p.id} className="dash-orch-row">
                    <div className="row" style={{ gap: "var(--sp-2)" }}>
                      <StatusDot color="var(--success)" pulse />
                      <OrchestratorBadge kind={p.kind} readonly={p.capabilities.includes("readonly")} />
                      <span className="text-xs muted mono truncate">{p.id}</span>
                    </div>
                    <span className="dash-orch-count">
                      {p.kind === "swarm"
                        ? (m?.swarmTasks ?? 0)
                        : p.kind === "kubernetes"
                          ? (m?.k8sPods ?? 0)
                          : (m?.containers.running ?? 0)}
                    </span>
                  </div>
                ))}
                {(providersQ.data ?? []).length === 0 ? (
                  <span className="muted text-sm">No orchestrators connected.</span>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-head">
            <span className="dash-card-title">Recent activity</span>
            {canAudit ? (
              <a href="/audit" onClick={(e) => { e.preventDefault(); navigate("/audit"); }} className="text-sm">
                View all
              </a>
            ) : null}
          </div>
          <div className="dash-card-body">
            {!canAudit ? (
              <span className="muted text-sm">You do not have permission to view the audit log.</span>
            ) : auditQ.isLoading ? (
              <LoadingFill />
            ) : (auditQ.data?.items ?? []).length === 0 ? (
              <EmptyState icon={<IconAudit size={32} />} title="No activity yet" />
            ) : (
              <div className="dash-activity">
                {(auditQ.data?.items ?? []).map((a) => (
                  <div key={a.id} className="dash-activity-row">
                    <StatusDot color={RESULT_COLOR[a.result]} />
                    <span className="dash-activity-main">
                      <strong>{a.actorName || a.actorId}</strong>{" "}
                      <span className="muted">·</span> <span className="mono text-xs">{a.action}</span>{" "}
                      {a.targetName ? <span className="muted">→ {a.targetName}</span> : null}
                    </span>
                    <span className="dash-activity-time">{timeAgo(a.tsEpoch)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ small building blocks ============================ */

function Kpi({
  label,
  value,
  sub,
  icon,
  accent = "var(--accent)",
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={onClick ? "dash-kpi is-click" : "dash-kpi"}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="dash-kpi-top">
        <span className="dash-kpi-label">{label}</span>
        {icon ? (
          <span className="dash-kpi-icon" style={{ color: accent, background: "var(--accent-soft)" }}>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="dash-kpi-value">{value}</div>
      {sub ?? <span className="dash-kpi-sub" />}
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <span className="dash-card-title">{title}</span>
        {hint ? <span className="dash-card-hint">{hint}</span> : null}
      </div>
      <div className="dash-card-body">{children}</div>
    </div>
  );
}

function Gauge({
  label,
  valueText,
  pct,
  cap,
  color,
  foot,
}: {
  label: string;
  valueText: string;
  pct: number;
  cap: number;
  color: string;
  foot: string;
}) {
  const width = Math.max(0, Math.min(100, cap > 0 ? (pct / cap) * 100 : 0));
  return (
    <div>
      <div className="dash-gauge-label">
        <span className="name">{label}</span>
        <span className="val">{valueText}</span>
      </div>
      <div className="dash-gauge-track">
        <span className="dash-gauge-fill" style={{ width: `${width}%`, background: color }} />
      </div>
      <div className="dash-gauge-foot">{foot}</div>
    </div>
  );
}

function TopBar({
  data,
  metric,
  color,
  axis,
  grid,
  cursor,
}: {
  data: DashboardTopContainer[];
  metric: "cpu" | "mem";
  color: string;
  axis: string;
  grid: string;
  cursor: string;
}) {
  if (data.length === 0) {
    return <EmptyState icon={<IconStats size={28} />} title="No live samples" />;
  }
  // shorten container names for the y-axis; keep full name for the tooltip.
  const rows = data.map((d) => ({
    name: d.name.length > 18 ? `${d.name.slice(0, 17)}…` : d.name,
    full: d.name,
    value: metric === "cpu" ? d.cpuPercent : d.memBytes,
  }));
  return (
    <div className="dash-chart-frame" style={{ height: Math.max(160, rows.length * 38 + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={grid} />
          <XAxis
            type="number"
            tick={{ fill: axis, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: grid }}
            tickFormatter={(v: number) => (metric === "cpu" ? `${v.toFixed(0)}%` : formatBytes(v, 0))}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fill: axis, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: grid }}
          />
          <Tooltip cursor={{ fill: cursor }} content={<TopTip metric={metric} />} />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ----- tooltips (typed to recharts' TooltipProps) ----- */

function CountTip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!;
  const color = (p.payload as { color?: string }).color ?? "var(--accent)";
  return (
    <div className="dash-tip">
      <div className="dash-tip-name">{p.name}</div>
      <div className="dash-tip-row">
        <span className="swatch" style={{ background: color }} />
        {p.value} container{p.value === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function TopTip({
  active,
  payload,
  metric,
}: TooltipProps<number, string> & { metric: "cpu" | "mem" }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!;
  const row = p.payload as { full: string; value: number };
  return (
    <div className="dash-tip">
      <div className="dash-tip-name">{row.full}</div>
      <div className="dash-tip-row">
        <span className="swatch" style={{ background: (p.color as string) ?? "var(--accent)" }} />
        {metric === "cpu" ? formatPct(row.value) : formatBytes(row.value)}
      </div>
    </div>
  );
}
