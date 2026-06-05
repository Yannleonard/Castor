// ui/src/views/K8sStorage.tsx
//
// Kubernetes storage (read + gated PVC writes): PersistentVolumes (cluster-
// scoped), PersistentVolumeClaims (namespaced, with a "Create PVC" modal and
// delete), and StorageClasses (cluster-scoped, with a default badge). A shared
// namespace selector scopes the PVC tab; PV/StorageClass are cluster-wide so the
// selector is hidden there. Write affordances are greyed-out before click via
// CapabilityGate (provider capability + RBAC k8s.storage.write); the backend
// re-checks. LIGHT BI theme.

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  useK8sPVs,
  useK8sPVCs,
  useK8sStorageClasses,
  useK8sNamespaces,
  useCapabilityLookup,
} from "../lib/hooks";
import { useSelectedHost } from "../lib/hostStore";
import { gateK8sCluster } from "../lib/rbac";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { OrchestratorBadge } from "../components/OrchestratorBadge";
import { ActionButton } from "../components/ActionButton";
import { CapabilityGate } from "../components/CapabilityGate";
import { ConfirmDestructiveDialog } from "../components/ConfirmDestructiveDialog";
import { Modal } from "../components/Modal";
import { IconVolumes, IconRefresh, IconPlus, IconTrash } from "../components/icons";
import { toast, toastError } from "../lib/toast";
import type { PVInfo, PVCInfo, StorageClassInfo } from "../lib/types";

type Tab = "pvs" | "pvcs" | "storageclasses";

// PVC / PV phase -> token color (Bound/Available are healthy; Pending warns;
// Released/Lost/Failed are danger).
function phaseColor(status: string): string {
  switch (status) {
    case "Bound":
    case "Available":
      return "var(--success)";
    case "Pending":
      return "var(--warning)";
    case "Released":
    case "Lost":
    case "Failed":
      return "var(--danger)";
    default:
      return "var(--text-secondary)";
  }
}

function PhasePill({ status }: { status: string }) {
  return (
    <span
      className="pill"
      style={{ color: phaseColor(status), background: "transparent", borderColor: "var(--border-strong)" }}
    >
      {status || "—"}
    </span>
  );
}

