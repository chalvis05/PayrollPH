import {
  annualize,
  computeFinalPay,
  computePayslip,
  dec,
  periodShare,
  rateBasis,
  splitOtherBenefits,
  thirteenthPayout,
  toMoney,
  weekdayOf,
  type AllowanceInput,
  type AttendanceSummary,
  type ContributionShare,
  type DailyFactor,
  type DayHours,
  type DayType,
  type FinalPayResult,
  type OtherDeductionInput,
  type PayFrequency,
  type PayLine,
  type PayslipComputation,
  type StatutoryRates,
} from '@payrollph/shared';
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  attendance,
  customDeductions,
  employeeAllowances,
  employees,
  holidays,
  loanLedger,
  loans,
  payrollRuns,
  payslips,
  settings,
} from '../db/schema';
import { writeAudit, type DbOrTx } from '../lib/audit';
import { badRequest, conflict, HttpError, notFound } from '../lib/http';
import { addDays, eachDate, isoWeekday, lastDayOfMonth, yearOf } from './dates';
import { fullName } from './employees';
import { loanBalances, reverseRunLoanPayments } from './loans';
import { minimumWageFor, ratesById, ratesForDate } from './rates';

export type RunRow = typeof payrollRuns.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;
type HolidayType = (typeof holidays.$inferSelect)['type'];
type AttendanceRow = typeof attendance.$inferSelect;

export const REGULAR_KINDS = ['semi_monthly_1', 'semi_monthly_2', 'monthly'] as const;
export type RegularKind = (typeof REGULAR_KINDS)[number];
/** Runs that pay days worked (so posting them locks attendance): regular + twice-weekly. */
export const PAYDAY_KINDS = [...REGULAR_KINDS, 'twice_weekly'] as const;

/** Where a payout falls in its month, for loans set to deduct on the 1st or 2nd cutoff only. */
export interface CutoffSlot {
  first: boolean;
  last: boolean;
}

export function cutoffSlotFor(kind: RegularKind): CutoffSlot {
  return { first: kind !== 'semi_monthly_2', last: kind !== 'semi_monthly_1' };
}

/** Twice-weekly payouts: Wednesday pays Sunday–Wednesday, Saturday pays Thursday–Saturday. */
export function twiceWeeklyPeriod(payDate: string): { start: string; end: string } {
  const wd = weekdayOf(payDate);
  if (wd === 3) return { start: addDays(payDate, -3), end: payDate };
  if (wd === 6) return { start: addDays(payDate, -2), end: payDate };
  throw badRequest('BAD_PAY_DATE', 'Twice-weekly payouts are on a Wednesday or a Saturday.');
}

/**
 * First/last twice-weekly payout of its month: the previous/next payout (Wed to Sat is 3 days,
 * Sat to Wed is 4) falls in another month. The last one deducts the month's contributions.
 */
export function twiceWeeklySlot(payDate: string): CutoffSlot {
  const isWed = weekdayOf(payDate) === 3;
  const month = payDate.slice(0, 7);
  return {
    first: addDays(payDate, isWed ? -4 : -3).slice(0, 7) !== month,
    last: addDays(payDate, isWed ? 3 : 4).slice(0, 7) !== month,
  };
}
const POSTED = ['approved', 'paid'] as const;

const ZERO = '0.00';

// ---------------------------------------------------------------- periods & schedules

export function periodFor(kind: RegularKind, month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) throw badRequest('BAD_MONTH', `Bad month ${month}`);
  const first = `${month}-01`;
  const last = lastDayOfMonth(y, m);
  if (kind === 'semi_monthly_1') return { start: first, end: `${month}-15` };
  if (kind === 'semi_monthly_2') return { start: `${month}-16`, end: last };
  return { start: first, end: last };
}

export function frequencyFor(kind: RegularKind): PayFrequency {
  return kind === 'monthly' ? 'monthly' : 'semi_monthly';
}

/** Which part of the monthly SSS/PhilHealth/Pag-IBIG this run deducts. */
export function contributionShareFor(
  kind: RegularKind,
  schedule: 'second_cutoff' | 'split',
): ContributionShare {
  if (kind === 'monthly') return 'full';
  if (kind === 'semi_monthly_1') return schedule === 'split' ? 'first_half' : 'none';
  return schedule === 'split' ? 'second_half' : 'full';
}

/** Day type from the holiday calendar and the employee's rest days. */
export function dayTypeFor(
  date: string,
  restDays: readonly number[],
  holiday: HolidayType | undefined,
): DayType {
  const rest = restDays.includes(isoWeekday(date));
  if (holiday === 'regular') return rest ? 'regular_rest_day' : 'regular';
  if (holiday === 'special_non_working') return rest ? 'special_rest_day' : 'special';
  return rest ? 'rest_day' : 'ordinary';
}

// ---------------------------------------------------------------- attendance → engine input

const num = (v: string | number): number => Number(v);

/**
 * Turn DTR rows into the engine's AttendanceSummary.
 * - Ordinary days: daily staff earn a day per day with hours; hourly staff earn per hour.
 * - Paid leave (any type except unpaid) counts as a paid day; unpaid leave and absences on
 *   ordinary days count as absences (deducted from monthly salaries).
 * - Rest days/holidays go to `days` for premium computation.
 * - Daily/hourly staff get unworked regular-holiday pay when they worked or were on paid leave
 *   on the last working day before the holiday.
 */
