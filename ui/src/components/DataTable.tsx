// ui/src/components/DataTable.tsx
//
// A sortable table with a sticky header. Rows beyond a threshold are virtualized
// with a simple windowing strategy (fixed row height) so large fleets stay fast.
//
// Generic over the row type; columns declare a key, header, optional sort accessor,
// and a cell renderer.

import { useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** cell renderer */
  cell: (row: T) => ReactNode;
  /** value used for sorting; omit to disable sort on this column */
  sortValue?: (row: T) => string | number;
  /** right-align (e.g. actions/metrics) */
  align?: "left" | "right" | "center";
  width?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** default sort column key */
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  emptyTitle?: string;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** virtualize when rows exceed this count */
  virtualizeThreshold?: number;
  rowHeight?: number;
  maxBodyHeight?: number;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  defaultSortKey,
  defaultSortDir = "asc",
  emptyTitle = "Nothing here yet",
  emptyMessage,
  emptyIcon,
  virtualizeThreshold = 120,
  rowHeight = 49,
  maxBodyHeight = 620,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const acc = col.sortValue;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortValue) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const virtualize = sorted.length > virtualizeThreshold;

  let body: ReactNode;
  if (sorted.length === 0) {
    body = (
      <tr>
        <td colSpan={columns.length} style={{ padding: 0, border: "none" }}>
          <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
        </td>
      </tr>
    );
  } else if (!virtualize) {
    body = sorted.map((row) => (
      <Row key={rowKey(row)} row={row} columns={columns} onRowClick={onRowClick} />
    ));
  } else {
    const total = sorted.length;
    const viewport = maxBodyHeight;
    const overscan = 6;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewport / rowHeight) + overscan * 2;
    const end = Math.min(total, start + visibleCount);
    const padTop = start * rowHeight;
    const padBottom = (total - end) * rowHeight;
    body = (
      <>
        {padTop > 0 && (
          <tr aria-hidden>
            <td colSpan={columns.length} style={{ height: padTop, padding: 0, border: "none" }} />
          </tr>
        )}
        {sorted.slice(start, end).map((row) => (
          <Row
            key={rowKey(row)}
            row={row}
            columns={columns}
            onRowClick={onRowClick}
            height={rowHeight}
          />
        ))}
        {padBottom > 0 && (
          <tr aria-hidden>
            <td colSpan={columns.length} style={{ height: padBottom, padding: 0, border: "none" }} />
          </tr>
        )}
      </>
    );
  }

  return (
    <div
      className="dt-wrap"
      ref={scrollRef}
      style={virtualize ? { maxHeight: maxBodyHeight } : undefined}
      onScroll={virtualize ? (e) => setScrollTop((e.target as HTMLDivElement).scrollTop) : undefined}
    >
      <table className="dt">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={clsx(c.sortValue && "sortable")}
                style={{ width: c.width, textAlign: c.align ?? "left" }}
                onClick={() => c.sortValue && toggleSort(c.key)}
              >
                {c.header}
                {sortKey === c.key && <span className="sort-ind">{sortDir === "asc" ? "▲" : "▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}

function Row<T>({
  row,
  columns,
  onRowClick,
  height,
}: {
  row: T;
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  height?: number;
}) {
  return (
    <tr
      className={clsx(onRowClick && "clickable")}
      style={height ? { height } : undefined}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
    >
      {columns.map((c) => (
        <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
          {c.cell(row)}
        </td>
      ))}
    </tr>
  );
}
