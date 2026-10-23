import type { Key, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';

export interface DataTableColumn<T> {
  /** Stable column id. */
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center' | undefined;
  /** Hide the column from the stacked phone layout (e.g. secondary details). */
  hideOnMobile?: boolean | undefined;
  className?: string | undefined;
}

interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => Key;
  /** Accessible table caption (visually hidden). */
  caption: string;
  loading?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: ReactNode | undefined;
  onRowClick?: ((row: T) => void) | undefined;
}

const alignClass = {
  left: 'text-left',
  right: 'text-right tabular-nums',
  center: 'text-center',
} as const;

/** Typed table: a real <table> from `md` up, stacked label/value cards on phones. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRowClick,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="flex justify-center py-10 text-slate-500">
        <Spinner label="Loading" className="size-6" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block dark:border-slate-800">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-slate-100 dark:bg-slate-800/60">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className={cn(
                    'px-3 py-2 font-semibold text-slate-700 dark:text-slate-300',
                    alignClass[col.align ?? 'left'],
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  onRowClick && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn('px-3 py-2', alignClass[col.align ?? 'left'], col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 text-sm">
              {columns
                .filter((col) => col.hideOnMobile !== true)
                .map((col) => (
                  <div key={col.id} className="contents">
                    <dt className="text-slate-500 dark:text-slate-400">{col.header}</dt>
                    <dd
                      className={cn('min-w-0 break-words', col.align === 'right' && 'tabular-nums')}
                    >
                      {col.cell(row)}
                    </dd>
                  </div>
                ))}
            </dl>
            {onRowClick ? (
              <button
                type="button"
                onClick={() => onRowClick(row)}
                className="mt-2 text-sm font-medium text-emerald-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600 dark:text-emerald-400"
              >
                Open
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