export function buildAttendanceSummary(input: {
  payType: EmployeeRow['payType'];
  restDays: readonly number[];
  period: { start: string; end: string };
  /** Rows for the period plus a few days before it (for holiday eligibility). */
  rows: readonly AttendanceRow[];
  holidaysByDate: ReadonlyMap<string, HolidayType>;
}): AttendanceSummary {
  const { period, restDays } = input;
  const byDate = new Map(input.rows.map((r) => [r.date, r]));
  const buckets = new Map<DayType, { hours: number; ot: number; nd: number; ndOt: number }>();
  let daysWorked = 0;
  let regularHours = 0;
  let paidLeaveDays = 0;
  let absentDays = 0;
  let tardy = 0;
  let undertime = 0;

  for (const row of input.rows) {
    if (row.date < period.start || row.date > period.end) continue;
    const dayType =
      row.dayTypeOverride ?? dayTypeFor(row.date, restDays, input.holidaysByDate.get(row.date));
    const hours = num(row.regularHours);
    const paidLeave = row.leaveType !== null && row.leaveType !== 'unpaid';
    if (paidLeave) paidLeaveDays += 1;
    if (dayType === 'ordinary' && (row.absent || row.leaveType === 'unpaid')) absentDays += 1;
    tardy += row.tardyMinutes;
    undertime += row.undertimeMinutes;

    if (dayType === 'ordinary' && hours > 0) {
      if (input.payType === 'daily') daysWorked += 1;
      if (input.payType === 'hourly') regularHours += hours;
    }
    const b = buckets.get(dayType) ?? { hours: 0, ot: 0, nd: 0, ndOt: 0 };
    b.hours += dayType === 'ordinary' ? 0 : hours;
    b.ot += num(row.otHours);
    b.nd += num(row.ndHours);
    b.ndOt += num(row.ndOtHours);
    buckets.set(dayType, b);
  }

  let unworkedRegularHolidays = 0;
  if (input.payType === 'daily' || input.payType === 'hourly') {
    for (const date of eachDate(period.start, period.end)) {
      if (input.holidaysByDate.get(date) !== 'regular') continue;
      const worked = num(byDate.get(date)?.regularHours ?? '0') > 0;
      if (worked) continue;
      // Last working day before the holiday: skip rest days and other holidays (max 7 days back).
      let prev = addDays(date, -1);
      for (let i = 0; i < 7; i += 1) {
        const isRest = restDays.includes(isoWeekday(prev));
        if (!isRest && !input.holidaysByDate.has(prev)) break;
        prev = addDays(prev, -1);
      }
      const prior = byDate.get(prev);
      const eligible =
        prior !== undefined &&
        (num(prior.regularHours) > 0 || (prior.leaveType !== null && prior.leaveType !== 'unpaid'));
      if (eligible) unworkedRegularHolidays += 1;
    }
  }

  const days: DayHours[] = [...buckets].map(([dayType, b]) => ({
    dayType,
    hours: b.hours,
    otHours: b.ot,
    ndHours: b.nd,
    ndOtHours: b.ndOt,
  }));

  return {
    daysWorked,
    regularHours,
    paidLeaveDays,
    absentDays,
    tardyMinutes: tardy,
    undertimeMinutes: undertime,
    days,
    unworkedRegularHolidays,
    unworkedDoubleHolidays: 0,
  };
}

// ---------------------------------------------------------------- data gathering

async function holidaysMap(
  db: DbOrTx,
  start: string,
  end: string,
): Promise<Map<string, HolidayType>> {
  const rows = await db
    .select()
    .from(holidays)
    .where(and(gte(holidays.date, start), lte(holidays.date, end)));
  // special_working days carry no premium; treat them as ordinary days.
  return new Map(rows.filter((h) => h.type !== 'special_working').map((h) => [h.date, h.type]));
}

interface PostedYtd {
  basicEarned: string;
  thirteenthAccrual: string;
  thirteenthPaid: string;
  otherBenefitsExemptUsed: string;
  taxableIncome: string;
  withholdingTax: string;
}

