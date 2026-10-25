import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreatePayrollRunSchema,
  CreateThirteenthRunSchema,
  CreateTwiceWeeklyRunSchema,
  type PayrollRunKind,
  type PayrollRunStatus,
} from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import {
  useController,
  useForm,
  useWatch,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { ApiError, api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge, type BadgeTone } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button, focusRing } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import {
  DateField,
  FormError,
  NumberField,
  SelectField,
  type BaseFieldProps,
} from '../components/forms';
import { FieldShell, describedBy, inputClass } from '../components/forms/FieldShell';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner } from '../lib/auth';
import { formatPeso } from '../lib/format';
import { applyServerError } from '../lib/forms';
import { optionsFrom, runKindLabels, runStatusLabels } from '../lib/labels';
import { formatDate, formatPeriod, manilaToday } from '../lib/dates';

type Row = ResponseOf<'/api/payroll-runs', 'get'>[number];

/* ------------------------------------------------------------------ */
/* Helpers shared by the payroll pages (PayrollRunDetail, Payslip, FinalPay). */

export const runStatusTone: Record<PayrollRunStatus, BadgeTone> = {
  draft: 'neutral',
  review: 'warning',
  approved: 'info',
  paid: 'success',
};

export function RunStatusBadge({ status }: { status: PayrollRunStatus }) {
  return <Badge tone={runStatusTone[status]}>{runStatusLabels[status]}</Badge>;
}

/** The id of an existing run carried in a 409 RUN_EXISTS error, if any. */
export function existingRunId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'RUN_EXISTS') return null;
  const details = err.details as { id?: unknown } | null | undefined;
  return typeof details?.id === 'string' ? details.id : null;
}

export function ExistingRunLink({ id }: { id: string }) {
  return (
    <Banner tone="info">
      <Link
        to={`/payroll/${id}`}
        className={`font-semibold underline underline-offset-2 ${focusRing}`}
      >
        Open the existing run
      </Link>
    </Banner>
  );
}

/* ------------------------------------------------------------------ */

/** `<input type="month">` bound to a `YYYY-MM` string (no shared MonthField exists yet). */
function MonthField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  hint,
  required,
  disabled,
  className,
}: BaseFieldProps<T, N, TT>) {
  const id = useId();
  const {
    field: { ref, name: fieldName, value: rawValue, onChange, onBlur },
    fieldState,
  } = useController<T, N, TT>({ control, name });
  const error = fieldState.error?.message;
  const value: unknown = rawValue;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <input
        id={id}
        ref={ref}
        name={fieldName}
        type="month"
        placeholder="YYYY-MM"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        required={required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClass}
      />
    </FieldShell>
  );
}

type CreateIn = z.input<typeof CreatePayrollRunSchema>;
type CreateOut = z.output<typeof CreatePayrollRunSchema>;

const regularKindOptions = optionsFrom({
  semi_monthly_1: runKindLabels.semi_monthly_1,
  semi_monthly_2: runKindLabels.semi_monthly_2,
  monthly: runKindLabels.monthly,
});

const scheduleOptions = [
  { value: 'second_cutoff', label: 'All on the 2nd cutoff' },
  { value: 'split', label: 'Split 50/50 across both cutoffs' },
];

/** Mounted only while open, so every opening starts from fresh defaults. */
function NewRunModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [existing, setExisting] = useState<string | null>(null);
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(api.GET('/api/settings')),
  });
  const { control, handleSubmit, formState, setError, setValue, getFieldState } = useForm<
    CreateIn,
    unknown,
    CreateOut
  >({
    resolver: zodResolver(CreatePayrollRunSchema),
    defaultValues: {
      kind: 'semi_monthly_1',
      month: manilaToday().slice(0, 7),
      payDate: '',
      contributionSchedule: 'second_cutoff',
    },
  });
  const kind = useWatch({ control, name: 'kind' });
  const defaultSchedule = settings.data?.contributionSchedule;

  useEffect(() => {
    // Apply the Settings default once it loads, unless the owner already picked one.
    if (defaultSchedule && !getFieldState('contributionSchedule').isDirty) {
      setValue('contributionSchedule', defaultSchedule);
    }
  }, [defaultSchedule, getFieldState, setValue]);

  const onSubmit = async (body: CreateOut) => {
    setExisting(null);
    try {
      const run = await unwrap(api.POST('/api/payroll-runs', { body }));
      await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.setQueryData(['payroll-run', run.id], run);
      onClose();
      void navigate(`/payroll/${run.id}`);
    } catch (err) {
      setExisting(existingRunId(err));
      applyServerError(err, setError);
    }
  };

  const formId = useId();
  return (
    <Modal
      open
      onClose={onClose}
      title="New payroll run"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Create and compute
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Creates a draft run for every active employee using the attendance, loans and deductions
          on file. You can recompute it until it is approved.
        </p>
        <FormError errors={formState.errors} />
        {existing ? <ExistingRunLink id={existing} /> : null}
        <SelectField
          control={control}
          name="kind"
          label="Run type"
          options={regularKindOptions}
          required
        />
        <MonthField
          control={control}
          name="month"
          label="Month"
          hint="The cutoff period is derived from the run type."
          required
        />
        <DateField control={control} name="payDate" label="Pay date" required />
        {kind !== 'monthly' ? (
          <SelectField
            control={control}
            name="contributionSchedule"
            label="SSS / PhilHealth / Pag-IBIG deduction"
            options={scheduleOptions}
            hint="Default comes from Settings."
            required
          />
        ) : null}
      </form>
    </Modal>
  );
}

