import { dec, sum, type PayLine } from '@payrollph/shared';
import { asc, eq } from 'drizzle-orm';
import { employees, payrollRuns, payslips } from '../../db/schema';
import { notFound } from '../../lib/http';
import {
  addAll,
  employeeName,
  loadEmployer,
  m,
  POSTED_STATUSES,
  RUN_KIND_LABELS,
  sumLines,
  tableDoc,
  totalsRow,
  type ReportColumn,
  type ReportContext,
  type ReportDoc,
} from './common';

const byCategory =
  (...cats: PayLine['category'][]) =>
  (l: PayLine): boolean =>
    cats.includes(l.category);

/** One row per payslip of a run, any status (unposted runs are titled DRAFT). */
export async function payrollRegisterReport(ctx: ReportContext, runId: string): Promise<ReportDoc> {
  const [run] = await ctx.db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) throw notFound('Payroll run');
  const employer = await loadEmployer(ctx.db);
  const slips = await ctx.db
    .select({ p: payslips, e: employees })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.payrollRunId, run.id))
    .orderBy(asc(employees.lastName), asc(employees.firstName), asc(employees.employeeNo));

  const rows = slips.map(({ p, e }) => {
    const c = p.computation;
    const earnings = [...c.earnings, ...(p.finalPay?.earnings ?? [])];
    const deductions = [...c.employeeDeductions, ...(p.finalPay?.deductions ?? [])];
    const basic = sumLines(earnings, byCategory('basic', 'attendance_deduction'));
    const premiums = sumLines(earnings, byCategory('premium'));
    const holiday = sumLines(earnings, byCategory('holiday'));
    const allowances = sumLines(earnings, byCategory('allowance'));
    const thirteenth = sumLines(earnings, byCategory('thirteenth_month'));
    // Anything else (e.g. SIL cash conversion) so the columns always add up to gross.
    const other = m(dec(p.gross).minus(sum([basic, premiums, holiday, allowances, thirteenth])));
    return [
      e.employeeNo,
      employeeName(e),
      basic,
      premiums,
      holiday,
      allowances,
      thirteenth,
      other,
      p.gross,
      p.sssEe,
      p.philhealthEe,
      p.pagibigEe,
      p.withholdingTax,
      sumLines(deductions, byCategory('loan')),
      sumLines(deductions, byCategory('deduction')),
      p.net,
      p.sssEr,
      p.sssEc,
      p.philhealthEr,
      p.pagibigEr,
      addAll([p.sssEr, p.sssEc, p.philhealthEr, p.pagibigEr]),
    ];
  });

  const money = (header: string): ReportColumn => ({ header, money: true });
  const columns: ReportColumn[] = [
    { header: 'Emp. no.', width: 0.9 },
    { header: 'Employee', width: 2.2 },
    money('Basic'),
    money('Premiums / OT / ND'),
    money('Holiday pay'),
    money('Allowances'),
    money('13th month'),
    money('Other earnings'),
    money('Gross'),
    money('SSS EE'),
    money('PhilHealth EE'),
    money('Pag-IBIG EE'),
    money('Withholding tax'),
    money('Loans'),
    money('Other deductions'),
    money('Net pay'),
    money('SSS ER'),
    money('SSS EC'),
    money('PhilHealth ER'),
    money('Pag-IBIG ER'),
    money('Total ER'),
  ];
  const posted = (POSTED_STATUSES as readonly string[]).includes(run.status);
  const label = `${RUN_KIND_LABELS[run.kind]} ${run.periodStart} to ${run.periodEnd}`;
  return tableDoc({
    fileBase: `payroll-register-${run.periodStart}-${run.kind.replace(/_/g, '-')}`,
    title: `${posted ? '' : 'DRAFT — '}Payroll Register — ${label}`,
    subtitle: [
      `Employer: ${employer.name}    TIN: ${employer.tin ?? '—'}`,
      `Pay date: ${run.payDate}    Status: ${run.status.toUpperCase()}${posted ? '' : ' (not posted; figures may change)'}`,
    ],
    columns,
    rows,
    totals: totalsRow(
      rows,
      columns.length,
      Array.from({ length: columns.length - 2 }, (_, i) => i + 2),
    ),
    pageSize: 'LEGAL',
    fontSize: 6.5,
    emptyText: 'This run has no payslips.',
  });
}
