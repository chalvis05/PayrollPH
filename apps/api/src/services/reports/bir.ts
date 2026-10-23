import {
  annualize,
  dec,
  max,
  min,
  sum,
  toMoney,
  ZERO,
  type Dec,
  type PayLine,
} from '@payrollph/shared';
import { eq } from 'drizzle-orm';
import { employees } from '../../db/schema';
import { notFound } from '../../lib/http';
import type { PdfSection } from '../../lib/pdf/table';
import { ratesForDate } from '../rates';
import {
  byEmployee,
  employeeName,
  loadEmployer,
  m,
  monthRange,
  postedSlips,
  reveal,
  tableDoc,
  totalsRow,
  yearRange,
  type PayslipRow,
  type ReportContext,
  type ReportDoc,
} from './common';

/*
 * Mapping from frozen payslip data to the BIR 1601-C / 2316 compensation lines.
 * Per posted payslip (regular, 13th-month and final-pay runs; earning lines are the
 * computation's `earnings` plus `final_pay.earnings`):
 *
 *   total compensation       = payslips.gross (all earning lines, incl. final-pay extras)
 *   SMW of MWEs              = MWE payslips: lines with taxClass `mwe_exempt_eligible` and
 *                              category basic / attendance_deduction
 *   holiday/OT/ND/hazard MWE = MWE payslips: remaining `mwe_exempt_eligible` lines
 *                              (categories premium / holiday)
 *   13th month & other ben.  = payslips.other_benefits_exempt_used (exempt part of
 *                              `other_benefit` lines; final pay adds the 13th-month exempt part)
 *   de minimis               = lines with taxClass `de_minimis` (already capped by the engine)
 *   SSS/PHIC/HDMF EE         = non-MWE payslips: EE contributions, limited to what the engine
 *                              could actually deduct from taxable pay. MWE contributions are not
 *                              listed separately: their whole wage is already exempt as SMW.
 *   other non-taxable        = the remainder (e.g. `non_taxable` lines), so that
 *                              total compensation − total non-taxable = taxable compensation
 *   taxable compensation     = payslips.taxable_income (what the engine taxed, incl. the taxable
 *                              part of 13th month/other benefits and final-pay SIL conversion)
 *   tax withheld             = payslips.withholding_tax (final pay includes the annualization
 *                              adjustment; a refund is negative)
 */

export interface CompensationBreakdown {
  gross: Dec;
  mweBasic: Dec;
  mweOther: Dec;
  benefitsExempt: Dec;
  deMinimis: Dec;
  statutoryEe: Dec;
  otherNonTaxable: Dec;
  totalNonTaxable: Dec;
  taxable: Dec;
  withheld: Dec;
}

const MWE_BASIC_CATEGORIES: readonly PayLine['category'][] = ['basic', 'attendance_deduction'];

const emptyBreakdown = (): CompensationBreakdown => ({
  gross: ZERO,
  mweBasic: ZERO,
  mweOther: ZERO,
  benefitsExempt: ZERO,
  deMinimis: ZERO,
  statutoryEe: ZERO,
  otherNonTaxable: ZERO,
  totalNonTaxable: ZERO,
  taxable: ZERO,
  withheld: ZERO,
});

const total = (lines: readonly PayLine[]): Dec => sum(lines.map((l) => l.amount));

export function slipBreakdown(p: PayslipRow): CompensationBreakdown {
  const c = p.computation;
  const lines = [...c.earnings, ...(p.finalPay?.earnings ?? [])];
  const mwe = c.isMinimumWageEarner;
  const mweLines = mwe ? lines.filter((l) => l.taxClass === 'mwe_exempt_eligible') : [];
  const mweBasic = total(mweLines.filter((l) => MWE_BASIC_CATEGORIES.includes(l.category)));
  const mweOther = total(mweLines).minus(mweBasic);
  const deMinimis = total(lines.filter((l) => l.taxClass === 'de_minimis'));
  const gross = dec(p.gross);
  const taxable = dec(p.taxableIncome);
  const benefitsExempt = dec(p.otherBenefitsExemptUsed);
  const residual = gross
    .minus(mweBasic)
    .minus(mweOther)
    .minus(benefitsExempt)
    .minus(deMinimis)
    .minus(taxable);
  const ee = dec(p.sssEe).plus(p.philhealthEe).plus(p.pagibigEe);
  const statutoryEe = mwe ? ZERO : min(ee, max(residual, ZERO));
  const otherNonTaxable = residual.minus(statutoryEe);
  const totalNonTaxable = gross.minus(taxable);
  return {
    gross,
    mweBasic,
    mweOther,
    benefitsExempt,
    deMinimis,
    statutoryEe,
    otherNonTaxable,
    totalNonTaxable,
    taxable,
    withheld: dec(p.withholdingTax),
  };
}

export function addBreakdowns(list: readonly CompensationBreakdown[]): CompensationBreakdown {
  const out = emptyBreakdown();
  for (const b of list) {
    for (const k of Object.keys(out) as (keyof CompensationBreakdown)[]) {
      out[k] = out[k].plus(b[k]);
    }
  }
  return out;
}

/** The compensation lines shared by 1601-C and 2316, in form order. */
const BREAKDOWN_LINES: { key: keyof CompensationBreakdown; label: string }[] = [
  { key: 'gross', label: 'Total amount of compensation' },
  { key: 'mweBasic', label: 'Non-taxable: statutory minimum wage (MWEs)' },
  {
    key: 'mweOther',
    label: 'Non-taxable: holiday pay, overtime, night differential, hazard pay (MWEs)',
  },
  { key: 'benefitsExempt', label: 'Non-taxable: 13th month pay and other benefits (exempt part)' },
  { key: 'deMinimis', label: 'Non-taxable: de minimis benefits' },
  {
    key: 'statutoryEe',
    label: 'Non-taxable: SSS, PhilHealth, Pag-IBIG employee contributions',
  },
  { key: 'otherNonTaxable', label: 'Non-taxable: other non-taxable compensation' },
  { key: 'totalNonTaxable', label: 'Total non-taxable compensation' },
  { key: 'taxable', label: 'Total taxable compensation' },
];

