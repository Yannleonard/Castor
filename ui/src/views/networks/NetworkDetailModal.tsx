// Castor by IT Leonard
// ui/src/views/networks/NetworkDetailModal.tsx
//
// Live inspect panel for one network: header facts and flags, the IPAM pools,
// the driver options, the attached containers (running or stopped, each with a
// gated, confirmed disconnect that protected containers never get) and a gated
// "connect a container" form offering the host's docker containers not yet
// attached. Docker's host/none networks take no attachments; the default
// bridge does, but without a static address.

import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { qk, useCapabilityLookup, useNetwork, useWorkloads } from "../../lib/hooks";
import { Modal } from "../../components/Modal";
import { ActionButton } from "../../components/ActionButton";
import { CapabilityGate } from "../../components/CapabilityGate";
import { StateBadge } from "../../components/StateBadge";
import { LoadingFill } from "../../components/Spinner";
import { TextField, SelectField } from "../../components/Field";
import { IconAlert } from "../../components/icons";
import { toast, toastError } from "../../lib/toast";
import { formatDateTime, shortId, timeAgo } from "../../lib/format";
import { useT, t as tr } from "../../i18n";
import { networksDict } from "../../i18n/locales/networks";
import { commonDict } from "../../i18n/locales/common";
import type { NetworkEndpoint, Workload } from "../../lib/types";
import {
  DEFAULT_BRIDGE,
  SYSTEM_NETWORKS,
  buildConnectRequest,
  validateConnectDraft,
  type ConnectDraft,
} from "./validate";

interface Props {
  hostId: string;
  networkId: string;
  onClose: () => void;
}

const EMPTY_WORKLOADS: Workload[] = [];

function emptyConnect(): ConnectDraft {
  return { containerId: "", ipv4: "", aliases: "" };
}

