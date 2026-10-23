import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attendance, auditLog, employees, loanLedger, loans } from '../../db/schema';
import { recordDisbursement } from '../../services/loans';
import { isAttendanceLocked } from '../../services/payrollRun';
import {
  createTestContext,
  employeeInput,
  ownerClient,
  resetDb,
  viewerClient,
  type TestClient,
  type TestContext,
} from '../../test/helpers';

let ctx: TestContext;
let owner: TestClient;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  owner = await ownerClient(ctx.app);
});

// 2026-03-01 is a Sunday: Mar 2 Mon, Mar 7 Sat, Mar 8 Sun, Mar 19 Thu, Mar 20 Fri (Eid, seeded
// as a regular holiday), Apr 1 Wed, Apr 2-3 Maundy Thu/Good Fri, Apr 9 Thu (Araw ng Kagitingan).

interface Line {
  code: string;
  amount: string;
  category: string;
}
interface Computation {
  grossPay: string;
  netPay: string;
  taxableIncome: string;
  withholdingTax: string;
  earnings: Line[];
  employeeDeductions: Line[];
  employerShares: Line[];
  warnings: { code: string }[];
  basicEarned: string;
}
interface RunDetail {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  totals: { gross: string; net: string };
  payslips: { id: string; employeeId: string; net: string; warnings: { code: string }[] }[];
}
interface PayslipDetail {
  computation: Computation;
  finalPay: {
    thirteenthMonth: { amount: string; exempt: string; taxable: string };
    earnings: Line[];
    deductions: Line[];
    lastSalaryNet: string;
    netFinalPay: string;
  } | null;
  ytd: { gross: string; net: string; sssEe: string };
}

const amount = (lines: Line[], code: string) => lines.find((l) => l.code === code)?.amount;

