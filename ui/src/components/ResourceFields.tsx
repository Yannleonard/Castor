// ui/src/components/ResourceFields.tsx
//
// Reusable CPU + memory inputs for resource limits / reservations / requests,
// shared by the Docker deploy modal, the Swarm create + update modals and the
// Kubernetes resources modal.
//
// Two flavours, because the backend speaks two different units:
//   - Docker / Swarm: CPU as decimal CORES (like `--cpus 0.5`), memory as BYTES.
//     <DockerSwarmResourceFields/> edits a {cpuLimit, memoryLimitBytes,
//     cpuReservation, memoryReservationBytes} value object (all in the wire units).
//   - Kubernetes: CPU as MILLICORES (500 = 0.5 core), memory as BYTES.
//     <K8sResourcePairFields/> edits a single {cpuMilli, memoryBytes} pair
//     (used twice: once for requests, once for limits).
//
// Memory is entered as a number + a MiB/GiB unit selector; the helpers below
// convert to/from bytes so callers always get/produce raw byte counts.

import { useT } from "../i18n";
import { resourceFieldsDict } from "../i18n/locales/resourceFields";

/* ============================ byte helpers ============================ */

export type MemUnit = "MiB" | "GiB";

const UNIT_BYTES: Record<MemUnit, number> = {
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
};

/** Convert a {value, unit} memory entry to bytes (0 when blank/invalid). */
export function memToBytes(value: string, unit: MemUnit): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * UNIT_BYTES[unit]);
}

/**
 * Split a byte count back into a {value, unit} entry for editing. Picks GiB once
 * the amount is a whole number of GiB (or >= 1 GiB), else MiB. 0/empty -> blank.
 */
export function bytesToMem(bytes: number | undefined | null): { value: string; unit: MemUnit } {
  if (!bytes || bytes <= 0) return { value: "", unit: "MiB" };
  const gib = bytes / UNIT_BYTES.GiB;
  if (bytes % UNIT_BYTES.GiB === 0 || gib >= 1) {
    // Trim trailing zeros from the fractional part.
    const v = Number(gib.toFixed(3));
    return { value: String(v), unit: "GiB" };
  }
  const mib = bytes / UNIT_BYTES.MiB;
  return { value: String(Number(mib.toFixed(3))), unit: "MiB" };
}

/** Parse a Kubernetes-style memory Quantity ("512Mi", "1Gi", "1.5Gi") to bytes. */
export function quantityToBytes(q: string | undefined): number {
  if (!q) return 0;
  const m = /^([0-9]*\.?[0-9]+)\s*(Ki|Mi|Gi|Ti|K|M|G|T)?$/.exec(q.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const suffix = m[2] ?? "";
  const factor: Record<string, number> = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  return Math.round(n * (factor[suffix] ?? 1));
}

/** Render bytes as a compact "512Mi" / "1Gi" Quantity-ish string ("—" if 0). */
export function bytesToQuantity(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes % UNIT_BYTES.GiB === 0) return `${bytes / UNIT_BYTES.GiB}Gi`;
  if (bytes % UNIT_BYTES.MiB === 0) return `${bytes / UNIT_BYTES.MiB}Mi`;
  const gib = bytes / UNIT_BYTES.GiB;
  if (gib >= 1) return `${Number(gib.toFixed(2))}Gi`;
  return `${Number((bytes / UNIT_BYTES.MiB).toFixed(2))}Mi`;
}

/** Parse a Kubernetes CPU Quantity ("500m", "1", "0.5") to millicores (0 if unset). */
export function cpuToMilli(q: string | undefined): number {
  if (!q) return 0;
  const s = q.trim();
  if (s.endsWith("m")) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
}

/* ============================ small primitives ============================ */

function NumInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  width,
  step,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  width?: number | string;
  step?: string;
}) {
  return (
    <input
      className="input"
      type="number"
      min={0}
      step={step}
      inputMode="decimal"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={width !== undefined ? { width } : undefined}
    />
  );
}

