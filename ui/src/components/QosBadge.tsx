// ui/src/components/QosBadge.tsx
//
// Small pill rendering a Kubernetes QoS class with a token color:
//   Guaranteed -> --success (teal), Burstable -> --warning (amber),
//   BestEffort -> --text-muted (grey). Used on deployment rows (computed from the
//   pod-template resources) and pod rows (kubelet-reported QOSClass).

import type { K8sQosClass } from "../lib/types";

const META: Record<K8sQosClass, { label: string; color: string; bg: string; hint: string }> = {
  Guaranteed: {
    label: "Guaranteed",
    color: "var(--success)",
    bg: "var(--success-bg)",
    hint: "Every container sets CPU + memory requests and limits, with requests == limits.",
  },
  Burstable: {
    label: "Burstable",
    color: "var(--warning)",
    bg: "var(--warning-bg)",
    hint: "At least one container sets a request or limit, but not enough for Guaranteed.",
  },
  BestEffort: {
    label: "BestEffort",
    color: "var(--text-muted)",
    bg: "rgba(110,138,166,0.16)",
    hint: "No container sets any CPU or memory request or limit.",
  },
};

interface Props {
  /** The QoS class; pass undefined/"" to render nothing. */
  qos: K8sQosClass | "" | undefined;
  /** subtle = transparent background + colored border (for dense rows) */
  subtle?: boolean;
}

/** A colored pill for a Kubernetes QoS class (renders null when unset). */
export function QosBadge({ qos, subtle }: Props) {
  if (!qos) return null;
  const meta = META[qos];
  if (!meta) return null;
  return (
    <span
      className="pill"
      style={
        subtle
          ? { color: meta.color, background: "transparent", borderColor: meta.color }
          : { color: meta.color, background: meta.bg, borderColor: "transparent" }
      }
      title={meta.hint}
    >
      {meta.label}
    </span>
  );
}