type ThirteenthIn = z.input<typeof CreateThirteenthRunSchema>;
type ThirteenthOut = z.output<typeof CreateThirteenthRunSchema>;

/** Mounted only while open, so every opening starts from fresh defaults. */
function ThirteenthRunModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [existing, setExisting] = useState<string | null>(null);
  const { control, handleSubmit, formState, setError } = useForm<
    ThirteenthIn,
    unknown,
    ThirteenthOut
  >({
    resolver: zodResolver(CreateThirteenthRunSchema),
    defaultValues: { year: Number(manilaToday().slice(0, 4)), mode: 'full', payDate: '' },
  });

  const onSubmit = async (body: ThirteenthOut) => {
    setExisting(null);
    try {
      const run = await unwrap(api.POST('/api/payroll-runs/thirteenth-month', { body }));
      await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.setQueryData(['payroll-run', run.id], run);
      onClose();
      void navigate(`/payroll/${run.id}`);
    } catch (err) {
      setExisting(existingRunId(err));
      applyServerError(err, setError);
    }
  };

  const formId = useId();
  return (
    <Modal
      open
      onClose={onClose}
      title="13th month run"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Create and compute
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Pays 13th month from basic salary earned in the year (posted runs only). Pay the full
          amount by December 24, or half mid-year and the balance later.
        </p>
        <FormError errors={formState.errors} />
        {existing ? <ExistingRunLink id={existing} /> : null}
        <NumberField control={control} name="year" label="Year" min={2000} max={2100} required />
        <SelectField
          control={control}
          name="mode"
          label="Amount"
          options={[
            { value: 'full', label: 'Full (balance still due for the year)' },
            { value: 'half', label: 'Half (mid-year advance)' },
          ]}
          required
        />
        <DateField control={control} name="payDate" label="Pay date" required />
      </form>
    </Modal>
  );
}

type TwiceWeeklyIn = z.input<typeof CreateTwiceWeeklyRunSchema>;
type TwiceWeeklyOut = z.output<typeof CreateTwiceWeeklyRunSchema>;

