import { useInfiniteQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button, focusRing } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { inputClass } from '../components/forms/FieldShell';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { useIsOwner } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/dates';

type Entry = ResponseOf<'/api/audit/', 'get'>[number];

const PAGE_SIZE = 50;

/** Entities the API writes to the audit log, with readable names for the filter. */
const entityLabels: Record<string, string> = {
  attendance: 'Attendance',
  backup: 'Backups',
  custom_deduction: 'Deductions',
  employee: 'Employees',
  employee_document: 'Employee documents',
  holiday: 'Holidays',
  loan: 'Loans',
  min_wages: 'Minimum wages',
  payroll_run: 'Payroll runs',
  settings: 'Settings',
  statutory_rates: 'Statutory rates',
  user: 'Users',
};

function prettyJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function JsonPane({ label, value }: { label: string; value: unknown }) {
  const text = prettyJson(value);
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </h4>
      {text === null ? (
        <p className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700">
          Nothing recorded.
        </p>
      ) : (
        <pre
          tabIndex={0}
          aria-label={`${label} values`}
          className={cn(
            'max-h-96 overflow-auto rounded-md bg-slate-100 p-3 font-mono text-xs leading-5 text-slate-800 dark:bg-slate-950 dark:text-slate-200',
            focusRing,
          )}
        >
          {text}
        </pre>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-slate-50 md:grid-cols-[auto_11rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center dark:hover:bg-slate-800/50',
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'row-span-4 mt-0.5 text-slate-400 transition-transform md:row-span-1 md:mt-0',
            open && 'rotate-90',
          )}
        >
          ▶
        </span>
        <span className="text-slate-600 tabular-nums dark:text-slate-400">
          {formatDateTime(entry.at)}
        </span>
        <span className="min-w-0 break-all">
          {entry.actorEmail ?? <span className="text-slate-500 italic">system / removed user</span>}
        </span>
        <span className="font-mono text-xs font-medium break-all">{entry.action}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <Badge>{entityLabels[entry.entity] ?? entry.entity}</Badge>
          {entry.entityId ? (
            <span className="truncate font-mono text-xs text-slate-500" title={entry.entityId}>
              {entry.entityId}
            </span>
          ) : null}
        </span>
        <span className="col-start-2 min-w-0 text-slate-600 md:col-start-auto dark:text-slate-400">
          {entry.reason ?? <span className="hidden md:inline">—</span>}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="grid gap-3 px-3 pb-4 md:grid-cols-2 md:pl-9">
          <JsonPane label="Before" value={entry.before} />
          <JsonPane label="After" value={entry.after} />
        </div>
      ) : null}
    </li>
  );
}

export function AuditPage() {
  const isOwner = useIsOwner();
  const filterId = useId();
  const idFilterId = useId();
  const [entity, setEntity] = useState('');
  const [entityIdInput, setEntityIdInput] = useState('');
  const entityId = entityIdInput.trim();

  const log = useInfiniteQuery({
    queryKey: ['audit', entity, entityId],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/audit/', {
          params: {
            query: {
              limit: PAGE_SIZE,
              ...(entity ? { entity } : {}),
              ...(entityId ? { entityId } : {}),
              ...(pageParam ? { before: pageParam.at, beforeId: pageParam.id } : {}),
            },
          },
        }),
      ),
    initialPageParam: null as { at: string; id: string } | null,
    // Cursor on (at, id) so entries sharing a timestamp across a page boundary are not skipped.
    getNextPageParam: (lastPage) => {
      const last = lastPage[lastPage.length - 1];
      return lastPage.length < PAGE_SIZE || !last ? undefined : { at: last.at, id: last.id };
    },
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <>
        <PageHeader title="Audit log" />
        <Banner tone="info" title="Owner only">
          The audit log records every change with before and after values, so only the owner can
          view it.
        </Banner>
      </>
    );
  }

  const entries = log.data?.pages.flat() ?? [];
  const filtered = entity !== '' || entityId !== '';

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every payroll state change, edit, delete and reopen, newest first. Open an entry to compare before and after."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor={filterId} className="text-sm font-medium">
            Entity
          </label>
          <select
            id={filterId}
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            className={cn(inputClass, 'sm:w-56')}
          >
            <option value="">All entities</option>
            {Object.entries(entityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={idFilterId} className="text-sm font-medium">
            Record ID
          </label>
          <input
            id={idFilterId}
            type="search"
            value={entityIdInput}
            onChange={(e) => setEntityIdInput(e.target.value)}
            placeholder="Optional"
            autoComplete="off"
            spellCheck={false}
            className={cn(inputClass, 'font-mono sm:w-80')}
          />
        </div>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setEntity('');
              setEntityIdInput('');
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {log.error ? (
        <Banner tone="danger" className="mb-4">
          {errorMessage(log.error)}
        </Banner>
      ) : null}

      {log.isPending ? (
        <div className="flex justify-center py-10 text-slate-500">
          <Spinner label="Loading audit log" className="size-6" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No audit entries"
          description={filtered ? 'Nothing matches these filters.' : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[auto_11rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 md:grid dark:bg-slate-800/60 dark:text-slate-300"
          >
            <span className="w-[1ch]" />
            <span>Time (Manila)</span>
            <span>Actor</span>
            <span>Action</span>
            <span>Entity</span>
            <span>Reason</span>
          </div>
          <ul aria-label="Audit entries">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
        </div>
      )}

      {log.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={log.isFetchingNextPage}
            onClick={() => void log.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : entries.length > 0 && !log.isPending ? (
        <p className="mt-4 text-center text-sm text-slate-500">
          End of the log · {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
        </p>
      ) : null}
    </>
  );
}
