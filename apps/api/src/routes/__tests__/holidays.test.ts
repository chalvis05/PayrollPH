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

interface Holiday {
  id: string;
  date: string;
  name: string;
  type: string;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe('holidays', () => {
  it('lists the seeded calendar by year', async () => {
    const all = await owner.get<Holiday[]>('/api/holidays?year=2026');
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThan(10);
    expect(all.body[0]?.date).toBe('2026-01-01');
    expect((await owner.get<Holiday[]>('/api/holidays?year=2031')).body).toEqual([]);
    expect((await owner.get('/api/holidays?year=abc')).status).toBe(400);
  });

  it('creates, edits and deletes holidays with audit rows', async () => {
    const created = await owner.post<Holiday>('/api/holidays', {
      date: '2026-07-27',
      name: 'Local Founding Day',
      type: 'special_non_working',
    });
    expect(created.status).toBe(201);

    const dup = await owner.post<ErrorBody>('/api/holidays', {
      date: '2026-07-27',
      name: 'Again',
      type: 'regular',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');

    const edited = await owner.put<Holiday>(`/api/holidays/${created.body.id}`, {
      date: '2026-07-28',
      name: 'Local Founding Day',
      type: 'special_working',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ date: '2026-07-28', type: 'special_working' });

    expect((await owner.del(`/api/holidays/${created.body.id}`)).status).toBe(200);
    expect((await owner.del(`/api/holidays/${created.body.id}`)).status).toBe(404);

    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.entity, 'holiday'));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['holiday.create', 'holiday.update', 'holiday.delete']),
    );
    const update = audits.find((a) => a.action === 'holiday.update');
    expect(update?.before).toMatchObject({ date: '2026-07-27' });
    expect(update?.after).toMatchObject({ date: '2026-07-28' });
  });

  it('validates input', async () => {
    const res = await owner.post<ErrorBody>('/api/holidays', {
      date: '27-07-2026',
      name: '',
      type: 'fiesta',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('forbids viewers from changing holidays', async () => {
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get('/api/holidays')).status).toBe(200);
    const res = await viewer.post('/api/holidays', {
      date: '2026-07-27',
      name: 'X',
      type: 'regular',
    });
    expect(res.status).toBe(403);
  });

  it('refuses changes to dates inside an approved run', async () => {
    await owner.post('/api/employees', employeeInput());
    const run = await owner.post<{ id: string }>('/api/payroll-runs', {
      kind: 'semi_monthly_1',
      month: '2026-03',
      payDate: '2026-03-15',
      contributionSchedule: 'second_cutoff',
    });
    await owner.post(`/api/payroll-runs/${run.body.id}/submit`);
    expect((await owner.post(`/api/payroll-runs/${run.body.id}/approve`)).status).toBe(200);

    const add = await owner.post<ErrorBody>('/api/holidays', {
      date: '2026-03-10',
      name: 'Too late',
      type: 'regular',
    });
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('HOLIDAY_LOCKED');

    // Moving an open holiday into the locked period is refused too.
    const open = await owner.post<Holiday>('/api/holidays', {
      date: '2026-03-25',
      name: 'Open',
      type: 'special_non_working',
    });
    expect(open.status).toBe(201);
    const move = await owner.put<ErrorBody>(`/api/holidays/${open.body.id}`, {
      date: '2026-03-05',
      name: 'Open',
      type: 'special_non_working',
    });
    expect(move.status).toBe(409);
  });
});