// ---------------------------------------------------------------- 1601-C

export async function bir1601cReport(ctx: ReportContext, month: string): Promise<ReportDoc> {
  const range = monthRange(month);
  const employer = await loadEmployer(ctx.db);
  const slips = await postedSlips(ctx.db, range);
  const b = addBreakdowns(slips.map((s) => slipBreakdown(s.p)));
  const headcount = new Set(slips.map((s) => s.e.id)).size;
  const rows: string[][] = [
    ...BREAKDOWN_LINES.map((l) => [l.label, m(b[l.key])]),
    ['Total taxes withheld', m(b.withheld)],
  ];
  return tableDoc({
    fileBase: `bir-1601c-${month}`,
    title: `BIR 1601-C Monthly Remittance Summary — ${month}`,
    subtitle: [
      `Withholding agent: ${employer.name}    TIN: ${employer.tin ?? '—'}`,
      ...(employer.address ? [`Address: ${employer.address}`] : []),
      `For the month of ${month}: approved/paid payroll runs ending ${range.from} to ${range.to}; ${headcount} employee(s), ${new Set(slips.map((s) => s.run.id)).size} run(s)`,
    ],
    columns: [
      { header: 'Item', width: 4 },
      { header: 'Amount', money: true, width: 1 },
    ],
    rows,
    fontSize: 10,
  });
}

// ---------------------------------------------------------------- 2316

export async function bir2316Report(
  ctx: ReportContext,
  year: number,
  employeeId?: string,
): Promise<ReportDoc> {
  if (employeeId) {
    const [e] = await ctx.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!e) throw notFound('Employee');
  }
  const range = yearRange(year);
  const employer = await loadEmployer(ctx.db);
  const rates = await ratesForDate(ctx.db, range.to);
  const groups = byEmployee(await postedSlips(ctx.db, range, employeeId));

  const header = [
    'Employee no.',
    'TIN',
    'Last name',
    'First name',
    'Middle name',
    'Period from',
    'Period to',
    ...BREAKDOWN_LINES.map((l) => l.label),
    'Tax due (annualized)',
    'Tax withheld',
    'Tax still payable / (refund)',
  ];
  const csvRows: string[][] = [];
  const sections: PdfSection[] = [];

  for (const { e, slips } of groups) {
    const b = addBreakdowns(slips.map((s) => slipBreakdown(s.p)));
    const annual = annualize({
      annualTaxableCompensation: b.taxable,
      taxWithheldYtd: b.withheld,
      rates: rates.data,
    });
    const tin = reveal(ctx, e.tinEnc);
    const from = e.hireDate > range.from ? e.hireDate : range.from;
    const to = e.separationDate && e.separationDate < range.to ? e.separationDate : range.to;
    const balance = toMoney(annual.balance);
    csvRows.push([
      e.employeeNo,
      tin,
      e.lastName,
      e.firstName,
      e.middleName ?? '',
      from,
      to,
      ...BREAKDOWN_LINES.map((l) => m(b[l.key])),
      m(annual.taxDue),
      m(annual.taxWithheld),
      balance,
    ]);
    const differenceLabel = annual.balance.gt(0)
      ? 'Amount still to be withheld / payable by the employee'
      : annual.balance.lt(0)
        ? 'Over-withheld: refund due to the employee'
        : 'Difference (tax due equals tax withheld)';
    sections.push({
      newPage: true,
      heading: `${employeeName(e)} (${e.employeeNo})`,
      subtitle: [
        `Employee TIN: ${tin || '—'}    Period: ${from} to ${to}`,
        `Employer: ${employer.name}    Employer TIN: ${employer.tin ?? '—'}`,
      ],
      columns: [
        { header: 'Item', width: 4 },
        { header: 'Amount', money: true, width: 1 },
      ],
      rows: [
        ...BREAKDOWN_LINES.map((l) => [l.label, m(b[l.key])]),
        [`Tax due (annualized, rates ${rates.version})`, m(annual.taxDue)],
        ['Tax withheld', m(annual.taxWithheld)],
        { cells: [differenceLabel, m(annual.balance.abs())], bold: true },
      ],
    });
  }

  const totals =
    csvRows.length > 1
      ? totalsRow(
          csvRows,
          header.length,
          Array.from({ length: header.length - 7 }, (_, i) => i + 7),
        )
      : null;

  return {
    fileBase:
      employeeId && groups[0] ? `bir-2316-${year}-${groups[0].e.employeeNo}` : `bir-2316-${year}`,
    csv: { header, rows: totals ? [...csvRows, totals] : csvRows },
    pdf: {
      title: `BIR 2316 Certificate of Compensation Summary — ${year}`,
      subtitle: [
        `Employer: ${employer.name}    TIN: ${employer.tin ?? '—'}`,
        `Approved/paid payroll runs ending in ${year}; tax due uses rates ${rates.version} (effective ${range.to}).`,
      ],
      footer: `BIR 2316 summary ${year}`,
      fontSize: 10,
      sections:
        sections.length > 0
          ? sections
          : [
              {
                columns: [
                  { header: 'Item', width: 4 },
                  { header: 'Amount', money: true },
                ],
                rows: [],
                emptyText: 'No posted payslips for this year.',
              },
            ],
    },
  };
}
