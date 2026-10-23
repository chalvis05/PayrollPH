import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorMessage, unwrap } from '../api/client';
import type { paths } from '../api/schema';
import type { ResponseOf } from '../api/types';
import { Banner } from '../components/Banner';
import { buttonClass } from '../components/Button';
import { Card } from '../components/Card';
import { inputClass } from '../components/forms/FieldShell';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner } from '../lib/auth';
import { cn } from '../lib/cn';
import { runKindLabels, runStatusLabels } from '../lib/labels';
import { manilaYear, previousMonth } from '../lib/dates';

type ReportPath = Extract<keyof paths, `/api/reports/${string}`>;
type Format = 'csv' | 'pdf';
type Run = ResponseOf<'/api/payroll-runs', 'get'>[number];
type Employee = ResponseOf<'/api/employees/', 'get'>[number];

const currentYear = (): string => String(manilaYear());

const MONTH_RE = /^\d{4}-\d{2}$/;
const YEAR_RE = /^(20\d{2}|2100)$/;

// ------------------------------------------------------------------ building blocks

function reportHref(path: ReportPath, params: Record<string, string>, format: Format): string {
  const qs = new URLSearchParams({ ...params, format });
  return `${path}?${qs.toString()}`;
}

/** Download links: plain GETs that carry the session cookie; the API answers with an attachment. */
function DownloadLinks({
  path,
  params,
  formats = ['csv', 'pdf'],
  disabledReason,
  title,
}: {
  path: ReportPath;
  params: Record<string, string>;
  formats?: readonly Format[];
  /** When set, the links are shown disabled with this explanation. */
  disabledReason?: string | null;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {formats.map((format) =>
          disabledReason ? (
            <span
              key={format}
              role="link"
              aria-disabled="true"
              className={cn(buttonClass('secondary', 'sm'), 'cursor-not-allowed opacity-60')}
            >
              Download {format.toUpperCase()}
            </span>
          ) : (
            <a
              key={format}
              href={reportHref(path, params, format)}
              download
              className={buttonClass(format === 'csv' ? 'primary' : 'secondary', 'sm')}
              aria-label={`Download ${title} as ${format.toUpperCase()}`}
            >
              Download {format.toUpperCase()}
            </a>
          ),
        )}
      </div>
      {disabledReason ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{disabledReason}</p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800 dark:text-slate-200">
        {label}
      </label>
      {children(id)}
      {hint !== undefined ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

function MonthInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Month" hint="Runs whose period ends in this month (approved or paid).">
      {(id) => (
        <input
          id={id}
          type="month"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder="YYYY-MM"
        />
      )}
    </Field>
  );
}

function YearInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Year">
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={2000}
          max={2100}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </Field>
  );
}

function ReportCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card title={title} className="flex flex-col">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
        {children}
      </div>
    </Card>
  );
}

const runLabel = (r: Run) =>
  `${runKindLabels[r.kind]} · ${r.periodStart} to ${r.periodEnd} (${runStatusLabels[r.status]})`;

// ------------------------------------------------------------------ cards

function MonthlyReportCard({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: ReportPath;
}) {
  const [month, setMonth] = useState(previousMonth);
  const valid = MONTH_RE.test(month);
  return (
    <ReportCard title={title} description={description}>
      <MonthInput value={month} onChange={setMonth} />
      <DownloadLinks
        title={title}
        path={path}
        params={{ month }}
        disabledReason={valid ? null : 'Pick a month.'}
      />
    </ReportCard>
  );
}

