import { RATES_V1 } from '@payrollph/shared';
import { parse } from 'csv-parse/sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attendance, loans, settings, statutoryRates } from '../../db/schema';
import { recordDisbursement } from '../../services/loans';
import {
  createTestContext,
  employeeInput,
  headerList,
  ownerClient,
  resetDb,
  viewerClient,
  type ApiResponse,
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
  await ctx.db.update(settings).set({
    ownerTin: '111-222-333-000',
    ownerSssEmployerNo: '03-9999999-0',
    ownerPhilhealthEmployerNo: '01-000000001-1',
    ownerPagibigEmployerNo: '2000-0000-0001',
  });
});

interface Created {
  id: string;
  employeeNo: string;
}

/** Parse a CSV download (BOM stripped) into rows. */
function csvRows(res: ApiResponse<unknown>): string[][] {
  expect(res.status).toBe(200);
  expect(String(res.headers['content-type'])).toContain('text/csv');
  return parse(res.raw, { bom: true }) as string[][];
}

/** Rows as objects keyed by header. */
function csvObjects(res: ApiResponse<unknown>): Record<string, string>[] {
  const [header, ...rows] = csvRows(res);
  if (!header) throw new Error('No header row');
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function createEmployee(overrides: Parameters<typeof employeeInput>[0]): Promise<Created> {
  const res = await owner.post<Created>('/api/employees', employeeInput(overrides));
  expect(res.status).toBe(201);
  return res.body;
}

async function createRun(
  kind: 'semi_monthly_1' | 'semi_monthly_2' | 'monthly',
  month: string,
  payDate: string,
): Promise<string> {
  const res = await owner.post<{ id: string }>('/api/payroll-runs', {
    kind,
    month,
    payDate,
    contributionSchedule: 'split',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function post(id: string): Promise<void> {
  expect((await owner.post(`/api/payroll-runs/${id}/submit`)).status).toBe(200);
  expect((await owner.post(`/api/payroll-runs/${id}/approve`)).status).toBe(200);
}

/**
 * March 2026, split contributions, two semi-monthly cutoffs posted:
 *  - A (Abad): ₱20,000/month, bank payout, company loan 5,000 @ 1,000 per run
 *  - B (Bautista): ₱60,000/month, GCash payout (SSS MSC capped at 35,000 → MPF tier)
 * Plus a DRAFT monthly March run that must not count.
 */
async function marchScenario() {
  const a = await createEmployee({
    lastName: 'Abad',
    firstName: 'Ana',
    middleName: 'Cruz',
    sex: 'female',
    baseRate: '20000.00',
    sssNo: '34-1234567-8',
    payout: {
      method: 'bank',
      bankName: 'BPI',
      accountName: 'Ana C. Abad',
      accountNumber: '1234567890',
    },
  });
  const b = await createEmployee({
    lastName: 'Bautista',
    firstName: 'Ben',
    baseRate: '60000.00',
    sssNo: '34-7654321-0',
    payout: { method: 'gcash', bankName: null, accountName: 'Ben', accountNumber: '09171234567' },
  });
  const [loan] = await ctx.db
    .insert(loans)
    .values({
      employeeId: a.id,
      type: 'company',
      reference: 'CL-1',
      principal: '5000.00',
      amortization: '1000.00',
      startDate: '2026-03-01',
    })
    .returning();
  if (!loan) throw new Error('loan insert failed');
  await recordDisbursement(ctx.db, loan);

  const run1 = await createRun('semi_monthly_1', '2026-03', '2026-03-15');
  await post(run1);
  const run2 = await createRun('semi_monthly_2', '2026-03', '2026-03-31');
  await post(run2);
  const draft = await createRun('monthly', '2026-03', '2026-03-31');
  return { a, b, run1, run2, draft };
}

describe('remittance reports', () => {
  it('SSS R-3: one row per employee summed over the month, MPF split out, totals row', async () => {
    await marchScenario();
    const res = await owner.get('/api/reports/sss?month=2026-03&format=csv');
    expect(String(res.headers['content-disposition'])).toBe(
      'attachment; filename="sss-2026-03.csv"',
    );
    expect(csvRows(res)).toEqual([
      [
        'SS number',
        'Last name',
        'First name',
        'Middle name',
        'MSC',
        'EE share',
        'ER share',
        'EC',
        'MPF EE',
        'MPF ER',
        'Total',
      ],
      // 20,000 → MSC 20,000: EE 1,000, ER 2,000, EC 30 (draft monthly run NOT added).
      [
        '34-1234567-8',
        'Abad',
        'Ana',
        'Cruz',
        '20000.00',
        '1000.00',
        '2000.00',
        '30.00',
        '0.00',
        '0.00',
        '3030.00',
      ],
      // 60,000 → MSC 35,000 = 20,000 regular + 15,000 MPF: EE 1,000+750, ER 2,000+1,500, EC 30.
      [
        '34-7654321-0',
        'Bautista',
        'Ben',
        '',
        '35000.00',
        '1000.00',
        '2000.00',
        '30.00',
        '750.00',
        '1500.00',
        '5280.00',
      ],
      ['TOTAL', '', '', '', '', '2000.00', '4000.00', '60.00', '750.00', '1500.00', '8310.00'],
    ]);
  });

  it('masks gov IDs for viewers', async () => {
    await marchScenario();
    const viewer = await viewerClient(ctx.app, owner);
    const rows = csvObjects(await viewer.get('/api/reports/sss?month=2026-03&format=csv'));
    expect(rows[0]?.['SS number']).toBe('••••5678');
  });

  it('PhilHealth RF-1 and Pag-IBIG MCRF', async () => {
    await marchScenario();
    const ph = csvRows(await owner.get('/api/reports/philhealth?month=2026-03&format=csv'));
    expect(ph[0]).toEqual([
      'PhilHealth no.',
      'Surname',
      'Given name',
      'Middle name',
      'Birth date',
      'Sex',
      'Monthly basic salary',
      'Personal share (EE)',
      'Employer share (ER)',
      'Total',
    ]);
    expect(ph[1]).toEqual([
      '12-345678901-2',
      'Abad',
      'Ana',
      'Cruz',
      '1990-01-15',
      'F',
      '20000.00',
      '500.00',
      '500.00',
      '1000.00',
    ]);
    expect(ph[2]?.slice(6)).toEqual(['60000.00', '1500.00', '1500.00', '3000.00']);
    expect(ph[3]).toEqual(['TOTAL', '', '', '', '', '', '', '2000.00', '2000.00', '4000.00']);

    const pi = csvObjects(await owner.get('/api/reports/pagibig?month=2026-03&format=csv'));
    expect(pi[0]).toMatchObject({
      'Pag-IBIG MID no.': '1234-5678-9012',
      'Period covered': '202603',
      // Base capped at 10,000 → 2% / 2%.
      'Monthly compensation': '10000.00',
      'EE share': '200.00',
      'ER share': '200.00',
      Total: '400.00',
    });
    expect(pi[2]).toMatchObject({ 'EE share': '400.00', 'ER share': '400.00', Total: '800.00' });
  });

  it('excludes draft runs: a month with only a draft run is empty', async () => {
    await createEmployee({ baseRate: '20000.00' });
    await createRun('semi_monthly_1', '2026-04', '2026-04-15');
    const rows = csvRows(await owner.get('/api/reports/sss?month=2026-04&format=csv'));
    expect(rows).toHaveLength(2); // header + TOTAL
    expect(rows[1]?.[0]).toBe('TOTAL');
    expect(rows[1]?.[10]).toBe('0.00');
  });

  it('every report renders a PDF', async () => {
    const { run2 } = await marchScenario();
    const urls = [
      '/api/reports/sss?month=2026-03&format=pdf',
      '/api/reports/philhealth?month=2026-03&format=pdf',
      '/api/reports/pagibig?month=2026-03&format=pdf',
      '/api/reports/bir-1601c?month=2026-03&format=pdf',
      '/api/reports/bir-2316?year=2026&format=pdf',
      `/api/reports/payroll-register?runId=${run2}&format=pdf`,
      '/api/reports/loans?format=pdf',
      '/api/reports/thirteenth-month?year=2026&format=pdf',
      `/api/reports/disbursement?runId=${run2}&format=pdf`,
    ];
    for (const url of urls) {
      const res = await owner.get(url);
      expect(res.status, url).toBe(200);
      expect(String(res.headers['content-type']), url).toContain('application/pdf');
      expect(res.raw.subarray(0, 4).toString('latin1'), url).toBe('%PDF');
      expect(String(res.headers['content-disposition']), url).toMatch(/\.pdf"$/);
    }
  });

  it('validates the month and format', async () => {
    expect((await owner.get('/api/reports/sss?month=2026-13&format=csv')).status).toBe(400);
    expect((await owner.get('/api/reports/sss?month=2026-03&format=xls')).status).toBe(400);
  });
});

describe('BIR reports', () => {
  it('1601-C monthly figures', async () => {
    await marchScenario();
    const res = await owner.get('/api/reports/bir-1601c?month=2026-03&format=csv');
    const rows = csvRows(res);
    expect(rows[0]).toEqual(['Item', 'Amount']);
    const fig = Object.fromEntries(rows.slice(1).map(([k, v]) => [k, v]));
    expect(fig).toEqual({
      'Total amount of compensation': '80000.00',
      'Non-taxable: statutory minimum wage (MWEs)': '0.00',
      'Non-taxable: holiday pay, overtime, night differential, hazard pay (MWEs)': '0.00',
      'Non-taxable: 13th month pay and other benefits (exempt part)': '0.00',
      'Non-taxable: de minimis benefits': '0.00',
      // A 1,000+500+200, B 1,750+1,500+200.
      'Non-taxable: SSS, PhilHealth, Pag-IBIG employee contributions': '5150.00',
      'Non-taxable: other non-taxable compensation': '0.00',
      'Total non-taxable compensation': '5150.00',
      'Total taxable compensation': '74850.00',
      // B per cutoff: 937.50 + 20% × (28,275 − 16,666.67) = 3,259.17; A below the threshold.
      'Total taxes withheld': '6518.34',
    });
  });

  it('1601-C: minimum wage earner pay (from attendance) is exempt', async () => {
    const c = await createEmployee({
      payType: 'daily',
      baseRate: '695.00',
      dailyFactor: 313,
      restDays: [7],
    });
    const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];
    const days2 = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'];
    await ctx.db.insert(attendance).values([
      ...days.map((date, i) => ({
        employeeId: c.id,
        date,
        regularHours: '8',
        otHours: i === 0 ? '2' : '0',
      })),
      ...days2.map((date) => ({ employeeId: c.id, date, regularHours: '8' })),
    ]);
    await post(await createRun('semi_monthly_1', '2026-03', '2026-03-15'));
    await post(await createRun('semi_monthly_2', '2026-03', '2026-03-31'));

    const rows = csvRows(await owner.get('/api/reports/bir-1601c?month=2026-03&format=csv'));
    const fig = Object.fromEntries(rows.slice(1).map(([k, v]) => [k, v]));
    // 10 days × 695.
    expect(fig['Non-taxable: statutory minimum wage (MWEs)']).toBe('6950.00');
    const ot = Number(
      fig['Non-taxable: holiday pay, overtime, night differential, hazard pay (MWEs)'],
    );
    expect(ot).toBeGreaterThan(0);
    expect(fig['Non-taxable: SSS, PhilHealth, Pag-IBIG employee contributions']).toBe('0.00');
    expect(fig['Total taxable compensation']).toBe('0.00');
    expect(fig['Total taxes withheld']).toBe('0.00');
    expect(fig['Total amount of compensation']).toBe(fig['Total non-taxable compensation']);
  });

  it('2316: annualizes with year-end rates and shows the refund/payable difference', async () => {
    const { b } = await marchScenario();
    const res = await owner.get('/api/reports/bir-2316?year=2026&format=csv');
    expect(String(res.headers['content-disposition'])).toContain('bir-2316-2026.csv');
    const rows = csvObjects(res);
    expect(rows).toHaveLength(3); // A, B, TOTAL
    expect(rows[0]).toMatchObject({
      'Last name': 'Abad',
      TIN: '123-456-789-000',
      'Total amount of compensation': '20000.00',
      'Total taxable compensation': '18300.00',
      'Tax due (annualized)': '0.00',
      'Tax withheld': '0.00',
      'Tax still payable / (refund)': '0.00',
    });
    // B: taxable 2 × 28,275 = 56,550 < 250,000 → no annual tax; everything withheld is refunded.
    expect(rows[1]).toMatchObject({
      'Last name': 'Bautista',
      'Total amount of compensation': '60000.00',
      'Non-taxable: SSS, PhilHealth, Pag-IBIG employee contributions': '3450.00',
      'Total taxable compensation': '56550.00',
      'Tax due (annualized)': '0.00',
      'Tax withheld': '6518.34',
      'Tax still payable / (refund)': '-6518.34',
    });
    expect(rows[2]).toMatchObject({ 'Employee no.': 'TOTAL', 'Tax withheld': '6518.34' });

    const one = await owner.get(`/api/reports/bir-2316?year=2026&format=csv&employeeId=${b.id}`);
    expect(String(one.headers['content-disposition'])).toContain(
      `bir-2316-2026-${b.employeeNo}.csv`,
    );
    const oneRows = csvObjects(one);
    expect(oneRows).toHaveLength(1);
    expect(oneRows[0]?.['Last name']).toBe('Bautista');

    const missing = await owner.get(
      '/api/reports/bir-2316?year=2026&format=csv&employeeId=00000000-0000-4000-8000-000000000000',
    );
    expect(missing.status).toBe(404);
  });
});

describe('payroll register, loans, 13th month', () => {
  it('payroll register: one row per payslip, columns add up', async () => {
    const { run1 } = await marchScenario();
    const res = await owner.get(`/api/reports/payroll-register?runId=${run1}&format=csv`);
    expect(String(res.headers['content-disposition'])).toBe(
      'attachment; filename="payroll-register-2026-03-01-semi-monthly-1.csv"',
    );
    const rows = csvObjects(res);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      Employee: 'Abad, Ana Cruz',
      Basic: '10000.00',
      Gross: '10000.00',
      'SSS EE': '500.00',
      'PhilHealth EE': '250.00',
      'Pag-IBIG EE': '100.00',
      'Withholding tax': '0.00',
      Loans: '1000.00',
      'Net pay': '8150.00',
      'SSS ER': '1000.00',
      'SSS EC': '15.00',
      'Total ER': '1365.00',
    });
    expect(rows[1]).toMatchObject({
      Basic: '30000.00',
      'SSS EE': '875.00',
      'PhilHealth EE': '750.00',
      'Withholding tax': '3259.17',
      'Net pay': '25015.83',
      'Total ER': '2615.00',
    });
    expect(rows[2]).toMatchObject({
      'Emp. no.': 'TOTAL',
      Gross: '40000.00',
      'Net pay': '33165.83',
    });
  });

  it('payroll register works for drafts and labels them DRAFT', async () => {
    const a = await createEmployee({ baseRate: '20000.00' });
    // Overtime on an ordinary day shows in the premiums column.
    await ctx.db
      .insert(attendance)
      .values({ employeeId: a.id, date: '2026-04-06', regularHours: '8', otHours: '2' });
    const draft = await createRun('semi_monthly_1', '2026-04', '2026-04-15');
    const csv = csvObjects(
      await owner.get(`/api/reports/payroll-register?runId=${draft}&format=csv`),
    );
    expect(Number(csv[0]?.['Premiums / OT / ND'])).toBeGreaterThan(0);
    const pdf = await owner.get(`/api/reports/payroll-register?runId=${draft}&format=pdf`);
    expect(pdf.raw.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.raw.toString('latin1')).toContain('(DRAFT - Payroll Register');
  });

  it('loan ledgers with balance = sum of ledger amounts', async () => {
    await marchScenario();
    const rows = csvObjects(await owner.get('/api/reports/loans?format=csv&status=active'));
    expect(rows.map((r) => [r['Entry kind'], r['Entry amount'], r['Balance after']])).toEqual([
      ['disbursement', '5000.00', '5000.00'],
      ['payment', '-1000.00', '4000.00'],
      ['payment', '-1000.00', '3000.00'],
    ]);
    expect(rows[0]).toMatchObject({ Reference: 'CL-1', 'Current balance': '3000.00' });
    const paid = csvRows(await owner.get('/api/reports/loans?format=csv&status=paid'));
    expect(paid).toHaveLength(1);
  });

  it('13th month: accrued, paid, balance, exempt vs taxable against the ceiling', async () => {
    await marchScenario();
    let rows = csvObjects(await owner.get('/api/reports/thirteenth-month?year=2026&format=csv'));
    expect(rows[0]).toMatchObject({
      'Basic earned YTD': '20000.00',
      '13th accrued': '1666.66', // 2 × round(10,000 / 12)
      '13th paid': '0.00',
      'Balance due': '1666.66',
      '13th exempt part': '1666.66',
      '13th taxable part': '0.00',
    });
    expect(rows[1]).toMatchObject({ '13th accrued': '5000.00', '13th exempt part': '5000.00' });

    // Test-local rates copy with a tiny ceiling: B's 5,000 splits 3,000 exempt / 2,000 taxable.
    await ctx.db.update(statutoryRates).set({
      data: { ...RATES_V1, benefits: { ...RATES_V1.benefits, otherBenefitsCeiling: '3000' } },
    });
    rows = csvObjects(await owner.get('/api/reports/thirteenth-month?year=2026&format=csv'));
    expect(rows[1]).toMatchObject({
      '13th exempt part': '3000.00',
      '13th taxable part': '2000.00',
    });
    expect(rows[2]).toMatchObject({ 'Emp. no.': 'TOTAL', '13th taxable part': '2000.00' });
  });
});

describe('disbursement', () => {
  it('owner gets full account numbers, filtered by method', async () => {
    const { run2 } = await marchScenario();
    const res = await owner.get(`/api/reports/disbursement?runId=${run2}&method=bank`);
    expect(headerList(res.headers['content-disposition'])[0]).toBe(
      'attachment; filename="disbursement-2026-03-31-bank.csv"',
    );
    expect(csvRows(res)).toEqual([
      [
        'Employee no.',
        'Name',
        'Method',
        'Bank',
        'Account name',
        'Account number',
        'Amount',
        'Reference',
      ],
      [
        expect.stringMatching(/^T-/),
        'Abad, Ana Cruz',
        'Bank',
        'BPI',
        'Ana C. Abad',
        '1234567890',
        '8150.00',
        'PAYROLL 2026-03-16 TO 2026-03-31',
      ],
      ['TOTAL', '', '', '', '', '', '8150.00', ''],
    ]);
    const all = csvRows(await owner.get(`/api/reports/disbursement?runId=${run2}`));
    expect(all).toHaveLength(4);
    expect(all[2]?.[5]).toBe('09171234567');
  });

  it('is owner-only and needs a posted run', async () => {
    const { run2, draft } = await marchScenario();
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get(`/api/reports/disbursement?runId=${run2}`)).status).toBe(403);
    expect((await owner.get(`/api/reports/disbursement?runId=${draft}`)).status).toBe(409);
    // Viewers can still read the other reports.
    expect(
      (await viewer.get(`/api/reports/payroll-register?runId=${run2}&format=csv`)).status,
    ).toBe(200);
  });
});
