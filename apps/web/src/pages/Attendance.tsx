import { zodResolver } from '@hookform/resolvers/zod';
import { AttendanceEntryInputSchema, type DayType } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api, errorMessage, unwrap, upload } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge, type BadgeTone } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button, buttonClass } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import {
  CheckboxField,
  DateField,
  FormError,
  NumberField,
  SelectField,
  TextAreaField,
} from '../components/forms';
import { inputClass } from '../components/forms/FieldShell';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner } from '../lib/auth';
import { applyServerError } from '../lib/forms';
import { leaveTypeLabels, optionsFrom } from '../lib/labels';
import { currentCutoff, formatDate, isIsoDate, manilaToday } from '../lib/dates';
import { dayTypeLabels } from '../lib/labels';

type Row = ResponseOf<'/api/attendance/', 'get'>[number];
type Employee = ResponseOf<'/api/employees/', 'get'>[number];
type ImportResult = ResponseOf<'/api/attendance/import', 'post'>;
type FormIn = z.input<typeof AttendanceEntryInputSchema>;
type FormOut = z.output<typeof AttendanceEntryInputSchema>;

const dayTypeTone: Record<DayType, BadgeTone> = {
  ordinary: 'neutral',
  rest_day: 'neutral',
  special: 'warning',
  special_rest_day: 'warning',
  regular: 'info',
  regular_rest_day: 'info',
  double: 'info',
  double_rest_day: 'info',
};

function invalidateAttendance(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ['attendance'] });
}

// ------------------------------------------------------------------ entry form