/** Year-to-date sums from approved/paid runs of the given year, excluding one run. */
export async function postedYtd(
  db: DbOrTx,
  employeeIds: string[],
  year: number,
  excludeRunId: string | null,
  upToDate?: string,
): Promise<Map<string, PostedYtd>> {
  const out = new Map<string, PostedYtd>();
  if (employeeIds.length === 0) return out;
  const conds = [
    inArray(payslips.employeeId, employeeIds),
    inArray(payrollRuns.status, [...POSTED]),
    sql`extract(year from ${payrollRuns.periodEnd}) = ${year}`,
  ];
  if (excludeRunId) conds.push(ne(payrollRuns.id, excludeRunId));
  if (upToDate) conds.push(lte(payrollRuns.periodEnd, upToDate));
  const rows = await db
    .select({
      employeeId: payslips.employeeId,
      basicEarned: sql<string>`sum(${payslips.basicEarned})::text`,
      thirteenthAccrual: sql<string>`sum(${payslips.thirteenthAccrual})::text`,
      thirteenthPaid: sql<string>`sum(${payslips.thirteenthPaid})::text`,
      otherBenefitsExemptUsed: sql<string>`sum(${payslips.otherBenefitsExemptUsed})::text`,
      taxableIncome: sql<string>`sum(${payslips.taxableIncome})::text`,
      withholdingTax: sql<string>`sum(${payslips.withholdingTax})::text`,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(and(...conds))
    .groupBy(payslips.employeeId);
  for (const r of rows) out.set(r.employeeId, r);
  return out;
}

const emptyYtd: PostedYtd = {
  basicEarned: ZERO,
  thirteenthAccrual: ZERO,
  thirteenthPaid: ZERO,
  otherBenefitsExemptUsed: ZERO,
  taxableIncome: ZERO,
  withholdingTax: ZERO,
};

const LOAN_LABELS: Record<(typeof loans.$inferSelect)['type'], string> = {
  sss: 'SSS loan',
  pagibig: 'Pag-IBIG loan',
  company: 'Company loan',
  cash_advance: 'Cash advance',
};

function loanAppliesTo(
  deductOn: (typeof loans.$inferSelect)['deductOn'],
  slot: CutoffSlot,
): boolean {
  if (deductOn === 'every_run') return true;
  if (deductOn === 'first_cutoff') return slot.first;
  return slot.last;
}

async function loanDeductionsFor(
  db: DbOrTx,
  employeeId: string,
  periodEnd: string,
  mode: { slot: CutoffSlot } | { payoff: true },
): Promise<OtherDeductionInput[]> {
  const rows = await db
    .select()
    .from(loans)
    .where(
      and(
        eq(loans.employeeId, employeeId),
        eq(loans.status, 'active'),
        lte(loans.startDate, periodEnd),
      ),
    );
  const balances = await loanBalances(
    db,
    rows.map((l) => l.id),
  );
  const out: OtherDeductionInput[] = [];
  for (const l of rows) {
    const balance = dec(balances.get(l.id) ?? ZERO);
    if (balance.lte(0)) continue;
    if ('slot' in mode && !loanAppliesTo(l.deductOn, mode.slot)) continue;
    const amount = 'payoff' in mode ? balance : DecMin(balance, l.amortization);
    out.push({
      code: `loan:${l.id}`,
      label: `${LOAN_LABELS[l.type]}${l.reference ? ` (${l.reference})` : ''}`,
      category: 'loan',
      amount: toMoney(amount),
    });
  }
  return out;
}

const DecMin = (a: ReturnType<typeof dec>, b: string) => (a.lt(b) ? a : dec(b));

async function customDeductionsFor(
  db: DbOrTx,
  employeeId: string,
  runId: string,
  period: { start: string; end: string },
): Promise<OtherDeductionInput[]> {
  const rows = await db
    .select()
    .from(customDeductions)
    .where(
      and(
        eq(customDeductions.employeeId, employeeId),
        eq(customDeductions.active, true),
        lte(customDeductions.startDate, period.end),
        or(isNull(customDeductions.endDate), gte(customDeductions.endDate, period.start)),
        or(
          eq(customDeductions.recurrence, 'every_run'),
          isNull(customDeductions.appliedRunId),
          eq(customDeductions.appliedRunId, runId),
        ),
      ),
    );
  return rows.map((d) => ({
    code: `deduction:${d.id}`,
    label: d.label,
    category: 'deduction' as const,
    amount: d.amount,
  }));
}

function allowanceInputs(rows: (typeof employeeAllowances.$inferSelect)[]): AllowanceInput[] {
  return rows.map((a) => ({
    code: `allowance:${a.id}`,
    name: a.name,
    amount: a.amount,
    kind: a.kind,
    ...(a.deMinimisType ? { deMinimisType: a.deMinimisType } : {}),
  }));
}

function govIds(e: EmployeeRow) {
  return {
    sss: e.sssNoEnc !== null,
    philhealth: e.philhealthNoEnc !== null,
    pagibig: e.pagibigNoEnc !== null,
    tin: e.tinEnc !== null,
  };
}

// ---------------------------------------------------------------- payslip rows

const lineAmount = (lines: readonly PayLine[], code: string): string =>
  lines.find((l) => l.code === code)?.amount ?? ZERO;

function payslipValues(
  runId: string,
  employeeId: string,
  c: PayslipComputation,
  share: ContributionShare,
  extra: { thirteenthPaid?: string; finalPay?: FinalPayResult } = {},
): typeof payslips.$inferInsert {
  const fp = extra.finalPay;
  const gross = fp ? toMoney(dec(c.grossPay).plus(fp.totalEarnings)) : c.grossPay;
  const totalDeductions = fp
    ? toMoney(dec(c.totalDeductions).plus(fp.totalDeductions))
    : c.totalDeductions;
  const taxAdj = fp
    ? (fp.deductions.find((d) => d.code === 'tax_annualization')?.amount ?? ZERO)
    : ZERO;
  return {
    payrollRunId: runId,
    employeeId,
    computation: c,
    finalPay: fp ?? null,
    gross,
    taxableIncome: fp
      ? toMoney(
          dec(c.taxableIncome)
            .plus(fp.thirteenthMonth.taxable)
            .plus(lineAmount(fp.earnings, 'sil_conversion')),
        )
      : c.taxableIncome,
    withholdingTax: toMoney(dec(c.withholdingTax).plus(taxAdj)),
    sssEe: lineAmount(c.employeeDeductions, 'sss_ee'),
    sssEr: lineAmount(c.employerShares, 'sss_er'),
    sssEc: lineAmount(c.employerShares, 'sss_ec'),
    sssMpfEe: toMoney(periodShare(c.monthlyContributions.sss.eeMpf, share)),
    sssMpfEr: toMoney(periodShare(c.monthlyContributions.sss.erMpf, share)),
    philhealthEe: lineAmount(c.employeeDeductions, 'philhealth_ee'),
    philhealthEr: lineAmount(c.employerShares, 'philhealth_er'),
    pagibigEe: lineAmount(c.employeeDeductions, 'pagibig_ee'),
    pagibigEr: lineAmount(c.employerShares, 'pagibig_er'),
    basicEarned: c.basicEarned,
    thirteenthAccrual: c.thirteenthMonthAccrual,
    thirteenthPaid: fp ? fp.thirteenthMonth.amount : (extra.thirteenthPaid ?? ZERO),
    otherBenefitsExemptUsed: fp
      ? toMoney(dec(c.otherBenefitsExemptUsed).plus(fp.thirteenthMonth.exempt))
      : c.otherBenefitsExemptUsed,
    totalDeductions,
    net: fp ? fp.netFinalPay : c.netPay,
  };
}

async function updateRunTotals(db: DbOrTx, runId: string): Promise<void> {
  const [t] = await db
    .select({
      gross: sql<string>`coalesce(sum(${payslips.gross}), 0)::text`,
      deductions: sql<string>`coalesce(sum(${payslips.totalDeductions}), 0)::text`,
      net: sql<string>`coalesce(sum(${payslips.net}), 0)::text`,
      er: sql<string>`coalesce(sum(${payslips.sssEr} + ${payslips.sssEc} + ${payslips.philhealthEr} + ${payslips.pagibigEr}), 0)::text`,
    })
    .from(payslips)
    .where(eq(payslips.payrollRunId, runId));
  await db
    .update(payrollRuns)
    .set({
      totalGross: t?.gross ?? ZERO,
      totalDeductions: t?.deductions ?? ZERO,
      totalNet: t?.net ?? ZERO,
      totalEmployerShares: t?.er ?? ZERO,
    })
    .where(eq(payrollRuns.id, runId));
}

// ---------------------------------------------------------------- regular runs

/** How one run pays: its tax frequency, contribution share and position in the month. */
interface SlipPlan {
  frequency: PayFrequency;
  share: ContributionShare;
  slot: CutoffSlot;
  /** Twice-weekly: gross of this employee's other payouts this month (SSS on actual pay). */
  otherGrossThisMonth?: string;
}

async function computeRegularSlip(
  db: DbOrTx,
  run: RunRow,
  e: EmployeeRow,
  rates: StatutoryRates,
  hols: Map<string, HolidayType>,
  plan: SlipPlan,
): Promise<{ computation: PayslipComputation; share: ContributionShare }> {
  const period = { start: run.periodStart, end: run.periodEnd };
  const rows = await db
    .select()
    .from(attendance)
    .where(
      and(
        eq(attendance.employeeId, e.id),
        gte(attendance.date, addDays(period.start, -10)),
        lte(attendance.date, period.end),
      ),
    );
  const summary = buildAttendanceSummary({
    payType: e.payType,
    restDays: e.restDays,
    period,
    rows,
    holidaysByDate: hols,
  });
  const allowances = await db
    .select()
    .from(employeeAllowances)
    .where(eq(employeeAllowances.employeeId, e.id));
  const otherDeductions = [
    ...(await loanDeductionsFor(db, e.id, period.end, { slot: plan.slot })),
    ...(await customDeductionsFor(db, e.id, run.id, period)),
  ];
  const ytd = (await postedYtd(db, [e.id], yearOf(period.end), run.id)).get(e.id) ?? emptyYtd;
  const minimumWage = await minimumWageFor(db, e.region, period.end);
  const share = plan.share;

  const base = {
    employee: {
      payType: e.payType,
      employmentType: e.employmentType,
      baseRate: e.baseRate,
      dailyFactor: e.dailyFactor as DailyFactor,
      govIds: govIds(e),
    },
    frequency: plan.frequency,
    attendance: summary,
    allowances: allowanceInputs(allowances),
    otherDeductions,
    ytd: { otherBenefitsExemptUsed: ytd.otherBenefitsExemptUsed },
    ...(minimumWage
      ? {
          minimumWage: {
            daily: minimumWage.daily,
            kasambahayMonthly: minimumWage.kasambahayMonthly,
          },
        }
      : {}),
    rates,
  };
  // The same month's first-cutoff payslip (any status; submit recomputes before approval).
  const [first] =
    run.kind === 'semi_monthly_2'
      ? await db
          .select({
            gross: payslips.gross,
            sssEe: payslips.sssEe,
            sssEr: payslips.sssEr,
            sssEc: payslips.sssEc,
            philhealthEe: payslips.philhealthEe,
            philhealthEr: payslips.philhealthEr,
            pagibigEe: payslips.pagibigEe,
            pagibigEr: payslips.pagibigEr,
          })
          .from(payslips)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
          .where(
            and(
              eq(payslips.employeeId, e.id),
              eq(payrollRuns.kind, 'semi_monthly_1'),
              eq(payrollRuns.periodStart, `${run.periodStart.slice(0, 7)}-01`),
            ),
          )
          .limit(1)
      : [];
  // Split schedule: the second cutoff takes the month's total minus what the first took, so the
  // halves add up even when the first half was estimated from the rate.
  const alreadyDeducted = share === 'second_half' && first ? { alreadyDeducted: first } : {};

  let computation = computePayslip({ ...base, contributions: { share, ...alreadyDeducted } });

  // Daily/hourly staff: SSS is based on actual monthly earnings, so when this run deducts the
  // month's contribution, recompute with this cutoff's gross plus the first cutoff's gross.
  if (
    (e.payType === 'daily' || e.payType === 'hourly') &&
    (share === 'full' || share === 'second_half')
  ) {
    const monthGross = (
      first ? dec(computation.grossPay).plus(first.gross) : dec(computation.grossPay)
    ).plus(plan.otherGrossThisMonth ?? '0');
    computation = computePayslip({
      ...base,
      contributions: { share, sssMonthlyCompensation: monthGross.toFixed(2), ...alreadyDeducted },
    });
  }
  return { computation, share };
}

/** (Re)compute every payslip of a draft regular run. */
export async function computeRegularRun(db: DbOrTx, runId: string): Promise<void> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) throw notFound('Payroll run');
  if (run.status !== 'draft' && run.status !== 'review') {
    throw conflict(
      'RUN_LOCKED',
      'Approved or paid runs cannot be recomputed. Reopen the run first.',
    );
  }
  if (!isRegular(run))
    throw badRequest('NOT_REGULAR', 'Only regular runs are recomputed this way.');
  const { data: rates } = await ratesById(db, run.ratesVersionId);
  const hols = await holidaysMap(db, addDays(run.periodStart, -10), run.periodEnd);
  const staff = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.status, 'active'),
        eq(employees.paySchedule, 'standard'),
        lte(employees.hireDate, run.periodEnd),
      ),
    );
  const plan: SlipPlan = {
    frequency: frequencyFor(run.kind),
    share: contributionShareFor(run.kind, run.contributionSchedule),
    slot: cutoffSlotFor(run.kind),
  };

  await db.delete(payslips).where(eq(payslips.payrollRunId, run.id));
  for (const e of staff) {
    const { computation, share } = await computeRegularSlip(db, run, e, rates, hols, plan);
    await db.insert(payslips).values(payslipValues(run.id, e.id, computation, share));
  }
  await updateRunTotals(db, run.id);
}

