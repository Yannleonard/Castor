// ui/src/views/marketplace/DeployedInstances.tsx
//
// "Deployed instances" affordance for the marketplace. Containers deployed from a
// template carry the reserved label io.castor.template=<slug> (and
// io.castor.managed=true), so the whole catalog's deployment counts come from a
// SINGLE page-level query — useWorkloads(hostId, { labelSelector: 'io.castor.template' })
// — not one request per card. This module exposes:
//
//   • LABEL_TEMPLATE / LABEL_SELECTOR_ANY — the reserved keys.
//   • countBySlug(workloads) — group a workload list by its template slug.
//   • DeployedBadge — a per-card "N deployed" pill/button (keyed on the SLUG,
//     since built-in templates have an empty id). Clicking opens the modal.
//   • DeployedInstancesModal — lists the instances (name, state, created) for one
//     slug, filtered client-side from the same page-level list.
//
// Everything is derived from the one list the page already holds, so adding the
// badge to every card costs zero extra requests.

import { useMemo } from "react";
import { Modal } from "../../components/Modal";
import { StateBadge } from "../../components/StateBadge";
import { EmptyState } from "../../components/EmptyState";
import { IconWorkloads } from "../../components/icons";
import { cleanName, timeAgo } from "../../lib/format";
import type { Template, Workload } from "../../lib/types";
import { useT } from "../../i18n";
import { mktDeployedInstancesDict } from "../../i18n/locales/mktDeployedInstances";

/** Reserved label carrying the marketplace template slug on deployed containers. */
export const LABEL_TEMPLATE = "io.castor.template";
/** Bare-key selector matching every template-deployed container (any slug). */
export const LABEL_SELECTOR_ANY = LABEL_TEMPLATE;

/**
 * Group deployed workloads by their template slug. A workload counts when it
 * carries a non-empty io.castor.template label. Returns slug -> instances so the
 * page can look up both the count and the list without a per-slug query.
 */
export function groupBySlug(workloads: Workload[] | undefined): Map<string, Workload[]> {
  const out = new Map<string, Workload[]>();
  for (const w of workloads ?? []) {
    const slug = w.labels?.[LABEL_TEMPLATE];
    if (!slug) continue;
    const list = out.get(slug);
    if (list) list.push(w);
    else out.set(slug, [w]);
  }
  return out;
}

/**
 * A compact "N deployed" pill for a template card. Renders nothing when the count
 * is zero (keeps cards clean for never-deployed templates). Clicking surfaces the
 * instance list for this slug via onOpen.
 */
export function DeployedBadge({ count, onOpen }: { count: number; onOpen: () => void }) {
  const t = useT(mktDeployedInstancesDict);
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className="pill mkt-deployed-badge"
      onClick={onOpen}
      title={t(count === 1 ? "badge.title" : "badge.titlePlural", { count })}
      style={{
        cursor: "pointer",
        color: "var(--accent)",
        background: "var(--info-bg)",
        borderColor: "transparent",
      }}
    >
      <IconWorkloads size={12} />
      {t("badge.label", { count })}
    </button>
  );
}

/**
 * Modal listing every instance deployed from a given template. The instances are
 * passed in (already filtered from the page-level list) so opening the modal does
 * not trigger a new request.
 */
export function DeployedInstancesModal({
  template,
  instances,
  onClose,
}: {
  template: Template | null;
  instances: Workload[];
  onClose: () => void;
}) {
  const t = useT(mktDeployedInstancesDict);

  // Newest first — most-recently deployed instance is usually what you want.
  const rows = useMemo(
    () => instances.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [instances],
  );

  return (
    <Modal
      open={!!template}
      wide
      title={
        <span className="row" style={{ gap: "var(--sp-2)" }}>
          {t("modal.title")}
          <span className="mono" style={{ fontWeight: 600 }}>
            {template?.name}
          </span>
          <span className="chip">{rows.length}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {t("modal.close")}
        </button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<IconWorkloads size={36} />}
          title={t("empty.title")}
          message={t("empty.message")}
        />
      ) : (
        <table className="dt">
          <thead>
            <tr>
              <th>{t("col.name")}</th>
              <th>{t("col.state")}</th>
              <th>{t("col.created")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={`${w.providerId}:${w.id}`}>
                <td>
                  <span style={{ fontWeight: 600 }}>{cleanName(w.name)}</span>
                </td>
                <td>
                  <StateBadge state={w.state} raw={w.stateRaw} />
                </td>
                <td className="text-xs muted nowrap">{timeAgo(w.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
