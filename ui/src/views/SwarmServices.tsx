// ui/src/views/SwarmServices.tsx
//
// Swarm (read + gated writes): services, tasks, nodes. Services can be created,
// scaled, updated (image/env/replicas → rolling update), force-restarted and
// removed; nodes can be drained / re-activated. Every affordance is greyed-out
// before click via CapabilityGate (provider capability + RBAC permission), and
// the backend re-checks. Tasks remain a read-only view.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  useSwarmServices,
  useSwarmTasks,
  useSwarmNodes,
  useSwarmSecrets,
  useSwarmConfigs,
  useCapabilityLookup,
  qk,
} from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { gateSwarmService, gateSwarmNode, gateSwarmSecret, canAny } from "../lib/rbac";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { StateBadge } from "../components/StateBadge";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { Modal } from "../components/Modal";
import { HelpPanel } from "../components/HelpPanel";
import { EmptyState } from "../components/EmptyState";
import { TextField, SelectField } from "../components/Field";
import {
  DockerSwarmResourceFields,
  draftFromResources,
  resourcesFromDraft,
  bytesToQuantity,
  type DockerSwarmResourcesDraft,
} from "../components/ResourceFields";
import { IconSwarm, IconRefresh, IconPlus, IconTrash, IconRestart, IconScale, IconEdit, IconHelp, IconCopy, IconCheck, IconLock } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import { cleanName, shortId, timeAgo } from "../lib/format";
import { useT } from "../i18n";
import { swarmServicesDict } from "../i18n/locales/swarmServices";
import { commonDict } from "../i18n/locales/common";
import type {
  SwarmNode,
  SwarmService,
  SwarmServiceCreateInput,
  SwarmServiceResources,
  SwarmServiceUpdateInput,
  SwarmPort,
  SwarmSecretInfo,
  SwarmConfigInfo,
  SwarmSecretRef,
  SwarmConfigRef,
  Workload,
} from "../lib/types";

type Section = "services" | "tasks" | "nodes" | "secrets" | "configs";

// One row in the attach-secret/config editors shared by the create/update modals.
interface AttachRow {
  id: string; // selected secret/config id ("" = none picked yet)
  targetFile: string; // override file name ("" => server default)
}

const RESTART_OPTIONS = ["any", "on-failure", "none"] as const;

