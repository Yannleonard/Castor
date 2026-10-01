// Castor by IT Leonard
// ui/src/views/workload/OverviewTab.tsx
//
// Overview tab: normalized workload header fields plus labels, ports and
// networks. Also shows a one-shot stats snapshot (REST) for Docker so the
// overview has numbers without opening the live stream.
//
// The Networks card lists every network the workload is attached to. For
// Docker containers it also offers connect / disconnect, gated per ADR-002 on
// CapNetworks + docker.network.connect / docker.network.disconnect and on the
// protected flag (the backend refuses to rewire protected containers). A
// container pinned to an exclusive network mode (host, none, or another
// container's namespace) gets neither button: the daemon refuses to rewire it,
// so the card explains why instead. Swarm and k8s workloads get the read-only
// list, or no card when it is empty.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useNetworks, qk } from "../../lib/hooks";
import { StateBadge } from "../../components/StateBadge";
import { OrchestratorBadge } from "../../components/OrchestratorBadge";
import { ProtectedTag } from "../../components/ProtectedTag";
import { ActionButton } from "../../components/ActionButton";
import { CapabilityGate } from "../../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../../components/ConfirmDestructiveDialog";
import { Modal } from "../../components/Modal";
import { TextField, SelectField } from "../../components/Field";
import { IconPlus } from "../../components/icons";
import { cleanName, formatBytes, formatDateTime, formatPct, timeAgo } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import type { Capability, StatSample, WorkloadDetail, WorkloadNetwork } from "../../lib/types";
import { gateStats } from "../../lib/rbac";
import { useT } from "../../i18n";
import { wlOverviewTabDict } from "../../i18n/locales/wlOverviewTab";
import { commonDict } from "../../i18n/locales/common";

// host and none are exclusive network modes chosen at create time, not
// endpoints a running container can be connected to.
const UNCONNECTABLE_NETWORKS = new Set(["host", "none"]);
// HostConfig.NetworkMode prefix of a container sharing another container's
// network namespace.
const CONTAINER_MODE_PREFIX = "container:";
// The engine's default bridge refuses static addresses (409
// static_ip_unsupported), so the field is disabled up front for it.
const DEFAULT_BRIDGE = "bridge";
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const ALIAS_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const EMPTY_NETWORKS: WorkloadNetwork[] = [];

interface Props {
  hostId: string;
  detail: WorkloadDetail;
  caps: Capability[] | undefined;
  permissions: string[] | undefined;
}