const isRegular = (run: RunRow): run is RunRow & { kind: RegularKind } =>
  (REGULAR_KINDS as readonly string[]).includes(run.kind);

/** (Re)compute a draft twice-weekly payout for every active twice-weekly employee. */
export async function computeTwiceWeeklyRun(db: DbOrTx, runId: string): Promise<void> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run || run.kind !== 'twice_weekly') throw notFound('Twice-weekly payout');
  if (run.status !== 'draft' && run.status !== 'review') {
    throw conflict(
      'RUN_LOCKED',
      'Approved or paid runs cannot be recomputed. Reopen the run first.',
    );
  }
  const { data: rates } = await ratesById(db, run.ratesVersionId);
  const hols = await holidaysMap(db, addDays(run.periodStart, -10), run.periodEnd);
  const staff = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.status, 'active'),
        eq(employees.paySchedule, 'twice_weekly'),
        lte(employees.hireDate, run.periodEnd),
      ),
    );
  const slot = twiceWeeklySlot(run.payDate);
  // The month's contributions come off the last payout of the month, on the month's actual pay.
  const share: ContributionShare = slot.last ? 'full' : 'none';
  const month = run.periodEnd.slice(0, 7);

  await db.delete(payslips).where(eq(payslips.payrollRunId, run.id));
  for (const e of staff) {
    const [others] = slot.last
      ? await db
          .select({ gross: sql<string>`coalesce(sum(${payslips.gross}), 0)::text` })
          .from(payslips)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
          .where(
            and(
              eq(payslips.employeeId, e.id),
              eq(payrollRuns.kind, 'twice_weekly'),
              ne(payrollRuns.id, run.id),
              sql`to_char(${payrollRuns.periodEnd}, 'YYYY-MM') = ${month}`,
            ),
          )
      : [];
    const { computation } = await computeRegularSlip(db, run, e, rates, hols, {
      frequency: 'twice_weekly',
      share,
      slot,
      ...(others ? { otherGrossThisMonth: others.gross } : {}),
    });
    await db.insert(payslips).values(payslipValues(run.id, e.id, computation, share));
  }
  await updateRunTotals(db, run.id);
}

