import { dec, sum, toMoney, type Numeric, type PayLine } from '@payrollph/shared';
import { and, asc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { employees, payrollRuns, payslips, settings } from '../../db/schema';
import { maskTail, type DbOrTx } from '../../lib/audit';
import type { FieldCipher } from '../../lib/crypto';
import { badRequest } from '../../lib/http';
import type { PdfColumn, PdfRow, TablePdfSpec } from '../../lib/pdf/table';
import { lastDayOfMonth } from '../dates';

export type EmployeeRow = typeof employees.$inferSelect;
export type RunRow = typeof payrollRuns.$inferSelect;
export type PayslipRow = typeof payslips.$inferSelect;

/** Only approved/paid runs count towards remittances and BIR figures. */
export const POSTED_STATUSES = ['approved', 'paid'] as const;

/** Who is asking: viewers get gov IDs masked. */
export interface ReportContext {
  db: DbOrTx;
  cipher: FieldCipher;
  /** True for viewers: sensitive values are masked to their last 4 characters. */
  mask: boolean;
}

export interface ReportColumn extends PdfColumn {
  header: string;
}

/** A report ready for either output format. */
export interface ReportDoc {
  /** File name without extension, e.g. `sss-2026-03`. */
  fileBase: string;
  csv: { header: string[]; rows: string[][] };
  pdf: TablePdfSpec;
}

/** One-table report: the CSV and PDF share the same columns; totals become the last CSV row. */
export function tableDoc(input: {
  fileBase: string;
  title: string;
  subtitle: string[];
  columns: ReportColumn[];
  rows: (string[] | PdfRow)[];
  totals?: string[];
  pageSize?: TablePdfSpec['pageSize'];
  fontSize?: number;
  emptyText?: string;
}): ReportDoc {
  const plain = input.rows.map((r) => (Array.isArray(r) ? r : [...r.cells]));
  return {
    fileBase: input.fileBase,
    csv: {
      header: input.columns.map((c) => c.header),
      rows: input.totals ? [...plain, input.totals] : plain,
    },
    pdf: {
      title: input.title,
      subtitle: input.subtitle,
      ...(input.pageSize ? { pageSize: input.pageSize } : {}),
      ...(input.fontSize ? { fontSize: input.fontSize } : {}),
      footer: input.title,
      sections: [
        {
          columns: input.columns,
          rows: input.rows,
          ...(input.totals ? { totals: input.totals } : {}),
          ...(input.emptyText ? { emptyText: input.emptyText } : {}),
        },
      ],
    },
  };
}

// ---------------------------------------------------------------- money helpers

export const m = (v: Numeric): string => toMoney(v);
export const addAll = (values: readonly Numeric[]): string => toMoney(sum(values));
export const isZero = (v: Numeric): boolean => dec(v).isZero();

export const sumLines = (lines: readonly PayLine[], pred: (l: PayLine) => boolean): string =>
  toMoney(sum(lines.filter(pred).map((l) => l.amount)));

/** Column-wise totals of money columns (indexes given); other cells blank, label in col 0. */
export function totalsRow(
  rows: readonly string[][],
  width: number,
  moneyCols: readonly number[],
  label = 'TOTAL',
): string[] {
  const out = Array.from({ length: width }, () => '');
  out[0] = label;
  for (const i of moneyCols) out[i] = addAll(rows.map((r) => r[i] ?? '0'));
  return out;
}

// ---------------------------------------------------------------- periods

export interface DateRange {
  from: string;
  to: string;
}

export function monthRange(month: string): DateRange {
  const [y, mo] = month.split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) throw badRequest('BAD_MONTH', `Bad month ${month}`);
  return { from: `${month}-01`, to: lastDayOfMonth(y, mo) };
}

export const yearRange = (year: number): DateRange => ({
  from: `${year}-01-01`,
  to: `${year}-12-31`,
});

// ---------------------------------------------------------------- data

export interface SlipRecord {
  p: PayslipRow;
  run: RunRow;
  e: EmployeeRow;
}

/** Payslips of posted runs whose period ends inside the range, ordered by employee then date. */
export async function postedSlips(
  db: DbOrTx,
  range: DateRange,
  employeeId?: string,
): Promise<SlipRecord[]> {
  const conds: SQL[] = [
    inArray(payrollRuns.status, [...POSTED_STATUSES]),
    gte(payrollRuns.periodEnd, range.from),
    lte(payrollRuns.periodEnd, range.to),
  ];
  if (employeeId) conds.push(eq(payslips.employeeId, employeeId));
  return db
    .select({ p: payslips, run: payrollRuns, e: employees })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(and(...conds))
    .orderBy(
      asc(employees.lastName),
      asc(employees.firstName),
      asc(employees.employeeNo),
      asc(payrollRuns.periodEnd),
      asc(payrollRuns.createdAt),
    );
}

/** Group slips by employee, keeping the query order. */
export function byEmployee(
  slips: readonly SlipRecord[],
): { e: EmployeeRow; slips: SlipRecord[] }[] {
  const map = new Map<string, { e: EmployeeRow; slips: SlipRecord[] }>();
  for (const s of slips) {
    const g = map.get(s.e.id) ?? { e: s.e, slips: [] };
    g.slips.push(s);
    map.set(s.e.id, g);
  }
  return [...map.values()];
}

export interface Employer {
  name: string;
  address: string | null;
  tin: string | null;
  sssNo: string | null;
  philhealthNo: string | null;
  pagibigNo: string | null;
}

export async function loadEmployer(db: DbOrTx): Promise<Employer> {
  const [s] = await db.select().from(settings).limit(1);
  return {
    name: s?.ownerName ?? '',
    address: s?.ownerAddress ?? null,
    tin: s?.ownerTin ?? null,
    sssNo: s?.ownerSssEmployerNo ?? null,
    philhealthNo: s?.ownerPhilhealthEmployerNo ?? null,
    pagibigNo: s?.ownerPagibigEmployerNo ?? null,
  };
}

/** Decrypt an encrypted field; masked for viewers. Empty string when missing. */
export function reveal(ctx: ReportContext, enc: string | null): string {
  const plain = ctx.cipher.decryptNullable(enc);
  return (ctx.mask ? maskTail(plain) : plain) ?? '';
}

export const employeeName = (e: Pick<EmployeeRow, 'firstName' | 'middleName' | 'lastName'>) =>
  `${e.lastName}, ${e.firstName}${e.middleName ? ` ${e.middleName}` : ''}`;

export const RUN_KIND_LABELS: Record<RunRow['kind'], string> = {
  semi_monthly_1: 'Semi-monthly (1st cutoff)',
  semi_monthly_2: 'Semi-monthly (2nd cutoff)',
  monthly: 'Monthly',
  thirteenth_month: '13th month',
  final_pay: 'Final pay',
  twice_weekly: 'Twice-weekly payout',
};