function MemoryInput({
  value,
  unit,
  onValue,
  onUnit,
  amountAria,
  unitAria,
}: {
  value: string;
  unit: MemUnit;
  onValue: (v: string) => void;
  onUnit: (u: MemUnit) => void;
  amountAria: string;
  unitAria: string;
}) {
  return (
    <span className="row" style={{ gap: 6, alignItems: "center" }}>
      <NumInput value={value} onChange={onValue} placeholder="0" ariaLabel={amountAria} width={96} />
      <select
        className="select"
        aria-label={unitAria}
        value={unit}
        onChange={(e) => onUnit(e.target.value as MemUnit)}
        style={{ width: 78 }}
      >
        <option value="MiB">MiB</option>
        <option value="GiB">GiB</option>
      </select>
    </span>
  );
}

/* ===================== Docker / Swarm (cores + bytes) ===================== */

// The value object edited by <DockerSwarmResourceFields/> — same field names &
// units (cpu cores, memory bytes) the deploy / swarm create+update bodies want.
export interface DockerSwarmResources {
  cpuLimit: number;
  memoryLimitBytes: number;
  cpuReservation: number;
  memoryReservationBytes: number;
}

export const EMPTY_DOCKER_SWARM_RESOURCES: DockerSwarmResources = {
  cpuLimit: 0,
  memoryLimitBytes: 0,
  cpuReservation: 0,
  memoryReservationBytes: 0,
};

// Local editing state keeps memory as a {value,unit} pair plus the CPU strings so
// the inputs stay controlled and empty == unset.
export interface DockerSwarmResourcesDraft {
  cpuLimit: string;
  memLimitValue: string;
  memLimitUnit: MemUnit;
  cpuReservation: string;
  memResValue: string;
  memResUnit: MemUnit;
}

/** Seed an editing draft from a resources value object (0 -> blank inputs). */
export function draftFromResources(r: Partial<DockerSwarmResources> | undefined): DockerSwarmResourcesDraft {
  const lim = bytesToMem(r?.memoryLimitBytes);
  const res = bytesToMem(r?.memoryReservationBytes);
  return {
    cpuLimit: r?.cpuLimit && r.cpuLimit > 0 ? String(r.cpuLimit) : "",
    memLimitValue: lim.value,
    memLimitUnit: lim.unit,
    cpuReservation: r?.cpuReservation && r.cpuReservation > 0 ? String(r.cpuReservation) : "",
    memResValue: res.value,
    memResUnit: res.unit,
  };
}

/** Collapse an editing draft back to the wire value object (blank -> 0). */
export function resourcesFromDraft(d: DockerSwarmResourcesDraft): DockerSwarmResources {
  const cpuLimit = Number(d.cpuLimit);
  const cpuRes = Number(d.cpuReservation);
  return {
    cpuLimit: Number.isFinite(cpuLimit) && cpuLimit > 0 ? cpuLimit : 0,
    memoryLimitBytes: memToBytes(d.memLimitValue, d.memLimitUnit),
    cpuReservation: Number.isFinite(cpuRes) && cpuRes > 0 ? cpuRes : 0,
    memoryReservationBytes: memToBytes(d.memResValue, d.memResUnit),
  };
}