async function addEmployee(overrides: Parameters<typeof employeeInput>[0] = {}): Promise<string> {
  const res = await owner.post<{ id: string }>('/api/employees', employeeInput(overrides));
  if (res.status !== 201) throw new Error(`employee create failed ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function dtr(
  employeeId: string,
  date: string,
  values: Partial<typeof attendance.$inferInsert> = {},
): Promise<void> {
  await ctx.db.insert(attendance).values({ employeeId, date, regularHours: '8', ...values });
}

async function createRun(
  kind: string,
  month: string,
  schedule = 'second_cutoff',
): Promise<RunDetail> {
  const payDate = kind === 'semi_monthly_1' ? `${month}-15` : `${month}-28`;
  const res = await owner.post<RunDetail>('/api/payroll-runs', {
    kind,
    month,
    payDate,
    contributionSchedule: schedule,
  });
  if (res.status !== 201)
    throw new Error(`run create failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function approve(runId: string): Promise<RunDetail> {
  expect((await owner.post(`/api/payroll-runs/${runId}/submit`)).status).toBe(200);
  const res = await owner.post<RunDetail>(`/api/payroll-runs/${runId}/approve`);
  expect(res.status).toBe(200);
  return res.body;
}

async function slip(run: RunDetail, employeeId: string): Promise<PayslipDetail> {
  const id = run.payslips.find((p) => p.employeeId === employeeId)?.id;
  const res = await owner.get<PayslipDetail>(`/api/payslips/${id}`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('regular payroll runs', () => {
  it('monthly ₱20,000 staff: 1st cutoff has no contributions, 2nd deducts the full month', async () => {
    const id = await addEmployee({ baseRate: '20000.00', dailyFactor: 261 });

    const run1 = await createRun('semi_monthly_1', '2026-03');
    expect(run1).toMatchObject({
      status: 'draft',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-15',
    });
    const s1 = (await slip(run1, id)).computation;
    expect(s1.grossPay).toBe('10000.00');
    expect(s1.employeeDeductions).toEqual([]);
    expect(s1.netPay).toBe('10000.00');

    const run2 = await createRun('semi_monthly_2', '2026-03');
    expect(run2.periodEnd).toBe('2026-03-31');
    const s2 = (await slip(run2, id)).computation;
    // SSS MSC 20,000: EE 5% = 1,000, ER 10% = 2,000, EC 30. PhilHealth 5% of 20,000 = 1,000 split
    // 500/500. Pag-IBIG 2% of the 10,000 cap = 200/200.
    expect(amount(s2.employeeDeductions, 'sss_ee')).toBe('1000.00');
    expect(amount(s2.employerShares, 'sss_er')).toBe('2000.00');
    expect(amount(s2.employerShares, 'sss_ec')).toBe('30.00');
    expect(amount(s2.employeeDeductions, 'philhealth_ee')).toBe('500.00');
    expect(amount(s2.employeeDeductions, 'pagibig_ee')).toBe('200.00');
    // Taxable 10,000 − 1,700 = 8,300, below the 10,416.67 semi-monthly threshold.
    expect(s2.taxableIncome).toBe('8300.00');
    expect(s2.withholdingTax).toBe('0.00');
    expect(s2.netPay).toBe('8300.00');
  });

  it('split schedule deducts half the contributions on each cutoff', async () => {
    const id = await addEmployee({ baseRate: '20000.00' });
    const s1 = (await slip(await createRun('semi_monthly_1', '2026-03', 'split'), id)).computation;
    const s2 = (await slip(await createRun('semi_monthly_2', '2026-03', 'split'), id)).computation;
    expect(amount(s1.employeeDeductions, 'sss_ee')).toBe('500.00');
    expect(amount(s2.employeeDeductions, 'sss_ee')).toBe('500.00');
    expect(amount(s1.employerShares, 'sss_ec')).toBe('15.00');
  });

  it('split schedule: daily staff second cutoff takes the actual month total minus the first half', async () => {
    const id = await addEmployee({
      payType: 'daily',
      baseRate: '800.00',
      dailyFactor: 313,
      restDays: [7],
    });
    for (const d of ['02', '03', '04', '05', '06', '07', '09', '10', '11', '12', '13', '14']) {
      await dtr(id, `2026-03-${d}`);
    }
    for (const d of ['16', '17', '18', '19', '21']) await dtr(id, `2026-03-${d}`);
    // 1st cutoff: no actual month yet → rate estimate 800×313/12 = 20,866.67 → MSC 21,000
    // (20,000 regular + 1,000 MPF) → EE 1,050 → first half 525.
    const s1 = (await slip(await createRun('semi_monthly_1', '2026-03', 'split'), id)).computation;
    expect(s1.grossPay).toBe('9600.00');
    expect(amount(s1.employeeDeductions, 'sss_ee')).toBe('525.00');
    // 2nd cutoff: gross 4,000 + 800 holiday = 4,800; month 14,400 → MSC 14,500 → EE 725.
    // Remainder 725 − 525 = 200, so the month adds up to the actual 725.
    const s2 = (await slip(await createRun('semi_monthly_2', '2026-03', 'split'), id)).computation;
    expect(s2.grossPay).toBe('4800.00');
    expect(amount(s2.employeeDeductions, 'sss_ee')).toBe('200.00');
  });

  it('adds rest-day and overtime premiums from the DTR and withholds tax above the threshold', async () => {
    const id = await addEmployee({ baseRate: '20000.00', dailyFactor: 261, restDays: [6, 7] });
    await dtr(id, '2026-03-02', { otHours: '2' }); // Monday, 2h OT
    await dtr(id, '2026-03-07'); // Saturday = rest day, 8h
    const s = (await slip(await createRun('semi_monthly_1', '2026-03'), id)).computation;
    // hourly = 20,000 × 12 / 261 / 8 = 114.9425…
    // rest day (factor 261 does not pay rest days): 8 × 114.9425 × 1.30 = 1,195.40
    // OT ordinary: 2 × 114.9425 × 1.25 = 287.36
    expect(amount(s.earnings, 'rest_day_work')).toBe('1195.40');
    expect(amount(s.earnings, 'ordinary_ot')).toBe('287.36');
    expect(s.grossPay).toBe('11482.76');
    // 15% × (11,482.76 − 250,000/24) = 0.15 × 1,066.0933 = 159.91
    expect(s.withholdingTax).toBe('159.91');
  });

  it('daily staff: basic per day worked, unworked regular holiday paid only when eligible', async () => {
    const eligible = await addEmployee({
      payType: 'daily',
      baseRate: '800.00',
      dailyFactor: 313,
      restDays: [7],
    });
    const notEligible = await addEmployee({
      payType: 'daily',
      baseRate: '800.00',
      dailyFactor: 313,
      restDays: [7],
    });
    for (const d of ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-21']) {
      await dtr(eligible, d);
    }
    for (const d of ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-21']) {
      await dtr(notEligible, d); // absent on the 19th, the workday before the holiday
    }
    const run = await createRun('semi_monthly_2', '2026-03');
    const a = (await slip(run, eligible)).computation;
    expect(amount(a.earnings, 'basic')).toBe('4000.00');
    expect(amount(a.earnings, 'regular_holiday_unworked')).toBe('800.00');
    expect(a.grossPay).toBe('4800.00');
    // SSS on actual monthly earnings 4,800 → MSC 5,000: EE 250. PhilHealth on 800×313/12 =
    // 20,866.67 → 1,043.33 premium, EE 521.67. Pag-IBIG 200.
    expect(amount(a.employeeDeductions, 'sss_ee')).toBe('250.00');
    expect(amount(a.employeeDeductions, 'philhealth_ee')).toBe('521.67');
    expect(amount(a.employeeDeductions, 'pagibig_ee')).toBe('200.00');
    expect(a.netPay).toBe('3828.33');

    const b = (await slip(run, notEligible)).computation;
    expect(amount(b.earnings, 'regular_holiday_unworked')).toBeUndefined();
  });

  it('flags missing gov IDs and below-minimum wages in the review warnings', async () => {
    const id = await addEmployee({
      payType: 'daily',
      baseRate: '600.00',
      dailyFactor: 313,
      restDays: [7],
      tin: null,
    });
    const run = await createRun('semi_monthly_1', '2026-03');
    const codes = run.payslips.find((p) => p.employeeId === id)?.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['below_minimum_wage', 'missing_gov_ids']));
  });

  it('refuses a second run for the same period', async () => {
    await createRun('semi_monthly_1', '2026-03');
    const dup = await owner.post<{ error: { code: string } }>('/api/payroll-runs', {
      kind: 'semi_monthly_1',
      month: '2026-03',
      payDate: '2026-03-15',
      contributionSchedule: 'second_cutoff',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('RUN_EXISTS');
  });
});

describe('run lifecycle', () => {
  it('draft → review → approved → paid, locks attendance, reopen needs a reason and is audited', async () => {
    await addEmployee();
    const run = await createRun('semi_monthly_1', '2026-03');

    const early = await owner.post<{ error: { code: string } }>(
      `/api/payroll-runs/${run.id}/approve`,
    );
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_TRANSITION');

    const approved = await approve(run.id);
    expect(approved.status).toBe('approved');
    expect(await isAttendanceLocked(ctx.db, '2026-03-10')).toBe(true);
    expect(await isAttendanceLocked(ctx.db, '2026-03-20')).toBe(false);

    expect((await owner.post(`/api/payroll-runs/${run.id}/recompute`)).status).toBe(409);
    expect((await owner.del(`/api/payroll-runs/${run.id}`)).status).toBe(409);

    const paid = await owner.post<RunDetail>(`/api/payroll-runs/${run.id}/mark-paid`);
    expect(paid.body.status).toBe('paid');

    const noReason = await owner.post(`/api/payroll-runs/${run.id}/reopen`, { reason: '' });
    expect(noReason.status).toBe(400);
    const reopened = await owner.post<RunDetail>(`/api/payroll-runs/${run.id}/reopen`, {
      reason: 'Wrong overtime for Juan',
    });
    expect(reopened.body.status).toBe('draft');
    expect(await isAttendanceLocked(ctx.db, '2026-03-10')).toBe(false);

    const entries = await ctx.db.select().from(auditLog).where(eq(auditLog.entityId, run.id));
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'payroll_run.create',
        'payroll_run.submit',
        'payroll_run.approve',
        'payroll_run.mark_paid',
        'payroll_run.reopen',
      ]),
    );
    const reopen = entries.find((e) => e.action === 'payroll_run.reopen');
    expect(reopen?.reason).toBe('Wrong overtime for Juan');
    expect(reopen?.before).toMatchObject({ status: 'paid' });
    expect(reopen?.after).toMatchObject({ status: 'draft' });

    expect((await owner.del(`/api/payroll-runs/${run.id}`)).status).toBe(200);
  });

  it('viewers can read runs but not create or approve them', async () => {
    await addEmployee();
    const run = await createRun('semi_monthly_1', '2026-03');
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get(`/api/payroll-runs/${run.id}`)).status).toBe(200);
    expect((await viewer.post(`/api/payroll-runs/${run.id}/submit`)).status).toBe(403);
  });

  it('deducts loan amortization, posts it to the ledger on approve, and reverses it on reopen', async () => {
    const id = await addEmployee();
    const [loan] = await ctx.db
      .insert(loans)
      .values({
        employeeId: id,
        type: 'sss',
        principal: '3000.00',
        amortization: '1000.00',
        deductOn: 'every_run',
        startDate: '2026-01-01',
      })
      .returning();
    if (!loan) throw new Error('no loan');
    await recordDisbursement(ctx.db, loan);

    const run = await createRun('semi_monthly_1', '2026-03');
    const s = (await slip(run, id)).computation;
    expect(amount(s.employeeDeductions, `loan:${loan.id}`)).toBe('1000.00');
    expect(s.netPay).toBe('9000.00');

    await approve(run.id);
    const ledger = await ctx.db.select().from(loanLedger).where(eq(loanLedger.loanId, loan.id));
    expect(ledger.map((l) => l.amount).sort()).toEqual(['-1000.00', '3000.00']);

    await owner.post(`/api/payroll-runs/${run.id}/reopen`, { reason: 'Recheck loan' });
    const after = await ctx.db.select().from(loanLedger).where(eq(loanLedger.loanId, loan.id));
    expect(after.map((l) => l.amount)).toEqual(['3000.00']);
  });
});

