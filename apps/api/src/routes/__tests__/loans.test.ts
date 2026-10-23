import type { LoanInput } from '@payrollph/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../db/schema';
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
let empId: string;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  owner = await ownerClient(ctx.app);
  const res = await owner.post<{ id: string }>('/api/employees', employeeInput());
  empId = res.body.id;
});

interface LedgerRow {
  kind: string;
  amount: string;
  balanceAfter: string;
  payrollRunId: string | null;
  note: string | null;
}
interface LoanDetail {
  id: string;
  balance: string;
  status: string;
  amortization: string;
  principal: string;
  reference: string | null;
  ledger: LedgerRow[];
}
interface ErrorBody {
  error: { code: string; message: string };
}
interface RunDetail {
  id: string;
  payslips: { id: string; net: string }[];
}
interface PayslipDetail {
  computation: { employeeDeductions: { code: string; amount: string }[] };
}

const loanInput = (overrides: Partial<LoanInput> = {}): LoanInput => ({
  employeeId: empId,
  type: 'company',
  reference: 'CL-1',
  principal: '5000.00',
  amortization: '1000.00',
  deductOn: 'every_run',
  startDate: '2026-03-01',
  notes: null,
  ...overrides,
});

describe('loans', () => {
  it('creates a loan with a disbursement row and lists it with its balance', async () => {
    const created = await owner.post<LoanDetail>('/api/loans', loanInput());
    expect(created.status).toBe(201);
    expect(created.body.balance).toBe('5000.00');
    expect(created.body.status).toBe('active');
    expect(created.body.ledger).toEqual([
      expect.objectContaining({ kind: 'disbursement', amount: '5000.00', balanceAfter: '5000.00' }),
    ]);

    const list = await owner.get<LoanDetail[]>(`/api/loans?employeeId=${empId}&status=active`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]?.balance).toBe('5000.00');
    expect((await owner.get<LoanDetail[]>('/api/loans?status=paid')).body).toHaveLength(0);

    const [audit] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'loan.create'));
    expect(audit?.after).toMatchObject({ principal: '5000.00' });
  });

  it('validates loans', async () => {
    const zeroAmort = await owner.post<ErrorBody>(
      '/api/loans',
      loanInput({ amortization: '0.00' }),
    );
    expect(zeroAmort.status).toBe(400);
    const zeroPrincipal = await owner.post<ErrorBody>('/api/loans', loanInput({ principal: '0' }));
    expect(zeroPrincipal.status).toBe(400);
    const badMoney = await owner.post<ErrorBody>('/api/loans', loanInput({ principal: '1.234' }));
    expect(badMoney.status).toBe(400);
    const noEmp = await owner.post<ErrorBody>(
      '/api/loans',
      loanInput({ employeeId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(noEmp.status).toBe(404);
  });

  it('edits only the editable fields', async () => {
    const created = await owner.post<LoanDetail>('/api/loans', loanInput());
    const res = await owner.put<LoanDetail>(`/api/loans/${created.body.id}`, {
      reference: 'CL-1A',
      amortization: '1500',
      deductOn: 'second_cutoff',
      notes: 'Raised',
      principal: '99999.00',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reference: 'CL-1A',
      amortization: '1500.00',
      principal: '5000.00',
      balance: '5000.00',
    });
    const [audit] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'loan.update'));
    expect(audit?.before).toMatchObject({ amortization: '1000.00' });
    expect(audit?.after).toMatchObject({ amortization: '1500.00' });
  });

  it('records signed adjustments, marks paid at zero and refuses negative balances', async () => {
    const { body: loan } = await owner.post<LoanDetail>('/api/loans', loanInput());
    const pay = await owner.post<LoanDetail>(`/api/loans/${loan.id}/adjustments`, {
      date: '2026-03-10',
      amount: '-4999.99',
      note: 'Paid in cash',
    });
    expect(pay.status).toBe(200);
    expect(pay.body.balance).toBe('0.01');

    const tooMuch = await owner.post<ErrorBody>(`/api/loans/${loan.id}/adjustments`, {
      date: '2026-03-11',
      amount: '-0.02',
      note: 'Over',
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('BALANCE_BELOW_ZERO');

    const zero = await owner.post<LoanDetail>(`/api/loans/${loan.id}/adjustments`, {
      date: '2026-03-11',
      amount: '-0.01',
      note: 'Final centavo',
    });
    expect(zero.body.balance).toBe('0.00');
    expect(zero.body.status).toBe('paid');

    const correction = await owner.post<LoanDetail>(`/api/loans/${loan.id}/adjustments`, {
      date: '2026-03-12',
      amount: '250.00',
      note: 'Bounced cheque',
    });
    expect(correction.body.balance).toBe('250.00');
    expect(correction.body.status).toBe('active');
    expect(correction.body.ledger.map((l) => [l.kind, l.amount, l.balanceAfter])).toEqual([
      ['disbursement', '5000.00', '5000.00'],
      ['adjustment', '-4999.99', '0.01'],
      ['adjustment', '-0.01', '0.00'],
      ['adjustment', '250.00', '250.00'],
    ]);

    const zeroAmount = await owner.post(`/api/loans/${loan.id}/adjustments`, {
      date: '2026-03-12',
      amount: '0.00',
      note: 'Nothing',
    });
    expect(zeroAmount.status).toBe(400);
  });

  it('cancels a loan with no payroll payments', async () => {
    const { body: loan } = await owner.post<LoanDetail>('/api/loans', loanInput());
    const res = await owner.post<LoanDetail>(`/api/loans/${loan.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect((await owner.post<ErrorBody>(`/api/loans/${loan.id}/cancel`)).status).toBe(409);
    const adj = await owner.post<ErrorBody>(`/api/loans/${loan.id}/adjustments`, {
      date: '2026-03-12',
      amount: '-1.00',
      note: 'x',
    });
    expect(adj.status).toBe(409);
  });

  it('forbids viewers from changing loans', async () => {
    const { body: loan } = await owner.post<LoanDetail>('/api/loans', loanInput());
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get(`/api/loans/${loan.id}`)).status).toBe(200);
    expect((await viewer.post('/api/loans', loanInput())).status).toBe(403);
    expect((await viewer.post(`/api/loans/${loan.id}/cancel`)).status).toBe(403);
    expect(
      (
        await viewer.post(`/api/loans/${loan.id}/adjustments`, {
          date: '2026-03-12',
          amount: '-1.00',
          note: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('flows through an approved payroll run and back out on reopen', async () => {
    const { body: loan } = await owner.post<LoanDetail>('/api/loans', loanInput());
    const run = await owner.post<RunDetail>('/api/payroll-runs', {
      kind: 'semi_monthly_1',
      month: '2026-03',
      payDate: '2026-03-15',
      contributionSchedule: 'second_cutoff',
    });
    expect(run.status).toBe(201);
    const slipId = run.body.payslips[0]?.id;
    expect(slipId).toBeDefined();
    const slip = await owner.get<PayslipDetail>(`/api/payslips/${slipId}`);
    expect(slip.body.computation.employeeDeductions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: `loan:${loan.id}`, amount: '1000.00' }),
      ]),
    );

    await owner.post(`/api/payroll-runs/${run.body.id}/submit`);
    expect((await owner.post(`/api/payroll-runs/${run.body.id}/approve`)).status).toBe(200);

    const after = await owner.get<LoanDetail>(`/api/loans/${loan.id}`);
    expect(after.body.balance).toBe('4000.00');
    expect(after.body.ledger[1]).toMatchObject({
      kind: 'payment',
      amount: '-1000.00',
      balanceAfter: '4000.00',
      payrollRunId: run.body.id,
    });

    // Payroll has deducted it, so it can no longer be cancelled.
    const cancel = await owner.post<ErrorBody>(`/api/loans/${loan.id}/cancel`);
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('LOAN_HAS_PAYMENTS');

    const reopen = await owner.post(`/api/payroll-runs/${run.body.id}/reopen`, {
      reason: 'Wrong overtime',
    });
    expect(reopen.status).toBe(200);
    const reverted = await owner.get<LoanDetail>(`/api/loans/${loan.id}`);
    expect(reverted.body.balance).toBe('5000.00');
    expect(reverted.body.ledger.map((l) => l.kind)).toEqual(['disbursement']);
  });
});