export function DockerSwarmResourceFields({
  draft,
  onChange,
  showReservations = true,
}: {
  draft: DockerSwarmResourcesDraft;
  onChange: (d: DockerSwarmResourcesDraft) => void;
  /** hide the reservation row (limits only) */
  showReservations?: boolean;
}) {
  const t = useT(resourceFieldsDict);
  const set = (patch: Partial<DockerSwarmResourcesDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <span className="field-label">{t("docker.cpuLimitLabel")}</span>
          <NumInput
            value={draft.cpuLimit}
            onChange={(v) => set({ cpuLimit: v })}
            placeholder={t("docker.cpuLimitPlaceholder")}
            ariaLabel={t("docker.cpuLimitAria")}
            width={120}
            step="0.1"
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <span className="field-label">{t("docker.memLimitLabel")}</span>
          <MemoryInput
            value={draft.memLimitValue}
            unit={draft.memLimitUnit}
            onValue={(v) => set({ memLimitValue: v })}
            onUnit={(u) => set({ memLimitUnit: u })}
            amountAria={t("mem.amountAria", { prefix: t("docker.memLimitLabel") })}
            unitAria={t("mem.unitAria", { prefix: t("docker.memLimitLabel") })}
          />
        </div>
      </div>
      {showReservations ? (
        <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">{t("docker.cpuReservationLabel")}</span>
            <NumInput
              value={draft.cpuReservation}
              onChange={(v) => set({ cpuReservation: v })}
              placeholder={t("docker.cpuReservationPlaceholder")}
              ariaLabel={t("docker.cpuReservationAria")}
              width={120}
              step="0.1"
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">{t("docker.memReservationLabel")}</span>
            <MemoryInput
              value={draft.memResValue}
              unit={draft.memResUnit}
              onValue={(v) => set({ memResValue: v })}
              onUnit={(u) => set({ memResUnit: u })}
              amountAria={t("mem.amountAria", { prefix: t("docker.memReservationLabel") })}
              unitAria={t("mem.unitAria", { prefix: t("docker.memReservationLabel") })}
            />
          </div>
        </div>
      ) : null}
      <span className="field-hint">{t("hint.blankUnset")}</span>
    </div>
  );
}

/* ===================== Kubernetes (millicores + bytes) ===================== */

// A single CPU+memory pair (requests OR limits) in the wire units.
export interface K8sPair {
  cpuMilli: number;
  memoryBytes: number;
}

export interface K8sPairDraft {
  cpuMilli: string; // millicores as a plain number string
  memValue: string;
  memUnit: MemUnit;
}

export const EMPTY_K8S_PAIR_DRAFT: K8sPairDraft = { cpuMilli: "", memValue: "", memUnit: "MiB" };

/** Seed a K8s pair draft from cpu/memory Quantity strings ("500m","128Mi"). */
export function k8sPairDraftFromQuantities(cpu: string | undefined, mem: string | undefined): K8sPairDraft {
  const milli = cpuToMilli(cpu);
  const bytes = quantityToBytes(mem);
  const m = bytesToMem(bytes);
  return {
    cpuMilli: milli > 0 ? String(milli) : "",
    memValue: m.value,
    memUnit: m.unit,
  };
}

/** Collapse a K8s pair draft to the wire pair (blank -> 0). */
export function k8sPairFromDraft(d: K8sPairDraft): K8sPair {
  const milli = Number(d.cpuMilli);
  return {
    cpuMilli: Number.isFinite(milli) && milli > 0 ? Math.round(milli) : 0,
    memoryBytes: memToBytes(d.memValue, d.memUnit),
  };
}

export function K8sResourcePairFields({
  label,
  draft,
  onChange,
}: {
  /** "Requests" or "Limits" */
  label: string;
  draft: K8sPairDraft;
  onChange: (d: K8sPairDraft) => void;
}) {
  const t = useT(resourceFieldsDict);
  const set = (patch: Partial<K8sPairDraft>) => onChange({ ...draft, ...patch });
  const memoryAria = t("k8s.memoryAria", { label });
  return (
    <div className="col" style={{ gap: "var(--sp-2)" }}>
      <span className="field-label" style={{ margin: 0 }}>
        {label}
      </span>
      <div className="row" style={{ gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <span className="field-hint" style={{ marginBottom: 4 }}>
            {t("k8s.cpuHint")}
          </span>
          <NumInput
            value={draft.cpuMilli}
            onChange={(v) => set({ cpuMilli: v.replace(/[^0-9]/g, "") })}
            placeholder={t("k8s.cpuPlaceholder")}
            ariaLabel={t("k8s.cpuAria", { label })}
            width={120}
            step="10"
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <span className="field-hint" style={{ marginBottom: 4 }}>
            {t("k8s.memoryHint")}
          </span>
          <MemoryInput
            value={draft.memValue}
            unit={draft.memUnit}
            onValue={(v) => set({ memValue: v })}
            onUnit={(u) => set({ memUnit: u })}
            amountAria={t("mem.amountAria", { prefix: memoryAria })}
            unitAria={t("mem.unitAria", { prefix: memoryAria })}
          />
        </div>
      </div>
    </div>
  );
}
