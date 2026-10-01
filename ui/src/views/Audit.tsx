// Castor by IT Leonard
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
import { HelpButton } from "../components/HelpButton";
import { IconAudit, IconDownload, IconRefresh, IconSearch, IconInspect } from "../components/icons";
import { formatDateTime, prettyJson, timeAgo } from "../lib/format";
import { toast, toastError } from "../lib/toast";
import { useT } from "../i18n";
import { auditDict } from "../i18n/locales/audit";
import { commonDict } from "../i18n/locales/common";
import type { AuditEntry, AuditResult } from "../lib/types";

// CSV columns exported for each audit row, in output order.
const CSV_COLUMNS = ["ts", "actor", "action", "target", "scope", "result", "status", "requestId"] as const;

// escapeCsv renders a field safe for CSV. Two concerns, in order:
//   1. Formula injection: a cell whose first character is =, +, -, @, or a
//      leading tab/CR is interpreted as a formula by Excel/Sheets and executed
//      on open. Prefix such a value with a single quote to neutralize it, so it
//      is shown as literal text instead of evaluated.
//   2. RFC 4180 quoting: a field containing a quote, comma, CR or LF is wrapped
//      in double quotes with embedded quotes doubled.
// Everything is stringified first so null/number values are handled uniformly.
function escapeCsv(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  // Defuse formula injection before RFC 4180 quoting.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// auditRowsToCsv renders the loaded audit entries to an RFC 4180 document. The
// scope field joins scopeType and scopeId the same way the detail drawer does.
function auditRowsToCsv(rows: AuditEntry[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((a) => {
    const scope = a.scopeId ? `${a.scopeType}:${a.scopeId}` : a.scopeType;
    const target = a.targetName || a.targetId || "";
    const cells: (string | number | null)[] = [
      a.ts,
      a.actorName || a.actorId,
      a.action,
      target,
      scope,
      a.result,
      a.httpStatus,
      a.requestId,
    ];
    return cells.map(escapeCsv).join(",");
  });
  // Leading BOM makes Excel read UTF-8 correctly; CRLF line endings per RFC 4180.
  return "﻿" + [header, ...lines].join("\r\n");
}

// downloadCsv triggers a browser save from an in-memory string via a transient
// object-URL anchor — pure client side, no network. Mirrors the anchor mechanic
// of api.ts downloadFile without going through the request path.
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Result filter options: technical `value` (sent to the API, never translated)
// paired with the auditDict key for its display label.
const RESULT_OPTIONS: { value: AuditResult | ""; labelKey: string }[] = [
  { value: "", labelKey: "filter.resultAll" },
  { value: "success", labelKey: "filter.resultSuccess" },
  { value: "denied", labelKey: "filter.resultDenied" },
  { value: "error", labelKey: "filter.resultError" },
];

const RESULT_COLOR: Record<AuditResult, string> = {
  success: "var(--success)",
  denied: "var(--warning)",
  error: "var(--danger)",
};

// auditDict key for each result value's capitalized display label.
const RESULT_LABEL_KEY: Record<AuditResult, string> = {
  success: "result.success",
  denied: "result.denied",
  error: "result.error",
};

export function Audit() {
  const t = useT(auditDict);
  const tc = useT(commonDict);
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

  const [exporting, setExporting] = useState(false);

  // exportCsv writes the currently loaded rows to a CSV download (browser-only).
  const exportCsv = (data: AuditEntry[]) => {
    if (data.length === 0) {
      toast.info(t("toast.nothingTitle"), t("toast.nothingBody"));
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(auditRowsToCsv(data), `audit-${stamp}.csv`);
    toast.success(t("toast.exportedTitle"), t("toast.exportedBody", { count: data.length }));
  };

  // exportAll drains remaining pages (respecting the active filters) before
  // exporting, so the CSV covers the full result set, not just loaded rows.
  const exportAll = async () => {
    setExporting(true);
    try {
      let result = await query.fetchNextPage();
      // fetchNextPage resolves with the accumulated data; loop while more remain.
      while (result.hasNextPage) {
        result = await query.fetchNextPage();
      }
      const all = (result.data?.pages ?? []).flatMap((p) => p.items);
      exportCsv(all);
    } catch (err) {
      toastError(t("toast.exportFailed"), err);
    } finally {
      setExporting(false);
    }
  };

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
      header: t("col.time"),
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
      header: t("col.result"),
      sortValue: (a) => a.result,
      width: "110px",
      cell: (a) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusDot color={RESULT_COLOR[a.result]} />
          <span className="text-sm" style={{ color: RESULT_COLOR[a.result] }}>
            {t(RESULT_LABEL_KEY[a.result])}
          </span>
        </span>
      ),
    },
    {
      key: "actor",
      header: t("col.actor"),
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
    { key: "action", header: t("col.action"), sortValue: (a) => a.action, cell: (a) => <span className="mono text-sm" style={{ color: "var(--text-link)" }}>{a.action}</span> },
    {
      key: "target",
      header: t("col.target"),
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
      header: t("col.http"),
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
        <ActionButton size="sm" iconOnly variant="ghost" tooltip={t("row.viewDetail")} aria-label={t("row.viewDetail")} onClick={() => setDetailRow(a)}>
          <IconInspect size={15} />
        </ActionButton>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={t("header.title")}
        subtitle={t("header.subtitle")}
        actions={
          <div className="row">
            <ActionButton
              variant="ghost"
              disabled={rows.length === 0}
              tooltip={rows.length === 0 ? t("header.exportLoadedEmpty") : undefined}
              onClick={() => exportCsv(rows)}
            >
              <IconDownload size={15} />
              {t("header.exportLoaded")}
            </ActionButton>
            {query.hasNextPage ? (
              <ActionButton variant="ghost" loading={exporting} onClick={exportAll}>
                <IconDownload size={15} />
                {t("header.exportAll")}
              </ActionButton>
            ) : null}
            <ActionButton variant="ghost" iconOnly tooltip={t("header.refresh")} aria-label={t("header.refresh")} onClick={() => query.refetch()}>
              <IconRefresh size={16} />
            </ActionButton>
            <HelpButton topic="audit" />
          </div>
        }
      />

      <div className="card card-pad">
        <div className="row-wrap" style={{ gap: "var(--sp-3)" }}>
          <div className="row" style={{ flex: "1 1 200px" }}>
            <span className="muted">
              <IconSearch size={16} />
            </span>
            <input className="input" placeholder={t("filter.actionPlaceholder")} value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <input className="input" style={{ width: 180 }} placeholder={t("filter.actorPlaceholder")} value={actorId} onChange={(e) => setActorId(e.target.value)} />
          <input className="input" style={{ width: 160 }} placeholder={t("filter.targetPlaceholder")} value={targetType} onChange={(e) => setTargetType(e.target.value)} />
          <select className="select" style={{ width: 150 }} value={result} onChange={(e) => setResult(e.target.value as AuditResult | "")}>
            {RESULT_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {t(r.labelKey)}
              </option>
            ))}
          </select>
          <ActionButton variant="primary" onClick={applyFilters}>
            {t("filter.apply")}
          </ActionButton>
          <ActionButton variant="ghost" onClick={resetFilters}>
            {t("filter.reset")}
          </ActionButton>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingFill label={t("list.loading")} />
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
            emptyTitle={t("empty.title")}
            emptyMessage={t("empty.message")}
          />
          <div className="row" style={{ justifyContent: "center" }}>
            {query.hasNextPage ? (
              <ActionButton variant="ghost" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                {t("list.loadMore")}
              </ActionButton>
            ) : rows.length > 0 ? (
              <span className="text-xs muted">{t("list.endOfLog", { count: rows.length })}</span>
            ) : null}
          </div>
        </>
      )}

      <Modal open={!!detailRow} title={t("detail.title")} onClose={() => setDetailRow(null)} wide footer={<button className="btn" onClick={() => setDetailRow(null)}>{tc("close")}</button>}>
        {detailRow ? (
          <div className="col" style={{ gap: "var(--sp-4)" }}>
            <dl className="dl">
              <dt>{t("detail.time")}</dt>
              <dd>{formatDateTime(detailRow.ts)}</dd>
              <dt>{t("detail.result")}</dt>
              <dd style={{ color: RESULT_COLOR[detailRow.result] }}>{t(RESULT_LABEL_KEY[detailRow.result])}</dd>
              <dt>{t("detail.actor")}</dt>
              <dd>
                {detailRow.actorName || detailRow.actorId} {detailRow.actorIp ? <span className="muted mono">({detailRow.actorIp})</span> : null}
              </dd>
              <dt>{t("detail.action")}</dt>
              <dd className="mono">{detailRow.action}</dd>
              <dt>{t("detail.target")}</dt>
              <dd>
                {detailRow.targetName || detailRow.targetId} <span className="muted">[{detailRow.targetType}]</span>
              </dd>
              <dt>{t("detail.scope")}</dt>
              <dd className="mono">
                {detailRow.scopeType}
                {detailRow.scopeId ? `:${detailRow.scopeId}` : ""}
              </dd>
              <dt>{t("detail.httpStatus")}</dt>
              <dd className="mono">{detailRow.httpStatus}</dd>
              <dt>{t("detail.requestId")}</dt>
              <dd className="mono">{detailRow.requestId || "—"}</dd>
            </dl>
            <div className="col" style={{ gap: "var(--sp-2)" }}>
              <span className="text-sm muted">{t("detail.sanitized")}</span>
              <pre className="code-block">{prettyJson(detailRow.detail ?? {})}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
