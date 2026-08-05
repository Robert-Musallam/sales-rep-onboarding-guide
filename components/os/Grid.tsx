"use client";

import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

export interface GridSelection<Id extends string | number = number> {
  selected: Set<Id>;
  onToggle: (id: Id) => void;
  onToggleAll: (ids: Id[], on: boolean) => void;
}

/**
 * Generic, sortable data grid (TanStack). Module-agnostic: pass column defs,
 * optional row selection, and an optional row-click handler. When `selection`
 * is provided, Grid injects the leading checkbox column itself.
 *
 * The row id may be numeric (renewals) or a uuid string (leasing) — the id type
 * is generic so selection stays type-safe for whichever key a module uses.
 *
 * The reference consumer is the renewals pipeline; leasing and future
 * pipeline-style modules reuse this without copy-paste.
 */
export function Grid<T extends { id: string | number }>({
  data,
  columns,
  selection,
  onRowClick,
  initialSorting = [],
  emptyMessage = "No rows.",
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  selection?: GridSelection<T["id"]>;
  onRowClick?: (row: T) => void;
  initialSorting?: SortingState;
  emptyMessage?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  const allSelected =
    !!selection && data.length > 0 && data.every((r) => selection.selected.has(r.id));

  const columnsWithSelect = useMemo(() => {
    if (!selection) return columns;
    const selectCol: ColumnDef<T, unknown> = {
      id: "__select",
      header: () => (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(e) => selection.onToggleAll(data.map((r) => r.id), e.target.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selection.selected.has(row.original.id)}
          onChange={() => selection.onToggle(row.original.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    };
    return [selectCol, ...columns];
  }, [columns, selection, allSelected, data]);

  const table = useReactTable({
    data,
    columns: columnsWithSelect,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="card overflow-x-auto thin-scroll">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-line">
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="text-left font-semibold text-muted px-2.5 py-2.5 whitespace-nowrap select-none cursor-pointer"
                  onClick={h.column.getToggleSortingHandler()}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={`border-b border-line/60 hover:bg-bg ${onRowClick ? "cursor-pointer" : ""} ${
                selection?.selected.has(row.original.id) ? "bg-bl/20" : ""
              }`}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-2.5 py-2 whitespace-nowrap">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={columnsWithSelect.length} className="text-center text-muted py-8">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
