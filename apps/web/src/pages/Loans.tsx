import { zodResolver } from '@hookform/resolvers/zod';
import { LoanAdjustmentSchema, LoanInputSchema, LoanUpdateSchema } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useController, useForm } from 'react-hook-form';
import type { Control } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import {
  DateField,
  FormError,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
  padMoney,
  sanitizeMoneyInput,
} from '../components/forms';
import { describedBy, FieldShell, inputClass } from '../components/forms/FieldShell';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { useIsOwner } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatPeso } from '../lib/format';
import { applyServerError } from '../lib/forms';
import { loanTypeLabels, optionsFrom } from '../lib/labels';
import { manilaToday } from '../lib/dates';
import { deductOnLabels, ledgerKindLabels, loanStatusLabels } from '../lib/labels';

type Loan = ResponseOf<'/api/loans/', 'get'>[number];
type LoanDetail = ResponseOf<'/api/loans/{id}', 'get'>;
type LedgerEntry = LoanDetail['ledger'][number];
type Employee = ResponseOf<'/api/employees/', 'get'>[number];
type LoanStatus = Loan['status'];

type CreateIn = z.input<typeof LoanInputSchema>;
type CreateOut = z.output<typeof LoanInputSchema>;
type UpdateIn = z.input<typeof LoanUpdateSchema>;
type UpdateOut = z.output<typeof LoanUpdateSchema>;
type AdjustIn = z.input<typeof LoanAdjustmentSchema>;
type AdjustOut = z.output<typeof LoanAdjustmentSchema>;

const statusTone = { active: 'info', paid: 'success', cancelled: 'neutral' } as const;

const ledgerKindTone = { disbursement: 'info', payment: 'success', adjustment: 'warning' } as const;

const filterClass =
  'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900';

const employeesQuery = {
  queryKey: ['employees', ''] as const,
  queryFn: () => unwrap(api.GET('/api/employees/', { params: { query: {} } })),
};

// ------------------------------------------------------------------ signed money input

/**
 * Signed peso amount as a 2-dp string (the shared MoneyField strips the minus sign, which an
 * adjustment needs). Pure string work: no float maths on money.
 */
function SignedMoneyField({
  control,
  label,
  hint,
}: {
  control: Control<AdjustIn, unknown, AdjustOut>;
  label: string;
  hint: string;
}) {
  const id = useId();
  const {
    field: { ref, name: fieldName, value: rawValue, onChange, onBlur },
    fieldState,
  } = useController({ control, name: 'amount' });
  const error = fieldState.error?.message;
  const text = rawValue;
  const negative = text.startsWith('-');
  const magnitude = negative ? text.slice(1) : text;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500"
        >
          ₱
        </span>
        <input
          id={id}
          ref={ref}
          name={fieldName}
          type="text"
          inputMode="text"
          autoComplete="off"
          value={text}
          placeholder="-0.00"
          onChange={(e) => {
            const raw = e.target.value.trim();
            const sign = raw.startsWith('-') ? '-' : '';
            onChange(sign + sanitizeMoneyInput(raw));
          }}
          onBlur={() => {
            const padded = magnitude === '' ? text : (negative ? '-' : '') + padMoney(magnitude);
            if (padded !== text) onChange(padded);
            onBlur();
          }}
          required
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(inputClass, 'pl-7 text-right tabular-nums')}
        />
      </div>
    </FieldShell>
  );
}

// ------------------------------------------------------------------ create