export function K8sStorage() {
  const hostId = useSelectedHost();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const { capsForKind } = useCapabilityLookup();
  const caps = capsForKind("kubernetes");

  const [tab, setTab] = useState<Tab>("pvs");
  const [namespace, setNamespace] = useState("");

  const pvsQ = useK8sPVs(hostId, tab === "pvs");
  const pvcsQ = useK8sPVCs(hostId, namespace, tab === "pvcs");
  const scQ = useK8sStorageClasses(hostId, tab === "storageclasses" || tab === "pvcs");
  // Namespaces feed the selector + the create-PVC form; load them once the PVC
  // tab is active.
  const nsQ = useK8sNamespaces(hostId, tab === "pvcs");

  const storageGate = gateK8sCluster("storage", caps, permissions);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PVCInfo | null>(null);

  // Namespace options: prefer the live namespace list, fall back to whatever the
  // loaded PVCs reference.
  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const n of nsQ.data ?? []) set.add(n.name);
    for (const c of pvcsQ.data ?? []) if (c.namespace) set.add(c.namespace);
    return Array.from(set).sort();
  }, [nsQ.data, pvcsQ.data]);

  const refetch = () => {
    if (tab === "pvs") pvsQ.refetch();
    else if (tab === "pvcs") pvcsQ.refetch();
    else scQ.refetch();
  };

  const invalidatePVCs = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "pvcs", hostId], exact: false });
  const invalidatePVs = () =>
    queryClient.invalidateQueries({ queryKey: ["k8s", "pvs", hostId], exact: false });

  const pvCols: Column<PVInfo>[] = [
    { key: "name", header: "Name", sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "capacity", header: "Capacity", sortValue: (v) => v.capacity, cell: (v) => <span className="mono">{v.capacity || "—"}</span> },
    { key: "status", header: "Status", sortValue: (v) => v.status, cell: (v) => <PhasePill status={v.status} /> },
    {
      key: "accessModes",
      header: "Access",
      cell: (v) => (
        <span className="row-wrap" style={{ gap: 4 }}>
          {v.accessModes.length ? v.accessModes.map((m) => <span key={m} className="chip text-xs">{m}</span>) : <span className="muted">—</span>}
        </span>
      ),
    },
    { key: "reclaim", header: "Reclaim", sortValue: (v) => v.reclaimPolicy, cell: (v) => <span className="text-sm secondary">{v.reclaimPolicy || "—"}</span> },
    { key: "storageClass", header: "Storage class", sortValue: (v) => v.storageClass, cell: (v) => (v.storageClass ? <span className="chip">{v.storageClass}</span> : <span className="muted">—</span>) },
    { key: "claim", header: "Claim", sortValue: (v) => v.claim, cell: (v) => <span className="mono text-xs">{v.claim || "—"}</span> },
  ];

  const pvcCols: Column<PVCInfo>[] = [
    { key: "name", header: "Name", sortValue: (v) => v.name, cell: (v) => <span style={{ fontWeight: 600 }}>{v.name}</span> },
    { key: "namespace", header: "Namespace", sortValue: (v) => v.namespace, cell: (v) => <span className="chip">{v.namespace}</span> },
    { key: "status", header: "Status", sortValue: (v) => v.status, cell: (v) => <PhasePill status={v.status} /> },
    { key: "capacity", header: "Capacity", sortValue: (v) => v.capacity, cell: (v) => <span className="mono">{v.capacity || "—"}</span> },
    {
      key: "accessModes",
      header: "Access",
      cell: (v) => (
        <span className="row-wrap" style={{ gap: 4 }}>
          {v.accessModes.length ? v.accessModes.map((m) => <span key={m} className="chip text-xs">{m}</span>) : <span className="muted">—</span>}
        </span>
      ),
    },
    { key: "storageClass", header: "Storage class", sortValue: (v) => v.storageClass, cell: (v) => (v.storageClass ? <span className="chip">{v.storageClass}</span> : <span className="muted">—</span>) },
    { key: "volume", header: "Volume", sortValue: (v) => v.volume, cell: (v) => <span className="mono text-xs muted">{v.volume || "—"}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "56px",
      cell: (v) => (
        <CapabilityGate gate={storageGate}>
          {(allowed, reason) => (
            <ActionButton
              size="sm"
              iconOnly
              variant="ghost"
              disabled={!allowed}
              tooltip={allowed ? "Delete PVC" : reason}
              aria-label="Delete PVC"
              onClick={() => setDeleteTarget(v)}
              style={allowed ? { color: "var(--danger)" } : undefined}
            >
              <IconTrash size={15} />
            </ActionButton>
          )}
        </CapabilityGate>
      ),
    },
  ];

  const scCols: Column<StorageClassInfo>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (v) => v.name,
      cell: (v) => (
        <span className="row" style={{ gap: "var(--sp-2)" }}>
          <span style={{ fontWeight: 600 }}>{v.name}</span>
          {v.isDefault ? (
            <span className="pill" style={{ color: "var(--accent)", background: "transparent", borderColor: "var(--accent)" }}>
              default
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "provisioner", header: "Provisioner", sortValue: (v) => v.provisioner, cell: (v) => <span className="mono text-xs">{v.provisioner}</span> },
    { key: "reclaim", header: "Reclaim", sortValue: (v) => v.reclaimPolicy, cell: (v) => <span className="text-sm secondary">{v.reclaimPolicy || "—"}</span> },
    { key: "binding", header: "Binding mode", sortValue: (v) => v.volumeBindingMode, cell: (v) => <span className="text-sm secondary">{v.volumeBindingMode || "—"}</span> },
  ];

  const loading =
    (tab === "pvs" && pvsQ.isLoading) ||
    (tab === "pvcs" && pvcsQ.isLoading) ||
    (tab === "storageclasses" && scQ.isLoading);

  const doDeletePVC = async () => {
    if (!deleteTarget) return;
    try {
      await api.k8sDeletePVC(hostId, deleteTarget.namespace, deleteTarget.name);
      toast.success("PVC deleted", `${deleteTarget.namespace}/${deleteTarget.name}`);
      invalidatePVCs();
      invalidatePVs();
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
            Storage
            <OrchestratorBadge kind="kubernetes" />
          </span>
        }
        subtitle="PersistentVolumes, claims and storage classes."
        actions={
          <div className="row">
            {tab === "pvcs" ? (
              <>
                <select className="select" style={{ width: 200 }} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
                  <option value="">All namespaces</option>
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>
                      {ns}
                    </option>
                  ))}
                </select>
                <CapabilityGate gate={storageGate}>
                  {(allowed, reason) => (
                    <ActionButton
                      variant="primary"
                      disabled={!allowed}
                      tooltip={allowed ? undefined : reason}
                      onClick={() => setCreateOpen(true)}
                    >
                      <IconPlus size={15} />
                      Create PVC
                    </ActionButton>
                  )}
                </CapabilityGate>
              </>
            ) : null}
            <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={refetch}>
              <IconRefresh size={16} />
            </ActionButton>
          </div>
        }
      />

      <div className="tabs">
        <button className={`tab${tab === "pvs" ? " active" : ""}`} onClick={() => setTab("pvs")}>
          Persistent Volumes
        </button>
        <button className={`tab${tab === "pvcs" ? " active" : ""}`} onClick={() => setTab("pvcs")}>
          Volume Claims
        </button>
        <button className={`tab${tab === "storageclasses" ? " active" : ""}`} onClick={() => setTab("storageclasses")}>
          Storage Classes
        </button>
      </div>

      {loading ? (
        <LoadingFill label="Loading storage…" />
      ) : tab === "pvs" ? (
        <DataTable
          columns={pvCols}
          rows={pvsQ.data ?? []}
          rowKey={(v) => v.name}
          defaultSortKey="name"
          emptyIcon={<IconVolumes size={40} />}
          emptyTitle="No persistent volumes"
          emptyMessage="No Kubernetes cluster is reachable, or no PVs are provisioned."
        />
      ) : tab === "pvcs" ? (
        <DataTable
          columns={pvcCols}
          rows={pvcsQ.data ?? []}
          rowKey={(v) => `${v.namespace}/${v.name}`}
          defaultSortKey="name"
          emptyIcon={<IconVolumes size={40} />}
          emptyTitle="No volume claims"
          emptyMessage="No PersistentVolumeClaims in this scope."
        />
      ) : (
        <DataTable
          columns={scCols}
          rows={scQ.data ?? []}
          rowKey={(v) => v.name}
          defaultSortKey="name"
          emptyIcon={<IconVolumes size={40} />}
          emptyTitle="No storage classes"
        />
      )}

      {/* ---- Create PVC ---- */}
      <CreatePVCModal
        open={createOpen}
        hostId={hostId}
        namespaces={namespaces}
        storageClasses={scQ.data ?? []}
        defaultNamespace={namespace}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          invalidatePVCs();
        }}
      />

      {/* ---- Delete PVC (confirm) ---- */}
      <ConfirmDestructiveDialog
        open={!!deleteTarget}
        title="Delete volume claim"
        variant="danger"
        confirmLabel="Delete"
        description={
          <>
            Delete{" "}
            <strong className="mono">
              {deleteTarget?.namespace}/{deleteTarget?.name}
            </strong>
            ? Depending on the volume&apos;s reclaim policy its bound PersistentVolume may be deleted too. This cannot be
            undone.
          </>
        }
        onConfirm={doDeletePVC}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ============================ Create PVC modal ============================ */

