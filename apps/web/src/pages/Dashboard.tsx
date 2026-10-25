import type { HolidayType, PayrollRunStatus } from '@payrollph/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge, type BadgeTone } from '../components/Badge';
import { Banner } from '../components/Banner';
import { buttonClass, focusRing } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { RatesVerifyBanner } from '../components/RatesVerifyBanner';
import { Spinner } from '../components/Spinner';
import { useIsOwner } from '../lib/auth';
import { formatPeso } from '../lib/format';
import { holidayTypeLabels, runKindLabels, runStatusLabels } from '../lib/labels';
import { formatDate } from '../lib/dates';

type Dashboard = ResponseOf<'/api/dashboard/', 'get'>;

const runStatusTone: Record<PayrollRunStatus, BadgeTone> = {
  draft: 'neutral',
  review: 'info',
  approved: 'warning',
  paid: 'success',
};

function holidayLabel(type: string): string {
  return type in holidayTypeLabels ? holidayTypeLabels[type as HolidayType] : type;
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {children !== undefined ? <div className="mt-2 text-sm">{children}</div> : null}
    </div>
  );
}

function Stats({ data }: { data: Dashboard }) {
  const atCap = data.activeEmployees >= data.employeeCap;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Stat label="Active employees" value={`${data.activeEmployees} / ${data.employeeCap}`}>
        {atCap ? (
          <Badge tone="warning">At the employee cap</Badge>
        ) : (
          <span className="text-slate-600 dark:text-slate-400">
            {data.employeeCap - data.activeEmployees} more allowed
          </span>
        )}
      </Stat>
      <Stat label="Statutory rates in effect" value={data.rates ? data.rates.version : 'None'}>
        {data.rates ? (
          <div className="flex flex-wrap items-center gap-2">
            {data.rates.verified ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Badge tone="warning">Not verified</Badge>
            )}
            <span className="text-slate-600 dark:text-slate-400">
              since {formatDate(data.rates.effectiveFrom, 'full')}
            </span>
          </div>
        ) : (
          <Link
            to="/settings/rates"
            className={`font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400 ${focusRing}`}
          >
            Set up rates
          </Link>
        )}
      </Stat>
    </div>
  );
}

function LatestRuns({ runs }: { runs: Dashboard['latestRuns'] }) {
  return (
    <Card
      title="Latest payroll runs"
      actions={
        <Link
          to="/payroll"
          className={`text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400 ${focusRing}`}
        >
          All runs
        </Link>
      }
    >
      {runs.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No payroll runs yet.</p>
      ) : (
        <ul className="-my-2 divide-y divide-slate-200 dark:divide-slate-800">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                to={`/payroll/${r.id}`}
                className={`-mx-2 flex items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${focusRing}`}
              >
                <div className="min-w-0">
                  <p className="font-medium">{runKindLabels[r.kind]}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDate(r.periodStart, 'full')} – {formatDate(r.periodEnd, 'full')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-medium tabular-nums">{formatPeso(r.totalNet)}</span>
                  <Badge tone={runStatusTone[r.status]}>{runStatusLabels[r.status]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UpcomingHolidays({ holidays }: { holidays: Dashboard['upcomingHolidays'] }) {
  return (
    <Card
      title="Upcoming holidays"
      actions={
        <Link
          to="/holidays"
          className={`text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400 ${focusRing}`}
        >
          Calendar
        </Link>
      }
    >
      {holidays.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No upcoming holidays in the calendar.
        </p>
      ) : (
        <ul className="-my-2 divide-y divide-slate-200 dark:divide-slate-800">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{h.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(h.date, 'full')}
                </p>
              </div>
              <Badge tone={h.type === 'regular' ? 'info' : 'neutral'}>{holidayLabel(h.type)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const isOwner = useIsOwner();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => unwrap(api.GET('/api/dashboard/')),
  });
  const data = dashboard.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Headcount, statutory rates, recent payroll runs and holidays."
        actions={
          isOwner ? (
            <>
              <Link to="/payroll" className={buttonClass('primary')}>
                New payroll run
              </Link>
              <Link to="/employees/new" className={buttonClass('secondary')}>
                Add employee
              </Link>
            </>
          ) : undefined
        }
      />
      {dashboard.error ? <Banner tone="danger">{errorMessage(dashboard.error)}</Banner> : null}
      {dashboard.isPending ? (
        <div className="flex justify-center py-10 text-slate-500">
          <Spinner label="Loading dashboard" className="size-6" />
        </div>
      ) : null}
      {data ? (
        <div className="space-y-6">
          {data.pendingRequests > 0 ? (
            <Banner
              tone="warning"
              title={isOwner ? 'Employee changes waiting for you' : 'Your changes are waiting'}
            >
              {data.pendingRequests === 1
                ? '1 employee change is'
                : `${data.pendingRequests} employee changes are`}{' '}
              waiting for {isOwner ? 'your' : 'the owner’s'} approval.{' '}
              <Link
                to="/approvals"
                className={`font-semibold underline underline-offset-2 ${focusRing}`}
              >
                Open Approvals
              </Link>
            </Banner>
          ) : null}
          {data.rates && !data.rates.verified ? <RatesVerifyBanner to="/settings/rates" /> : null}
          {data.rates === null ? (
            <Banner tone="warning" title="No statutory rates in effect">
              Payroll cannot be computed until a rates version covers today.{' '}
              <Link
                to="/settings/rates"
                className={`font-semibold underline underline-offset-2 ${focusRing}`}
              >
                Review rates
              </Link>
            </Banner>
          ) : null}
          <Stats data={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <LatestRuns runs={data.latestRuns} />
            <UpcomingHolidays holidays={data.upcomingHolidays} />
          </div>
        </div>
      ) : null}
    </>
  );
}