function CreateLoanModal({
  open,
  onClose,
  employees,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  employees: readonly Employee[];
  onCreated: (loan: LoanDetail) => void;
}) {
  const qc = useQueryClient();
  const formId = useId();
  const { control, handleSubmit, formState, setError, reset } = useForm<
    CreateIn,
    unknown,
    CreateOut
  >({
    resolver: zodResolver(LoanInputSchema),
    defaultValues: {
      employeeId: '',
      type: 'sss',
      reference: null,
      principal: '',
      amortization: '',
      deductOn: 'every_run',
      startDate: manilaToday(),
      notes: null,
    },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = async (body: CreateOut) => {
    try {
      const created = await unwrap(api.POST('/api/loans/', { body }));
      await qc.invalidateQueries({ queryKey: ['loans'] });
      qc.setQueryData(['loan', created.id], created);
      onCreated(created);
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  const employeeOptions = employees
    .filter((e) => e.status === 'active')
    .map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeNo})` }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New loan"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Add loan
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
        <SelectField
          control={control}
          name="employeeId"
          label="Employee"
          placeholder="Choose an employee…"
          options={employeeOptions}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="type"
            label="Type"
            options={optionsFrom(loanTypeLabels)}
            required
          />
          <TextField
            control={control}
            name="reference"
            label="Reference no."
            hint="E.g. the SSS or Pag-IBIG loan number."
            emptyAsNull
          />
          <MoneyField
            control={control}
            name="principal"
            label="Principal"
            hint="Total amount to be repaid."
            required
          />
          <MoneyField
            control={control}
            name="amortization"
            label="Amortization"
            hint="Deducted each time the loan is due."
            required
          />
          <SelectField
            control={control}
            name="deductOn"
            label="Deduct on"
            options={optionsFrom(deductOnLabels)}
            required
          />
          <DateField control={control} name="startDate" label="Start date" required />
        </div>
        <TextAreaField control={control} name="notes" label="Notes" emptyAsNull />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ edit

function EditLoanModal({
  open,
  onClose,
  loan,
}: {
  open: boolean;
  onClose: () => void;
  loan: LoanDetail;
}) {
  const qc = useQueryClient();
  const formId = useId();
  const { control, handleSubmit, formState, setError, reset } = useForm<
    UpdateIn,
    unknown,
    UpdateOut
  >({
    resolver: zodResolver(LoanUpdateSchema),
    defaultValues: {
      reference: loan.reference,
      amortization: loan.amortization,
      deductOn: loan.deductOn,
      notes: loan.notes,
    },
  });

  useEffect(() => {
    if (open)
      reset({
        reference: loan.reference,
        amortization: loan.amortization,
        deductOn: loan.deductOn,
        notes: loan.notes,
      });
  }, [open, loan, reset]);

  const onSubmit = async (body: UpdateOut) => {
    try {
      const saved = await unwrap(
        api.PUT('/api/loans/{id}', { params: { path: { id: loan.id } }, body }),
      );
      qc.setQueryData(['loan', saved.id], saved);
      await qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit loan"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Save changes
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          The principal and start date are part of the ledger and cannot be edited. Use an
          adjustment to correct the balance.
        </p>
        <TextField control={control} name="reference" label="Reference no." emptyAsNull />
        <MoneyField control={control} name="amortization" label="Amortization" required />
        <SelectField
          control={control}
          name="deductOn"
          label="Deduct on"
          options={optionsFrom(deductOnLabels)}
          required
        />
        <TextAreaField control={control} name="notes" label="Notes" emptyAsNull />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ adjustment

function AdjustmentModal({
  open,
  onClose,
  loan,
}: {
  open: boolean;
  onClose: () => void;
  loan: LoanDetail;
}) {
  const qc = useQueryClient();
  const formId = useId();
  const { control, handleSubmit, formState, setError, reset } = useForm<
    AdjustIn,
    unknown,
    AdjustOut
  >({
    resolver: zodResolver(LoanAdjustmentSchema),
    defaultValues: { date: manilaToday(), amount: '', note: '' },
  });

  useEffect(() => {
    if (open) reset({ date: manilaToday(), amount: '', note: '' });
  }, [open, reset]);

  const onSubmit = async (body: AdjustOut) => {
    try {
      const saved = await unwrap(
        api.POST('/api/loans/{id}/adjustments', { params: { path: { id: loan.id } }, body }),
      );
      qc.setQueryData(['loan', saved.id], saved);
      await qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add adjustment"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Record adjustment
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
        <Banner tone="info">
          Use a <strong>negative</strong> amount for a payment made outside payroll (e.g. -500.00
          lowers the balance). Use a <strong>positive</strong> amount to correct the balance upward.
          Current balance: <strong>{formatPeso(loan.balance)}</strong>. It cannot go below zero.
        </Banner>
        <DateField control={control} name="date" label="Date" required />
        <SignedMoneyField
          control={control}
          label="Amount"
          hint="Negative = manual payment, positive = correction."
        />
        <TextAreaField
          control={control}
          name="note"
          label="Note"
          hint="Why this adjustment was made (kept in the ledger and audit log)."
          required
        />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ cancel

function CancelLoanModal({
  open,
  onClose,
  loan,
}: {
  open: boolean;
  onClose: () => void;
  loan: LoanDetail;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await unwrap(
        api.POST('/api/loans/{id}/cancel', { params: { path: { id: loan.id } } }),
      );
      qc.setQueryData(['loan', saved.id], saved);
      await qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel this loan?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep loan
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            Cancel loan
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error !== null ? (
          <Banner tone="danger" title="Could not cancel">
            {error}
          </Banner>
        ) : null}
        <p>
          Cancel only a loan entered by mistake. It will no longer be deducted from payroll. A loan
          that payroll has already deducted cannot be cancelled; record an adjustment instead.
        </p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ detail panel

const ledgerColumns: DataTableColumn<LedgerEntry>[] = [
  { id: 'date', header: 'Date', cell: (r) => r.date },
  {
    id: 'kind',
    header: 'Kind',
    cell: (r) => <Badge tone={ledgerKindTone[r.kind]}>{ledgerKindLabels[r.kind]}</Badge>,
  },
  { id: 'amount', header: 'Amount', align: 'right', cell: (r) => formatPeso(r.amount) },
  {
    id: 'balance',
    header: 'Balance after',
    align: 'right',
    cell: (r) => formatPeso(r.balanceAfter),
  },
  {
    id: 'note',
    header: 'Note',
    cell: (r) => (
      <div className="space-y-0.5">
        {r.note !== null && r.note !== '' ? <div>{r.note}</div> : null}
        {r.payrollRunId !== null ? (
          <Link
            to={`/payroll/${r.payrollRunId}`}
            className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
          >
            View payroll run
          </Link>
        ) : null}
        {(r.note === null || r.note === '') && r.payrollRunId === null ? '—' : null}
      </div>
    ),
  },
];

type Dialog = 'edit' | 'adjust' | 'cancel' | null;

function LoanDetailPanel({
  loanId,
  employeeName,
  onClose,
}: {
  loanId: string;
  employeeName: (employeeId: string) => string;
  onClose: () => void;
}) {
  const isOwner = useIsOwner();
  const [dialog, setDialog] = useState<Dialog>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detail = useQuery({
    queryKey: ['loan', loanId],
    queryFn: () => unwrap(api.GET('/api/loans/{id}', { params: { path: { id: loanId } } })),
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, [loanId]);

  const loan = detail.data;
  const closeDialog = () => setDialog(null);

  return (
    <Card
      className="mb-6"
      title={
        <span ref={headingRef} tabIndex={-1} className="outline-none">
          {loan ? `${loanTypeLabels[loan.type]} — ${employeeName(loan.employeeId)}` : 'Loan'}
        </span>
      }
      actions={
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close loan details">
          Close
        </Button>
      }
    >
      {detail.isPending ? <Spinner label="Loading loan" /> : null}
      {detail.error ? <Banner tone="danger">{errorMessage(detail.error)}</Banner> : null}
      {loan ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Status</dt>
              <dd>
                <Badge tone={statusTone[loan.status]}>{loanStatusLabels[loan.status]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Balance</dt>
              <dd className="font-semibold tabular-nums">{formatPeso(loan.balance)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Principal</dt>
              <dd className="tabular-nums">{formatPeso(loan.principal)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Amortization</dt>
              <dd className="tabular-nums">{formatPeso(loan.amortization)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Deduct on</dt>
              <dd>{deductOnLabels[loan.deductOn]}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Start date</dt>
              <dd>{loan.startDate}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Reference</dt>
              <dd className="break-words">{loan.reference ?? '—'}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-slate-500 dark:text-slate-400">Notes</dt>
              <dd className="break-words">{loan.notes ?? '—'}</dd>
            </div>
          </dl>

          {isOwner && loan.status !== 'cancelled' ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDialog('edit')}>
                Edit
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDialog('adjust')}>
                Add adjustment
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDialog('cancel')}>
                Cancel loan
              </Button>
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-sm font-semibold">Ledger</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Payroll deductions are added automatically when a payroll run is approved.
            </p>
            <DataTable
              caption="Loan ledger"
              columns={ledgerColumns}
              rows={loan.ledger}
              rowKey={(r) => r.id}
              emptyTitle="No ledger entries"
            />
          </div>

          {isOwner ? (
            <>
              <EditLoanModal open={dialog === 'edit'} onClose={closeDialog} loan={loan} />
              <AdjustmentModal open={dialog === 'adjust'} onClose={closeDialog} loan={loan} />
              {dialog === 'cancel' ? (
                <CancelLoanModal open onClose={closeDialog} loan={loan} />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ page

export function LoansPage() {
  const isOwner = useIsOwner();
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState<LoanStatus | ''>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const employees = useQuery(employeesQuery);
  const loans = useQuery({
    queryKey: ['loans', employeeId, status],
    queryFn: () => {
      const query: { employeeId?: string; status?: LoanStatus } = {};
      if (employeeId) query.employeeId = employeeId;
      if (status) query.status = status;
      return unwrap(api.GET('/api/loans/', { params: { query } }));
    },
  });

  const nameById = new Map((employees.data ?? []).map((e) => [e.id, e.fullName]));
  const employeeName = (id: string) => nameById.get(id) ?? '—';

  const columns: DataTableColumn<Loan>[] = [
    {
      id: 'employee',
      header: 'Employee',
      cell: (r) => (
        <div>
          <div className="font-medium">{employeeName(r.employeeId)}</div>
          {r.reference !== null ? (
            <div className="text-xs text-slate-500">{r.reference}</div>
          ) : null}
        </div>
      ),
    },
    { id: 'type', header: 'Type', cell: (r) => loanTypeLabels[r.type] },
    {
      id: 'principal',
      header: 'Principal',
      align: 'right',
      cell: (r) => formatPeso(r.principal),
      hideOnMobile: true,
    },
    {
      id: 'amortization',
      header: 'Amortization',
      align: 'right',
      cell: (r) => formatPeso(r.amortization),
    },
    { id: 'balance', header: 'Balance', align: 'right', cell: (r) => formatPeso(r.balance) },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <Badge tone={statusTone[r.status]}>{loanStatusLabels[r.status]}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Loans"
        description="SSS, Pag-IBIG, company loans and cash advances. Balances come from each loan's ledger."
        actions={isOwner ? <Button onClick={() => setCreating(true)}>Add loan</Button> : undefined}
      />

      {selectedId !== null ? (
        <LoanDetailPanel
          loanId={selectedId}
          employeeName={employeeName}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="loan-employee" className="text-sm text-slate-600 dark:text-slate-400">
            Employee
          </label>
          <select
            id="loan-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={cn(filterClass, 'max-w-[14rem]')}
          >
            <option value="">All employees</option>
            {(employees.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="loan-status" className="text-sm text-slate-600 dark:text-slate-400">
            Status
          </label>
          <select
            id="loan-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as LoanStatus | '')}
            className={filterClass}
          >
            <option value="active">Active</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {loans.error ? <Banner tone="danger">{errorMessage(loans.error)}</Banner> : null}
      {employees.error ? <Banner tone="danger">{errorMessage(employees.error)}</Banner> : null}
      <DataTable
        caption="Loans"
        columns={columns}
        rows={loans.data ?? []}
        rowKey={(r) => r.id}
        loading={loans.isPending}
        emptyTitle="No loans"
        emptyDescription={
          isOwner ? 'Add a loan to deduct its amortization from payroll.' : undefined
        }
        onRowClick={(r) => {
          setSelectedId(r.id);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {isOwner ? (
        <CreateLoanModal
          open={creating}
          onClose={() => setCreating(false)}
          employees={employees.data ?? []}
          onCreated={(loan) => {
            setCreating(false);
            setSelectedId(loan.id);
          }}
        />
      ) : null}
    </>
  );
}