export async function createTwiceWeeklyRun(
  db: DbOrTx,
  input: { payDate: string },
  actorId: string,
): Promise<string> {
  const period = twiceWeeklyPeriod(input.payDate);
  const rates = await ratesForDate(db, period.end);
  const [existing] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.kind, 'twice_weekly'), eq(payrollRuns.periodStart, period.start)))
    .limit(1);
  if (existing) {
    throw conflict('RUN_EXISTS', 'A payout for this pay date already exists.', {
      id: existing.id,
    });
  }
  const [cfg] = await db.select().from(settings).limit(1);
  const [run] = await db
    .insert(payrollRuns)
    .values({
      kind: 'twice_weekly',
      periodStart: period.start,
      periodEnd: period.end,
      payDate: input.payDate,
      ratesVersionId: rates.id,
      contributionSchedule: cfg?.contributionSchedule ?? 'second_cutoff',
      createdBy: actorId,
    })
    .returning();
  if (!run) throw new Error('Run insert returned no row');
  await computeTwiceWeeklyRun(db, run.id);
  await writeAudit(db, {
    actorId,
    action: 'payroll_run.create',
    entity: 'payroll_run',
    entityId: run.id,
    after: {
      kind: run.kind,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      ratesVersion: rates.version,
    },
  });
  return run.id;
}

export async function createRegularRun(
  db: DbOrTx,
  input: {
    kind: RegularKind;
    month: string;
    payDate: string;
    contributionSchedule: 'second_cutoff' | 'split';
  },
  actorId: string,
): Promise<string> {
  const period = periodFor(input.kind, input.month);
  const rates = await ratesForDate(db, period.end);
  const [existing] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.kind, input.kind), eq(payrollRuns.periodStart, period.start)))
    .limit(1);
  if (existing) {
    throw conflict('RUN_EXISTS', 'A payroll run for this period already exists.', {
      id: existing.id,
    });
  }
  const [run] = await db
    .insert(payrollRuns)
    .values({
      kind: input.kind,
      periodStart: period.start,
      periodEnd: period.end,
      payDate: input.payDate,
      ratesVersionId: rates.id,
      contributionSchedule: input.contributionSchedule,
      createdBy: actorId,
    })
    .returning();
  if (!run) throw new Error('Run insert returned no row');
  await computeRegularRun(db, run.id);
  await writeAudit(db, {
    actorId,
    action: 'payroll_run.create',
    entity: 'payroll_run',
    entityId: run.id,
    after: {
      kind: run.kind,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      ratesVersion: rates.version,
    },
  });
  return run.id;
}

// ---------------------------------------------------------------- 13th month runs

export async function createThirteenthRun(
  db: DbOrTx,
  input: { year: number; mode: 'half' | 'full'; payDate: string },
  actorId: string,
): Promise<string> {
  const start = `${input.year}-01-01`;
  const end = `${input.year}-12-31`;
  const [open] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.kind, 'thirteenth_month'),
        eq(payrollRuns.periodStart, start),
        inArray(payrollRuns.status, ['draft', 'review']),
      ),
    )
    .limit(1);
  if (open) {
    throw conflict('RUN_EXISTS', 'Finish or delete the open 13th-month run for this year first.', {
      id: open.id,
    });
  }
  const rates = await ratesForDate(db, input.payDate);
  const [cfg] = await db.select().from(settings).limit(1);
  const [run] = await db
    .insert(payrollRuns)
    .values({
      kind: 'thirteenth_month',
      periodStart: start,
      periodEnd: end,
      payDate: input.payDate,
      ratesVersionId: rates.id,
      contributionSchedule: cfg?.contributionSchedule ?? 'second_cutoff',
      thirteenthMode: input.mode,
      createdBy: actorId,
    })
    .returning();
  if (!run) throw new Error('Run insert returned no row');
  await computeThirteenthRun(db, run.id);
  await writeAudit(db, {
    actorId,
    action: 'payroll_run.create',
    entity: 'payroll_run',
    entityId: run.id,
    after: { kind: run.kind, year: input.year, mode: input.mode },
  });
  return run.id;
}

