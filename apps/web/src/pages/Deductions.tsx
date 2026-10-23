import { zodResolver } from '@hookform/resolvers/zod';
import { CustomDeductionInputSchema } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import {
  CheckboxField,
  DateField,
  FormError,
  MoneyField,
  SelectField,
  TextField,
} from '../components/forms';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatPeso } from '../lib/format';
import { applyServerError } from '../lib/forms';
import { optionsFrom } from '../lib/labels';
import { manilaToday } from '../lib/dates';
import { recurrenceLabels } from '../lib/labels';

type Deduction = ResponseOf<'/api/deductions/', 'get'>[number];
type Employee = ResponseOf<'/api/employees/', 'get'>[number];
type FormIn = z.input<typeof CustomDeductionInputSchema>;
type FormOut = z.output<typeof CustomDeductionInputSchema>;
type ActiveFilter = '' | 'true' | 'false';

const filterClass =
  'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900';

function emptyForm(): FormIn {
  return {
    employeeId: '',
    label: '',
    amount: '',
    recurrence: 'every_run',
    startDate: manilaToday(),
    endDate: null,
    active: true,
  };
}

function toFormValues(d: Deduction): FormIn {
  return {
    employeeId: d.employeeId,
    label: d.label,
    amount: d.amount,
    recurrence: d.recurrence,
    startDate: d.startDate,
    endDate: d.endDate,
    active: d.active,
  };
}

/** `null` = closed, `'new'` = create, otherwise the deduction being edited/viewed.
 * The modal is mounted only while open (keyed per deduction), so its form state starts fresh. */
type Editing = null | 'new' | Deduction;

