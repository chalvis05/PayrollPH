import { dec } from '@payrollph/shared';
import {
  addAll,
  byEmployee,
  isZero,
  loadEmployer,
  m,
  monthRange,
  postedSlips,
  reveal,
  tableDoc,
  totalsRow,
  type ReportColumn,
  type ReportContext,
  type ReportDoc,
  type SlipRecord,
} from './common';

/**
 * Monthly remittance lists (SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF). One row per employee:
 * the month's posted payslips summed. The salary credit / premium base comes from the latest
 * payslip of the month that actually deducted the contribution (for daily/hourly staff only the
 * cutoff that deducts sees the whole month's earnings).
 */

const money = (header: string): ReportColumn => ({ header, money: true });

function latestWith(slips: readonly SlipRecord[], pred: (s: SlipRecord) => boolean): SlipRecord {
  const withContribution = slips.filter(pred);
  const pick = withContribution.at(-1) ?? slips.at(-1);
  if (!pick) throw new Error('latestWith called with no payslips');
  return pick;
}

const sexCode = (sex: 'female' | 'male' | null): string =>
  sex === 'female' ? 'F' : sex === 'male' ? 'M' : '';

export async function sssReport(ctx: ReportContext, month: string): Promise<ReportDoc> {
  const range = monthRange(month);
  const employer = await loadEmployer(ctx.db);
  const groups = byEmployee(await postedSlips(ctx.db, range));
  const rows: string[][] = [];
  for (const { e, slips } of groups) {
    const ps = slips.map((s) => s.p);
    const total = addAll(ps.flatMap((p) => [p.sssEe, p.sssEr, p.sssEc]));
    if (isZero(total)) continue;
    const src = latestWith(slips, (s) => !isZero(dec(s.p.sssEe).plus(s.p.sssEr)));
    rows.push([
      reveal(ctx, e.sssNoEnc),
      e.lastName,
      e.firstName,
      e.middleName ?? '',
      m(src.p.computation.monthlyContributions.sss.msc),
      addAll(ps.map((p) => dec(p.sssEe).minus(p.sssMpfEe))),
      addAll(ps.map((p) => dec(p.sssEr).minus(p.sssMpfEr))),
      addAll(ps.map((p) => p.sssEc)),
      addAll(ps.map((p) => p.sssMpfEe)),
      addAll(ps.map((p) => p.sssMpfEr)),
      total,
    ]);
  }
  const columns: ReportColumn[] = [
    { header: 'SS number', width: 1.3 },
    { header: 'Last name', width: 1.4 },
    { header: 'First name', width: 1.4 },
    { header: 'Middle name', width: 1.2 },
    money('MSC'),
    money('EE share'),
    money('ER share'),
    money('EC'),
    money('MPF EE'),
    money('MPF ER'),
    money('Total'),
  ];
  return tableDoc({
    fileBase: `sss-${month}`,
    title: `SSS Contribution List (R-3) — ${month}`,
    subtitle: [
      `Employer: ${employer.name}`,
      `SSS employer no.: ${employer.sssNo ?? '—'}    TIN: ${employer.tin ?? '—'}`,
      `Applicable month: ${month} (approved/paid payroll runs ending ${range.from} to ${range.to})`,
    ],
    columns,
    rows,
    totals: totalsRow(rows, columns.length, [5, 6, 7, 8, 9, 10]),
    emptyText: 'No posted SSS contributions for this month.',
  });
}

export async function philhealthReport(ctx: ReportContext, month: string): Promise<ReportDoc> {
  const range = monthRange(month);
  const employer = await loadEmployer(ctx.db);
  const groups = byEmployee(await postedSlips(ctx.db, range));
  const rows: string[][] = [];
  for (const { e, slips } of groups) {
    const ps = slips.map((s) => s.p);
    const ee = addAll(ps.map((p) => p.philhealthEe));
    const er = addAll(ps.map((p) => p.philhealthEr));
    if (isZero(ee) && isZero(er)) continue;
    const src = latestWith(slips, (s) => !isZero(dec(s.p.philhealthEe).plus(s.p.philhealthEr)));
    rows.push([
      reveal(ctx, e.philhealthNoEnc),
      e.lastName,
      e.firstName,
      e.middleName ?? '',
      e.birthDate ?? '',
      sexCode(e.sex),
      m(src.p.computation.monthlyContributions.philhealth.base),
      ee,
      er,
      addAll([ee, er]),
    ]);
  }
  const columns: ReportColumn[] = [
    { header: 'PhilHealth no.', width: 1.4 },
    { header: 'Surname', width: 1.4 },
    { header: 'Given name', width: 1.4 },
    { header: 'Middle name', width: 1.2 },
    { header: 'Birth date' },
    { header: 'Sex', width: 0.5 },
    money('Monthly basic salary'),
    money('Personal share (EE)'),
    money('Employer share (ER)'),
    money('Total'),
  ];
  return tableDoc({
    fileBase: `philhealth-${month}`,
    title: `PhilHealth Remittance Report (RF-1) — ${month}`,
    subtitle: [
      `Employer: ${employer.name}`,
      `PhilHealth employer no.: ${employer.philhealthNo ?? '—'}    TIN: ${employer.tin ?? '—'}`,
      `Applicable month: ${month}`,
    ],
    columns,
    rows,
    totals: totalsRow(rows, columns.length, [7, 8, 9]),
    emptyText: 'No posted PhilHealth contributions for this month.',
  });
}

export async function pagibigReport(ctx: ReportContext, month: string): Promise<ReportDoc> {
  const range = monthRange(month);
  const employer = await loadEmployer(ctx.db);
  const groups = byEmployee(await postedSlips(ctx.db, range));
  const periodCovered = month.replace('-', '');
  const rows: string[][] = [];
  for (const { e, slips } of groups) {
    const ps = slips.map((s) => s.p);
    const ee = addAll(ps.map((p) => p.pagibigEe));
    const er = addAll(ps.map((p) => p.pagibigEr));
    if (isZero(ee) && isZero(er)) continue;
    const src = latestWith(slips, (s) => !isZero(dec(s.p.pagibigEe).plus(s.p.pagibigEr)));
    rows.push([
      reveal(ctx, e.pagibigNoEnc),
      e.lastName,
      e.firstName,
      e.middleName ?? '',
      periodCovered,
      m(src.p.computation.monthlyContributions.pagibig.base),
      ee,
      er,
      addAll([ee, er]),
    ]);
  }
  const columns: ReportColumn[] = [
    { header: 'Pag-IBIG MID no.', width: 1.4 },
    { header: 'Last name', width: 1.4 },
    { header: 'First name', width: 1.4 },
    { header: 'Middle name', width: 1.2 },
    { header: 'Period covered' },
    money('Monthly compensation'),
    money('EE share'),
    money('ER share'),
    money('Total'),
  ];
  return tableDoc({
    fileBase: `pagibig-${month}`,
    title: `Pag-IBIG Membership Contribution Remittance (MCRF) — ${month}`,
    subtitle: [
      `Employer: ${employer.name}`,
      `Pag-IBIG employer no.: ${employer.pagibigNo ?? '—'}    TIN: ${employer.tin ?? '—'}`,
      `Period covered: ${periodCovered}`,
    ],
    columns,
    rows,
    totals: totalsRow(rows, columns.length, [6, 7, 8]),
    emptyText: 'No posted Pag-IBIG contributions for this month.',
  });
}
