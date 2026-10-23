import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Banner } from '../components/Banner';
import { Button, buttonClass } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { formatPeso } from '../lib/format';
import { runKindLabels } from '../lib/labels';
import { RunStatusBadge } from './PayrollRuns';
import { formatDate, formatPeriod } from '../lib/dates';

type PayslipDetail = ResponseOf<'/api/payslips/{id}', 'get'>;
type Line = PayslipDetail['computation']['earnings'][number];

const severityTone = { info: 'info', warning: 'warning', error: 'danger' } as const;

const cardClass = 'print:break-inside-avoid print:border-slate-400 print:shadow-none';

/** A list of pay lines with an optional total row; amounts come straight from the API. */
function LinesTable({
  caption,
  lines,
  total,
  showQuantity = false,
  empty = 'None.',
}: {
  caption: string;
  lines: readonly Line[];
  total?: { label: string; amount: string } | undefined;
  showQuantity?: boolean;
  empty?: string;
}) {
  if (lines.length === 0 && total === undefined) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{empty}</p>;
  }
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <th scope="col" className="py-1.5 pr-2 font-medium">
            Item
          </th>
          {showQuantity ? (
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Qty
            </th>
          ) : null}
          <th scope="col" className="py-1.5 pl-2 text-right font-medium">
            Amount
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {lines.length === 0 ? (
          <tr>
            <td colSpan={showQuantity ? 3 : 2} className="py-1.5 text-slate-500">
              {empty}
            </td>
          </tr>
        ) : null}
        {lines.map((l, i) => (
          <tr key={`${l.code}-${i}`}>
            <th scope="row" className="py-1.5 pr-2 text-left font-normal">
              {l.label}
            </th>
            {showQuantity ? (
              <td className="px-2 py-1.5 text-right text-slate-500 tabular-nums dark:text-slate-400">
                {l.quantity ?? ''}
              </td>
            ) : null}
            <td className="py-1.5 pl-2 text-right tabular-nums">{formatPeso(l.amount)}</td>
          </tr>
        ))}
      </tbody>
      {total ? (
        <tfoot>
          <tr className="border-t border-slate-300 font-semibold dark:border-slate-600">
            <th scope="row" colSpan={showQuantity ? 2 : 1} className="py-1.5 pr-2 text-left">
              {total.label}
            </th>
            <td className="py-1.5 pl-2 text-right tabular-nums">{formatPeso(total.amount)}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function AmountRow({ label, amount, strong }: { label: string; amount: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${strong ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatPeso(amount)}</dd>
    </div>
  );
}

export function PayslipPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['payslip', id],
    queryFn: () => unwrap(api.GET('/api/payslips/{id}', { params: { path: { id } } })),
    enabled: id !== '',
  });

  if (query.isPending) return <Spinner label="Loading payslip" />;
  const slip = query.data;
  if (query.error || !slip) {
    return (
      <Banner tone="danger">
        {query.error ? errorMessage(query.error) : 'Payslip not found.'}
      </Banner>
    );
  }

  const c = slip.computation;
  const fp = slip.finalPay;
  const posted = slip.run.status === 'approved' || slip.run.status === 'paid';

  return (
    <article aria-label={`Payslip for ${slip.employeeName}`}>
      <PageHeader
        title="Payslip"
        description={`${slip.employeeName} · ${slip.employeeNo}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link to={`/payroll/${slip.payrollRunId}`} className={buttonClass('ghost')}>
              Back to run
            </Link>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <a
              href={`/api/payslips/${encodeURIComponent(slip.id)}/pdf`}
              download
              className={buttonClass('primary')}
            >
              Download PDF
            </a>
          </div>
        }
      />

      <div className="space-y-4">
        {!posted ? (
          <Banner tone="warning" title="DRAFT">
            This run is {slip.run.status === 'review' ? 'in review' : 'a draft'} and not posted yet.
            Figures may still change until it is approved.
          </Banner>
        ) : null}

        {c.warnings.map((w, i) => (
          <Banner key={`${w.code}-${i}`} tone={severityTone[w.severity]} className="print:hidden">
            {w.message}
          </Banner>
        ))}

        <Card className={cardClass}>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Field label="Employee">
              {slip.employeeName}
              <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                {slip.employeeNo}
              </span>
            </Field>
            <Field label="Period">{formatPeriod(slip.run.periodStart, slip.run.periodEnd)}</Field>
            <Field label="Pay date">{formatDate(slip.run.payDate)}</Field>
            <Field label="Run">
              <span className="flex flex-wrap items-center gap-1">
                {runKindLabels[slip.run.kind]} <RunStatusBadge status={slip.run.status} />
              </span>
            </Field>
            <Field label="Monthly rate">{formatPeso(c.rateBasis.monthly)}</Field>
            <Field label="Daily rate">{formatPeso(c.rateBasis.daily)}</Field>
            <Field label="Hourly rate">{formatPeso(c.rateBasis.hourly)}</Field>
            <Field label="Minimum wage earner">{c.isMinimumWageEarner ? 'Yes' : 'No'}</Field>
          </dl>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          <Card title={fp ? 'Earnings (last salary)' : 'Earnings'} className={cardClass}>
            <LinesTable
              caption="Earnings"
              lines={c.earnings}
              showQuantity
              total={{ label: 'Gross pay', amount: c.grossPay }}
            />
          </Card>
          <Card title="Deductions" className={cardClass}>
            <LinesTable
              caption="Employee deductions"
              lines={c.employeeDeductions}
              total={{ label: 'Total deductions', amount: c.totalDeductions }}
            />
          </Card>
        </div>

        <Card className={cardClass}>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <AmountRow label="Gross pay" amount={c.grossPay} />
            <AmountRow label="Total deductions" amount={c.totalDeductions} />
            <div className="flex justify-between gap-3 py-1 text-base font-bold text-emerald-700 dark:text-emerald-400">
              <dt>{fp ? 'Net (last salary)' : 'NET PAY'}</dt>
              <dd className="tabular-nums">{formatPeso(c.netPay)}</dd>
            </div>
          </dl>
        </Card>

        {fp ? (
          <Card title="Final pay" className={cardClass}>
            <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Additional earnings</h3>
                <LinesTable
                  caption="Final pay earnings"
                  lines={fp.earnings}
                  showQuantity
                  total={{ label: 'Total', amount: fp.totalEarnings }}
                />
                <dl className="mt-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                  <p className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Prorated 13th month
                  </p>
                  <AmountRow label="Amount" amount={fp.thirteenthMonth.amount} />
                  <AmountRow label="Tax-exempt" amount={fp.thirteenthMonth.exempt} />
                  <AmountRow label="Taxable" amount={fp.thirteenthMonth.taxable} />
                </dl>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Loan payoffs and tax adjustment</h3>
                <LinesTable
                  caption="Final pay deductions"
                  lines={fp.deductions}
                  total={{ label: 'Total', amount: fp.totalDeductions }}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  A negative tax line is a refund from year-end annualization.
                </p>
              </div>
            </div>
            <dl className="mt-4 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
              <AmountRow label="Net last salary" amount={fp.lastSalaryNet} />
              <AmountRow label="Plus additional earnings" amount={fp.totalEarnings} />
              <AmountRow label="Less payoffs and tax" amount={fp.totalDeductions} />
              <div className="flex justify-between gap-3 pt-2 text-base font-bold text-emerald-700 dark:text-emerald-400">
                <dt>NET FINAL PAY</dt>
                <dd className="tabular-nums">{formatPeso(fp.netFinalPay)}</dd>
              </div>
            </dl>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          <Card title="Employer contributions" className={cardClass}>
            <LinesTable
              caption="Employer shares"
              lines={c.employerShares}
              empty="No employer contributions this period."
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Paid by the employer on top of gross pay; not deducted from the employee.
            </p>
          </Card>
          <Card title="Year to date" className={cardClass}>
            <dl className="text-sm">
              <AmountRow label="Gross pay" amount={slip.ytd.gross} />
              <AmountRow label="Taxable income" amount={slip.ytd.taxableIncome} />
              <AmountRow label="Withholding tax" amount={slip.ytd.withholdingTax} />
              <AmountRow label="SSS (employee)" amount={slip.ytd.sssEe} />
              <AmountRow label="PhilHealth (employee)" amount={slip.ytd.philhealthEe} />
              <AmountRow label="Pag-IBIG (employee)" amount={slip.ytd.pagibigEe} />
              <AmountRow label="Net pay" amount={slip.ytd.net} strong />
            </dl>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Posted payslips this year up to this period, plus this one.
            </p>
          </Card>
        </div>
      </div>
    </article>
  );
}