function EntryFormModal({
  entry,
  defaults,
  employees,
  onClose,
}: {
  entry: Row | null;
  defaults: { employeeId: string; date: string };
  employees: readonly Employee[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { control, handleSubmit, formState, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(AttendanceEntryInputSchema),
    defaultValues: entry
      ? {
          employeeId: entry.employeeId,
          date: entry.date,
          dayTypeOverride: entry.dayTypeOverride,
          regularHours: entry.regularHours,
          otHours: entry.otHours,
          ndHours: entry.ndHours,
          ndOtHours: entry.ndOtHours,
          tardyMinutes: entry.tardyMinutes,
          undertimeMinutes: entry.undertimeMinutes,
          absent: entry.absent,
          leaveType: entry.leaveType,
          notes: entry.notes,
        }
      : {
          employeeId: defaults.employeeId,
          date: defaults.date,
          dayTypeOverride: null,
          regularHours: 8,
          otHours: 0,
          ndHours: 0,
          ndOtHours: 0,
          tardyMinutes: 0,
          undertimeMinutes: 0,
          absent: false,
          leaveType: null,
          notes: null,
        },
  });
  const formId = useId();

  const onSubmit = async (body: FormOut) => {
    try {
      await unwrap(api.PUT('/api/attendance/', { body }));
      await invalidateAttendance(qc);
      onClose();
    } catch (err) {
      // ATTENDANCE_LOCKED (409) and other errors show the server's message in the form banner.
      applyServerError(err, setError);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={entry ? 'Edit attendance' : 'Add attendance'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            {entry ? 'Save changes' : 'Add entry'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      >
        <FormError errors={formState.errors} />
        {entry ? null : (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Saving replaces any existing entry for the same employee and date.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="employeeId"
            label="Employee"
            placeholder="Choose…"
            options={employees.map((e) => ({
              value: e.id,
              label: `${e.employeeNo} — ${e.fullName}`,
            }))}
            disabled={entry !== null}
            required
          />
          <DateField
            control={control}
            name="date"
            label="Date"
            disabled={entry !== null}
            required
          />
          <SelectField
            control={control}
            name="dayTypeOverride"
            label="Day type"
            placeholder="Automatic"
            options={optionsFrom(dayTypeLabels)}
            hint="Automatic uses the holiday calendar and the employee's rest days."
          />
          <SelectField
            control={control}
            name="leaveType"
            label="Leave"
            placeholder="None"
            options={optionsFrom(leaveTypeLabels)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberField
            control={control}
            name="regularHours"
            label="Regular hrs"
            min={0}
            max={24}
            step={0.25}
            required
          />
          <NumberField
            control={control}
            name="otHours"
            label="OT hrs"
            min={0}
            max={24}
            step={0.25}
            required
          />
          <NumberField
            control={control}
            name="ndHours"
            label="Night diff hrs"
            min={0}
            max={24}
            step={0.25}
            required
          />
          <NumberField
            control={control}
            name="ndOtHours"
            label="Night diff OT hrs"
            min={0}
            max={24}
            step={0.25}
            required
          />
          <NumberField control={control} name="tardyMinutes" label="Tardy min" min={0} required />
          <NumberField
            control={control}
            name="undertimeMinutes"
            label="Undertime min"
            min={0}
            required
          />
        </div>
        <CheckboxField control={control} name="absent" label="Absent" />
        <TextAreaField control={control} name="notes" label="Notes" rows={2} emptyAsNull />
      </form>
    </Modal>
  );
}

function DeleteEntryModal({
  entry,
  employeeName,
  onClose,
}: {
  entry: Row;
  employeeName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.DELETE('/api/attendance/{id}', { params: { path: { id: entry.id } } }));
      await invalidateAttendance(qc);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete attendance entry?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void onDelete()}>
            Delete
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error ? (
          <Banner tone="danger" title="Could not delete">
            {error}
          </Banner>
        ) : null}
        <p>
          Remove the entry for <span className="font-semibold">{employeeName}</span> on{' '}
          {formatDate(entry.date, 'weekday')}?
        </p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ CSV import

function ImportCard() {
  const qc = useQueryClient();
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await upload<ImportResult>('/api/attendance/import', form);
      setResult(res);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await invalidateAttendance(qc);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Import from CSV"
      actions={
        <a
          href="/api/attendance/template.csv"
          download="attendance-template.csv"
          className={buttonClass('ghost', 'sm')}
        >
          Download template
        </a>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          One row per employee and date. Rows for an existing employee and date replace that entry;
          invalid rows are skipped and listed below.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={inputId} className="text-sm font-medium">
              CSV file
            </label>
            <input
              id={inputId}
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium dark:file:border-slate-600 dark:file:bg-slate-800 dark:file:text-slate-100"
            />
          </div>
          <Button onClick={() => void onImport()} disabled={!file} loading={busy}>
            Import
          </Button>
        </div>
        {error ? (
          <Banner tone="danger" title="Import failed">
            {error}
          </Banner>
        ) : null}
        {result ? (
          <Banner
            tone={result.errors.length > 0 ? 'warning' : 'info'}
            title={`Imported ${result.imported} ${result.imported === 1 ? 'row' : 'rows'}${
              result.errors.length > 0 ? `, ${result.errors.length} skipped` : ''
            }`}
          >
            {result.errors.length > 0 ? (
              <ul className="mt-1 max-h-60 list-none space-y-0.5 overflow-y-auto">
                {result.errors.map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    <span className="font-semibold">Row {e.row}:</span> {e.message}
                  </li>
                ))}
              </ul>
            ) : (
              'All rows were saved.'
            )}
          </Banner>
        ) : null}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ page

type Dialog = { kind: 'form'; entry: Row | null } | { kind: 'delete'; entry: Row } | null;

const hours = (n: number) => (n === 0 ? '—' : String(n));

export function AttendancePage() {
  const isOwner = useIsOwner();
  const today = manilaToday();
  const [range, setRange] = useState(() => currentCutoff(today));
  const [employeeId, setEmployeeId] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const fromId = useId();
  const toId = useId();
  const empId = useId();

  const rangeValid = isIsoDate(range.from) && isIsoDate(range.to) && range.from <= range.to;

  const allEmployees = useQuery({
    queryKey: ['employees', ''],
    queryFn: () => unwrap(api.GET('/api/employees/', { params: { query: {} } })),
  });
  const activeEmployees = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: () => unwrap(api.GET('/api/employees/', { params: { query: { status: 'active' } } })),
  });
  const entries = useQuery({
    queryKey: ['attendance', range.from, range.to, employeeId],
    queryFn: () =>
      unwrap(
        api.GET('/api/attendance/', {
          params: {
            query: employeeId
              ? { from: range.from, to: range.to, employeeId }
              : { from: range.from, to: range.to },
          },
        }),
      ),
    enabled: rangeValid,
  });

  const byId = new Map((allEmployees.data ?? []).map((e) => [e.id, e]));
  const nameOf = (id: string) => byId.get(id)?.fullName ?? 'Unknown employee';

  /** Active employees for the form, plus the edited entry's employee if no longer active. */
  const formEmployees = (entry: Row | null): Employee[] => {
    const list = activeEmployees.data ?? [];
    if (!entry || list.some((e) => e.id === entry.employeeId)) return list;
    const extra = byId.get(entry.employeeId);
    return extra ? [...list, extra] : list;
  };

  const columns: DataTableColumn<Row>[] = [
    { id: 'date', header: 'Date', cell: (r) => formatDate(r.date, 'weekday') },
    {
      id: 'employee',
      header: 'Employee',
      cell: (r) => {
        const e = byId.get(r.employeeId);
        return (
          <div>
            <div className="font-medium">{nameOf(r.employeeId)}</div>
            {e ? <div className="text-xs text-slate-500">{e.employeeNo}</div> : null}
          </div>
        );
      },
    },
    {
      id: 'dayType',
      header: 'Day type',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={dayTypeTone[r.dayType]}>{dayTypeLabels[r.dayType]}</Badge>
          {r.dayTypeOverride !== null ? <Badge tone="neutral">Override</Badge> : null}
        </div>
      ),
    },
    { id: 'reg', header: 'Reg hrs', align: 'right', cell: (r) => hours(r.regularHours) },
    { id: 'ot', header: 'OT hrs', align: 'right', cell: (r) => hours(r.otHours) },
    {
      id: 'nd',
      header: 'ND hrs',
      align: 'right',
      cell: (r) => hours(r.ndHours),
      hideOnMobile: true,
    },
    {
      id: 'ndot',
      header: 'ND-OT hrs',
      align: 'right',
      cell: (r) => hours(r.ndOtHours),
      hideOnMobile: true,
    },
    {
      id: 'late',
      header: 'Tardy / UT min',
      align: 'right',
      cell: (r) =>
        r.tardyMinutes === 0 && r.undertimeMinutes === 0
          ? '—'
          : `${r.tardyMinutes} / ${r.undertimeMinutes}`,
    },
    {
      id: 'status',
      header: 'Absent / leave',
      cell: (r) =>
        r.absent ? (
          <Badge tone="danger">Absent</Badge>
        ) : r.leaveType !== null ? (
          <Badge tone="info">{leaveTypeLabels[r.leaveType]}</Badge>
        ) : (
          '—'
        ),
    },
  ];
  if (isOwner) {
    columns.push({
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog({ kind: 'form', entry: r })}
            aria-label={`Edit ${nameOf(r.employeeId)} on ${r.date}`}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog({ kind: 'delete', entry: r })}
            aria-label={`Delete ${nameOf(r.employeeId)} on ${r.date}`}
          >
            Delete
          </Button>
        </div>
      ),
    });
  }

  const defaultDate = today >= range.from && today <= range.to ? today : range.from;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Daily time records: regular, overtime, night differential, tardiness and leave."
        actions={
          isOwner ? (
            <Button onClick={() => setDialog({ kind: 'form', entry: null })}>Add entry</Button>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor={fromId} className="text-sm font-medium">
              From
            </label>
            <input
              id={fromId}
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={toId} className="text-sm font-medium">
              To
            </label>
            <input
              id={toId}
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={empId} className="text-sm font-medium">
              Employee
            </label>
            <select
              id={empId}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={inputClass}
            >
              <option value="">All employees</option>
              {(allEmployees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeNo} — {e.fullName}
                  {e.status !== 'active' ? ` (${e.status})` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={() => setRange(currentCutoff(today))}>
            Current cutoff
          </Button>
        </div>

        {!rangeValid ? (
          <Banner tone="warning">Choose a valid range: “From” must be on or before “To”.</Banner>
        ) : null}
        {entries.error ? <Banner tone="danger">{errorMessage(entries.error)}</Banner> : null}

        <DataTable
          caption="Attendance entries"
          columns={columns}
          rows={rangeValid ? (entries.data ?? []) : []}
          rowKey={(r) => r.id}
          loading={rangeValid && entries.isPending}
          emptyTitle="No attendance in this range"
          emptyDescription={isOwner ? 'Add entries one by one or import a CSV below.' : undefined}
        />

        {isOwner ? <ImportCard /> : null}
      </div>

      {dialog?.kind === 'form' ? (
        <EntryFormModal
          entry={dialog.entry}
          defaults={{ employeeId, date: defaultDate }}
          employees={formEmployees(dialog.entry)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteEntryModal
          entry={dialog.entry}
          employeeName={nameOf(dialog.entry.employeeId)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