export async function computeThirteenthRun(db: DbOrTx, runId: string): Promise<void> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run || run.kind !== 'thirteenth_month') throw notFound('13th-month run');
  const { data: rates } = await ratesById(db, run.ratesVersionId);
  const year = yearOf(run.periodEnd);
  const mode = run.thirteenthMode === 'half' ? 'half' : 'full';
  const staff = await db
    .select()
    .from(employees)
    .where(and(eq(employees.status, 'active'), lte(employees.hireDate, run.periodEnd)));
  const ytd = await postedYtd(
    db,
    staff.map((e) => e.id),
    year,
    run.id,
  );

  await db.delete(payslips).where(eq(payslips.payrollRunId, run.id));
  for (const e of staff) {
    const y = ytd.get(e.id) ?? emptyYtd;
    const amount = thirteenthPayout({
      accruedYtd: y.thirteenthAccrual,
      paidYtd: y.thirteenthPaid,
      mode,
    });
    if (amount.lte(0)) continue;
    const split = splitOtherBenefits({ amount, exemptUsedYtd: y.otherBenefitsExemptUsed, rates });
    const basis = rateBasis(e.payType, e.baseRate, e.dailyFactor as DailyFactor, rates);
    const zeroContrib = {
      msc: ZERO,
      mscRegular: ZERO,
      mscMpf: ZERO,
      ee: ZERO,
      eeMpf: ZERO,
      er: ZERO,
      erMpf: ZERO,
      ec: ZERO,
    };
    const computation: PayslipComputation = {
      rateBasis: {
        monthly: toMoney(basis.monthly),
        daily: toMoney(basis.daily),
        hourly: toMoney(basis.hourly),
      },
      isMinimumWageEarner: false,
      earnings: [
        {
          code: 'thirteenth_month',
          label: mode === 'half' ? '13th month pay (mid-year half)' : '13th month pay',
          category: 'thirteenth_month',
          amount: toMoney(amount),
          taxClass: 'other_benefit',
        },
      ],
      grossPay: toMoney(amount),
      monthlyContributions: {
        sss: zeroContrib,
        philhealth: { base: ZERO, premium: ZERO, ee: ZERO, er: ZERO },
        pagibig: { base: ZERO, ee: ZERO, er: ZERO },
        employerShoulderedEe: false,
      },
      employeeDeductions: [],
      employerShares: [],
      // Tax on any excess over the ceiling is settled in the year-end annualization (BIR 2316).
      taxableIncome: toMoney(split.taxable),
      withholdingTax: ZERO,
      basicEarned: ZERO,
      thirteenthMonthAccrual: ZERO,
      otherBenefitsExemptUsed: toMoney(split.exempt),
      totalDeductions: ZERO,
      netPay: toMoney(amount),
      warnings: [],
    };
    await db
      .insert(payslips)
      .values(
        payslipValues(run.id, e.id, computation, 'none', { thirteenthPaid: toMoney(amount) }),
      );
  }
  await updateRunTotals(db, run.id);
}

// ---------------------------------------------------------------- final pay

export async function createFinalPayRun(
  db: DbOrTx,
  input: {
    employeeId: string;
    separationDate: string;
    payDate: string;
    unusedSilDays: number;
    reason: string;
  },
  actorId: string,
): Promise<string> {
  const [e] = await db.select().from(employees).where(eq(employees.id, input.employeeId)).limit(1);
  if (!e) throw notFound('Employee');
  if (e.status === 'separated')
    throw conflict('ALREADY_SEPARATED', 'This employee is already separated.');
  if (input.separationDate < e.hireDate) {
    throw badRequest('BAD_SEPARATION_DATE', 'The separation date is before the hire date.');
  }
  const [open] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.kind, 'final_pay'),
        eq(payrollRuns.finalPayEmployeeId, e.id),
        inArray(payrollRuns.status, ['draft', 'review']),
      ),
    )
    .limit(1);
  if (open)
    throw conflict('RUN_EXISTS', 'This employee already has an open final-pay run.', {
      id: open.id,
    });

  // The last salary covers the days after the latest posted regular payslip.
  const [lastPosted] = await db
    .select({ end: sql<string | null>`max(${payrollRuns.periodEnd})::text` })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(
      and(
        eq(payslips.employeeId, e.id),
        inArray(payrollRuns.status, [...POSTED]),
        inArray(payrollRuns.kind, [...PAYDAY_KINDS]),
      ),
    );
  const startCandidate = lastPosted?.end ? addDays(lastPosted.end, 1) : e.hireDate;
  const periodStart = startCandidate > input.separationDate ? input.separationDate : startCandidate;
  const rates = await ratesForDate(db, input.separationDate);
  const [cfg] = await db.select().from(settings).limit(1);
  const [run] = await db
    .insert(payrollRuns)
    .values({
      kind: 'final_pay',
      periodStart,
      periodEnd: input.separationDate,
      payDate: input.payDate,
      ratesVersionId: rates.id,
      contributionSchedule: cfg?.contributionSchedule ?? 'second_cutoff',
      finalPayEmployeeId: e.id,
      createdBy: actorId,
    })
    .returning();
  if (!run) throw new Error('Run insert returned no row');
  await computeFinalPayRun(db, run.id, {
    unusedSilDays: input.unusedSilDays,
    lastSalaryStart: startCandidate,
  });
  await writeAudit(db, {
    actorId,
    action: 'payroll_run.create',
    entity: 'payroll_run',
    entityId: run.id,
    reason: input.reason,
    after: {
      kind: 'final_pay',
      employeeId: e.id,
      separationDate: input.separationDate,
      unusedSilDays: input.unusedSilDays,
    },
  });
  return run.id;
}

