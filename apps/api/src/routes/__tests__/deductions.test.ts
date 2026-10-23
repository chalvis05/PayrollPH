import type { CustomDeductionInput } from '@payrollph/shared';
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

interface Deduction extends CustomDeductionInput {
  id: string;
  active: boolean;
  appliedRunId: string | null;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const input = (overrides: Partial<CustomDeductionInput & { active: boolean }> = {}) => ({
  employeeId: empId,
  label: 'Uniform',
  amount: '500',
  recurrence: 'once' as const,
  startDate: '2026-03-01',
  endDate: null,
  ...overrides,
});

describe('custom deductions', () => {
  it('creates, lists, edits and deletes with audit rows', async () => {
    const created = await owner.post<Deduction>('/api/deductions', input());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ amount: '500.00', active: true, appliedRunId: null });

    await owner.post(
      '/api/deductions',
      input({ label: 'Canteen', recurrence: 'every_run', active: false }),
    );
    const all = await owner.get<Deduction[]>(`/api/deductions?employeeId=${empId}`);
    expect(all.body).toHaveLength(2);
    const active = await owner.get<Deduction[]>('/api/deductions?active=true');
    expect(active.body.map((d) => d.label)).toEqual(['Uniform']);

    const edited = await owner.put<Deduction>(
      `/api/deductions/${created.body.id}`,
      input({ amount: '650.50', endDate: '2026-06-30' }),
    );
    expect(edited.status).toBe(200);
    expect(edited.body.amount).toBe('650.50');

    expect((await owner.del(`/api/deductions/${created.body.id}`)).status).toBe(200);
    expect((await owner.get(`/api/deductions/${created.body.id}`)).status).toBe(404);

    const audits = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entity, 'custom_deduction'));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'deduction.create',
      'deduction.create',
      'deduction.delete',
      'deduction.update',
    ]);
  });

  it('validates input', async () => {
    expect((await owner.post('/api/deductions', input({ amount: '-5.00' }))).status).toBe(400);
    expect((await owner.post('/api/deductions', input({ label: '' }))).status).toBe(400);
    const badRange = await owner.post<ErrorBody>(
      '/api/deductions',
      input({ startDate: '2026-03-10', endDate: '2026-03-01' }),
    );
    expect(badRange.status).toBe(400);
    const noEmp = await owner.post(
      '/api/deductions',
      input({ employeeId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(noEmp.status).toBe(404);
  });

  it('forbids viewers from changing deductions', async () => {
    const created = await owner.post<Deduction>('/api/deductions', input());
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get('/api/deductions')).status).toBe(200);
    expect((await viewer.post('/api/deductions', input())).status).toBe(403);
    expect((await viewer.del(`/api/deductions/${created.body.id}`)).status).toBe(403);
  });

  it('freezes a one-off once an approved run applies it, and frees it on reopen', async () => {
    const { body: ded } = await owner.post<Deduction>('/api/deductions', input());
    const run = await owner.post<{ id: string }>('/api/payroll-runs', {
      kind: 'semi_monthly_1',
      month: '2026-03',
      payDate: '2026-03-15',
      contributionSchedule: 'second_cutoff',
    });
    await owner.post(`/api/payroll-runs/${run.body.id}/submit`);
    expect((await owner.post(`/api/payroll-runs/${run.body.id}/approve`)).status).toBe(200);

    const applied = await owner.get<Deduction>(`/api/deductions/${ded.id}`);
    expect(applied.body.appliedRunId).toBe(run.body.id);

    const edit = await owner.put<ErrorBody>(`/api/deductions/${ded.id}`, input({ amount: '1.00' }));
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('DEDUCTION_APPLIED');
    const del = await owner.del<ErrorBody>(`/api/deductions/${ded.id}`);
    expect(del.status).toBe(409);

    await owner.post(`/api/payroll-runs/${run.body.id}/reopen`, {
      reason: 'Correct the uniform fee',
    });
    expect((await owner.put(`/api/deductions/${ded.id}`, input({ amount: '1.00' }))).status).toBe(
      200,
    );
  });
});