export function NetworkDetailModal({ hostId, networkId, onClose }: Props) {
  const t = useT(networksDict);
  const tc = useT(commonDict);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const hasCap = !!capsForKind("docker")?.includes("networks");
  const canConnect = hasCap && can("docker.network.connect");
  const canDisconnect = hasCap && can("docker.network.disconnect");
  // Castor itself and protected-label containers are never rewired.
  const disconnectReason = (c: NetworkEndpoint) =>
    !hasCap ? t("gate.noNetworks") : c.protected ? t("gate.protectedContainer") : t("gate.needDisconnect");

  const query = useNetwork(hostId, networkId);
  const detail = query.data;
  const isSystem = detail ? SYSTEM_NETWORKS.has(detail.name) : false;
  const isDefaultBridge = detail?.name === DEFAULT_BRIDGE;
  // host/none share the host namespace and refuse attachments; the default
  // bridge accepts them (without a static address).
  const acceptsAttach = !!detail && (!isSystem || isDefaultBridge);

  const workloads = useWorkloads(hostId, { all: true }, { enabled: canConnect && acceptsAttach });

  const [disconnectTarget, setDisconnectTarget] = useState<NetworkEndpoint | null>(null);
  const [force, setForce] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connect, setConnect] = useState<ConnectDraft>(emptyConnect);
  const [connecting, setConnecting] = useState(false);

  const connectErrors = useMemo(() => validateConnectDraft(connect, { isDefaultBridge }), [connect, isDefaultBridge]);
  const describe = (code: string) => t(`validation.${code}`);

  // Docker containers of the host not already on this network. The detail
  // lists every attached container by id, stopped ones included, so the id is
  // the one reliable key (names may differ by a leading slash).
  const candidates = useMemo(() => {
    if (!detail) return EMPTY_WORKLOADS;
    const attached = new Set(detail.containers.map((c) => c.containerId));
    return (workloads.data ?? EMPTY_WORKLOADS)
      .filter((w) => w.kind === "docker" && !attached.has(w.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [detail, workloads.data]);

  const invalidate = () => {
    // The detail key nests under the list key, so one invalidation covers both.
    queryClient.invalidateQueries({ queryKey: qk.networks(hostId) });
    queryClient.invalidateQueries({ queryKey: ["workloads", hostId] });
    // Any open workload detail on this host (its Networks card) is stale too;
    // the key prefix covers every container id.
    queryClient.invalidateQueries({ queryKey: ["workload", hostId] });
  };

  const doConnect = async () => {
    if (!detail || !connectErrors.valid || connecting) return;
    setConnecting(true);
    try {
      await api.networkConnect(hostId, detail.id, buildConnectRequest(connect));
      const container = candidates.find((w) => w.id === connect.containerId)?.name ?? connect.containerId;
      toast.success(
        tr(networksDict, "toast.connectedTitle"),
        tr(networksDict, "toast.connectedBody", { container, network: detail.name }),
      );
      setConnect(emptyConnect());
      invalidate();
    } catch (err) {
      toastError(tr(networksDict, "toast.connectFailed"), err);
    } finally {
      setConnecting(false);
    }
  };

  const doDisconnect = async () => {
    if (!detail || !disconnectTarget || disconnecting) return;
    setDisconnecting(true);
    try {
      await api.networkDisconnect(hostId, detail.id, { containerId: disconnectTarget.containerId, force });
      toast.success(
        tr(networksDict, "toast.disconnectedTitle"),
        tr(networksDict, "toast.disconnectedBody", {
          container: disconnectTarget.name || shortId(disconnectTarget.containerId),
          network: detail.name,
        }),
      );
      setDisconnectTarget(null);
      setForce(false);
      invalidate();
    } catch (err) {
      toastError(tr(networksDict, "toast.disconnectFailed"), err);
    } finally {
      setDisconnecting(false);
    }
  };

  const busy = connecting || disconnecting;
  const options = detail ? Object.entries(detail.options).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <Modal
      open
      wide
      busy={busy}
      title={
        <span className="row" style={{ gap: "var(--sp-2)" }}>
          <span className="mono">{detail?.name ?? t("header.title")}</span>
          {isSystem ? <span className="chip text-xs">{t("badge.system")}</span> : null}
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose} disabled={busy}>
          {tc("close")}
        </button>
      }
    >
      {query.isLoading ? (
        <LoadingFill label={t("detail.loading")} />
      ) : !detail ? (
        <div className="banner danger" style={{ alignItems: "flex-start" }}>
          <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
          <span className="col" style={{ gap: "var(--sp-2)", flex: 1 }}>
            <span>{t("detail.loadFailed")}</span>
            {query.error?.message ? <span className="text-xs muted">{query.error.message}</span> : null}
            <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => query.refetch()}>
              {tc("retry")}
            </button>
          </span>
        </div>
      ) : (
        <div className="col" style={{ gap: "var(--sp-4)" }}>
          <dl className="dl">
            <dt>{t("detail.field.driver")}</dt>
            <dd>
              <span className="chip">{detail.driver}</span>
            </dd>
            <dt>{t("detail.field.scope")}</dt>
            <dd>{detail.scope}</dd>
            <dt>{t("detail.field.id")}</dt>
            <dd className="mono text-xs">{detail.id}</dd>
            <dt>{t("detail.field.created")}</dt>
            <dd>
              {formatDateTime(detail.created)} <span className="text-xs muted">({timeAgo(detail.created)})</span>
            </dd>
            <dt>{t("detail.field.flags")}</dt>
            <dd>
              <div className="row-wrap">
                {detail.internal ? <FlagPill label={t("badge.internal")} /> : null}
                {detail.attachable ? <FlagPill label={t("badge.attachable")} /> : null}
                {detail.enableIPv6 ? <FlagPill label={t("badge.ipv6")} /> : null}
                {!detail.internal && !detail.attachable && !detail.enableIPv6 ? <span className="muted">—</span> : null}
              </div>
            </dd>
          </dl>

          <Section
            title={t("detail.ipamTitle")}
            aside={detail.ipam.driver ? `${t("detail.field.ipamDriver")}: ${detail.ipam.driver}` : undefined}
          >
            {detail.ipam.config.length === 0 ? (
              <span className="muted text-sm">{t("detail.ipamNone")}</span>
            ) : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>{t("detail.col.subnet")}</th>
                      <th>{t("detail.col.gateway")}</th>
                      <th>{t("detail.col.ipRange")}</th>
                      <th>{t("detail.col.aux")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.ipam.config.map((c, i) => {
                      const aux = Object.entries(c.auxAddresses ?? {});
                      return (
                        <tr key={i}>
                          <td className="mono">{c.subnet || "—"}</td>
                          <td className="mono">{c.gateway || "—"}</td>
                          <td className="mono">{c.ipRange || "—"}</td>
                          <td>
                            {aux.length === 0 ? (
                              <span className="muted">—</span>
                            ) : (
                              <div className="row-wrap">
                                {aux.map(([k, v]) => (
                                  <span key={k} className="chip chip-mono" title={k}>
                                    {k}={v}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={t("detail.optionsTitle")} aside={options.length ? String(options.length) : undefined}>
            {options.length === 0 ? (
              <span className="muted text-sm">{t("detail.optionsNone")}</span>
            ) : (
              <div className="col" style={{ gap: "var(--sp-1)" }}>
                {options.map(([k, v]) => (
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
          </Section>

          <Section title={t("detail.containersTitle")} aside={String(detail.containers.length)}>
            {detail.containers.length === 0 ? (
              <span className="muted text-sm">{t("detail.containersNone")}</span>
            ) : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>{t("detail.col.container")}</th>
                      <th>{t("detail.col.state")}</th>
                      <th>{t("detail.col.ipv4")}</th>
                      <th>{t("detail.col.ipv6")}</th>
                      <th>{t("detail.col.mac")}</th>
                      <th style={{ textAlign: "right" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.containers.map((c) => (
                      <tr key={c.containerId}>
                        <td>
                          <div className="col" style={{ gap: 2 }}>
                            <span style={{ fontWeight: 600 }}>{c.name || shortId(c.containerId)}</span>
                            <span className="mono text-xs muted">{shortId(c.containerId)}</span>
                          </div>
                        </td>
                        <td>
                          <StateBadge state={c.running ? "running" : "stopped"} raw={c.state} />
                        </td>
                        <td className="mono text-xs">{c.ipv4 || "—"}</td>
                        <td className="mono text-xs">{c.ipv6 || "—"}</td>
                        <td className="mono text-xs muted">{c.mac || "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          <CapabilityGate allowed={canDisconnect && !c.protected} reason={disconnectReason(c)}>
                            {(allowed, why) => (
                              <ActionButton
                                size="sm"
                                variant="ghost"
                                disabled={!allowed || busy}
                                tooltip={allowed ? undefined : why}
                                onClick={() => {
                                  setForce(false);
                                  setDisconnectTarget(c);
                                }}
                                style={allowed ? { color: "var(--danger)" } : undefined}
                              >
                                {t("detail.disconnect")}
                              </ActionButton>
                            )}
                          </CapabilityGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {disconnectTarget ? (
              <div className="banner danger" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--sp-3)" }}>
                <span className="row" style={{ gap: "var(--sp-2)", alignItems: "flex-start" }}>
                  <IconAlert size={16} style={{ flex: "0 0 auto", marginTop: 2 }} />
                  <span>
                    {t("detail.disconnectQuestion", {
                      container: disconnectTarget.name || shortId(disconnectTarget.containerId),
                      network: detail.name,
                    })}
                  </span>
                </span>
                <label className="checkbox-row">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={disconnecting} />
                  <span>{t("detail.disconnectForce")}</span>
                </label>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-sm" onClick={() => setDisconnectTarget(null)} disabled={disconnecting}>
                    {tc("cancel")}
                  </button>
                  <ActionButton variant="danger" size="sm" loading={disconnecting} onClick={doDisconnect}>
                    {t("detail.disconnectConfirm")}
                  </ActionButton>
                </div>
              </div>
            ) : null}
          </Section>

          <Section title={t("detail.connectTitle")}>
            {!acceptsAttach ? (
              <span className="muted text-sm">{t("detail.systemNoAttach")}</span>
            ) : (
              <div className="col" style={{ gap: "var(--sp-3)" }}>
                <SelectField
                  label={t("detail.connectContainer")}
                  value={connect.containerId}
                  disabled={!canConnect || connecting}
                  onChange={(e) => setConnect((d) => ({ ...d, containerId: e.target.value }))}
                  hint={
                    !canConnect
                      ? hasCap
                        ? t("gate.needConnect")
                        : t("gate.noNetworks")
                      : workloads.data && candidates.length === 0
                        ? t("detail.connectNoCandidates")
                        : undefined
                  }
                >
                  <option value="">{t("detail.connectPick")}</option>
                  {candidates.map((w) => (
                    <option key={w.id} value={w.id} disabled={w.protected}>
                      {w.name} ({w.state}){w.protected ? ` — ${t("detail.connectProtected")}` : ""}
                    </option>
                  ))}
                </SelectField>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--sp-3)" }}>
                  <TextField
                    label={t("detail.connectIPv4")}
                    mono
                    placeholder={isDefaultBridge ? "" : t("detail.connectIPv4Placeholder")}
                    value={connect.ipv4}
                    disabled={!canConnect || connecting || isDefaultBridge}
                    onChange={(e) => setConnect((d) => ({ ...d, ipv4: e.target.value }))}
                    error={connectErrors.ipv4 ? describe(connectErrors.ipv4) : undefined}
                    hint={isDefaultBridge ? t("detail.connectIPv4Bridge") : t("detail.connectIPv4Hint")}
                  />
                  <TextField
                    label={t("detail.connectAliases")}
                    mono
                    placeholder={t("detail.connectAliasesPlaceholder")}
                    value={connect.aliases}
                    disabled={!canConnect || connecting}
                    onChange={(e) => setConnect((d) => ({ ...d, aliases: e.target.value }))}
                    hint={t("detail.connectAliasesHint")}
                  />
                </div>
                <div className="row">
                  <span className="spacer" />
                  <CapabilityGate allowed={canConnect} reason={hasCap ? t("gate.needConnect") : t("gate.noNetworks")}>
                    {(allowed, why) => (
                      <ActionButton
                        variant="primary"
                        size="sm"
                        loading={connecting}
                        disabled={!allowed || !connectErrors.valid}
                        tooltip={!allowed ? why : connectErrors.valid ? undefined : t("form.fixErrors")}
                        onClick={doConnect}
                      >
                        {t("detail.connectSubmit")}
                      </ActionButton>
                    )}
                  </CapabilityGate>
                </div>
              </div>
            )}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function FlagPill({ label }: { label: string }) {
  return (
    <span className="pill" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
      {label}
    </span>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="card-header" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
        <span className="card-title" style={{ fontSize: "var(--fs-sm)" }}>
          {title}
        </span>
        {aside ? <span className="text-xs muted">{aside}</span> : null}
      </div>
      <div className="card-body col" style={{ padding: "var(--sp-4)", gap: "var(--sp-3)" }}>
        {children}
      </div>
    </div>
  );
}