async function computeFinalPayRun(
  db: DbOrTx,
  runId: string,
  opts: { unusedSilDays: number; lastSalaryStart: string },
): Promise<void> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run?.finalPayEmployeeId) throw notFound('Final-pay run');
  const [e] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, run.finalPayEmployeeId))
    .limit(1);
  if (!e) throw notFound('Employee');
  const { data: rates } = await ratesById(db, run.ratesVersionId);
  const [cfg] = await db.select().from(settings).limit(1);
  const frequency: PayFrequency =
    e.paySchedule === 'twice_weekly'
      ? 'twice_weekly'
      : cfg?.payFrequency === 'monthly'
        ? 'monthly'
        : 'semi_monthly';
  const basis = rateBasis(e.payType, e.baseRate, e.dailyFactor as DailyFactor, rates);
  const year = yearOf(run.periodEnd);
  const hasLastSalary = opts.lastSalaryStart <= run.periodEnd;
  const period = { start: run.periodStart, end: run.periodEnd };

  // Contributions: deduct the month's share only if nothing was deducted for that month yet.
  const [deducted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(
      and(
        eq(payslips.employeeId, e.id),
        inArray(payrollRuns.status, [...POSTED]),
        sql`to_char(${payrollRuns.periodEnd}, 'YYYY-MM') = ${run.periodEnd.slice(0, 7)}`,
        sql`(${payslips.sssEe} + ${payslips.sssEr} + ${payslips.philhealthEr} + ${payslips.pagibigEr}) > 0`,
      ),
    );
  const share: ContributionShare = (deducted?.n ?? 0) > 0 ? 'none' : 'full';

  const ytd = (await postedYtd(db, [e.id], year, run.id)).get(e.id) ?? emptyYtd;
  const minimumWage = await minimumWageFor(db, e.region, run.periodEnd);
  const allowances = await db
    .select()
    .from(employeeAllowances)
    .where(eq(employeeAllowances.employeeId, e.id));

  // Last salary for a partial period. Monthly/semi-monthly staff are paid per working day
  // actually employed (their salary only covers whole periods); daily/hourly as usual.
  let computation: PayslipComputation;
  if (hasLastSalary) {
    const hols = await holidaysMap(db, addDays(period.start, -10), period.end);
    const rows = await db
      .select()
      .from(attendance)
      .where(
        and(
          eq(attendance.employeeId, e.id),
          gte(attendance.date, addDays(period.start, -10)),
          lte(attendance.date, period.end),
        ),
      );
    const salaried = e.payType === 'monthly' || e.payType === 'semi_monthly';
    let summary = buildAttendanceSummary({
      payType: salaried ? 'daily' : e.payType,
      restDays: e.restDays,
      period,
      rows,
      holidaysByDate: hols,
    });
    if (salaried) {
      // Days worked on a holiday are paid in full by the premium line (the daily conversion has
      // no salary coverage), so they must not also count as a paid working day here.
      const premiumWorked = new Set(
        rows
          .filter(
            (r) =>
              r.date >= period.start &&
              r.date <= period.end &&
              Number(r.regularHours) > 0 &&
              (r.dayTypeOverride ?? dayTypeFor(r.date, e.restDays, hols.get(r.date))) !==
                'ordinary',
          )
          .map((r) => r.date),
      );
      const workdays = eachDate(period.start, period.end).filter(
        (d) =>
          !e.restDays.includes(isoWeekday(d)) &&
          hols.get(d) !== 'special_non_working' &&
          !premiumWorked.has(d),
      ).length;
      summary = {
        ...summary,
        daysWorked: Math.max(
          workdays - Number(summary.absentDays) - Number(summary.paidLeaveDays),
          0,
        ),
        unworkedRegularHolidays: 0,
      };
    }
    computation = computePayslip({
      employee: {
        payType: salaried ? 'daily' : e.payType,
        employmentType: e.employmentType,
        baseRate: salaried ? basis.daily.toFixed(6) : e.baseRate,
        dailyFactor: e.dailyFactor as DailyFactor,
        govIds: govIds(e),
      },
      frequency,
      attendance: summary,
      allowances: allowanceInputs(allowances),
      contributions: {
        share,
        sssMonthlyCompensation: basis.monthly.toFixed(2),
        monthlyBasicSalary: basis.monthly.toFixed(2),
      },
      otherDeductions: [],
      ytd: { otherBenefitsExemptUsed: ytd.otherBenefitsExemptUsed },
      ...(minimumWage
        ? {
            minimumWage: {
              daily: minimumWage.daily,
              kasambahayMonthly: minimumWage.kasambahayMonthly,
            },
          }
        : {}),
      rates,
    });
  } else {
    computation = computePayslip({
      employee: {
        payType: 'daily',
        employmentType: e.employmentType,
        baseRate: basis.daily.toFixed(6),
        dailyFactor: e.dailyFactor as DailyFactor,
        govIds: govIds(e),
      },
      frequency,
      attendance: {
        daysWorked: 0,
        regularHours: 0,
        paidLeaveDays: 0,
        absentDays: 0,
        tardyMinutes: 0,
        undertimeMinutes: 0,
        days: [],
        unworkedRegularHolidays: 0,
        unworkedDoubleHolidays: 0,
      },
      allowances: [],
      contributions: { share: 'none' },
      otherDeductions: [],
      ytd: { otherBenefitsExemptUsed: ytd.otherBenefitsExemptUsed },
      rates,
    });
  }

  const loanPayoff = await loanDeductionsFor(db, e.id, run.periodEnd, { payoff: true });
  const baseFinal = {
    lastSalaryNet: computation.netPay,
    basicEarnedYtd: dec(ytd.basicEarned).plus(computation.basicEarned).toFixed(2),
    thirteenthPaidYtd: ytd.thirteenthPaid,
    unusedSilDays: opts.unusedSilDays,
    dailyRate: basis.daily.toFixed(6),
    otherBenefitsExemptUsedYtd: dec(ytd.otherBenefitsExemptUsed)
      .plus(computation.otherBenefitsExemptUsed)
      .toFixed(2),
    outstandingLoans: loanPayoff.map((l) => ({ code: l.code, label: l.label, balance: l.amount })),
    rates,
  };
  // First pass for the 13th-month taxable portion and SIL, then annualize for the tax adjustment.
  const draft = computeFinalPay({ ...baseFinal, taxAdjustment: 0 });
  const annual = annualize({
    annualTaxableCompensation: dec(ytd.taxableIncome)
      .plus(computation.taxableIncome)
      .plus(draft.thirteenthMonth.taxable)
      .plus(lineAmount(draft.earnings, 'sil_conversion')),
    taxWithheldYtd: dec(ytd.withholdingTax).plus(computation.withholdingTax),
    rates,
  });
  const finalPay = computeFinalPay({ ...baseFinal, taxAdjustment: annual.balance });

  await db.delete(payslips).where(eq(payslips.payrollRunId, run.id));
  await db.insert(payslips).values(payslipValues(run.id, e.id, computation, share, { finalPay }));
  await updateRunTotals(db, run.id);
}

// ---------------------------------------------------------------- state machine

export type RunAction = 'submit' | 'return' | 'approve' | 'mark_paid' | 'reopen';

const TRANSITIONS: Record<RunAction, { from: RunRow['status'][]; to: RunRow['status'] }> = {
  submit: { from: ['draft'], to: 'review' },
  return: { from: ['review'], to: 'draft' },
  approve: { from: ['review'], to: 'approved' },
  mark_paid: { from: ['approved'], to: 'paid' },
  reopen: { from: ['approved', 'paid'], to: 'draft' },
};

export function runSnapshot(r: RunRow) {
  return {
    kind: r.kind,
    status: r.status,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    payDate: r.payDate,
    totalGross: r.totalGross,
    totalDeductions: r.totalDeductions,
    totalNet: r.totalNet,
    totalEmployerShares: r.totalEmployerShares,
  };
}