// "3/5" or "5" → the desired replica count (left side); falls back to 0.
function parseReplicas(replicas: string): number {
  const head = replicas.split("/")[0]?.trim() ?? "";
  const n = Number(head);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// True when any of the four resource knobs is set.
function hasResources(r: SwarmServiceResources | undefined): boolean {
  return !!r && (r.cpuLimit > 0 || r.memoryLimitBytes > 0 || r.cpuReservation > 0 || r.memoryReservationBytes > 0);
}

// Compact "CPU 0.5 / Mem 512Mi" summary of a service's configured limits
// (reservations are shown as "≥" prefixed). Returns "—" when nothing is set.
function ResourceSummary({ r }: { r: SwarmServiceResources | undefined }) {
  const t = useT(swarmServicesDict);
  if (!hasResources(r)) return <span className="muted">—</span>;
  const parts: string[] = [];
  if (r!.cpuLimit > 0) parts.push(`${r!.cpuLimit} cpu`);
  if (r!.memoryLimitBytes > 0) parts.push(bytesToQuantity(r!.memoryLimitBytes));
  const res: string[] = [];
  if (r!.cpuReservation > 0) res.push(`${r!.cpuReservation} cpu`);
  if (r!.memoryReservationBytes > 0) res.push(bytesToQuantity(r!.memoryReservationBytes));
  return (
    <span className="col" style={{ gap: 2 }}>
      {parts.length ? <span className="mono text-xs">{parts.join(" · ")}</span> : null}
      {res.length ? (
        <span className="mono text-xs muted" title={t("resource.reservations")}>
          ≥ {res.join(" · ")}
        </span>
      ) : null}
    </span>
  );
}

// Small copy-able shell command used in the guided empty state.
function InlineCommand({ command }: { command: string }) {
  const t = useT(swarmServicesDict);
  const tc = useT(commonDict);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success(tc("copied"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(tc("copied"), command);
    }
  };
  return (
    <div className="help-cmd">
      <code className="help-cmd-text">{command}</code>
      <button type="button" className="btn btn-ghost btn-sm btn-icon help-cmd-copy" onClick={copy} aria-label={t("command.copyAria")} title={t("command.copyAria")}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

export function SwarmServices() {
  const t = useT(swarmServicesDict);
  const hostId = useSelectedHost();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("swarm");

  const [section, setSection] = useState<Section>("services");

  const servicesQ = useSwarmServices(hostId, section === "services");
  const tasksQ = useSwarmTasks(hostId, section === "tasks");
  const nodesQ = useSwarmNodes(hostId, section === "nodes");
  const secretsQ = useSwarmSecrets(hostId, section === "secrets");
  const configsQ = useSwarmConfigs(hostId, section === "configs");
  // Always-loaded lists feeding the attach-secret/config pickers in the
  // create/update modals (independent of the active tab). Enabled only when the
  // user can read them, so a viewer without the perm doesn't 403-spam.
  const canReadSecrets = canAny(permissions, ["swarm.secret.read"]);
  const canReadConfigs = canAny(permissions, ["swarm.config.read"]);
  const attachSecretsQ = useSwarmSecrets(hostId, canReadSecrets);
  const attachConfigsQ = useSwarmConfigs(hostId, canReadConfigs);

  // Write affordance gates (capability + permission).
  const createGate = gateSwarmService("create", caps, permissions);
  const scaleGate = gateSwarmService("scale", caps, permissions);
  const updateGate = gateSwarmService("update", caps, permissions);
  const restartGate = gateSwarmService("restart", caps, permissions);
  const removeGate = gateSwarmService("remove", caps, permissions);
  const nodeGate = gateSwarmNode(caps, permissions);
  const secretGate = gateSwarmSecret("secret", caps, permissions);
  const configGate = gateSwarmSecret("config", caps, permissions);

  // Modal / dialog state.
  const [helpOpen, setHelpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [scaleTarget, setScaleTarget] = useState<SwarmService | null>(null);
  const [updateTarget, setUpdateTarget] = useState<SwarmService | null>(null);
  const [restartTarget, setRestartTarget] = useState<SwarmService | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SwarmService | null>(null);
  const [nodeTarget, setNodeTarget] = useState<SwarmNode | null>(null);
  const [createSecretOpen, setCreateSecretOpen] = useState(false);
  const [createConfigOpen, setCreateConfigOpen] = useState(false);
  const [secretDeleteTarget, setSecretDeleteTarget] = useState<SwarmSecretInfo | null>(null);
  const [configDeleteTarget, setConfigDeleteTarget] = useState<SwarmConfigInfo | null>(null);

  // Picker option lists (id+name) for the attach editors.
  const secretOptions = useMemo(
    () => (attachSecretsQ.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    [attachSecretsQ.data],
  );
  const configOptions = useMemo(
    () => (attachConfigsQ.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    [attachConfigsQ.data],
  );

  const refetch = () => {
    if (section === "services") servicesQ.refetch();
    else if (section === "tasks") tasksQ.refetch();
    else if (section === "secrets") secretsQ.refetch();
    else if (section === "configs") configsQ.refetch();
    else nodesQ.refetch();
  };

  const invalidateServices = () =>
    queryClient.invalidateQueries({ queryKey: qk.swarmServices(hostId) });
  const invalidateNodes = () => queryClient.invalidateQueries({ queryKey: qk.swarmNodes(hostId) });
  const invalidateSecrets = () => queryClient.invalidateQueries({ queryKey: qk.swarmSecrets(hostId) });
  const invalidateConfigs = () => queryClient.invalidateQueries({ queryKey: qk.swarmConfigs(hostId) });

  const serviceCols: Column<SwarmService>[] = [
    { key: "name", header: t("col.service"), sortValue: (s) => s.name, cell: (s) => <span style={{ fontWeight: 600 }}>{s.name}</span> },
    { key: "mode", header: t("col.mode"), sortValue: (s) => s.mode, cell: (s) => <span className="chip">{s.mode}</span> },
    { key: "replicas", header: t("col.replicas"), sortValue: (s) => s.replicas, cell: (s) => <span className="mono">{s.replicas}</span> },
    { key: "image", header: t("col.image"), sortValue: (s) => s.image, cell: (s) => <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={s.image}>{s.image}</span> },
    { key: "resources", header: t("col.resources"), cell: (s) => <ResourceSummary r={s.resources} /> },
    { key: "id", header: t("col.id"), cell: (s) => <span className="mono text-xs muted">{shortId(s.id)}</span> },
    { key: "created", header: t("col.created"), sortValue: (s) => s.createdAt, cell: (s) => <span className="text-xs muted nowrap">{timeAgo(s.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "168px",
      cell: (s) => (
        <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
          <CapabilityGate gate={scaleGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.scale") : reason}
                aria-label={t("action.scaleAria")}
                onClick={() => setScaleTarget(s)}
              >
                <IconScale size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={updateGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.update") : reason}
                aria-label={t("action.updateAria")}
                onClick={() => setUpdateTarget(s)}
              >
                <IconEdit size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={restartGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.forceRestart") : reason}
                aria-label={t("action.restartAria")}
                onClick={() => setRestartTarget(s)}
              >
                <IconRestart size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
          <CapabilityGate gate={removeGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? t("action.remove") : reason}
                aria-label={t("action.removeAria")}
                onClick={() => setRemoveTarget(s)}
                style={allowed ? { color: "var(--danger)" } : undefined}
              >
                <IconTrash size={15} />
              </ActionButton>
            )}
          </CapabilityGate>
        </div>
      ),
    },
  ];

  const taskCols: Column<Workload>[] = [
    { key: "name", header: t("col.task"), sortValue: (w) => cleanName(w.name), cell: (w) => <span className="truncate">{cleanName(w.name)}</span> },
    { key: "state", header: t("col.state"), sortValue: (w) => w.state, cell: (w) => <StateBadge state={w.state} raw={w.stateRaw} /> },
    { key: "node", header: t("col.node"), sortValue: (w) => w.node ?? "", cell: (w) => <span className="text-sm secondary">{w.node || "—"}</span> },
    { key: "image", header: t("col.image"), sortValue: (w) => w.image, cell: (w) => <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={w.image}>{w.image}</span> },
    { key: "group", header: t("col.service"), sortValue: (w) => w.group ?? "", cell: (w) => (w.group ? <span className="chip">{w.group}</span> : <span className="muted">—</span>) },
    { key: "created", header: t("col.created"), sortValue: (w) => w.createdAt, cell: (w) => <span className="text-xs muted nowrap">{timeAgo(w.createdAt)}</span> },
  ];

  const nodeCols: Column<SwarmNode>[] = [
    { key: "hostname", header: t("col.hostname"), sortValue: (n) => n.hostname, cell: (n) => <span style={{ fontWeight: 600 }}>{n.hostname}</span> },
    {
      key: "role",
      header: t("col.role"),
      sortValue: (n) => n.role,
      cell: (n) => (
        <span className="pill" style={{ color: n.role === "manager" ? "var(--accent)" : "var(--text-secondary)", borderColor: "var(--border-strong)", background: "transparent" }}>
          {n.role}
        </span>
      ),
    },
    { key: "availability", header: t("col.availability"), sortValue: (n) => n.availability, cell: (n) => <span className="text-sm secondary">{n.availability}</span> },
    { key: "state", header: t("col.state"), sortValue: (n) => n.state, cell: (n) => <span className="chip">{n.state}</span> },
    { key: "addr", header: t("col.address"), cell: (n) => <span className="mono text-xs muted">{n.addr || "—"}</span> },
    { key: "id", header: t("col.id"), cell: (n) => <span className="mono text-xs muted">{shortId(n.id)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "120px",
      cell: (n) => {
        const isActive = n.availability.toLowerCase() === "active";
        return (
          <CapabilityGate gate={nodeGate}>
            {(allowed, reason) => (
              <ActionButton
                size="sm"
                variant="ghost"
                disabled={!allowed}
                tooltip={allowed ? undefined : reason}
                onClick={() => setNodeTarget(n)}
              >
                {isActive ? t("node.drain") : t("node.activate")}
              </ActionButton>
            )}
          </CapabilityGate>
        );
      },
    },
  ];

  const secretCols: Column<SwarmSecretInfo>[] = [
    { key: "name", header: t("col.name"), sortValue: (s) => s.name, cell: (s) => <span className="row" style={{ gap: 6, fontWeight: 600 }}><IconLock size={13} />{s.name}</span> },
    { key: "id", header: t("col.id"), cell: (s) => <span className="mono text-xs muted">{shortId(s.id)}</span> },
    { key: "created", header: t("col.created"), sortValue: (s) => s.createdAt, cell: (s) => <span className="text-xs muted nowrap">{timeAgo(s.createdAt)}</span> },
    { key: "updated", header: t("col.updated"), sortValue: (s) => s.updatedAt, cell: (s) => <span className="text-xs muted nowrap">{timeAgo(s.updatedAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "56px",
      cell: (s) => (
        <CapabilityGate gate={secretGate}>
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? t("action.deleteSecret") : reason}
              aria-label={t("action.deleteSecretAria")}
              onClick={() => setSecretDeleteTarget(s)}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  const configCols: Column<SwarmConfigInfo>[] = [
    { key: "name", header: t("col.name"), sortValue: (c) => c.name, cell: (c) => <span style={{ fontWeight: 600 }}>{c.name}</span> },
    { key: "id", header: t("col.id"), cell: (c) => <span className="mono text-xs muted">{shortId(c.id)}</span> },
    { key: "created", header: t("col.created"), sortValue: (c) => c.createdAt, cell: (c) => <span className="text-xs muted nowrap">{timeAgo(c.createdAt)}</span> },
    { key: "updated", header: t("col.updated"), sortValue: (c) => c.updatedAt, cell: (c) => <span className="text-xs muted nowrap">{timeAgo(c.updatedAt)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "56px",
      cell: (c) => (
        <CapabilityGate gate={configGate}>
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? t("action.deleteConfig") : reason}
              aria-label={t("action.deleteConfigAria")}
              onClick={() => setConfigDeleteTarget(c)}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  const loading =
    (section === "services" && servicesQ.isLoading) ||
    (section === "tasks" && tasksQ.isLoading) ||
    (section === "nodes" && nodesQ.isLoading) ||
    (section === "secrets" && secretsQ.isLoading) ||
    (section === "configs" && configsQ.isLoading);

  // --- node availability confirm ---
  const nodeIsActive = (nodeTarget?.availability ?? "").toLowerCase() === "active";
  const doNodeAvailability = async () => {
    if (!nodeTarget) return;
    const next = nodeIsActive ? "drain" : "active";
    try {
      await api.swarmNodeAvailability(hostId, nodeTarget.id, next);
      toast.success(next === "drain" ? t("toast.nodeDraining") : t("toast.nodeActivated"), nodeTarget.hostname);
      invalidateNodes();
    } catch (err) {
      toastError(next === "drain" ? t("toast.drainFailed") : t("toast.activateFailed"), err);
      throw err;
    }
  };

  const doRestart = async () => {
    if (!restartTarget) return;
    try {
      await api.swarmServiceRestart(hostId, restartTarget.id);
      toast.success(t("toast.serviceRestarting"), t("toast.serviceRestartingBody", { name: restartTarget.name }));
      invalidateServices();
    } catch (err) {
      toastError(t("toast.restartFailed"), err);
      throw err;
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await api.swarmServiceRemove(hostId, removeTarget.id);
      toast.success(t("toast.serviceRemoved"), removeTarget.name);
      invalidateServices();
    } catch (err) {
      toastError(t("toast.removeFailed"), err);
      throw err;
    }
  };

  const doDeleteSecret = async () => {
    if (!secretDeleteTarget) return;
    try {
      await api.swarmSecretRemove(hostId, secretDeleteTarget.id);
      toast.success(t("toast.secretDeleted"), secretDeleteTarget.name);
      invalidateSecrets();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  const doDeleteConfig = async () => {
    if (!configDeleteTarget) return;
    try {
      await api.swarmConfigRemove(hostId, configDeleteTarget.id);
      toast.success(t("toast.configDeleted"), configDeleteTarget.name);
      invalidateConfigs();
    } catch (err) {
      toastError(t("toast.deleteFailed"), err);
      throw err;
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="row" style={{ gap: "var(--sp-3)" }}>
            Swarm
            <OrchestratorBadge kind="swarm" />
          </span>
        }
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            {section === "services" ? (
              <CapabilityGate gate={createGate}>
                {(allowed, reason) => (
                  <ActionButton
                    variant="primary"
                    disabled={!allowed}
                    tooltip={allowed ? undefined : reason}
                    onClick={() => setCreateOpen(true)}
                  >
                    <IconPlus size={15} />
                    {t("header.deployService")}
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : section === "secrets" ? (
              <CapabilityGate gate={secretGate}>
                {(allowed, reason) => (
                  <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateSecretOpen(true)}>
                    <IconPlus size={15} />
                    {t("header.createSecret")}
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : section === "configs" ? (
              <CapabilityGate gate={configGate}>
                {(allowed, reason) => (
                  <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateConfigOpen(true)}>
                    <IconPlus size={15} />
                    {t("header.createConfig")}
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : null}
            <ActionButton variant="ghost" iconOnly tooltip={t("header.setupGuide")} aria-label={t("header.setupGuide")} onClick={() => setHelpOpen(true)}>
              <IconHelp size={16} />
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${section === "services" ? " active" : ""}`} onClick={() => setSection("services")}>
          {t("tab.services")}
        </button>
        <button className={`tab${section === "tasks" ? " active" : ""}`} onClick={() => setSection("tasks")}>
          {t("tab.tasks")}
        </button>
        <button className={`tab${section === "nodes" ? " active" : ""}`} onClick={() => setSection("nodes")}>
          {t("tab.nodes")}
        </button>
        <button className={`tab${section === "secrets" ? " active" : ""}`} onClick={() => setSection("secrets")}>
          {t("tab.secrets")}
        </button>
        <button className={`tab${section === "configs" ? " active" : ""}`} onClick={() => setSection("configs")}>
          {t("tab.configs")}
        </button>
      </div>

      {loading ? (
        <LoadingFill label={t("loading.data")} />
      ) : section === "services" ? (
        (servicesQ.data ?? []).length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconSwarm size={40} />}
              title={t("empty.servicesTitle")}
              message={t("empty.servicesGuideMessage")}
              action={
                <div className="help-guide">
                  <ActionButton variant="primary" onClick={() => setHelpOpen(true)}>
                    <IconHelp size={15} />
                    {t("empty.showSetupGuide")}
                  </ActionButton>
                  <div className="help-guide-cmd">
                    <InlineCommand command="docker swarm init" />
                  </div>
                </div>
              }
            />
          </div>
        ) : (
          <DataTable
            columns={serviceCols}
            rows={servicesQ.data ?? []}
            rowKey={(s) => s.id}
            defaultSortKey="name"
            emptyIcon={<IconSwarm size={40} />}
            emptyTitle={t("empty.servicesTitle")}
            emptyMessage={t("empty.servicesShortMessage")}
          />
        )
      ) : section === "tasks" ? (
        <DataTable
          columns={taskCols}
          rows={tasksQ.data ?? []}
          rowKey={(w) => w.id}
          defaultSortKey="name"
          onRowClick={(w) => navigate(`/workloads/${encodeURIComponent(hostId)}/${encodeURIComponent(w.id)}`)}
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle={t("empty.tasksTitle")}
        />
      ) : section === "secrets" ? (
        <DataTable
          columns={secretCols}
          rows={secretsQ.data ?? []}
          rowKey={(s) => s.id}
          defaultSortKey="name"
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle={t("empty.secretsTitle")}
          emptyMessage={t("empty.secretsMessage")}
        />
      ) : section === "configs" ? (
        <DataTable
          columns={configCols}
          rows={configsQ.data ?? []}
          rowKey={(c) => c.id}
          defaultSortKey="name"
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle={t("empty.configsTitle")}
        />
      ) : (
        <DataTable
          columns={nodeCols}
          rows={nodesQ.data ?? []}
          rowKey={(n) => n.id}
          defaultSortKey="hostname"
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle={t("empty.nodesTitle")}
        />
      )}

      {/* ---- Setup guide ---- */}
      <HelpPanel topic="swarm" open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ---- Deploy service ---- */}
      <CreateServiceModal
        open={createOpen}
        hostId={hostId}
        secretOptions={secretOptions}
        configOptions={configOptions}
        onClose={() => setCreateOpen(false)}
        onDone={() => {
          setCreateOpen(false);
          invalidateServices();
        }}
      />

      {/* ---- Scale ---- */}
      <ScaleServiceModal
        hostId={hostId}
        target={scaleTarget}
        onClose={() => setScaleTarget(null)}
        onDone={() => {
          setScaleTarget(null);
          invalidateServices();
        }}
      />

      {/* ---- Update ---- */}
      <UpdateServiceModal
        hostId={hostId}
        target={updateTarget}
        secretOptions={secretOptions}
        configOptions={configOptions}
        onClose={() => setUpdateTarget(null)}
        onDone={() => {
          setUpdateTarget(null);
          invalidateServices();
        }}
      />

      {/* ---- Restart (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!restartTarget}
        title={t("dialog.restartTitle")}
        variant="primary"
        confirmLabel={t("dialog.restartConfirm")}
        description={
          <>
            {t("dialog.restartDescPrefix")}
            <strong className="mono">{restartTarget?.name}</strong>
            {t("dialog.restartDescSuffix")}
          </>
        }
        onConfirm={doRestart}
        onClose={() => setRestartTarget(null)}
      />

      {/* ---- Remove (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!removeTarget}
        title={t("dialog.removeTitle")}
        variant="danger"
        confirmLabel={t("dialog.removeConfirm")}
        description={
          <>
            {t("dialog.removeDescPrefix")}
            <strong className="mono">{removeTarget?.name}</strong>
            {t("dialog.removeDescSuffix")}
          </>
        }
        onConfirm={doRemove}
        onClose={() => setRemoveTarget(null)}
      />

      {/* ---- Node drain/activate (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!nodeTarget}
        title={nodeIsActive ? t("dialog.drainTitle") : t("dialog.activateTitle")}
        variant={nodeIsActive ? "danger" : "primary"}
        confirmLabel={nodeIsActive ? t("dialog.drainConfirm") : t("dialog.activateConfirm")}
        description={
          nodeIsActive ? (
            <>
              {t("dialog.drainDescPrefix")}
              <strong className="mono">{nodeTarget?.hostname}</strong>
              {t("dialog.drainDescSuffix")}
            </>
          ) : (
            <>
              {t("dialog.activateDescPrefix")}
              <strong className="mono">{nodeTarget?.hostname}</strong>
              {t("dialog.activateDescMid")}
              <strong>{t("dialog.activateDescActive")}</strong>
              {t("dialog.activateDescSuffix")}
            </>
          )
        }
        onConfirm={doNodeAvailability}
        onClose={() => setNodeTarget(null)}
      />

      {/* ---- Create secret ---- */}
      <CreateSecretConfigModal
        kind="secret"
        open={createSecretOpen}
        hostId={hostId}
        onClose={() => setCreateSecretOpen(false)}
        onDone={() => {
          setCreateSecretOpen(false);
          invalidateSecrets();
        }}
      />

      {/* ---- Create config ---- */}
      <CreateSecretConfigModal
        kind="config"
        open={createConfigOpen}
        hostId={hostId}
        onClose={() => setCreateConfigOpen(false)}
        onDone={() => {
          setCreateConfigOpen(false);
          invalidateConfigs();
        }}
      />

      {/* ---- Delete secret (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!secretDeleteTarget}
        title={t("dialog.deleteSecretTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteSecretDescPrefix")}
            <strong className="mono">{secretDeleteTarget?.name}</strong>
            {t("dialog.deleteSecretDescSuffix")}
          </>
        }
        onConfirm={doDeleteSecret}
        onClose={() => setSecretDeleteTarget(null)}
      />

      {/* ---- Delete config (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!configDeleteTarget}
        title={t("dialog.deleteConfigTitle")}
        variant="danger"
        confirmLabel={t("dialog.deleteConfirm")}
        description={
          <>
            {t("dialog.deleteConfigDescPrefix")}
            <strong className="mono">{configDeleteTarget?.name}</strong>
            {t("dialog.deleteConfigDescSuffix")}
          </>
        }
        onConfirm={doDeleteConfig}
        onClose={() => setConfigDeleteTarget(null)}
      />
    </div>
  );
}

/* ============================ Attach secret/config editor ============================ */

// Repeating-row editor to attach EXISTING secrets/configs to a service. Each row
// picks an object (by id) and an optional target file name. Shared by the
// create/update modals. The attached objects' values are never carried here —
// only references — so this is safe.
function AttachRowsEditor({
  kind,
  rows,
  options,
  onChange,
}: {
  kind: "secret" | "config";
  rows: AttachRow[];
  options: { id: string; name: string }[];
  onChange: (rows: AttachRow[]) => void;
}) {
  const t = useT(swarmServicesDict);
  const update = (i: number, patch: Partial<AttachRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { id: "", targetFile: "" }]);

  const mountRoot = kind === "secret" ? "/run/secrets/" : "/";
  const noun = kind === "secret" ? t("attach.nounSecret") : t("attach.nounConfig");
  const tabName = kind === "secret" ? t("attach.tabSecrets") : t("attach.tabConfigs");

  if (options.length === 0) {
    return (
      <span className="text-xs muted">
        {t("attach.noneExist", { noun, tab: tabName })}
      </span>
    );
  }

  return (
    <div className="col" style={{ gap: "var(--sp-2)" }}>
      {rows.map((r, i) => {
        const picked = options.find((o) => o.id === r.id);
        return (
          <div key={i} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
            <select
              className="select"
              value={r.id}
              onChange={(e) => update(i, { id: e.target.value })}
              aria-label={t("attach.selectAria", { noun })}
              style={{ minWidth: 180, flex: 1 }}
            >
              <option value="">{t("attach.selectPlaceholder", { noun })}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <span className="muted">→</span>
            <input
              className="input input-mono"
              placeholder={`${mountRoot}${picked?.name ?? noun}`}
              value={r.targetFile}
              onChange={(e) => update(i, { targetFile: e.target.value })}
              aria-label={t("attach.targetFileAria")}
              style={{ flex: 1, minWidth: 160 }}
            />
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label={t("attach.removeAria", { noun })}
              onClick={() => remove(i)}
              style={{ color: "var(--danger)" }}
            >
              <IconTrash size={14} />
            </ActionButton>
          </div>
        );
      })}
      <div>
        <ActionButton size="sm" variant="ghost" onClick={add}>
          <IconPlus size={14} />
          {t("attach.add", { noun })}
        </ActionButton>
      </div>
    </div>
  );
}

// Map attach rows -> the typed ref arrays expected by the API (drop rows with no
// object picked). For secrets targetFile defaults server-side to the secret name;
// for configs to /<configName>. We pass the selected object's name too so the
// backend can resolve by name if needed.
function toSecretRefs(rows: AttachRow[], options: { id: string; name: string }[]): SwarmSecretRef[] {
  return rows
    .filter((r) => r.id !== "")
    .map((r) => ({
      secretId: r.id,
      secretName: options.find((o) => o.id === r.id)?.name ?? "",
      targetFile: r.targetFile.trim(),
    }));
}
function toConfigRefs(rows: AttachRow[], options: { id: string; name: string }[]): SwarmConfigRef[] {
  return rows
    .filter((r) => r.id !== "")
    .map((r) => ({
      configId: r.id,
      configName: options.find((o) => o.id === r.id)?.name ?? "",
      targetFile: r.targetFile.trim(),
    }));
}

/* ============================ Create secret/config modal ============================ */

const SECRET_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

// Create a swarm secret OR config (same shape: name + value). SECURITY: the value
// textarea is the only place a secret's data is ever transmitted; after creation
// secret values are write-only and never returned by the API.
function CreateSecretConfigModal({
  kind,
  open,
  hostId,
  onClose,
  onDone,
}: {
  kind: "secret" | "config";
  open: boolean;
  hostId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT(swarmServicesDict);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setValue("");
      setBusy(false);
    }
  }, [open]);

  const nameOk = SECRET_NAME_RE.test(name.trim());
  const valueOk = value.length > 0;
  const valid = nameOk && valueOk && !busy;
  const noun = kind === "secret" ? t("attach.nounSecret") : t("attach.nounConfig");

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      if (kind === "secret") {
        await api.swarmSecretCreate(hostId, { name: name.trim(), data: value });
      } else {
        await api.swarmConfigCreate(hostId, { name: name.trim(), data: value });
      }
      toast.success(kind === "secret" ? t("toast.secretCreated") : t("toast.configCreated"), name.trim());
      onDone();
    } catch (err) {
      toastError(t("toast.createFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={t("secretModal.createTitle", { noun })}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("modal.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("secretModal.create")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <TextField
          label={t("secretModal.name")}
          mono
          autoFocus
          placeholder={kind === "secret" ? "db_password" : "nginx_conf"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={name && !nameOk ? t("secretModal.nameError") : undefined}
          style={{ maxWidth: 360 }}
        />
        <div className="field">
          <label className="field-label" htmlFor="secret-value">
            {kind === "secret" ? t("secretModal.valueWriteOnly") : t("secretModal.value")}
          </label>
          <textarea
            id="secret-value"
            className="textarea input-mono"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "secret" ? t("secretModal.secretPlaceholder") : t("secretModal.configPlaceholder")}
            style={{ minHeight: 160, fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre", tabSize: 2 }}
            aria-label={t("secretModal.valueAria", { noun })}
          />
          {kind === "secret" ? (
            <span className="field-hint">
              {t("secretModal.secretHint")}
            </span>
          ) : (
            <span className="field-hint">{t("secretModal.configHint")}</span>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ============================ Deploy service modal ============================ */

interface PortRow {
  published: string;
  target: string;
  protocol: string;
}
interface EnvRow {
  key: string;
  value: string;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

function CreateServiceModal({
  open,
  hostId,
  secretOptions,
  configOptions,
  onClose,
  onDone,
}: {
  open: boolean;
  hostId: string;
  secretOptions: { id: string; name: string }[];
  configOptions: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT(swarmServicesDict);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [replicas, setReplicas] = useState("1");
  const [restart, setRestart] = useState<string>("any");
  const [networks, setNetworks] = useState("");
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [secretRows, setSecretRows] = useState<AttachRow[]>([]);
  const [configRows, setConfigRows] = useState<AttachRow[]>([]);
  const [resources, setResources] = useState<DockerSwarmResourcesDraft>(() => draftFromResources(undefined));
  const [busy, setBusy] = useState(false);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setName("");
      setImage("");
      setReplicas("1");
      setRestart("any");
      setNetworks("");
      setEnv([]);
      setPorts([]);
      setSecretRows([]);
      setConfigRows([]);
      setResources(draftFromResources(undefined));
      setBusy(false);
    }
  }, [open]);

  const nameOk = name.trim().length > 0 && NAME_RE.test(name.trim());
  const imageOk = image.trim().length > 0;
  const replicasN = Number(replicas);
  const replicasOk = Number.isInteger(replicasN) && replicasN >= 0;
  const valid = nameOk && imageOk && replicasOk && !busy;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    const rsc = resourcesFromDraft(resources);
    const body: SwarmServiceCreateInput = {
      name: name.trim(),
      image: image.trim(),
      replicas: replicasN,
      env: env.filter((e) => e.key.trim() !== "").map((e) => `${e.key.trim()}=${e.value}`),
      ports: ports
        .filter((p) => Number(p.target) > 0)
        .map<SwarmPort>((p) => ({
          published: Number(p.published) || 0,
          target: Number(p.target) || 0,
          protocol: p.protocol || "tcp",
        })),
      networks: networks
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      restart,
      // Resource limits/reservations (0 => left unset server-side).
      cpuLimit: rsc.cpuLimit || undefined,
      memoryLimitBytes: rsc.memoryLimitBytes || undefined,
      cpuReservation: rsc.cpuReservation || undefined,
      memoryReservationBytes: rsc.memoryReservationBytes || undefined,
    };
    // Attach existing secrets/configs by reference (omit when none picked).
    const secs = toSecretRefs(secretRows, secretOptions);
    const cfgs = toConfigRefs(configRows, configOptions);
    if (secs.length) body.secrets = secs;
    if (cfgs.length) body.configs = cfgs;
    try {
      const res = await api.swarmServiceCreate(hostId, body);
      toast.success(t("toast.serviceDeployed"), t("toast.serviceDeployedBody", { name: body.name, id: shortId(res.id) }));
      onDone();
    } catch (err) {
      toastError(t("toast.deployFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={t("create.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("modal.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("create.deploy")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <TextField
            label={t("create.name")}
            placeholder="web"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={name && !nameOk ? t("create.nameError") : undefined}
            style={{ minWidth: 200 }}
          />
          <TextField
            label={t("create.image")}
            mono
            placeholder="nginx:latest"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            style={{ minWidth: 240, flex: 1 }}
          />
        </div>

        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <TextField
            label={t("create.replicas")}
            type="number"
            min={0}
            value={replicas}
            onChange={(e) => setReplicas(e.target.value)}
            error={replicas !== "" && !replicasOk ? t("create.replicasError") : undefined}
            style={{ width: 120 }}
          />
          <SelectField label={t("create.restart")} value={restart} onChange={(e) => setRestart(e.target.value)}>
            {RESTART_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
        </div>

        <TextField
          label={t("create.networks")}
          mono
          placeholder="frontend backend"
          value={networks}
          onChange={(e) => setNetworks(e.target.value)}
          hint={t("create.networksHint")}
        />

        {/* ports */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            {t("create.publishedPorts")}
          </span>
          {ports.map((p, i) => (
            <div key={i} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
              <input
                className="input"
                type="number"
                min={0}
                placeholder={t("create.portPublished")}
                value={p.published}
                onChange={(e) => setPorts((prev) => prev.map((x, idx) => (idx === i ? { ...x, published: e.target.value } : x)))}
                style={{ width: 110 }}
                aria-label={t("create.portPublishedAria")}
              />
              <span className="muted">:</span>
              <input
                className="input"
                type="number"
                min={1}
                placeholder={t("create.portTarget")}
                value={p.target}
                onChange={(e) => setPorts((prev) => prev.map((x, idx) => (idx === i ? { ...x, target: e.target.value } : x)))}
                style={{ width: 100 }}
                aria-label={t("create.portTargetAria")}
              />
              <select
                className="select"
                value={p.protocol}
                onChange={(e) => setPorts((prev) => prev.map((x, idx) => (idx === i ? { ...x, protocol: e.target.value } : x)))}
                style={{ width: 90 }}
                aria-label={t("create.protocolAria")}
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
                <option value="sctp">sctp</option>
              </select>
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                aria-label={t("create.removePortAria")}
                onClick={() => setPorts((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ color: "var(--danger)" }}
              >
                <IconTrash size={14} />
              </ActionButton>
            </div>
          ))}
          <div>
            <ActionButton size="sm" variant="ghost" onClick={() => setPorts((prev) => [...prev, { published: "", target: "", protocol: "tcp" }])}>
              <IconPlus size={14} />
              {t("create.addPort")}
            </ActionButton>
          </div>
        </div>

        {/* env */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            {t("create.environment")}
          </span>
          {env.map((e, i) => (
            <div key={i} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
              <input
                className="input input-mono"
                placeholder="KEY"
                value={e.key}
                onChange={(ev) => setEnv((prev) => prev.map((x, idx) => (idx === i ? { ...x, key: ev.target.value } : x)))}
                style={{ width: 200 }}
                aria-label={t("create.envKeyAria")}
              />
              <span className="muted">=</span>
              <input
                className="input input-mono"
                placeholder="value"
                value={e.value}
                onChange={(ev) => setEnv((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: ev.target.value } : x)))}
                style={{ flex: 1, minWidth: 160 }}
                aria-label={t("create.envValueAria")}
              />
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                aria-label={t("create.removeEnvAria")}
                onClick={() => setEnv((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ color: "var(--danger)" }}
              >
                <IconTrash size={14} />
              </ActionButton>
            </div>
          ))}
          <div>
            <ActionButton size="sm" variant="ghost" onClick={() => setEnv((prev) => [...prev, { key: "", value: "" }])}>
              <IconPlus size={14} />
              {t("create.addVariable")}
            </ActionButton>
          </div>
        </div>

        {/* resources */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            {t("create.resources")}
          </span>
          <DockerSwarmResourceFields draft={resources} onChange={setResources} />
        </div>

        {/* secrets */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            {t("create.secrets")}
          </span>
          <AttachRowsEditor kind="secret" rows={secretRows} options={secretOptions} onChange={setSecretRows} />
        </div>

        {/* configs */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            {t("create.configs")}
          </span>
          <AttachRowsEditor kind="config" rows={configRows} options={configOptions} onChange={setConfigRows} />
        </div>
      </div>
    </Modal>
  );
}

/* ============================ Scale modal ============================ */

function ScaleServiceModal({
  hostId,
  target,
  onClose,
  onDone,
}: {
  hostId: string;
  target: SwarmService | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT(swarmServicesDict);
  const [replicas, setReplicas] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setReplicas(String(parseReplicas(target.replicas)));
      setBusy(false);
    }
  }, [target]);

  const n = Number(replicas);
  const valid = Number.isInteger(n) && n >= 0 && !busy;

  const submit = async () => {
    if (!target || !valid) return;
    setBusy(true);
    try {
      await api.swarmServiceScale(hostId, target.id, { replicas: n });
      toast.success(t("toast.serviceScaled"), t("toast.serviceScaledBody", { name: target.name, n }));
      onDone();
    } catch (err) {
      toastError(t("toast.scaleFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      title={t("scale.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("modal.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("scale.scale")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="text-sm secondary">
          {t("scale.currentPrefix")}<strong className="mono">{target?.name}</strong>{t("scale.currentMid")}
          <span className="mono">{target?.replicas}</span>{t("scale.currentSuffix")}
        </div>
        <TextField
          label={t("scale.replicas")}
          type="number"
          min={0}
          autoFocus
          value={replicas}
          onChange={(e) => setReplicas(e.target.value)}
          error={replicas !== "" && !(Number.isInteger(n) && n >= 0) ? t("scale.replicasError") : undefined}
          hint={t("scale.hint")}
          style={{ width: 160 }}
        />
      </div>
    </Modal>
  );
}

/* ============================ Update modal ============================ */

function UpdateServiceModal({
  hostId,
  target,
  secretOptions,
  configOptions,
  onClose,
  onDone,
}: {
  hostId: string;
  target: SwarmService | null;
  secretOptions: { id: string; name: string }[];
  configOptions: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT(swarmServicesDict);
  const [image, setImage] = useState("");
  const [envText, setEnvText] = useState("");
  const [replicas, setReplicas] = useState("");
  const [setEnvOn, setSetEnvOn] = useState(false);
  // Attachments use pointer-to-slice semantics: omitted => unchanged. The current
  // refs aren't surfaced on SwarmService, so attaching is opt-in — checking the
  // box REPLACES the full set (empty rows => detach all), like "Replace env".
  const [setAttachOn, setSetAttachOn] = useState(false);
  const [secretRows, setSecretRows] = useState<AttachRow[]>([]);
  const [configRows, setConfigRows] = useState<AttachRow[]>([]);
  const [resources, setResources] = useState<DockerSwarmResourcesDraft>(() => draftFromResources(undefined));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setImage(target.image);
      setEnvText("");
      setSetEnvOn(false);
      setSetAttachOn(false);
      setSecretRows([]);
      setConfigRows([]);
      setReplicas(String(parseReplicas(target.replicas)));
      // Seed from the service's current limits: the server re-applies resources
      // on every update (0 clears), so we must round-trip them or they'd be lost.
      setResources(draftFromResources(target.resources));
      setBusy(false);
    }
  }, [target]);

  const replicasN = Number(replicas);
  const replicasOk = replicas === "" || (Number.isInteger(replicasN) && replicasN >= 0);
  const valid = image.trim().length > 0 && replicasOk && !busy;

  const submit = async () => {
    if (!target || !valid) return;
    setBusy(true);
    const body: SwarmServiceUpdateInput = {};
    const img = image.trim();
    // Always send the image (it is required by the update path; resending the
    // same value is a no-op, a changed value triggers the rolling update).
    if (img) body.image = img;
    if (setEnvOn) {
      body.env = envText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }
    if (replicas !== "") body.replicas = replicasN;
    // The server always re-applies resources from the body (positive sets, 0
    // clears), so send all four every time — the fields are seeded from the
    // current values, so untouched limits are preserved.
    const rsc = resourcesFromDraft(resources);
    body.cpuLimit = rsc.cpuLimit;
    body.memoryLimitBytes = rsc.memoryLimitBytes;
    body.cpuReservation = rsc.cpuReservation;
    body.memoryReservationBytes = rsc.memoryReservationBytes;
    // Only touch attachments when the operator opts in; sending the arrays (even
    // []) REPLACES the full set server-side. Omitting them leaves them unchanged.
    if (setAttachOn) {
      body.secrets = toSecretRefs(secretRows, secretOptions);
      body.configs = toConfigRefs(configRows, configOptions);
    }
    try {
      await api.swarmServiceUpdate(hostId, target.id, body);
      toast.success(t("toast.serviceUpdated"), t("toast.serviceUpdatedBody", { name: target.name }));
      onDone();
    } catch (err) {
      toastError(t("toast.updateFailed"), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title={t("update.title")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("modal.cancel")}
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t("update.apply")}
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          {t("update.introPrefix")}<strong className="mono">{target?.name}</strong>{t("update.introSuffix")}
        </div>
        <TextField
          label={t("update.image")}
          mono
          placeholder="nginx:1.27"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          error={image.trim().length === 0 ? t("update.imageError") : undefined}
        />
        <TextField
          label={t("update.replicas")}
          type="number"
          min={0}
          value={replicas}
          onChange={(e) => setReplicas(e.target.value)}
          error={!replicasOk ? t("update.replicasError") : undefined}
          hint={t("update.replicasHint")}
          style={{ width: 160 }}
        />
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={setEnvOn} onChange={(e) => setSetEnvOn(e.target.checked)} />
            <span>{t("update.replaceEnv")}</span>
          </label>
          {setEnvOn ? (
            <textarea
              className="textarea input-mono"
              spellCheck={false}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={"KEY=value\nANOTHER=value"}
              style={{ minHeight: 120, fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre", tabSize: 2 }}
              aria-label={t("update.envAria")}
            />
          ) : (
            <span className="text-xs muted">{t("update.envUnchecked")}</span>
          )}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            {t("update.resources")}
          </span>
          <DockerSwarmResourceFields draft={resources} onChange={setResources} />
          <span className="text-xs muted">
            {t("update.resourcesHint")}
          </span>
        </div>

        {/* secrets / configs (opt-in replace) */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={setAttachOn} onChange={(e) => setSetAttachOn(e.target.checked)} />
            <span>{t("update.replaceAttach")}</span>
          </label>
          {setAttachOn ? (
            <div className="col" style={{ gap: "var(--sp-4)" }}>
              <div className="col" style={{ gap: "var(--sp-2)" }}>
                <span className="field-label" style={{ margin: 0 }}>
                  {t("update.secrets")}
                </span>
                <AttachRowsEditor kind="secret" rows={secretRows} options={secretOptions} onChange={setSecretRows} />
              </div>
              <div className="col" style={{ gap: "var(--sp-2)" }}>
                <span className="field-label" style={{ margin: 0 }}>
                  {t("update.configs")}
                </span>
                <AttachRowsEditor kind="config" rows={configRows} options={configOptions} onChange={setConfigRows} />
              </div>
              <span className="text-xs muted">
                {t("update.attachReplaceHint")}
              </span>
            </div>
          ) : (
            <span className="text-xs muted">{t("update.attachUnchecked")}</span>
          )}
        </div>
      </div>
    </Modal>
  );
}
