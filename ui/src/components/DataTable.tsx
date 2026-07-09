// ui/src/components/DataTable.tsx
//
// A sortable table with a sticky header. Rows beyond a threshold are virtualized
// with a simple windowing strategy (fixed row height) so large fleets stay fast.
//
// Generic over the row type; columns declare a key, header, optional sort accessor,
// and a cell renderer.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  /** enable a leading checkbox column for row selection */
  selectable?: boolean;
  /** currently selected row keys (controlled by the caller) */
  selectedKeys?: Set<string>;
  /** toggle a single row's selection */
  onToggleRow?: (key: string) => void;
  /**
   * Toggle all rows. Receives the keys of the *complete* sorted set (never the
   * virtualized window) so "select all" covers rows scrolled out of view.
   */
  onToggleAll?: (keys: string[]) => void;
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
  selectable = false,
  selectedKeys,
  onToggleRow,
  onToggleAll,
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

  // Selection derived from the full sorted set (not the virtualized window), so
  // the header checkbox reflects rows scrolled out of view.
  const selection = selectable ? (selectedKeys ?? EMPTY_SELECTION) : EMPTY_SELECTION;
  const selectedInView = selectable ? sorted.filter((r) => selection.has(rowKey(r))).length : 0;
  const allSelected = selectable && sorted.length > 0 && selectedInView === sorted.length;
  const someSelected = selectable && selectedInView > 0 && !allSelected;

  const handleToggleAll = () => {
    if (!onToggleAll) return;
    onToggleAll(sorted.map((r) => rowKey(r)));
  };

  // Total header/body column span, including the checkbox column when present.
  const colSpan = columns.length + (selectable ? 1 : 0);

  let body: ReactNode;
  if (sorted.length === 0) {
    body = (
      <tr>
        <td colSpan={colSpan} style={{ padding: 0, border: "none" }}>
          <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
        </td>
      </tr>
    );
  } else if (!virtualize) {
    body = sorted.map((row) => (
      <Row
        key={rowKey(row)}
        row={row}
        columns={columns}
        onRowClick={onRowClick}
        selectable={selectable}
        selected={selection.has(rowKey(row))}
        onToggleRow={onToggleRow ? () => onToggleRow(rowKey(row)) : undefined}
      />
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
            <td colSpan={colSpan} style={{ height: padTop, padding: 0, border: "none" }} />
          </tr>
        )}
        {sorted.slice(start, end).map((row) => (
          <Row
            key={rowKey(row)}
            row={row}
            columns={columns}
            onRowClick={onRowClick}
            height={rowHeight}
            selectable={selectable}
            selected={selection.has(rowKey(row))}
            onToggleRow={onToggleRow ? () => onToggleRow(rowKey(row)) : undefined}
          />
        ))}
        {padBottom > 0 && (
          <tr aria-hidden>
            <td colSpan={colSpan} style={{ height: padBottom, padding: 0, border: "none" }} />
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
            {selectable ? (
              <th style={{ width: 40, textAlign: "center" }}>
                <HeaderCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={sorted.length === 0}
                  onChange={handleToggleAll}
                />
              </th>
            ) : null}
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
  selectable,
  selected,
  onToggleRow,
}: {
  row: T;
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  height?: number;
  selectable?: boolean;
  selected?: boolean;
  onToggleRow?: () => void;
}) {
  return (
    <tr
      className={clsx(onRowClick && "clickable", selected && "selected")}
      style={height ? { height } : undefined}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
    >
      {selectable ? (
        <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
          {/* stopPropagation keeps the row-click (navigate/open) from firing */}
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleRow?.()}
            aria-label="Select row"
            style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }}
          />
        </td>
      ) : null}
      {columns.map((c) => (
        <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
          {c.cell(row)}
        </td>
      ))}
    </tr>
  );
}

// Stable empty selection reference so uncontrolled usage keeps a constant identity.
const EMPTY_SELECTION: Set<string> = new Set();

// Header checkbox with an indeterminate visual for partial selection. React has
// no `indeterminate` prop, so it is set imperatively on the DOM node.
function HeaderCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label="Select all rows"
      style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: disabled ? "default" : "pointer" }}
    />
  );
}
