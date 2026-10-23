import { zodResolver } from '@hookform/resolvers/zod';
import { HolidayInputSchema, type HolidayType } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge, type BadgeTone } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { DateField, FormError, SelectField, TextField } from '../components/forms';
import { inputClass } from '../components/forms/FieldShell';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner } from '../lib/auth';
import { applyServerError } from '../lib/forms';
import { holidayTypeLabels, optionsFrom } from '../lib/labels';
import { formatDate, manilaYear } from '../lib/dates';

type Row = ResponseOf<'/api/holidays/', 'get'>[number];
type FormIn = z.input<typeof HolidayInputSchema>;
type FormOut = z.output<typeof HolidayInputSchema>;

const typeTone: Record<HolidayType, BadgeTone> = {
  regular: 'info',
  special_non_working: 'warning',
  special_working: 'neutral',
};

function invalidateHolidays(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['holidays'] }),
    qc.invalidateQueries({ queryKey: ['dashboard'] }),
    qc.invalidateQueries({ queryKey: ['attendance'] }),
  ]);
}

function HolidayFormModal({
  holiday,
  year,
  onClose,
}: {
  holiday: Row | null;
  year: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { control, handleSubmit, formState, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(HolidayInputSchema),
    defaultValues: holiday
      ? { date: holiday.date, name: holiday.name, type: holiday.type }
      : { date: `${year}-01-01`, name: '', type: 'regular' },
  });
  const formId = holiday ? `holiday-form-${holiday.id}` : 'holiday-form-new';

  const onSubmit = async (body: FormOut) => {
    try {
      if (holiday) {
        await unwrap(api.PUT('/api/holidays/{id}', { params: { path: { id: holiday.id } }, body }));
      } else {
        await unwrap(api.POST('/api/holidays/', { body }));
      }
      await invalidateHolidays(qc);
      onClose();
    } catch (err) {
      // HOLIDAY_LOCKED and other conflicts land in the form banner with the server's message.
      applyServerError(err, setError);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            {holiday ? 'Save changes' : 'Add holiday'}
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
        <DateField control={control} name="date" label="Date" required />
        <TextField control={control} name="name" label="Name" required />
        <SelectField
          control={control}
          name="type"
          label="Type"
          options={optionsFrom(holidayTypeLabels)}
          hint="Premium multipliers for each type come from the statutory rates."
          required
        />
      </form>
    </Modal>
  );
}

function DeleteHolidayModal({ holiday, onClose }: { holiday: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.DELETE('/api/holidays/{id}', { params: { path: { id: holiday.id } } }));
      await invalidateHolidays(qc);
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
      title="Delete holiday?"
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
          Remove <span className="font-semibold">{holiday.name}</span> on{' '}
          {formatDate(holiday.date, 'weekday')}? Attendance on this date will be treated as an
          ordinary or rest day.
        </p>
      </div>
    </Modal>
  );
}

type Dialog = { kind: 'form'; holiday: Row | null } | { kind: 'delete'; holiday: Row } | null;

export function HolidaysPage() {
  const isOwner = useIsOwner();
  const thisYear = manilaYear();
  const [year, setYear] = useState(thisYear);
  const [dialog, setDialog] = useState<Dialog>(null);
  const years = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1, thisYear + 2];

  const holidays = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => unwrap(api.GET('/api/holidays/', { params: { query: { year } } })),
  });

  const columns: DataTableColumn<Row>[] = [
    { id: 'date', header: 'Date', cell: (r) => formatDate(r.date, 'weekday') },
    { id: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      id: 'type',
      header: 'Type',
      cell: (r) => <Badge tone={typeTone[r.type]}>{holidayTypeLabels[r.type]}</Badge>,
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
            onClick={() => setDialog({ kind: 'form', holiday: r })}
            aria-label={`Edit ${r.name}`}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog({ kind: 'delete', holiday: r })}
            aria-label={`Delete ${r.name}`}
          >
            Delete
          </Button>
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Regular and special holidays set the day type, and so the premium pay, of attendance."
        actions={
          isOwner ? (
            <Button onClick={() => setDialog({ kind: 'form', holiday: null })}>Add holiday</Button>
          ) : undefined
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="holiday-year" className="text-sm text-slate-600 dark:text-slate-400">
          Year
        </label>
        <select
          id="holiday-year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={`${inputClass} w-auto`}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {holidays.error ? <Banner tone="danger">{errorMessage(holidays.error)}</Banner> : null}
      <DataTable
        caption={`Holidays in ${year}`}
        columns={columns}
        rows={holidays.data ?? []}
        rowKey={(r) => r.id}
        loading={holidays.isPending}
        emptyTitle={`No holidays for ${year}`}
        emptyDescription={
          isOwner
            ? 'Add the holidays proclaimed for this year so premium pay is computed correctly.'
            : undefined
        }
      />
      {dialog?.kind === 'form' ? (
        <HolidayFormModal holiday={dialog.holiday} year={year} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteHolidayModal holiday={dialog.holiday} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