/** Mounted only while open, so every opening starts from fresh defaults. */
function TwiceWeeklyRunModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [existing, setExisting] = useState<string | null>(null);
  const { control, handleSubmit, formState, setError } = useForm<
    TwiceWeeklyIn,
    unknown,
    TwiceWeeklyOut
  >({
    resolver: zodResolver(CreateTwiceWeeklyRunSchema),
    defaultValues: { payDate: '' },
  });

  const onSubmit = async (body: TwiceWeeklyOut) => {
    setExisting(null);
    try {
      const run = await unwrap(api.POST('/api/payroll-runs/twice-weekly', { body }));
      await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.setQueryData(['payroll-run', run.id], run);
      onClose();
      void navigate(`/payroll/${run.id}`);
    } catch (err) {
      setExisting(existingRunId(err));
      applyServerError(err, setError);
    }
  };

  const formId = useId();
  return (
    <Modal
      open
      onClose={onClose}
      title="Twice-weekly payout"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Create and compute
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Pays employees on the twice-weekly schedule. Wednesday pays Sunday to Wednesday; Saturday
          pays Thursday to Saturday. SSS, PhilHealth and Pag-IBIG come off the last payout of the
          month; tax is withheld every payout.
        </p>
        <FormError errors={formState.errors} />
        {existing ? <ExistingRunLink id={existing} /> : null}
        <DateField
          control={control}
          name="payDate"
          label="Pay date"
          hint="A Wednesday or a Saturday."
          required
        />
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export const runColumns: DataTableColumn<Row>[] = [
  {
    id: 'period',
    header: 'Period',
    cell: (r) => (
      <div>
        <div className="font-medium">{runKindLabels[r.kind]}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {formatPeriod(r.periodStart, r.periodEnd)}
        </div>
      </div>
    ),
  },
  { id: 'pay', header: 'Pay date', cell: (r) => formatDate(r.payDate), hideOnMobile: true },
  {
    id: 'employees',
    header: 'Employees',
    align: 'right',
    cell: (r) => r.employeeCount,
    hideOnMobile: true,
  },
  { id: 'net', header: 'Net pay', align: 'right', cell: (r) => formatPeso(r.totals.net) },
  {
    id: 'status',
    header: 'Status',
    cell: (r) => (
      <div className="flex flex-wrap gap-1">
        <RunStatusBadge status={r.status} />
        {r.warningCount > 0 ? (
          <Badge tone="warning">
            {r.warningCount} warning{r.warningCount === 1 ? '' : 's'}
          </Badge>
        ) : null}
        {!r.ratesVerified ? <Badge tone="danger">Rates unverified</Badge> : null}
      </div>
    ),
  },
];

const selectClass =
  'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900';

export function PayrollRunsPage() {
  const isOwner = useIsOwner();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PayrollRunStatus | ''>('');
  const [kind, setKind] = useState<PayrollRunKind | ''>('');
  const [modal, setModal] = useState<'regular' | 'thirteenth' | 'twice_weekly' | null>(null);

  const runs = useQuery({
    queryKey: ['payroll-runs', { status, kind }],
    queryFn: () =>
      unwrap(
        api.GET('/api/payroll-runs', {
          params: { query: { ...(status ? { status } : {}), ...(kind ? { kind } : {}) } },
        }),
      ),
  });
  const rows = runs.data ?? [];
  const unverified = rows.some((r) => !r.ratesVerified && r.status !== 'paid');

  return (
    <>
      <PageHeader
        title="Payroll runs"
        description="Semi-monthly, monthly, twice-weekly, 13th-month and final-pay runs."
        actions={
          isOwner ? (
            <>
              <Button variant="secondary" onClick={() => setModal('twice_weekly')}>
                Twice-weekly payout
              </Button>
              <Button variant="secondary" onClick={() => setModal('thirteenth')}>
                13th month run
              </Button>
              <Button onClick={() => setModal('regular')}>New payroll run</Button>
            </>
          ) : undefined
        }
      />
      {unverified ? (
        <Banner tone="warning" title="Unverified statutory rates" className="mb-4">
          Some runs were computed with rates that have not been marked verified. Check the figures
          against the latest circulars before approving.{' '}
          <Link
            to="/settings/rates"
            className={`font-semibold underline underline-offset-2 ${focusRing}`}
          >
            Review rates
          </Link>
        </Banner>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="run-status-filter" className="text-sm text-slate-600 dark:text-slate-400">
            Status
          </label>
          <select
            id="run-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as PayrollRunStatus | '')}
            className={selectClass}
          >
            <option value="">All</option>
            {optionsFrom(runStatusLabels).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="run-kind-filter" className="text-sm text-slate-600 dark:text-slate-400">
            Type
          </label>
          <select
            id="run-kind-filter"
            value={kind}
            onChange={(e) => setKind(e.target.value as PayrollRunKind | '')}
            className={selectClass}
          >
            <option value="">All</option>
            {optionsFrom(runKindLabels).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {runs.error ? (
        <Banner tone="danger" className="mb-4">
          {errorMessage(runs.error)}
        </Banner>
      ) : null}
      <DataTable
        caption="Payroll runs"
        columns={runColumns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={runs.isPending}
        emptyTitle={status || kind ? 'No runs match these filters' : 'No payroll runs yet'}
        emptyDescription={
          isOwner && !status && !kind
            ? 'Create a payroll run once attendance for the period is in.'
            : undefined
        }
        onRowClick={(r) => void navigate(`/payroll/${r.id}`)}
      />
      {isOwner ? (
        <>
          {modal === 'regular' ? <NewRunModal onClose={() => setModal(null)} /> : null}
          {modal === 'thirteenth' ? <ThirteenthRunModal onClose={() => setModal(null)} /> : null}
          {modal === 'twice_weekly' ? <TwiceWeeklyRunModal onClose={() => setModal(null)} /> : null}
        </>
      ) : null}
    </>
  );
}
