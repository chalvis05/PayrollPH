import type { EmployeeStatus } from '@payrollph/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { buttonClass } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { useIsEncoder, useIsOwner } from '../lib/auth';
import { formatPeso } from '../lib/format';
import { employmentTypeLabels, payTypeLabels } from '../lib/labels';

type Row = ResponseOf<'/api/employees/', 'get'>[number];

const statusTone = { active: 'success', inactive: 'neutral', separated: 'warning' } as const;

const columns: DataTableColumn<Row>[] = [
  { id: 'no', header: 'No.', cell: (r) => r.employeeNo },
  {
    id: 'name',
    header: 'Name',
    cell: (r) => (
      <div>
        <div className="font-medium">{r.fullName}</div>
        <div className="text-xs text-slate-500">{r.position ?? '—'}</div>
      </div>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    cell: (r) => employmentTypeLabels[r.employmentType],
    hideOnMobile: true,
  },
  { id: 'pay', header: 'Pay', cell: (r) => payTypeLabels[r.payType], hideOnMobile: true },
  { id: 'rate', header: 'Rate', align: 'right', cell: (r) => formatPeso(r.baseRate) },
  {
    id: 'status',
    header: 'Status',
    cell: (r) => (
      <div className="flex flex-wrap gap-1">
        <Badge tone={statusTone[r.status]}>{r.status}</Badge>
        {r.missingGovIds.length > 0 ? (
          <Badge tone="warning">
            Missing {r.missingGovIds.map((k) => k.toUpperCase()).join(', ')}
          </Badge>
        ) : null}
      </div>
    ),
  },
];

export function EmployeesPage() {
  const isOwner = useIsOwner();
  const isEncoder = useIsEncoder();
  const canPropose = isOwner || isEncoder;
  const navigate = useNavigate();
  const [status, setStatus] = useState<EmployeeStatus | ''>('active');
  const employees = useQuery({
    queryKey: ['employees', status],
    queryFn: () =>
      unwrap(api.GET('/api/employees/', { params: { query: status ? { status } : {} } })),
  });
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => unwrap(api.GET('/api/dashboard/')),
  });
  const counts = dashboard.data;

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          counts
            ? `${counts.activeEmployees} of ${counts.employeeCap} active employees allowed.`
            : undefined
        }
        actions={
          canPropose ? (
            <Link to="/employees/new" className={buttonClass('primary')}>
              Add employee
            </Link>
          ) : undefined
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="status-filter" className="text-sm text-slate-600 dark:text-slate-400">
          Show
        </label>
        <select
          id="status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as EmployeeStatus | '')}
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="separated">Separated</option>
          <option value="">All</option>
        </select>
      </div>
      {employees.error ? <Banner tone="danger">{errorMessage(employees.error)}</Banner> : null}
      <DataTable
        caption="Employees"
        columns={columns}
        rows={employees.data ?? []}
        rowKey={(r) => r.id}
        loading={employees.isPending}
        emptyTitle="No employees yet"
        emptyDescription={isOwner ? 'Add your first employee to start running payroll.' : undefined}
        onRowClick={(r) => void navigate(`/employees/${r.id}`)}
      />
    </>
  );
}
