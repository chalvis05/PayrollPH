import { dec, max, splitOtherBenefits, sum, ZERO } from '@payrollph/shared';
import { ratesForDate } from '../rates';
import {
  byEmployee,
  employeeName,
  loadEmployer,
  m,
  postedSlips,
  tableDoc,
  totalsRow,
  yearRange,
  type ReportColumn,
  type ReportContext,
  type ReportDoc,
} from './common';

/**
 * 13th-month status per employee for a year (posted runs only):
 *  - accrued = Σ payslips.thirteenth_accrual (basic earned ÷ divisor), paid = Σ thirteenth_paid
 *  - balance due = accrued − paid (never negative)
 *  - exempt part = exemption already applied to 13th-month payouts (13th-month runs, final pay)
 *    + the exempt part of the balance against what is left of the other-benefits ceiling
 *    (rates at year end) after ALL exemption used so far this year (incl. de minimis excess)
 *  - taxable part = (paid + balance) − exempt part
 */
export async function thirteenthMonthReport(ctx: ReportContext, year: number): Promise<ReportDoc> {
  const range = yearRange(year);
  const employer = await loadEmployer(ctx.db);
  const rates = await ratesForDate(ctx.db, range.to);
  const groups = byEmployee(await postedSlips(ctx.db, range));
  const rows: string[][] = [];
  for (const { e, slips } of groups) {
    const ps = slips.map((s) => s.p);
    const basic = sum(ps.map((p) => p.basicEarned));
    const accrued = sum(ps.map((p) => p.thirteenthAccrual));
    const paid = sum(ps.map((p) => p.thirteenthPaid));
    if (accrued.isZero() && paid.isZero()) continue;
    const balance = max(accrued.minus(paid), ZERO);
    const exemptUsed = sum(ps.map((p) => p.otherBenefitsExemptUsed));
    const exemptOnPaid = sum(
      slips.map(({ p, run }) =>
        run.kind === 'thirteenth_month'
          ? dec(p.otherBenefitsExemptUsed)
          : dec(p.finalPay?.thirteenthMonth.exempt ?? '0'),
      ),
    );
    const split = splitOtherBenefits({
      amount: balance,
      exemptUsedYtd: exemptUsed,
      rates: rates.data,
    });
    const exempt = exemptOnPaid.plus(split.exempt);
    const totalThirteenth = paid.plus(balance);
    rows.push([
      e.employeeNo,
      employeeName(e),
      m(basic),
      m(accrued),
      m(paid),
      m(balance),
      m(exemptUsed),
      m(exempt),
      m(totalThirteenth.minus(exempt)),
    ]);
  }
  const money = (header: string): ReportColumn => ({ header, money: true });
  const columns: ReportColumn[] = [
    { header: 'Emp. no.', width: 0.9 },
    { header: 'Employee', width: 2.4 },
    money('Basic earned YTD'),
    money('13th accrued'),
    money('13th paid'),
    money('Balance due'),
    money('Other-benefits exemption used YTD'),
    money('13th exempt part'),
    money('13th taxable part'),
  ];
  return tableDoc({
    fileBase: `thirteenth-month-${year}`,
    title: `13th Month Pay — ${year}`,
    subtitle: [
      `Employer: ${employer.name}`,
      `Approved/paid payroll runs ending in ${year}. Exempt ceiling for 13th month and other benefits: ${rates.data.benefits.otherBenefitsCeiling} (rates ${rates.version}).`,
    ],
    columns,
    rows,
    totals: totalsRow(rows, columns.length, [2, 3, 4, 5, 6, 7, 8]),
    emptyText: 'No 13th-month accruals for this year.',
  });
}