describe('stale runs', () => {
  it('refuses to approve when a loan was cancelled after the run was submitted', async () => {
    const id = await addEmployee();
    const [loan] = await ctx.db
      .insert(loans)
      .values({
        employeeId: id,
        type: 'company',
        principal: '2000.00',
        amortization: '500.00',
        deductOn: 'every_run',
        startDate: '2026-01-01',
      })
      .returning();
    if (!loan) throw new Error('no loan');
    await recordDisbursement(ctx.db, loan);
    const run = await createRun('semi_monthly_1', '2026-03');
    expect((await owner.post(`/api/payroll-runs/${run.id}/submit`)).status).toBe(200);
    await ctx.db.update(loans).set({ status: 'cancelled' }).where(eq(loans.id, loan.id));
    const res = await owner.post<{ error: { code: string } }>(
      `/api/payroll-runs/${run.id}/approve`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_RUN');
    const ledger = await ctx.db.select().from(loanLedger).where(eq(loanLedger.loanId, loan.id));
    expect(ledger).toHaveLength(1); // only the disbursement; nothing was posted
  });
});

describe('13th month', () => {
  it('pays the accrued 1/12 of basic from posted runs, half or full', async () => {
    const id = await addEmployee({ baseRate: '20000.00' });
    await approve((await createRun('semi_monthly_1', '2026-03')).id);
    await approve((await createRun('semi_monthly_2', '2026-03')).id);

    // Each cutoff accrues round(10,000 / 12) = 833.33.
    const half = await owner.post<RunDetail>('/api/payroll-runs/thirteenth-month', {
      year: 2026,
      mode: 'half',
      payDate: '2026-06-15',
    });
    expect(half.status).toBe(201);
    expect((await slip(half.body, id)).computation.grossPay).toBe('833.33');
    await approve(half.body.id);

    const full = await owner.post<RunDetail>('/api/payroll-runs/thirteenth-month', {
      year: 2026,
      mode: 'full',
      payDate: '2026-12-15',
    });
    const s = (await slip(full.body, id)).computation;
    // 1,666.66 accrued − 833.33 already paid.
    expect(s.grossPay).toBe('833.33');
    expect(s.taxableIncome).toBe('0.00');
  });
});

describe('final pay', () => {
  it('computes last salary, prorated 13th, unused SIL; approve separates, reopen reverts', async () => {
    const id = await addEmployee({ baseRate: '20000.00', dailyFactor: 261, restDays: [6, 7] });
    await approve((await createRun('semi_monthly_1', '2026-03')).id);
    await approve((await createRun('semi_monthly_2', '2026-03')).id);

    const res = await owner.post<RunDetail>('/api/final-pay', {
      employeeId: id,
      separationDate: '2026-04-10',
      payDate: '2026-04-30',
      unusedSilDays: 3,
      reason: 'Resigned',
    });
    expect(res.status).toBe(201);
    expect(res.body.periodStart).toBe('2026-04-01');
    const detail = await slip(res.body, id);
    // Workdays Apr 1–10 excluding Sat/Sun: 1,2,3,6,7,8,9,10 = 8 (regular holidays are paid).
    // 8 × 20,000 × 12 / 261 = 7,356.32. April contributions not yet deducted → full month:
    // 1,000 + 500 + 200 = 1,700 → last salary net 5,656.32.
    expect(amount(detail.computation.earnings, 'basic')).toBe('7356.32');
    expect(detail.finalPay?.lastSalaryNet).toBe('5656.32');
    // 13th: (20,000 + 7,356.32) / 12 = 2,279.69, fully exempt. SIL 3 × 919.54 = 2,758.62.
    expect(detail.finalPay?.thirteenthMonth).toEqual({
      amount: '2279.69',
      exempt: '2279.69',
      taxable: '0.00',
    });
    expect(amount(detail.finalPay?.earnings ?? [], 'sil_conversion')).toBe('2758.62');
    expect(detail.finalPay?.netFinalPay).toBe('10694.63');

    await approve(res.body.id);
    const [sep] = await ctx.db.select().from(employees).where(eq(employees.id, id));
    expect(sep).toMatchObject({ status: 'separated', separationDate: '2026-04-10' });

    await owner.post(`/api/payroll-runs/${res.body.id}/reopen`, { reason: 'Wrong SIL count' });
    const [back] = await ctx.db.select().from(employees).where(eq(employees.id, id));
    expect(back).toMatchObject({ status: 'inactive', separationDate: null });
  });
});