export function OverviewTab({ hostId, detail, caps, permissions }: Props) {
  const t = useT(wlOverviewTabDict);
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
          <span className="card-title">{t("card.overview")}</span>
          <div className="row">
            <OrchestratorBadge kind={detail.kind} readonly={caps?.includes("readonly")} />
            {detail.protected ? <ProtectedTag /> : null}
          </div>
        </div>
        <div className="card-body">
          <dl className="dl">
            <dt>{t("field.state")}</dt>
            <dd>
              <StateBadge state={detail.state} raw={detail.stateRaw} />
              {detail.stateRaw ? <span className="text-xs muted" style={{ marginLeft: 8 }}>{detail.stateRaw}</span> : null}
            </dd>
            <dt>{t("field.id")}</dt>
            <dd className="mono">{detail.id}</dd>
            <dt>{t("field.image")}</dt>
            <dd className="mono">{detail.image || "—"}</dd>
            <dt>{t("field.node")}</dt>
            <dd>{detail.node || "—"}</dd>
            <dt>{t("field.provider")}</dt>
            <dd className="mono">{detail.providerId}</dd>
            {detail.group ? (
              <>
                <dt>{t("field.group")}</dt>
                <dd>
                  <span className="chip">{detail.group}</span>
                </dd>
              </>
            ) : null}
            <dt>{t("field.created")}</dt>
            <dd>
              {formatDateTime(detail.createdAt)} <span className="text-xs muted">({timeAgo(detail.createdAt)})</span>
            </dd>
          </dl>
        </div>
      </div>

      {detail.ports && detail.ports.length ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t("card.ports")}</span>
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

      <NetworksCard hostId={hostId} detail={detail} caps={caps} />

      {statsAllowed ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t("card.snapshot")}</span>
            <span className="text-xs muted">{t("card.snapshotCaption")}</span>
          </div>
          <div className="card-body">
            <div className="kv-grid">
              <Snap label={t("snap.cpu")} value={stat ? formatPct(stat.cpuPercent) : "—"} />
              <Snap
                label={t("snap.memory")}
                value={stat ? `${formatBytes(stat.memUsageBytes)} / ${formatBytes(stat.memLimitBytes)}` : "—"}
              />
              <Snap label={t("snap.netRx")} value={stat ? formatBytes(stat.netRxBytes) : "—"} />
              <Snap label={t("snap.netTx")} value={stat ? formatBytes(stat.netTxBytes) : "—"} />
              <Snap label={t("snap.blockRead")} value={stat ? formatBytes(stat.blkReadBytes) : "—"} />
              <Snap label={t("snap.blockWrite")} value={stat ? formatBytes(stat.blkWriteBytes) : "—"} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <span className="card-title">{t("card.labels")}</span>
          <span className="text-xs muted">{labels.length}</span>
        </div>
        <div className="card-body">
          {labels.length === 0 ? (
            <span className="muted text-sm">{t("empty.labels")}</span>
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

/* ===================== Networks card ===================== */

// dockerNetworkMode reads HostConfig.NetworkMode off a Docker inspect document
// (WorkloadDetail.raw, a marshaled ContainerJSON). Undefined when raw is not
// container-shaped or the mode is unset.
function dockerNetworkMode(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const hostConfig = (raw as { HostConfig?: unknown }).HostConfig;
  if (!hostConfig || typeof hostConfig !== "object") return undefined;
  const mode = (hostConfig as { NetworkMode?: unknown }).NetworkMode;
  return typeof mode === "string" && mode !== "" ? mode : undefined;
}

// exclusiveNetworkMode names the network mode that pins a container to a
// namespace it cannot leave ("host", "none" or "container"), for which the
// daemon refuses every connect and disconnect. Undefined for a bridge-style
// container. The attachment list is the fallback when the raw document does
// not carry the mode: a host/none container is attached to exactly that one
// pseudo-network.
function exclusiveNetworkMode(detail: WorkloadDetail, networks: WorkloadNetwork[]): string | undefined {
  const mode = dockerNetworkMode(detail.raw);
  if (mode && UNCONNECTABLE_NETWORKS.has(mode)) return mode;
  if (mode?.startsWith(CONTAINER_MODE_PREFIX)) return "container";
  if (networks.length === 1 && UNCONNECTABLE_NETWORKS.has(networks[0].name)) return networks[0].name;
  return undefined;
}

interface NetworksCardProps {
  hostId: string;
  detail: WorkloadDetail;
  caps: Capability[] | undefined;
}

function NetworksCard({ hostId, detail, caps }: NetworksCardProps) {
  const t = useT(wlOverviewTabDict);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<WorkloadNetwork | null>(null);

  const networks = detail.networks ?? EMPTY_NETWORKS;
  // Only standalone Docker containers can be rewired; other kinds are read-only.
  const interactive = detail.kind === "docker";
  if (!interactive && networks.length === 0) return null;

  // A host/none/container-mode container can neither join nor leave a
  // network, so the buttons are dropped rather than left to fail server-side.
  const exclusiveMode = interactive ? exclusiveNetworkMode(detail, networks) : undefined;
  const rewirable = interactive && !exclusiveMode;

  const hasCap = !!caps?.includes("networks");
  const canConnect = hasCap && !detail.protected && can("docker.network.connect");
  const canDisconnect = hasCap && !detail.protected && can("docker.network.disconnect");
  const gateReason = (action: "connect" | "disconnect") =>
    !hasCap
      ? t("gate.noNetworks")
      : detail.protected
        ? t("gate.protected")
        : action === "connect"
          ? t("gate.needConnect")
          : t("gate.needDisconnect");

  // An attachment change touches the detail (addresses, aliases), the list
  // rows (networkNames, ipAddress) and the networks' container counts.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.workload(hostId, detail.id) });
    queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
    queryClient.invalidateQueries({ queryKey: qk.networks(hostId) });
  };

  const doDisconnect = async () => {
    if (!disconnectTarget) return;
    try {
      await api.networkDisconnect(hostId, disconnectTarget.networkId || disconnectTarget.name, {
        containerId: detail.id,
      });
      toast.success(t("toast.disconnectedTitle"), disconnectTarget.name);
      invalidate();
    } catch (err) {
      toastError(t("toast.disconnectFailed"), err);
      throw err;
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{t("card.networks")}</span>
        <div className="row">
          <span className="text-xs muted">{networks.length}</span>
          {rewirable ? (
            <CapabilityGate allowed={canConnect} reason={gateReason("connect")}>
              {(allowed, reason) => (
                <ActionButton
                  size="sm"
                  variant="ghost"
                  disabled={!allowed}
                  tooltip={allowed ? undefined : reason}
                  onClick={() => setConnectOpen(true)}
                >
                  <IconPlus size={14} />
                  {t("action.connect")}
                </ActionButton>
              )}
            </CapabilityGate>
          ) : null}
        </div>
      </div>
      <div className="card-body">
        {networks.length === 0 ? (
          <span className="muted text-sm">{t("empty.networks")}</span>
        ) : (
          <div className="col" style={{ gap: "var(--sp-3)" }}>
            {networks.map((n, i) => (
              <NetworkRow
                key={n.networkId || n.name}
                net={n}
                divider={i > 0}
                action={
                  rewirable ? (
                    <CapabilityGate allowed={canDisconnect} reason={gateReason("disconnect")}>
                      {(allowed, reason) => (
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          disabled={!allowed}
                          tooltip={allowed ? undefined : reason}
                          onClick={() => setDisconnectTarget(n)}
                          style={allowed ? { color: "var(--danger)" } : undefined}
                        >
                          {t("action.disconnect")}
                        </ActionButton>
                      )}
                    </CapabilityGate>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
        {exclusiveMode ? (
          <div className="banner info" role="note" style={{ marginTop: "var(--sp-3)" }}>
            {t("net.exclusiveMode", { mode: exclusiveMode })}
          </div>
        ) : null}
      </div>

      <ConfirmDestructiveDialog
        open={!!disconnectTarget}
        title={t("disconnect.title")}
        variant="danger"
        confirmLabel={t("disconnect.confirm")}
        description={
          <>
            {t("disconnect.question")} <strong className="mono">{cleanName(detail.name)}</strong> {t("disconnect.from")}{" "}
            <strong className="mono">{disconnectTarget?.name}</strong>
            {t("disconnect.hint")}
          </>
        }
        onConfirm={doDisconnect}
        onClose={() => setDisconnectTarget(null)}
      />

      {connectOpen ? (
        <ConnectNetworkModal
          hostId={hostId}
          detail={detail}
          attached={networks}
          onClose={() => setConnectOpen(false)}
          onConnected={invalidate}
        />
      ) : null}
    </div>
  );
}

interface NetworkRowProps {
  net: WorkloadNetwork;
  divider: boolean;
  action?: ReactNode;
}

function NetworkRow({ net, divider, action }: NetworkRowProps) {
  const t = useT(wlOverviewTabDict);
  return (
    <div
      className="row"
      style={{
        gap: "var(--sp-3)",
        alignItems: "flex-start",
        paddingTop: divider ? "var(--sp-3)" : undefined,
        borderTop: divider ? "1px solid var(--border)" : undefined,
      }}
    >
      <div className="col" style={{ gap: "var(--sp-1)", flex: "1 1 auto", minWidth: 0 }}>
        <div className="row-wrap">
          <span style={{ fontWeight: 600 }}>{net.name}</span>
          {net.ipv4 ? <span className="mono text-sm">{net.ipv4}</span> : null}
          {net.ipv6 ? <span className="mono text-xs secondary">{net.ipv6}</span> : null}
          {!net.ipv4 && !net.ipv6 ? <span className="text-xs muted">{t("net.noAddress")}</span> : null}
        </div>
        {net.gateway || net.mac ? (
          <div className="row-wrap text-xs muted">
            {net.gateway ? (
              <span>
                {t("net.gateway")} <span className="mono">{net.gateway}</span>
              </span>
            ) : null}
            {net.mac ? <span className="mono">{net.mac}</span> : null}
          </div>
        ) : null}
        {net.aliases?.length ? (
          <div className="row-wrap">
            {net.aliases.map((a) => (
              <span key={a} className="chip chip-mono">
                {a}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ===================== Connect modal ===================== */

interface ConnectNetworkModalProps {
  hostId: string;
  detail: WorkloadDetail;
  attached: WorkloadNetwork[];
  onClose: () => void;
  onConnected: () => void;
}

// Mounted only while open, so the host's network list is fetched on demand
// rather than polled for every workload detail view.
function ConnectNetworkModal({ hostId, detail, attached, onClose, onConnected }: ConnectNetworkModalProps) {
  const t = useT(wlOverviewTabDict);
  const tc = useT(commonDict);
  const query = useNetworks(hostId);
  const [networkId, setNetworkId] = useState("");
  const [ipv4, setIpv4] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);

  // Networks the container can still join: not attached yet and not an
  // exclusive network mode.
  const candidates = useMemo(() => {
    const ids = new Set(attached.map((n) => n.networkId).filter((id): id is string => !!id));
    const names = new Set(attached.map((n) => n.name));
    return (query.data ?? [])
      .filter((n) => !ids.has(n.id) && !names.has(n.name) && !UNCONNECTABLE_NETWORKS.has(n.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data, attached]);

  const selected = candidates.find((n) => n.id === networkId);
  // The Go side marshals a nil slice as null despite the string[] contract.
  const subnets = selected?.subnets ?? [];
  const isDefaultBridge = selected?.name === DEFAULT_BRIDGE;
  // A static address needs a user-defined network with a configured subnet.
  const staticIpAllowed = !!selected && !isDefaultBridge && subnets.length > 0;
  const ipv4Value = staticIpAllowed ? ipv4.trim() : "";
  const ipv4Ok = ipv4Value === "" || IPV4_RE.test(ipv4Value);
  const aliasList = aliases
    .split(/[,\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  const aliasesOk = aliasList.every((a) => ALIAS_RE.test(a));
  const valid = !!selected && ipv4Ok && aliasesOk;

  const ipv4Hint = !selected
    ? undefined
    : isDefaultBridge
      ? t("connect.ipv4Bridge")
      : subnets.length === 0
        ? t("connect.ipv4NoSubnet")
        : t("connect.ipv4Hint", { subnets: subnets.join(", ") });

  const submit = async () => {
    if (!selected || !valid) return;
    setBusy(true);
    try {
      await api.networkConnect(hostId, selected.id, {
        containerId: detail.id,
        ipv4: ipv4Value || undefined,
        aliases: aliasList.length ? aliasList : undefined,
      });
      toast.success(t("toast.connectedTitle"), selected.name);
      onConnected();
      onClose();
    } catch (err) {
      toastError(t("toast.connectFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t("connect.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {tc("cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("connect.submit")}
          </ActionButton>
        </>
      }
    >
      {query.isLoading ? (
        <span className="muted text-sm">{t("connect.loading")}</span>
      ) : query.isError ? (
        <span className="text-sm" style={{ color: "var(--danger)" }}>
          {t("connect.loadFailed")}
        </span>
      ) : candidates.length === 0 ? (
        <span className="muted text-sm">{t("connect.noCandidates")}</span>
      ) : (
        <div className="col" style={{ gap: "var(--sp-3)" }}>
          <SelectField label={t("connect.network")} autoFocus value={networkId} onChange={(e) => setNetworkId(e.target.value)}>
            <option value="">{t("connect.networkPlaceholder")}</option>
            {candidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({n.driver})
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("connect.ipv4")}
            mono
            placeholder={t("connect.ipv4Placeholder")}
            value={staticIpAllowed ? ipv4 : ""}
            onChange={(e) => setIpv4(e.target.value)}
            disabled={!staticIpAllowed}
            hint={ipv4Hint}
            error={ipv4Value && !ipv4Ok ? t("connect.ipv4Error") : undefined}
          />
          <TextField
            label={t("connect.aliases")}
            mono
            placeholder={t("connect.aliasesPlaceholder")}
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            hint={t("connect.aliasesHint")}
            error={aliases.trim() && !aliasesOk ? t("connect.aliasesError") : undefined}
          />
        </div>
      )}
    </Modal>
  );
}
