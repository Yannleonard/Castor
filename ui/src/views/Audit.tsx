// ui/src/views/Audit.tsx
//
// Audit log (perm audit.read). Filterable table with keyset pagination via
// nextCursor. Detail is sanitized JSON (never secrets) shown in an expandable
// row drawer.

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { LoadingFill } from "../components/Spinner";
import { ActionButton } from "../components/ActionButton";
import { Modal } from "../components/Modal";
import { StatusDot } from "../components/StatusDot";
import { IconAudit, IconRefresh, IconSearch, IconInspect } from "../components/icons";
import { formatDateTime, prettyJson, timeAgo } from "../lib/format";
import type { AuditEntry, AuditResult } from "../lib/types";

const RESULTS: { value: AuditResult | ""; label: string }[] = [
  { value: "", label: "All results" },
  { value: "success", label: "Success" },
  { value: "denied", label: "Denied" },
  { value: "error", label: "Error" },
];

const RESULT_COLOR: Record<AuditResult, string> = {
  success: "var(--success)",
  denied: "var(--warning)",
  error: "var(--danger)",
};

export function Audit() {
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [result, setResult] = useState<AuditResult | "">("");
  const [applied, setApplied] = useState({ action: "", actorId: "", targetType: "", result: "" as AuditResult | "" });
  const [detailRow, setDetailRow] = useState<AuditEntry | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["audit", "page", applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.audit({
        limit: 100,
        cursor: pageParam,
        action: applied.action || undefined,
        actorId: applied.actorId || undefined,
        targetType: applied.targetType || undefined,
        result: applied.result || undefined,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = (query.data?.pages ?? []).flatMap((p) => p.items);

  const applyFilters = () => setApplied({ action, actorId, targetType, result });
  const resetFilters = () => {
    setAction("");
    setActorId("");
    setTargetType("");
    setResult("");
    setApplied({ action: "", actorId: "", targetType: "", result: "" });
  };

  const columns: Column<AuditEntry>[] = [
    {
      key: "ts",
      header: "Time",
      sortValue: (a) => a.tsEpoch,
      width: "170px",
      cell: (a) => (
        <div className="col" style={{ gap: 0 }}>
          <span className="text-sm">{timeAgo(a.tsEpoch)}</span>
          <span className="text-xs muted nowrap">{formatDateTime(a.ts)}</span>
        </div>
      ),
    },
    {
      key: "result",
      header: "Result",
      sortValue: (a) => a.result,
      width: "110px",
      cell: (a) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusDot color={RESULT_COLOR[a.result]} />
          <span className="text-sm" style={{ color: RESULT_COLOR[a.result], textTransform: "capitalize" }}>
            {a.result}
          </span>
        </span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      sortValue: (a) => a.actorName || a.actorId,
      cell: (a) => (
        <div className="col" style={{ gap: 0 }}>
          <span className="text-sm" style={{ fontWeight: 600 }}>
            {a.actorName || a.actorId || "—"}
          </span>
          {a.actorIp ? <span className="text-xs muted mono">{a.actorIp}</span> : null}
        </div>
      ),
    },
    { key: "action", header: "Action", sortValue: (a) => a.action, cell: (a) => <span className="mono text-sm" style={{ color: "var(--text-link)" }}>{a.action}</span> },
    {
      key: "target",
      header: "Target",
      sortValue: (a) => a.targetType,
      cell: (a) => (
        <div className="col" style={{ gap: 0 }}>
          <span className="text-sm truncate">{a.targetName || a.targetId || "—"}</span>
          {a.targetType ? <span className="text-xs muted">{a.targetType}</span> : null}
        </div>
      ),
    },
    {
      key: "http",
      header: "HTTP",
      align: "right",
      sortValue: (a) => a.httpStatus,
      width: "80px",
      cell: (a) => (
        <span className="mono text-sm" style={{ color: a.httpStatus >= 400 ? "var(--danger)" : "var(--text-secondary)" }}>
          {a.httpStatus || "—"}
        </span>
      ),
    },
    {
      key: "detail",
      header: "",
      align: "right",
      width: "50px",
      cell: (a) => (
        <ActionButton size="sm" iconOnly variant="ghost" tooltip="View detail" aria-label="View detail" onClick={() => setDetailRow(a)}>
          <IconInspect size={15} />
        </ActionButton>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of every mutating action and access decision."
        actions={
          <ActionButton variant="ghost" iconOnly tooltip="Refresh" aria-label="Refresh" onClick={() => query.refetch()}>
            <IconRefresh size={16} />
          </ActionButton>
        }
      />

      <div className="card card-pad">
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <div className="row" style={{ flex: "1 1 200px" }}>
            <span className="muted">
              <IconSearch size={16} />
            </span>
            <input className="input" placeholder="Action (e.g. docker.container.stop)" value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <input className="input" style={{ width: 180 }} placeholder="Actor id" value={actorId} onChange={(e) => setActorId(e.target.value)} />
          <input className="input" style={{ width: 160 }} placeholder="Target type" value={targetType} onChange={(e) => setTargetType(e.target.value)} />
          <select className="select" style={{ width: 150 }} value={result} onChange={(e) => setResult(e.target.value as AuditResult | "")}>
            {RESULTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <ActionButton variant="primary" onClick={applyFilters}>
            Apply
          </ActionButton>
          <ActionButton variant="ghost" onClick={resetFilters}>
            Reset
          </ActionButton>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label="Loading audit log…" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            defaultSortKey="ts"
            defaultSortDir="desc"
            onRowClick={(a) => setDetailRow(a)}
            emptyIcon={<IconAudit size={40} />}
            emptyTitle="No audit entries"
            emptyMessage="Nothing matches the current filters."
          />
          <div className="row" style={{ justifyContent: "center" }}>
            {query.hasNextPage ? (
              <ActionButton variant="ghost" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                Load more
              </ActionButton>
            ) : rows.length > 0 ? (
              <span className="text-xs muted">End of log · {rows.length} entries loaded</span>
            ) : null}
          </div>
        </>
      )}

      <Modal open={!!detailRow} title="Audit entry" onClose={() => setDetailRow(null)} wide footer={<button className="btn" onClick={() => setDetailRow(null)}>Close</button>}>
        {detailRow ? (
          <div className="col" style={{ gap: "var(--sp-4)" }}>
            <dl className="dl">
              <dt>Time</dt>
              <dd>{formatDateTime(detailRow.ts)}</dd>
              <dt>Result</dt>
              <dd style={{ color: RESULT_COLOR[detailRow.result], textTransform: "capitalize" }}>{detailRow.result}</dd>
              <dt>Actor</dt>
              <dd>
                {detailRow.actorName || detailRow.actorId} {detailRow.actorIp ? <span className="muted mono">({detailRow.actorIp})</span> : null}
              </dd>
              <dt>Action</dt>
              <dd className="mono">{detailRow.action}</dd>
              <dt>Target</dt>
              <dd>
                {detailRow.targetName || detailRow.targetId} <span className="muted">[{detailRow.targetType}]</span>
              </dd>
              <dt>Scope</dt>
              <dd className="mono">
                {detailRow.scopeType}
                {detailRow.scopeId ? `:${detailRow.scopeId}` : ""}
              </dd>
              <dt>HTTP status</dt>
              <dd className="mono">{detailRow.httpStatus}</dd>
              <dt>Request id</dt>
              <dd className="mono">{detailRow.requestId || "—"}</dd>
            </dl>
            <div className="col" style={{ gap: "var(--sp-2)" }}>
              <span className="text-sm muted">Detail (sanitized)</span>
              <pre className="code-block">{prettyJson(detailRow.detail ?? {})}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
