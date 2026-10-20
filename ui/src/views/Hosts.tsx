// ui/src/views/Hosts.tsx
//
// Registered hosts list with status + capability chips. Each card shows
// status, owned providers, capability chips, and live summary counts.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHosts, useProviders, useHost } from "../lib/hooks";
import { api } from "../lib/api";
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
  const [creating, setCreating] = useState(false);
  const [hostName, setHostName] = useState("");
  const [enrollment, setEnrollment] = useState<{ hostId: string; hostName: string; enrollmentToken: string } | null>(null);
  const [operationError, setOperationError] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [downloadedArch, setDownloadedArch] = useState<"amd64" | "arm64" | null>(null);
  const [agentArch, setAgentArch] = useState<"amd64" | "arm64">("amd64");
  const [agentChecksum, setAgentChecksum] = useState("");

  const enroll = async () => {
    setOperationError("");
    try {
      const result = await api.createAgentHost(hostName.trim());
      setEnrollment({ hostId: result.hostId, hostName: result.name, enrollmentToken: result.enrollmentToken });
      setHostName("");
      setCreating(false);
      await hostsQ.refetch();
    } catch {
      setOperationError(t("agent.error"));
    }
  };

  const enrollmentCommand = enrollment
    ? `${downloadedArch === agentArch && agentChecksum ? `echo '${agentChecksum}'  castor-agent-linux-${agentArch} | sha256sum -c -\n` : `# ${t("agent.downloadFirst")}\n`}sudo install -o root -g root -m 0750 ./castor-agent-linux-${agentArch} /usr/local/bin/castor-agent\nsudo install -d -o root -g root -m 0700 /var/lib/castor-agent\nsudo /usr/local/bin/castor-agent -server wss://${window.location.host}/api/v1/agent/ws -state /var/lib/castor-agent/identity.json`
    : "";

  const downloadAgent = async () => {
    setDownloadError(false);
    try {
      const blob = await api.downloadAgent(agentArch);
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      setAgentChecksum(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
      setDownloadedArch(agentArch);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `castor-agent-linux-${agentArch}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadError(false);
    } catch {
      setDownloadError(true);
    }
  };

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
            <ActionButton onClick={() => { setCreating(true); setOperationError(""); }}>{t("agent.add")}</ActionButton>
            <HelpButton topic="dashboard" />
          </div>
        }
      />

      {operationError ? <div className="card-body text-sm" role="alert" style={{ color: "var(--danger)" }}>{operationError}</div> : null}

      {creating ? (
        <section className="card" style={{ marginBottom: "var(--sp-4)" }} aria-label={t("agent.add")}>
          <div className="card-body col">
            <label className="col text-sm">{t("agent.name")}
              <input value={hostName} maxLength={128} onChange={(event) => setHostName(event.target.value)} autoFocus />
            </label>
            <div className="row">
              <ActionButton disabled={!hostName.trim()} onClick={() => void enroll()}>{t("agent.add")}</ActionButton>
              <ActionButton variant="ghost" onClick={() => setCreating(false)}>{t("agent.close")}</ActionButton>
            </div>
          </div>
        </section>
      ) : null}

      {enrollment ? (
        <section className="card" style={{ marginBottom: "var(--sp-4)" }} aria-label={t("agent.enrollmentReady")}>
          <div className="card-body col">
            <strong>{t("agent.enrollmentReady")}</strong>
            <span className="text-sm secondary">{t("agent.tokenWarning")}</span>
            {downloadError ? <span className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{t("agent.error")}</span> : null}
            <div className="row">
              <label className="text-sm">{t("agent.architecture")}
                <select value={agentArch} onChange={(event) => setAgentArch(event.target.value as "amd64" | "arm64")}>
                  <option value="amd64">Linux amd64</option>
                  <option value="arm64">Linux arm64</option>
                </select>
              </label>
              <ActionButton onClick={() => void downloadAgent()}>{t("agent.download")}</ActionButton>
            </div>
            <label className="col text-sm">{t("agent.token")}
              <input type="password" readOnly value={enrollment.enrollmentToken} onFocus={(event) => event.currentTarget.select()} autoComplete="off" />
            </label>
            <label className="col text-sm">{t("agent.command")}
              <textarea readOnly rows={4} value={enrollmentCommand} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="row">
              <ActionButton onClick={() => {
                void navigator.clipboard.writeText(enrollment.enrollmentToken)
                  .then(() => setCopied(true))
                  .catch(() => setOperationError(t("agent.error")));
              }}>{copied ? t("agent.copied") : t("agent.copyToken")}</ActionButton>
              <ActionButton onClick={() => {
                void navigator.clipboard.writeText(enrollmentCommand).catch(() => setOperationError(t("agent.error")));
              }}>{t("agent.copy")}</ActionButton>
              <ActionButton variant="ghost" onClick={() => { setEnrollment(null); setCopied(false); }}>{t("agent.close")}</ActionButton>
            </div>
          </div>
        </section>
      ) : null}

      {hosts.length === 0 ? (
        <EmptyState icon={<IconHosts size={40} />} title={t("empty.title")} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "var(--sp-4)" }}>
          {hosts.map((h) => (
            <HostCard key={h.id} host={h} providers={providers} onRevoked={() => hostsQ.refetch()} onError={() => setOperationError(t("agent.error"))} />
          ))}
        </div>
      )}
    </div>
  );
}

function HostCard({ host, providers, onRevoked, onError }: { host: HostSummaryEntry; providers: ProviderInfo[]; onRevoked: () => void; onError: () => void }) {
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
        {host.connection === "remote-agent" ? (
          <div className="text-sm secondary" role="note">
            {t(host.status === "pending" ? "agent.pendingHost" : host.status === "connected" ? "agent.connectedHost" : "agent.offlineHost")}
          </div>
        ) : null}
        {host.connection === "remote-agent" && host.agentVersion ? (
          <div className="text-sm secondary" role="note">
            {t("agent.version", { version: host.agentVersion })}
          </div>
        ) : null}
        {host.connection === "remote-agent" && host.agentUpdateAvailable ? (
          <div className="text-sm secondary" role="status">
            {t("agent.updateAvailable", { version: host.currentAgentVersion || "—" })}
          </div>
        ) : null}
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
            disabled={host.status !== "connected" || host.providerIds.length === 0}
            onClick={() => {
              setSelectedHost(host.id);
              navigate("/workloads");
            }}
          >
            <IconExternal size={14} />
            {t("action.openWorkloads")}
          </ActionButton>
          {host.connection === "remote-agent" ? (
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!window.confirm(t("agent.revokeConfirm"))) return;
                void api.revokeAgentHost(host.id).then(onRevoked).catch(onError);
              }}
            >
              {t("agent.revoke")}
            </ActionButton>
          ) : null}
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