/** Move a run through draft → review → approved → paid (or reopen with a reason). */
export async function transitionRun(
  db: DbOrTx,
  runId: string,
  action: RunAction,
  actorId: string,
  reason: string | null,
): Promise<void> {
  // Lock the row so two clicks cannot both approve.
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.id, runId))
    .for('update')
    .limit(1);
  if (!run) throw notFound('Payroll run');
  const t = TRANSITIONS[action];
  if (!t.from.includes(run.status)) {
    throw conflict(
      'INVALID_TRANSITION',
      `Cannot ${action.replace('_', ' ')} a run that is ${run.status}.`,
    );
  }
  if (action === 'reopen' && !reason)
    throw badRequest('REASON_REQUIRED', 'Reopening requires a reason.');

  if (action === 'submit') {
    // Refresh numbers from the latest attendance/loans before review.
    if (isRegular(run)) await computeRegularRun(db, run.id);
    else if (run.kind === 'twice_weekly') await computeTwiceWeeklyRun(db, run.id);
    else if (run.kind === 'thirteenth_month') await computeThirteenthRun(db, run.id);
  }
  if (action === 'approve') await postRun(db, run);
  if (action === 'reopen') await unpostRun(db, run);

  const now = new Date();
  const [after] = await db
    .update(payrollRuns)
    .set({
      status: t.to,
      ...(action === 'approve' ? { approvedAt: now, approvedBy: actorId } : {}),
      ...(action === 'mark_paid' ? { paidAt: now } : {}),
      ...(action === 'reopen'
        ? { approvedAt: null, approvedBy: null, paidAt: null, lastReopenReason: reason }
        : {}),
    })
    .where(eq(payrollRuns.id, run.id))
    .returning();
  if (!after) throw new Error('Run update returned no row');
  await writeAudit(db, {
    actorId,
    action: `payroll_run.${action}`,
    entity: 'payroll_run',
    entityId: run.id,
    reason,
    before: runSnapshot(run),
    after: runSnapshot(after),
  });
}

/** On approve: post loan payments, consume one-off deductions, and separate final-pay employees. */
async function postRun(db: DbOrTx, run: RunRow): Promise<void> {
  const slips = await db.select().from(payslips).where(eq(payslips.payrollRunId, run.id));
  if (slips.length === 0) throw badRequest('EMPTY_RUN', 'This run has no payslips.');
  const loanLines: { loanId: string; amount: string }[] = [];
  const deductionIds: string[] = [];
  for (const s of slips) {
    const lines = [...s.computation.employeeDeductions, ...(s.finalPay?.deductions ?? [])];
    for (const l of lines) {
      if (l.code.startsWith('loan:')) loanLines.push({ loanId: l.code.slice(5), amount: l.amount });
      if (l.code.startsWith('deduction:')) deductionIds.push(l.code.slice(10));
    }
  }
  const loanIds = [...new Set(loanLines.map((l) => l.loanId))];
  const balances = await loanBalances(db, loanIds);
  if (loanIds.length > 0) {
    const inactive = await db
      .select({ id: loans.id })
      .from(loans)
      .where(and(inArray(loans.id, loanIds), ne(loans.status, 'active')));
    if (inactive.length > 0) {
      throw conflict(
        'STALE_RUN',
        'A loan in this run was cancelled or paid off since it was computed. Return it to draft and submit again.',
      );
    }
  }
  for (const l of loanLines) {
    const balance = dec(balances.get(l.loanId) ?? ZERO);
    if (dec(l.amount).gt(balance)) {
      throw conflict(
        'STALE_RUN',
        'A loan balance changed since this run was computed. Return it to draft and submit again.',
      );
    }
    const after = balance.minus(l.amount);
    balances.set(l.loanId, after.toFixed(2));
    await db.insert(loanLedger).values({
      loanId: l.loanId,
      date: run.payDate,
      payrollRunId: run.id,
      kind: 'payment',
      amount: toMoney(dec(l.amount).negated()),
      balanceAfter: toMoney(after),
      note: 'Payroll deduction',
    });
    if (after.lte(0)) await db.update(loans).set({ status: 'paid' }).where(eq(loans.id, l.loanId));
  }
  if (deductionIds.length > 0) {
    await db
      .update(customDeductions)
      .set({ appliedRunId: run.id })
      .where(
        and(inArray(customDeductions.id, deductionIds), eq(customDeductions.recurrence, 'once')),
      );
  }
  if (run.kind === 'final_pay' && run.finalPayEmployeeId) {
    await db
      .update(employees)
      .set({ status: 'separated', separationDate: run.periodEnd })
      .where(eq(employees.id, run.finalPayEmployeeId));
  }
}

/** On reopen: undo everything postRun did. Separated employees go back to inactive. */
async function unpostRun(db: DbOrTx, run: RunRow): Promise<void> {
  await reverseRunLoanPayments(db, run.id);
  await db
    .update(customDeductions)
    .set({ appliedRunId: null })
    .where(eq(customDeductions.appliedRunId, run.id));
  if (run.kind === 'final_pay' && run.finalPayEmployeeId) {
    await db
      .update(employees)
      .set({ status: 'inactive', separationDate: null })
      .where(eq(employees.id, run.finalPayEmployeeId));
  }
}

/** Recompute a draft run of any kind. */
export async function recomputeRun(db: DbOrTx, runId: string): Promise<void> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) throw notFound('Payroll run');
  if (run.status !== 'draft') throw conflict('RUN_NOT_DRAFT', 'Only draft runs can be recomputed.');
  if (isRegular(run)) return computeRegularRun(db, run.id);
  if (run.kind === 'twice_weekly') return computeTwiceWeeklyRun(db, run.id);
  if (run.kind === 'thirteenth_month') return computeThirteenthRun(db, run.id);
  throw new HttpError(
    409,
    'RECREATE_FINAL_PAY',
    'Final-pay runs are computed once. Delete this draft and create it again to recompute.',
  );
}

/**
 * True when `date` falls inside an approved/paid regular run, so attendance for it is locked.
 * Used by the attendance routes.
 */
export async function isAttendanceLocked(db: DbOrTx, date: string): Promise<boolean> {
  const [row] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        inArray(payrollRuns.kind, [...PAYDAY_KINDS]),
        inArray(payrollRuns.status, [...POSTED]),
        lte(payrollRuns.periodStart, date),
        gte(payrollRuns.periodEnd, date),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export { fullName };
