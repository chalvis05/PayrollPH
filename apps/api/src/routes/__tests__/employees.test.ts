import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, employees, settings } from '../../db/schema';
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

interface Detail {
  id: string;
  sssNo: string | null;
  tin: string | null;
  payout: { accountNumber: string | null };
  missingGovIds: string[];
  sensitiveMasked: boolean;
  allowances: { name: string }[];
  status: string;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe('employees', () => {
  it('creates an employee with gov IDs encrypted at rest and returns them to the owner', async () => {
    const input = employeeInput({
      payout: { method: 'bank', bankName: 'BPI', accountName: 'Juan', accountNumber: '1234567890' },
      allowances: [{ name: 'Rice', amount: '1000.00', kind: 'de_minimis', deMinimisType: 'rice' }],
    });
    const res = await owner.post<Detail>('/api/employees', input);
    expect(res.status).toBe(201);
    expect(res.body.sssNo).toBe(input.sssNo);
    expect(res.body.payout.accountNumber).toBe('1234567890');
    expect(res.body.allowances).toHaveLength(1);

    const [row] = await ctx.db.select().from(employees).where(eq(employees.id, res.body.id));
    expect(row?.sssNoEnc).toMatch(/^v1\./);
    expect(row?.sssNoEnc).not.toContain('1234567');
    expect(row?.accountNumberEnc).toMatch(/^v1\./);
  });

  it('masks gov IDs and account numbers for viewers', async () => {
    const created = await owner.post<Detail>('/api/employees', employeeInput());
    const viewer = await viewerClient(ctx.app, owner);
    const res = await viewer.get<Detail>(`/api/employees/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.sensitiveMasked).toBe(true);
    expect(res.body.sssNo).toBe('••••5678');
    expect(res.body.tin).toBe('••••9000');
  });

  it('lists missing gov IDs', async () => {
    await owner.post('/api/employees', employeeInput({ tin: null, pagibigNo: null }));
    const list = await owner.get<{ missingGovIds: string[] }[]>('/api/employees');
    expect(list.body[0]?.missingGovIds).toEqual(['pagibig', 'tin']);
  });

  it('enforces the active-employee cap with a clear 409', async () => {
    await ctx.db.update(settings).set({ employeeCap: 2 });
    expect((await owner.post('/api/employees', employeeInput())).status).toBe(201);
    expect((await owner.post('/api/employees', employeeInput())).status).toBe(201);
    const third = await owner.post<ErrorBody>('/api/employees', employeeInput());
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('EMPLOYEE_CAP_EXCEEDED');
    expect(third.body.error.message).toMatch(/cap is 2/);

    // Inactive employees do not count.
    const inactive = await owner.post('/api/employees', employeeInput({ status: 'inactive' }));
    expect(inactive.status).toBe(201);
  });

  it('blocks reactivation over the cap', async () => {
    await ctx.db.update(settings).set({ employeeCap: 1 });
    await owner.post('/api/employees', employeeInput());
    const inactive = await owner.post<Detail>(
      '/api/employees',
      employeeInput({ status: 'inactive' }),
    );
    const res = await owner.put<ErrorBody>(
      `/api/employees/${inactive.body.id}`,
      employeeInput({ status: 'active' }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPLOYEE_CAP_EXCEEDED');
  });

  it('maps the DB trigger to the same 409 when the app check is bypassed', async () => {
    await ctx.db.update(settings).set({ employeeCap: 1 });
    await owner.post('/api/employees', employeeInput());
    // Insert straight into the table, as a bug or manual SQL might.
    const err: unknown = await ctx.db
      .execute(
        sql`insert into employees (employee_no, first_name, last_name, region,
        employment_type, pay_type, base_rate, daily_factor, hire_date)
        values ('RAW-1','Raw','Insert','NCR','regular','daily',700,313,'2026-01-01')`,
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    // Drizzle wraps the driver error; the Postgres message is on the cause.
    const cause = (err as { cause?: { message?: string; code?: string } } | null)?.cause;
    expect(cause?.code).toBe('P0001');
    expect(cause?.message).toMatch(/^EMPLOYEE_CAP_EXCEEDED/);
  });

  it('updates an employee, replacing allowances, and audits before/after with masked IDs', async () => {
    const created = await owner.post<Detail>(
      '/api/employees',
      employeeInput({
        allowances: [{ name: 'Transport', amount: '500.00', kind: 'taxable', deMinimisType: null }],
      }),
    );
    const res = await owner.put<Detail>(
      `/api/employees/${created.body.id}`,
      employeeInput({ baseRate: '25000.00', allowances: [] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.allowances).toHaveLength(0);

    const entries = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, created.body.id));
    const update = entries.find((e) => e.action === 'employee.update');
    expect(update).toBeDefined();
    expect(JSON.stringify(update?.before)).toContain('20000.00');
    expect(JSON.stringify(update?.after)).toContain('25000.00');
    expect(JSON.stringify(update)).not.toContain('34-1234567-8');
  });

  it('rejects invalid input', async () => {
    const res = await owner.post<ErrorBody>('/api/employees', {
      ...employeeInput(),
      dailyFactor: 300,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate employee number', async () => {
    const input = employeeInput();
    await owner.post('/api/employees', input);
    const dup = await owner.post<ErrorBody>('/api/employees', { ...input });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
  });

  it('deletes an employee with no history', async () => {
    const created = await owner.post<Detail>('/api/employees', employeeInput());
    expect((await owner.del(`/api/employees/${created.body.id}`)).status).toBe(200);
    expect((await owner.get(`/api/employees/${created.body.id}`)).status).toBe(404);
  });
});