function Bir2316Card({ employees }: { employees: readonly Employee[] }) {
  const title = 'BIR 2316';
  const [year, setYear] = useState(currentYear);
  const [employeeId, setEmployeeId] = useState('');
  const params: Record<string, string> = { year };
  if (employeeId) params['employeeId'] = employeeId;
  return (
    <ReportCard
      title={title}
      description="Certificate of Compensation Payment / Tax Withheld (BIR Form 2316): annual pay and tax per employee. The PDF has one page per employee."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <YearInput value={year} onChange={setYear} />
        <Field label="Employee">
          {(id) => (
            <select
              id={id}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={inputClass}
            >
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <DownloadLinks
        title={title}
        path="/api/reports/bir-2316"
        params={params}
        disabledReason={YEAR_RE.test(year) ? null : 'Enter a year from 2000 to 2100.'}
      />
    </ReportCard>
  );
}

function ThirteenthCard() {
  const title = '13th-month pay';
  const [year, setYear] = useState(currentYear);
  return (
    <ReportCard
      title={title}
      description="13th-month pay per employee for the year (PD 851): basic pay earned, accrued, paid, balance due and the tax-exempt part."
    >
      <YearInput value={year} onChange={setYear} />
      <DownloadLinks
        title={title}
        path="/api/reports/thirteenth-month"
        params={{ year }}
        disabledReason={YEAR_RE.test(year) ? null : 'Enter a year from 2000 to 2100.'}
      />
    </ReportCard>
  );
}

function LoansReportCard() {
  const title = 'Loan ledgers';
  const [status, setStatus] = useState('');
  const params: Record<string, string> = {};
  if (status) params['status'] = status;
  return (
    <ReportCard
      title={title}
      description="Every loan with its ledger and current balance: for checking SSS and Pag-IBIG loan billings and company advances."
    >
      <Field label="Status">
        {(id) => (
          <select
            id={id}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputClass}
          >
            <option value="">All loans</option>
            <option value="active">Active</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
      </Field>
      <DownloadLinks title={title} path="/api/reports/loans" params={params} />
    </ReportCard>
  );
}

function RunSelect({
  runs,
  value,
  onChange,
  hint,
  loading,
}: {
  runs: readonly Run[];
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  loading: boolean;
}) {
  return (
    <Field label="Payroll run" {...(hint !== undefined ? { hint } : {})}>
      {(id) => (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          disabled={loading}
        >
          <option value="">{loading ? 'Loading runs…' : 'Choose a run…'}</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {runLabel(r)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function RegisterCard({ runs, loading }: { runs: readonly Run[]; loading: boolean }) {
  const title = 'Payroll register';
  const [runId, setRunId] = useState('');
  return (
    <ReportCard
      title={title}
      description="Per-employee earnings, deductions and net pay for one payroll run, as required for DOLE payroll records. Drafts are labelled as such."
    >
      <RunSelect runs={runs} value={runId} onChange={setRunId} loading={loading} />
      <DownloadLinks
        title={title}
        path="/api/reports/payroll-register"
        params={{ runId }}
        disabledReason={runId ? null : 'Choose a payroll run.'}
      />
    </ReportCard>
  );
}

function DisbursementCard({ runs, loading }: { runs: readonly Run[]; loading: boolean }) {
  const title = 'Bank / GCash disbursement';
  const [runId, setRunId] = useState('');
  const [method, setMethod] = useState('');
  const posted = runs.filter((r) => r.status === 'approved' || r.status === 'paid');
  const params: Record<string, string> = { runId };
  if (method) params['method'] = method;
  return (
    <ReportCard
      title={title}
      description="Payout file with full account numbers for crediting net pay by bank transfer, GCash or cash. Owner only."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <RunSelect
          runs={posted}
          value={runId}
          onChange={setRunId}
          loading={loading}
          hint="Approved or paid runs only."
        />
        <Field label="Payout method">
          {(id) => (
            <select
              id={id}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={inputClass}
            >
              <option value="">All methods</option>
              <option value="bank">Bank transfer</option>
              <option value="gcash">GCash</option>
              <option value="cash">Cash</option>
            </select>
          )}
        </Field>
      </div>
      <DownloadLinks
        title={title}
        path="/api/reports/disbursement"
        params={params}
        formats={['csv']}
        disabledReason={runId ? null : 'Choose an approved or paid run.'}
      />
    </ReportCard>
  );
}

// ------------------------------------------------------------------ page

export function ReportsPage() {
  const isOwner = useIsOwner();
  const runs = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => unwrap(api.GET('/api/payroll-runs')),
  });
  const employees = useQuery({
    queryKey: ['employees', ''],
    queryFn: () => unwrap(api.GET('/api/employees/', { params: { query: {} } })),
  });

  return (
    <>
      <PageHeader
        title="Reports"
        description="Remittance reports, BIR forms, registers and payout files. Statutory reports count only approved or paid payroll runs."
      />
      {runs.error ? (
        <Banner tone="danger" className="mb-4">
          {errorMessage(runs.error)}
        </Banner>
      ) : null}
      {employees.error ? (
        <Banner tone="danger" className="mb-4">
          {errorMessage(employees.error)}
        </Banner>
      ) : null}
      {!isOwner ? (
        <Banner tone="info" className="mb-4">
          Government ID numbers are masked in reports downloaded by viewers.
        </Banner>
      ) : null}

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        Monthly remittances
      </h2>
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <MonthlyReportCard
          title="SSS contributions"
          path="/api/reports/sss"
          description="Employee and employer SSS, EC and MPF contributions, in the layout of the SSS R-3 contribution collection list."
        />
        <MonthlyReportCard
          title="PhilHealth premiums"
          path="/api/reports/philhealth"
          description="Employee and employer PhilHealth premiums, in the layout of the PhilHealth RF-1 remittance report."
        />
        <MonthlyReportCard
          title="Pag-IBIG contributions"
          path="/api/reports/pagibig"
          description="Employee and employer Pag-IBIG savings, in the layout of the Pag-IBIG MCRF (Member's Contribution Remittance Form)."
        />
        <MonthlyReportCard
          title="BIR 1601-C"
          path="/api/reports/bir-1601c"
          description="Monthly Remittance Return of Income Taxes Withheld on Compensation (BIR Form 1601-C) figures."
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        Annual
      </h2>
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Bir2316Card employees={employees.data ?? []} />
        <ThirteenthCard />
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        Payroll and loans
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <RegisterCard runs={runs.data ?? []} loading={runs.isPending} />
        {isOwner ? <DisbursementCard runs={runs.data ?? []} loading={runs.isPending} /> : null}
        <LoansReportCard />
      </div>
    </>
  );
}
