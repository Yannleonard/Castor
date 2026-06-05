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
        <span className="mono text-xs muted" title="Reservations">
          ≥ {res.join(" · ")}
        </span>
      ) : null}
    </span>
  );
}

// Small copy-able shell command used in the guided empty state.
function InlineCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copied to clipboard", command);
    }
  };
  return (
    <div className="help-cmd">
      <code className="help-cmd-text">{command}</code>
      <button type="button" className="btn btn-ghost btn-sm btn-icon help-cmd-copy" onClick={copy} aria-label="Copy command" title="Copy command">
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

export function SwarmServices() {
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
    { key: "name", header: "Service", sortValue: (s) => s.name, cell: (s) => <span style={{ fontWeight: 600 }}>{s.name}</span> },
    { key: "mode", header: "Mode", sortValue: (s) => s.mode, cell: (s) => <span className="chip">{s.mode}</span> },
    { key: "replicas", header: "Replicas", sortValue: (s) => s.replicas, cell: (s) => <span className="mono">{s.replicas}</span> },
    { key: "image", header: "Image", sortValue: (s) => s.image, cell: (s) => <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={s.image}>{s.image}</span> },
    { key: "resources", header: "Resources", cell: (s) => <ResourceSummary r={s.resources} /> },
    { key: "id", header: "ID", cell: (s) => <span className="mono text-xs muted">{shortId(s.id)}</span> },
    { key: "created", header: "Created", sortValue: (s) => s.createdAt, cell: (s) => <span className="text-xs muted nowrap">{timeAgo(s.createdAt)}</span> },
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
                tooltip={allowed ? "Scale" : reason}
                aria-label="Scale service"
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
                tooltip={allowed ? "Update" : reason}
                aria-label="Update service"
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
                tooltip={allowed ? "Force restart" : reason}
                aria-label="Restart service"
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
                tooltip={allowed ? "Remove" : reason}
                aria-label="Remove service"
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
    { key: "name", header: "Task", sortValue: (t) => cleanName(t.name), cell: (t) => <span className="truncate">{cleanName(t.name)}</span> },
    { key: "state", header: "State", sortValue: (t) => t.state, cell: (t) => <StateBadge state={t.state} raw={t.stateRaw} /> },
    { key: "node", header: "Node", sortValue: (t) => t.node ?? "", cell: (t) => <span className="text-sm secondary">{t.node || "—"}</span> },
    { key: "image", header: "Image", sortValue: (t) => t.image, cell: (t) => <span className="mono text-xs truncate" style={{ maxWidth: 240, display: "inline-block" }} title={t.image}>{t.image}</span> },
    { key: "group", header: "Service", sortValue: (t) => t.group ?? "", cell: (t) => (t.group ? <span className="chip">{t.group}</span> : <span className="muted">—</span>) },
    { key: "created", header: "Created", sortValue: (t) => t.createdAt, cell: (t) => <span className="text-xs muted nowrap">{timeAgo(t.createdAt)}</span> },
  ];

  const nodeCols: Column<SwarmNode>[] = [
    { key: "hostname", header: "Hostname", sortValue: (n) => n.hostname, cell: (n) => <span style={{ fontWeight: 600 }}>{n.hostname}</span> },
    {
      key: "role",
      header: "Role",
      sortValue: (n) => n.role,
      cell: (n) => (
        <span className="pill" style={{ color: n.role === "manager" ? "var(--accent)" : "var(--text-secondary)", borderColor: "var(--border-strong)", background: "transparent" }}>
          {n.role}
        </span>
      ),
    },
    { key: "availability", header: "Availability", sortValue: (n) => n.availability, cell: (n) => <span className="text-sm secondary">{n.availability}</span> },
    { key: "state", header: "State", sortValue: (n) => n.state, cell: (n) => <span className="chip">{n.state}</span> },
    { key: "addr", header: "Address", cell: (n) => <span className="mono text-xs muted">{n.addr || "—"}</span> },
    { key: "id", header: "ID", cell: (n) => <span className="mono text-xs muted">{shortId(n.id)}</span> },
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
                {isActive ? "Drain" : "Activate"}
              </ActionButton>
            )}
          </CapabilityGate>
        );
      },
    },
  ];

  const secretCols: Column<SwarmSecretInfo>[] = [
    { key: "name", header: "Name", sortValue: (s) => s.name, cell: (s) => <span className="row" style={{ gap: 6, fontWeight: 600 }}><IconLock size={13} />{s.name}</span> },
    { key: "id", header: "ID", cell: (s) => <span className="mono text-xs muted">{shortId(s.id)}</span> },
    { key: "created", header: "Created", sortValue: (s) => s.createdAt, cell: (s) => <span className="text-xs muted nowrap">{timeAgo(s.createdAt)}</span> },
    { key: "updated", header: "Updated", sortValue: (s) => s.updatedAt, cell: (s) => <span className="text-xs muted nowrap">{timeAgo(s.updatedAt)}</span> },
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
              tooltip={allowed ? "Delete secret" : reason}
              aria-label="Delete secret"
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
    { key: "name", header: "Name", sortValue: (c) => c.name, cell: (c) => <span style={{ fontWeight: 600 }}>{c.name}</span> },
    { key: "id", header: "ID", cell: (c) => <span className="mono text-xs muted">{shortId(c.id)}</span> },
    { key: "created", header: "Created", sortValue: (c) => c.createdAt, cell: (c) => <span className="text-xs muted nowrap">{timeAgo(c.createdAt)}</span> },
    { key: "updated", header: "Updated", sortValue: (c) => c.updatedAt, cell: (c) => <span className="text-xs muted nowrap">{timeAgo(c.updatedAt)}</span> },
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
              tooltip={allowed ? "Delete config" : reason}
              aria-label="Delete config"
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
      toast.success(next === "drain" ? "Node draining" : "Node activated", nodeTarget.hostname);
      invalidateNodes();
    } catch (err) {
      toastError(next === "drain" ? "Drain failed" : "Activate failed", err);
      throw err;
    }
  };

  const doRestart = async () => {
    if (!restartTarget) return;
    try {
      await api.swarmServiceRestart(hostId, restartTarget.id);
      toast.success("Service restarting", `${restartTarget.name} — tasks are being redeployed.`);
      invalidateServices();
    } catch (err) {
      toastError("Restart failed", err);
      throw err;
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await api.swarmServiceRemove(hostId, removeTarget.id);
      toast.success("Service removed", removeTarget.name);
      invalidateServices();
    } catch (err) {
      toastError("Remove failed", err);
      throw err;
    }
  };

  const doDeleteSecret = async () => {
    if (!secretDeleteTarget) return;
    try {
      await api.swarmSecretRemove(hostId, secretDeleteTarget.id);
      toast.success("Secret deleted", secretDeleteTarget.name);
      invalidateSecrets();
    } catch (err) {
      toastError("Delete failed", err);
      throw err;
    }
  };

  const doDeleteConfig = async () => {
    if (!configDeleteTarget) return;
    try {
      await api.swarmConfigRemove(hostId, configDeleteTarget.id);
      toast.success("Config deleted", configDeleteTarget.name);
      invalidateConfigs();
    } catch (err) {
      toastError("Delete failed", err);
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
        subtitle="Manage Swarm services, secrets and configs; tasks are read-only."
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
                    Deploy service
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : section === "secrets" ? (
              <CapabilityGate gate={secretGate}>
                {(allowed, reason) => (
                  <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateSecretOpen(true)}>
                    <IconPlus size={15} />
                    Create secret
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : section === "configs" ? (
              <CapabilityGate gate={configGate}>
                {(allowed, reason) => (
                  <ActionButton variant="primary" disabled={!allowed} tooltip={allowed ? undefined : reason} onClick={() => setCreateConfigOpen(true)}>
                    <IconPlus size={15} />
                    Create config
                  </ActionButton>
                )}
              </CapabilityGate>
            ) : null}
            <ActionButton variant="ghost" iconOnly tooltip="Setup guide" aria-label="Setup guide" onClick={() => setHelpOpen(true)}>
              <IconHelp size={16} />
            </ActionButton>
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${section === "services" ? " active" : ""}`} onClick={() => setSection("services")}>
          Services
        </button>
        <button className={`tab${section === "tasks" ? " active" : ""}`} onClick={() => setSection("tasks")}>
          Tasks
        </button>
        <button className={`tab${section === "nodes" ? " active" : ""}`} onClick={() => setSection("nodes")}>
          Nodes
        </button>
        <button className={`tab${section === "secrets" ? " active" : ""}`} onClick={() => setSection("secrets")}>
          Secrets
        </button>
        <button className={`tab${section === "configs" ? " active" : ""}`} onClick={() => setSection("configs")}>
          Configs
        </button>
      </div>

      {loading ? (
        <LoadingFill label="Loading swarm data…" />
      ) : section === "services" ? (
        (servicesQ.data ?? []).length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconSwarm size={40} />}
              title="No swarm services"
              message="This engine is not part of an active swarm, or has no services. Initialise a single-node swarm to start deploying, then add nodes for high availability."
              action={
                <div className="help-guide">
                  <ActionButton variant="primary" onClick={() => setHelpOpen(true)}>
                    <IconHelp size={15} />
                    Show setup guide
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
            emptyTitle="No swarm services"
            emptyMessage="This engine is not part of an active swarm, or has no services."
          />
        )
      ) : section === "tasks" ? (
        <DataTable
          columns={taskCols}
          rows={tasksQ.data ?? []}
          rowKey={(t) => t.id}
          defaultSortKey="name"
          onRowClick={(t) => navigate(`/workloads/${encodeURIComponent(hostId)}/${encodeURIComponent(t.id)}`)}
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle="No swarm tasks"
        />
      ) : section === "secrets" ? (
        <DataTable
          columns={secretCols}
          rows={secretsQ.data ?? []}
          rowKey={(s) => s.id}
          defaultSortKey="name"
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle="No swarm secrets"
          emptyMessage="Secret values are write-only and are never shown — only names and timestamps."
        />
      ) : section === "configs" ? (
        <DataTable
          columns={configCols}
          rows={configsQ.data ?? []}
          rowKey={(c) => c.id}
          defaultSortKey="name"
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle="No swarm configs"
        />
      ) : (
        <DataTable
          columns={nodeCols}
          rows={nodesQ.data ?? []}
          rowKey={(n) => n.id}
          defaultSortKey="hostname"
          emptyIcon={<IconSwarm size={40} />}
          emptyTitle="No swarm nodes"
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
        title="Restart service"
        variant="primary"
        confirmLabel="Restart"
        description={
          <>
            Force a rolling redeploy of every task in{" "}
            <strong className="mono">{restartTarget?.name}</strong>? The image and configuration are unchanged.
          </>
        }
        onConfirm={doRestart}
        onClose={() => setRestartTarget(null)}
      />

      {/* ---- Remove (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!removeTarget}
        title="Remove service"
        variant="danger"
        confirmLabel="Remove"
        description={
          <>
            Remove <strong className="mono">{removeTarget?.name}</strong> and all of its tasks? This cannot be undone.
          </>
        }
        onConfirm={doRemove}
        onClose={() => setRemoveTarget(null)}
      />

      {/* ---- Node drain/activate (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!nodeTarget}
        title={nodeIsActive ? "Drain node" : "Activate node"}
        variant={nodeIsActive ? "danger" : "primary"}
        confirmLabel={nodeIsActive ? "Drain" : "Activate"}
        description={
          nodeIsActive ? (
            <>
              Drain <strong className="mono">{nodeTarget?.hostname}</strong>? Tasks are rescheduled off this node and no
              new tasks are placed on it.
            </>
          ) : (
            <>
              Set <strong className="mono">{nodeTarget?.hostname}</strong> back to <strong>active</strong> so the
              scheduler can place tasks on it again?
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
        title="Delete secret"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete secret <strong className="mono">{secretDeleteTarget?.name}</strong>? Services still referencing it must
            be updated first; a secret in use cannot be removed.
          </>
        }
        onConfirm={doDeleteSecret}
        onClose={() => setSecretDeleteTarget(null)}
      />

      {/* ---- Delete config (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!configDeleteTarget}
        title="Delete config"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete config <strong className="mono">{configDeleteTarget?.name}</strong>? Services still referencing it must
            be updated first; a config in use cannot be removed.
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
  const update = (i: number, patch: Partial<AttachRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { id: "", targetFile: "" }]);

  const mountRoot = kind === "secret" ? "/run/secrets/" : "/";
  const noun = kind === "secret" ? "secret" : "config";

  if (options.length === 0) {
    return (
      <span className="text-xs muted">
        No {noun}s exist yet — create one in the {noun.charAt(0).toUpperCase() + noun.slice(1)}s tab first.
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
              aria-label={`Select ${noun}`}
              style={{ minWidth: 180, flex: 1 }}
            >
              <option value="">Select a {noun}…</option>
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
              aria-label="Target file"
              style={{ flex: 1, minWidth: 160 }}
            />
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              aria-label={`Remove ${noun}`}
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
          Attach {noun}
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
  const noun = kind === "secret" ? "secret" : "config";

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      if (kind === "secret") {
        await api.swarmSecretCreate(hostId, { name: name.trim(), data: value });
      } else {
        await api.swarmConfigCreate(hostId, { name: name.trim(), data: value });
      }
      toast.success(`${noun.charAt(0).toUpperCase() + noun.slice(1)} created`, name.trim());
      onDone();
    } catch (err) {
      toastError("Create failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={`Create ${noun}`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Create
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <TextField
          label="Name"
          mono
          autoFocus
          placeholder={kind === "secret" ? "db_password" : "nginx_conf"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={name && !nameOk ? "Letters, digits, dot, dash, underscore (max 64)." : undefined}
          style={{ maxWidth: 360 }}
        />
        <div className="field">
          <label className="field-label" htmlFor="secret-value">
            Value{kind === "secret" ? " (write-only)" : ""}
          </label>
          <textarea
            id="secret-value"
            className="textarea input-mono"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "secret" ? "super-secret-value" : "server { listen 80; }"}
            style={{ minHeight: 160, fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre", tabSize: 2 }}
            aria-label={`${noun} value`}
          />
          {kind === "secret" ? (
            <span className="field-hint">
              Stored encrypted by the swarm; the value is never shown again after creation.
            </span>
          ) : (
            <span className="field-hint">Configs are non-secret content mounted as files (e.g. an nginx.conf).</span>
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
      toast.success("Service deployed", `${body.name} — ${shortId(res.id)}`);
      onDone();
    } catch (err) {
      toastError("Deploy failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title="Deploy service"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Deploy
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <TextField
            label="Name"
            placeholder="web"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={name && !nameOk ? "Letters, digits, dot, dash, underscore (max 63)." : undefined}
            style={{ minWidth: 200 }}
          />
          <TextField
            label="Image"
            mono
            placeholder="nginx:latest"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            style={{ minWidth: 240, flex: 1 }}
          />
        </div>

        <div className="row" style={{ gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <TextField
            label="Replicas"
            type="number"
            min={0}
            value={replicas}
            onChange={(e) => setReplicas(e.target.value)}
            error={replicas !== "" && !replicasOk ? "Whole number ≥ 0." : undefined}
            style={{ width: 120 }}
          />
          <SelectField label="Restart" value={restart} onChange={(e) => setRestart(e.target.value)}>
            {RESTART_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
        </div>

        <TextField
          label="Networks"
          mono
          placeholder="frontend backend"
          value={networks}
          onChange={(e) => setNetworks(e.target.value)}
          hint="Attached overlay networks by name/id (space or comma separated)."
        />

        {/* ports */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            Published ports
          </span>
          {ports.map((p, i) => (
            <div key={i} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
              <input
                className="input"
                type="number"
                min={0}
                placeholder="published"
                value={p.published}
                onChange={(e) => setPorts((prev) => prev.map((x, idx) => (idx === i ? { ...x, published: e.target.value } : x)))}
                style={{ width: 110 }}
                aria-label="Published port"
              />
              <span className="muted">:</span>
              <input
                className="input"
                type="number"
                min={1}
                placeholder="target"
                value={p.target}
                onChange={(e) => setPorts((prev) => prev.map((x, idx) => (idx === i ? { ...x, target: e.target.value } : x)))}
                style={{ width: 100 }}
                aria-label="Target port"
              />
              <select
                className="select"
                value={p.protocol}
                onChange={(e) => setPorts((prev) => prev.map((x, idx) => (idx === i ? { ...x, protocol: e.target.value } : x)))}
                style={{ width: 90 }}
                aria-label="Protocol"
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
                <option value="sctp">sctp</option>
              </select>
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                aria-label="Remove port"
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
              Add port
            </ActionButton>
          </div>
        </div>

        {/* env */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            Environment
          </span>
          {env.map((e, i) => (
            <div key={i} className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
              <input
                className="input input-mono"
                placeholder="KEY"
                value={e.key}
                onChange={(ev) => setEnv((prev) => prev.map((x, idx) => (idx === i ? { ...x, key: ev.target.value } : x)))}
                style={{ width: 200 }}
                aria-label="Env key"
              />
              <span className="muted">=</span>
              <input
                className="input input-mono"
                placeholder="value"
                value={e.value}
                onChange={(ev) => setEnv((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: ev.target.value } : x)))}
                style={{ flex: 1, minWidth: 160 }}
                aria-label="Env value"
              />
              <ActionButton
                size="sm"
                iconOnly
                variant="ghost"
                aria-label="Remove env var"
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
              Add variable
            </ActionButton>
          </div>
        </div>

        {/* resources */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            Resources
          </span>
          <DockerSwarmResourceFields draft={resources} onChange={setResources} />
        </div>

        {/* secrets */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            Secrets
          </span>
          <AttachRowsEditor kind="secret" rows={secretRows} options={secretOptions} onChange={setSecretRows} />
        </div>

        {/* configs */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            Configs
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
      toast.success("Service scaled", `${target.name} → ${n} replica(s).`);
      onDone();
    } catch (err) {
      toastError("Scale failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      title="Scale service"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Scale
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-3)" }}>
        <div className="text-sm secondary">
          Service <strong className="mono">{target?.name}</strong> — currently{" "}
          <span className="mono">{target?.replicas}</span>.
        </div>
        <TextField
          label="Replicas"
          type="number"
          min={0}
          autoFocus
          value={replicas}
          onChange={(e) => setReplicas(e.target.value)}
          error={replicas !== "" && !(Number.isInteger(n) && n >= 0) ? "Whole number ≥ 0." : undefined}
          hint="Only replicated services can be scaled."
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
      toast.success("Service updated", `${target.name} — rolling update in progress.`);
      onDone();
    } catch (err) {
      toastError("Update failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      wide
      title="Update service"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <ActionButton variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            Apply update
          </ActionButton>
        </>
      }
    >
      <div className="col" style={{ gap: "var(--sp-4)" }}>
        <div className="text-sm secondary">
          Updating <strong className="mono">{target?.name}</strong>. Changing the image triggers a rolling update.
        </div>
        <TextField
          label="Image"
          mono
          placeholder="nginx:1.27"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          error={image.trim().length === 0 ? "Image is required." : undefined}
        />
        <TextField
          label="Replicas"
          type="number"
          min={0}
          value={replicas}
          onChange={(e) => setReplicas(e.target.value)}
          error={!replicasOk ? "Whole number ≥ 0." : undefined}
          hint="Replicated services only. Leave as-is to keep the current count."
          style={{ width: 160 }}
        />
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={setEnvOn} onChange={(e) => setSetEnvOn(e.target.checked)} />
            <span>Replace environment</span>
          </label>
          {setEnvOn ? (
            <textarea
              className="textarea input-mono"
              spellCheck={false}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={"KEY=value\nANOTHER=value"}
              style={{ minHeight: 120, fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre", tabSize: 2 }}
              aria-label="Environment (one KEY=value per line)"
            />
          ) : (
            <span className="text-xs muted">Leave unchecked to keep the existing environment.</span>
          )}
        </div>

        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <span className="field-label" style={{ margin: 0 }}>
            Resources
          </span>
          <DockerSwarmResourceFields draft={resources} onChange={setResources} />
          <span className="text-xs muted">
            Seeded from the current limits. Clearing a field removes that limit on apply.
          </span>
        </div>

        {/* secrets / configs (opt-in replace) */}
        <div className="col" style={{ gap: "var(--sp-2)" }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={setAttachOn} onChange={(e) => setSetAttachOn(e.target.checked)} />
            <span>Replace secrets &amp; configs</span>
          </label>
          {setAttachOn ? (
            <div className="col" style={{ gap: "var(--sp-4)" }}>
              <div className="col" style={{ gap: "var(--sp-2)" }}>
                <span className="field-label" style={{ margin: 0 }}>
                  Secrets
                </span>
                <AttachRowsEditor kind="secret" rows={secretRows} options={secretOptions} onChange={setSecretRows} />
              </div>
              <div className="col" style={{ gap: "var(--sp-2)" }}>
                <span className="field-label" style={{ margin: 0 }}>
                  Configs
                </span>
                <AttachRowsEditor kind="config" rows={configRows} options={configOptions} onChange={setConfigRows} />
              </div>
              <span className="text-xs muted">
                This REPLACES the full set of attached secrets/configs (empty = detach all).
              </span>
            </div>
          ) : (
            <span className="text-xs muted">Leave unchecked to keep the service's current secret/config attachments.</span>
          )}
        </div>
      </div>
    </Modal>
  );
}