const SIZE_UNITS = ["Mi", "Gi", "Ti"] as const;
type SizeUnit = (typeof SIZE_UNITS)[number];

const UNIT_BYTES: Record<SizeUnit, number> = {
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
};

const ACCESS_MODES = ["ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany"] as const;

function CreatePVCModal({
  open,
  hostId,
  namespaces,
  storageClasses,
  defaultNamespace,
  onClose,
  onCreated,
}: {
  open: boolean;
  hostId: string;
  namespaces: string[];
  storageClasses: StorageClassInfo[];
  defaultNamespace: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(defaultNamespace || "default");
  const [storageClass, setStorageClass] = useState("");
  const [accessMode, setAccessMode] = useState<(typeof ACCESS_MODES)[number]>("ReadWriteOnce");
  const [size, setSize] = useState("1");
  const [unit, setUnit] = useState<SizeUnit>("Gi");
  const [busy, setBusy] = useState(false);

  // Seed each time the modal opens (so a reopened form is fresh).
  useEffect(() => {
    if (open) {
      setName("");
      setNs(defaultNamespace || "default");
      setStorageClass("");
      setAccessMode("ReadWriteOnce");
      setSize("1");
      setUnit("Gi");
      setBusy(false);
    }
  }, [open, defaultNamespace]);

  const sizeNum = Number(size);
  const sizeValid = Number.isFinite(sizeNum) && sizeNum > 0;
  const nameValid = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
  const nsValid = ns.trim().length > 0;
  const valid = nameValid && nsValid && sizeValid && !busy;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const requestBytes = Math.round(sizeNum * UNIT_BYTES[unit]);
      await api.k8sCreatePVC(hostId, {
        name: name.trim(),
        namespace: ns.trim(),
        storageClass: storageClass || undefined,
        accessModes: [accessMode],
        requestBytes,
      });
      toast.success("PVC created", `${ns.trim()}/${name.trim()} (${size}${unit})`);
      onCreated();
    } catch (err) {
      toastError("Create failed", err);
    } finally {
      setBusy(false);
    }
  };

  // Offer the known namespaces but allow free entry (the field is editable via
  // the select fallback to "default").
  const nsOptions = namespaces.length ? namespaces : ["default"];

  return (
    <Modal
      open={open}
      title="Create volume claim"
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
        <div className="field">
          <label className="field-label" htmlFor="pvc-name">
            Name
          </label>
          <input
            id="pvc-name"
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="data"
          />
          {name !== "" && !nameValid ? (
            <span className="field-error">Lowercase DNS label (a-z, 0-9, -).</span>
          ) : null}
        </div>

        <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap" }}>
          <div className="field" style={{ minWidth: 200, flex: 1 }}>
            <label className="field-label" htmlFor="pvc-ns">
              Namespace
            </label>
            <select id="pvc-ns" className="select" value={ns} onChange={(e) => setNs(e.target.value)}>
              {!nsOptions.includes(ns) ? <option value={ns}>{ns}</option> : null}
              {nsOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 200, flex: 1 }}>
            <label className="field-label" htmlFor="pvc-sc">
              Storage class
            </label>
            <select id="pvc-sc" className="select" value={storageClass} onChange={(e) => setStorageClass(e.target.value)}>
              <option value="">Cluster default</option>
              {storageClasses.map((sc) => (
                <option key={sc.name} value={sc.name}>
                  {sc.name}
                  {sc.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div className="field" style={{ minWidth: 200, flex: 1 }}>
            <label className="field-label" htmlFor="pvc-access">
              Access mode
            </label>
            <select
              id="pvc-access"
              className="select"
              value={accessMode}
              onChange={(e) => setAccessMode(e.target.value as (typeof ACCESS_MODES)[number])}
            >
              {ACCESS_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ width: 130 }}>
            <label className="field-label" htmlFor="pvc-size">
              Size
            </label>
            <input
              id="pvc-size"
              className="input"
              type="number"
              min={1}
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
            {size !== "" && !sizeValid ? <span className="field-error">Positive number.</span> : null}
          </div>

          <div className="field" style={{ width: 90 }}>
            <label className="field-label" htmlFor="pvc-unit">
              Unit
            </label>
            <select id="pvc-unit" className="select" value={unit} onChange={(e) => setUnit(e.target.value as SizeUnit)}>
              {SIZE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        <span className="text-xs muted">
          Requests <span className="mono">{sizeValid ? `${size}${unit}` : "—"}</span> of storage. A blank storage class
          uses the cluster default provisioner.
        </span>
      </div>
    </Modal>
  );
}
