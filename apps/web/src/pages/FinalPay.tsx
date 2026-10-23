import { zodResolver } from '@hookform/resolvers/zod';
import { FinalPayRequestSchema } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { DateField, FormError, NumberField, SelectField, TextAreaField } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner } from '../lib/auth';
import { formatPeso } from '../lib/format';
import { applyServerError } from '../lib/forms';
import { existingRunId, ExistingRunLink, RunStatusBadge } from './PayrollRuns';
import { formatDate, manilaToday } from '../lib/dates';

type FormIn = z.input<typeof FinalPayRequestSchema>;
type FormOut = z.output<typeof FinalPayRequestSchema>;
type Run = ResponseOf<'/api/payroll-runs', 'get'>[number];
type Employee = ResponseOf<'/api/employees/', 'get'>[number];

function FinalPayForm({ employees }: { employees: readonly Employee[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [existing, setExisting] = useState<string | null>(null);
  const { control, handleSubmit, formState, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(FinalPayRequestSchema),
    defaultValues: {
      employeeId: '',
      separationDate: manilaToday(),
      payDate: '',
      unusedSilDays: 0,
      reason: '',
    },
  });

  const options = employees
    .filter((e) => e.status !== 'separated')
    .map((e) => ({
      value: e.id,
      label: `${e.fullName} (${e.employeeNo})${e.status === 'inactive' ? ' — inactive' : ''}`,
    }));

  const onSubmit = async (body: FormOut) => {
    setExisting(null);
    try {
      const run = await unwrap(api.POST('/api/final-pay', { body }));
      qc.setQueryData(['payroll-run', run.id], run);
      await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      void navigate(`/payroll/${run.id}`);
    } catch (err) {
      setExisting(existingRunId(err));
      applyServerError(err, setError);
    }
  };

  return (
    <Card title="Compute final pay">
      <form noValidate className="space-y-4" onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
        <FormError errors={formState.errors} />
        {existing ? <ExistingRunLink id={existing} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="employeeId"
            label="Employee"
            placeholder="Choose an employee…"
            options={options}
            required
            className="sm:col-span-2"
          />
          <DateField
            control={control}
            name="separationDate"
            label="Last day of work (separation date)"
            required
          />
          <DateField
            control={control}
            name="payDate"
            label="Pay date"
            hint="DOLE expects final pay within 30 days of separation."
            required
          />
          <NumberField
            control={control}
            name="unusedSilDays"
            label="Unused service incentive leave (days)"
            hint="Converted to cash at the daily rate. Half days allowed."
            min={0}
            max={366}
            step={0.5}
            required
          />
          <TextAreaField
            control={control}
            name="reason"
            label="Reason for separation"
            hint="Kept in the audit log, e.g. resignation, end of contract."
            rows={2}
            required
            className="sm:col-span-2"
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={formState.isSubmitting}>
            Create final-pay run
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function FinalPayPage() {
  const isOwner = useIsOwner();
  const navigate = useNavigate();

  const employees = useQuery({
    queryKey: ['employees', ''],
    queryFn: () => unwrap(api.GET('/api/employees/', { params: { query: {} } })),
  });
  const runs = useQuery({
    queryKey: ['payroll-runs', { status: '', kind: 'final_pay' }],
    queryFn: () =>
      unwrap(api.GET('/api/payroll-runs', { params: { query: { kind: 'final_pay' } } })),
  });

  const nameById = new Map((employees.data ?? []).map((e) => [e.id, e.fullName]));
  const columns: DataTableColumn<Run>[] = [
    {
      id: 'employee',
      header: 'Employee',
      cell: (r) => (
        <span className="font-medium">
          {(r.finalPayEmployeeId && nameById.get(r.finalPayEmployeeId)) ?? 'Employee'}
        </span>
      ),
    },
    { id: 'separation', header: 'Separation date', cell: (r) => formatDate(r.periodEnd) },
    { id: 'pay', header: 'Pay date', cell: (r) => formatDate(r.payDate), hideOnMobile: true },
    { id: 'net', header: 'Net final pay', align: 'right', cell: (r) => formatPeso(r.totals.net) },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <RunStatusBadge status={r.status} />
          {r.warningCount > 0 ? <Badge tone="warning">{r.warningCount} warnings</Badge> : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Final pay"
        description="Last salary, prorated 13th month and leave conversion for separating employees."
      />
      <div className="space-y-6">
        {isOwner ? (
          <>
            <Banner tone="info" title="What final pay computes">
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Last salary for the days worked after the last posted payroll run.</li>
                <li>Prorated 13th month pay for the year, less any 13th month already paid.</li>
                <li>Cash conversion of unused service incentive leave.</li>
                <li>Payoff of outstanding loan balances.</li>
                <li>Year-end tax annualization: extra withholding or a refund.</li>
              </ul>
              <p className="mt-2">
                It creates a draft run you review and approve like any other. Approving marks the
                employee as separated and posts the loan payoffs.
              </p>
            </Banner>
            {employees.error ? (
              <Banner tone="danger">{errorMessage(employees.error)}</Banner>
            ) : (
              <FinalPayForm employees={employees.data ?? []} />
            )}
          </>
        ) : null}

        <section aria-labelledby="final-runs-heading" className="space-y-3">
          <h2 id="final-runs-heading" className="text-base font-semibold">
            Final-pay runs
          </h2>
          {runs.error ? <Banner tone="danger">{errorMessage(runs.error)}</Banner> : null}
          <DataTable
            caption="Final-pay runs"
            columns={columns}
            rows={runs.data ?? []}
            rowKey={(r) => r.id}
            loading={runs.isPending}
            emptyTitle="No final-pay runs yet"
            onRowClick={(r) => void navigate(`/payroll/${r.id}`)}
          />
        </section>
      </div>
    </>
  );
}