function DeductionModal({
  editing,
  onClose,
  employees,
}: {
  editing: Editing;
  onClose: () => void;
  employees: readonly Employee[];
}) {
  const qc = useQueryClient();
  const formId = useId();
  const open = editing !== null;
  const existing = editing !== null && editing !== 'new' ? editing : null;
  const applied = existing !== null && existing.appliedRunId !== null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { control, handleSubmit, formState, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(CustomDeductionInputSchema),
    defaultValues: existing ? toFormValues(existing) : emptyForm(),
  });
  const recurrence = useWatch({ control, name: 'recurrence' });

  const refresh = () => qc.invalidateQueries({ queryKey: ['deductions'] });

  const onSubmit = async (out: FormOut) => {
    // A one-off deduction applies to one run only, so an end date has no meaning there.
    const body = { ...out, endDate: out.recurrence === 'once' ? null : out.endDate };
    try {
      if (existing) {
        await unwrap(
          api.PUT('/api/deductions/{id}', { params: { path: { id: existing.id } }, body }),
        );
      } else {
        await unwrap(api.POST('/api/deductions/', { body }));
      }
      await refresh();
      onClose();
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    setDeleting(true);
    try {
      await unwrap(api.DELETE('/api/deductions/{id}', { params: { path: { id: existing.id } } }));
      await refresh();
      onClose();
    } catch (err) {
      setError('root.server', { type: 'server', message: errorMessage(err) });
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  // Inactive employees keep their existing deductions visible in the select.
  const employeeOptions = employees
    .filter((e) => e.status === 'active' || e.id === existing?.employeeId)
    .map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeNo})` }));

  let footer;
  if (applied) {
    footer = (
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    );
  } else if (confirmDelete) {
    footer = (
      <>
        <span className="text-sm sm:mr-auto sm:self-center">Delete this deduction?</span>
        <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
          Keep it
        </Button>
        <Button variant="danger" loading={deleting} onClick={() => void onDelete()}>
          Delete
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        {existing ? (
          <Button
            variant="ghost"
            className="text-red-700 sm:mr-auto dark:text-red-400"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={formState.isSubmitting}>
          {existing ? 'Save changes' : 'Add deduction'}
        </Button>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={applied ? 'Applied deduction' : existing ? 'Edit deduction' : 'New deduction'}
      footer={footer}
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      >
        {applied ? (
          <Banner tone="info">
            This one-off deduction was already taken by an approved payroll run, so it is read-only.
            Reopen that run to change it.
          </Banner>
        ) : null}
        <FormError errors={formState.errors} />
        <fieldset disabled={applied} className="space-y-4">
          <SelectField
            control={control}
            name="employeeId"
            label="Employee"
            placeholder="Choose an employee…"
            options={employeeOptions}
            required
          />
          <TextField
            control={control}
            name="label"
            label="Label"
            hint="Shown on the payslip, e.g. “Uniform” or “Canteen”."
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField
              control={control}
              name="amount"
              label="Amount"
              hint="Per payroll run."
              required
            />
            <SelectField
              control={control}
              name="recurrence"
              label="Recurrence"
              options={optionsFrom(recurrenceLabels)}
              required
            />
            <DateField
              control={control}
              name="startDate"
              label={recurrence === 'once' ? 'Apply from' : 'Start date'}
              hint={
                recurrence === 'once'
                  ? 'Taken by the first approved run on or after this date.'
                  : undefined
              }
              required
            />
            {recurrence === 'every_run' ? (
              <DateField
                control={control}
                name="endDate"
                label="End date"
                hint="Leave empty to keep deducting until switched off."
                emptyAsNull
              />
            ) : null}
          </div>
          <CheckboxField
            control={control}
            name="active"
            label="Active"
            hint="Untick to pause this deduction without deleting it."
          />
        </fieldset>
      </form>
    </Modal>
  );
}

export function DeductionsPage() {
  const isOwner = useIsOwner();
  const [employeeId, setEmployeeId] = useState('');
  const [active, setActive] = useState<ActiveFilter>('true');
  const [editing, setEditing] = useState<Editing>(null);

  const employees = useQuery({
    queryKey: ['employees', ''],
    queryFn: () => unwrap(api.GET('/api/employees/', { params: { query: {} } })),
  });
  const deductions = useQuery({
    queryKey: ['deductions', employeeId, active],
    queryFn: () => {
      const query: { employeeId?: string; active?: 'true' | 'false' } = {};
      if (employeeId) query.employeeId = employeeId;
      if (active) query.active = active;
      return unwrap(api.GET('/api/deductions/', { params: { query } }));
    },
  });

  const nameById = new Map((employees.data ?? []).map((e) => [e.id, e.fullName]));

  const columns: DataTableColumn<Deduction>[] = [
    {
      id: 'employee',
      header: 'Employee',
      cell: (r) => <span className="font-medium">{nameById.get(r.employeeId) ?? '—'}</span>,
    },
    { id: 'label', header: 'Label', cell: (r) => r.label },
    { id: 'amount', header: 'Amount', align: 'right', cell: (r) => formatPeso(r.amount) },
    {
      id: 'recurrence',
      header: 'Recurrence',
      cell: (r) => (r.recurrence === 'once' ? 'Once' : 'Every run'),
    },
    {
      id: 'dates',
      header: 'Dates',
      hideOnMobile: true,
      cell: (r) =>
        r.recurrence === 'once'
          ? `From ${r.startDate}`
          : `${r.startDate} – ${r.endDate ?? 'no end'}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.appliedRunId !== null ? (
            <Badge tone="success">Applied</Badge>
          ) : (
            <Badge tone={r.active ? 'info' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Deductions"
        description="Custom deductions taken from net pay: one-off or every payroll run."
        actions={
          isOwner ? <Button onClick={() => setEditing('new')}>Add deduction</Button> : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="ded-employee" className="text-sm text-slate-600 dark:text-slate-400">
            Employee
          </label>
          <select
            id="ded-employee"
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
          <label htmlFor="ded-active" className="text-sm text-slate-600 dark:text-slate-400">
            Show
          </label>
          <select
            id="ded-active"
            value={active}
            onChange={(e) => setActive(e.target.value as ActiveFilter)}
            className={filterClass}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {deductions.error ? <Banner tone="danger">{errorMessage(deductions.error)}</Banner> : null}
      {employees.error ? <Banner tone="danger">{errorMessage(employees.error)}</Banner> : null}
      <DataTable
        caption="Custom deductions"
        columns={columns}
        rows={deductions.data ?? []}
        rowKey={(r) => r.id}
        loading={deductions.isPending}
        emptyTitle="No deductions"
        emptyDescription={
          isOwner ? 'Add a deduction such as a uniform, canteen or equipment charge.' : undefined
        }
        onRowClick={isOwner ? (r) => setEditing(r) : undefined}
      />

      {isOwner && editing !== null ? (
        <DeductionModal
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing}
          onClose={() => setEditing(null)}
          employees={employees.data ?? []}
        />
      ) : null}
    </>
  );
}
