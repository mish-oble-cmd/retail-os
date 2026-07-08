import type { ReactNode } from 'react';
import { cn } from '../cn.js';
import { useDensity } from '../density.js';

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  /** Money and quantities are right-aligned per design-system.md. */
  align?: 'left' | 'right';
  render: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Footer totals row, keyed by column key (design-system.md DataTable). */
  footer?: Readonly<Record<string, ReactNode>>;
  /** Rendered when rows is empty — pair with an EmptyState CTA. */
  empty?: ReactNode;
  /** Sticky header needs a max-height scroll container. */
  maxHeight?: number;
  className?: string;
}

/** Basic DataTable (Phase 0): sticky header + footer totals. Sorting lands in Phase 1 with real data. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  footer,
  empty,
  maxHeight,
  className,
}: DataTableProps<Row>) {
  const density = useDensity();
  const cellPad = density === 'pos' ? 'px-3 py-3 text-pos-body' : 'px-3 py-2 text-body-sm';

  if (rows.length === 0 && empty) {
    return (
      <div className={cn('rounded-card border border-border bg-surface p-8', className)}>
        {empty}
      </div>
    );
  }

  return (
    <div
      className={cn('overflow-auto rounded-card border border-border bg-surface', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse font-ui">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'sticky top-0 border-b border-border bg-surface text-caption font-medium text-ink-muted',
                  cellPad,
                  col.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border last:border-b-0">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'text-ink',
                    cellPad,
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'border-t border-border bg-bg font-semibold text-ink',
                    cellPad,
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {footer[col.key] ?? null}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
