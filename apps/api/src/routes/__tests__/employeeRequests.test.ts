import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, employees, settings } from '../../db/schema';
import {
  createTestContext,
  employeeInput,
  ownerClient,
  resetDb,
  TestClient,
  viewerClient,
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

let encoderSeq = 0;
async function encoderClient(): Promise<{ client: TestClient; email: string }> {
  encoderSeq += 1;
  const email = `encoder${encoderSeq}@example.test`;
  const created = await owner.post('/api/users', {
    name: `Encoder ${encoderSeq}`,
    email,
    password: 'encoder-password-123',
    role: 'encoder',
  });
  expect(created.status).toBe(201);
  const client = new TestClient(ctx.app);
  const login = await client.post('/api/auth/login', { email, password: 'encoder-password-123' });
  expect(login.status).toBe(200);
  return { client, email };
}

interface RequestDto {
  id: string;
  kind: string;
  status: string;
  employeeId: string | null;
  resultEmployeeId: string | null;
  decisionNote: string | null;
  summary: { employeeNo: string; fullName: string };
}
interface RequestDetail extends RequestDto {
  proposed: { sssNo: string | null; baseRate: string };
  changes: { field: string; from: string | null; to: string | null }[];
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe('encoder role', () => {
  it('cannot change employees directly, but can read them with gov IDs masked', async () => {
    const created = await owner.post<{ id: string }>('/api/employees', employeeInput());
    const { client: enc } = await encoderClient();
    expect((await enc.post('/api/employees', employeeInput())).status).toBe(403);
    expect((await enc.put(`/api/employees/${created.body.id}`, employeeInput())).status).toBe(403);
    const detail = await enc.get<{ sssNo: string; sensitiveMasked: boolean }>(
      `/api/employees/${created.body.id}`,
    );
    expect(detail.body).toMatchObject({ sssNo: '••••5678', sensitiveMasked: true });
  });

  it('viewers cannot use change requests at all', async () => {
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get('/api/employee-requests')).status).toBe(403);
    expect((await viewer.post('/api/employee-requests', { data: employeeInput() })).status).toBe(
      403,
    );
  });
});

describe('new-employee requests', () => {
  it('stay pending until the owner approves; approval creates the employee and audits both people', async () => {
    const { client: enc, email } = await encoderClient();
    const input = employeeInput({ firstName: 'Proposed' });
    const submitted = await enc.post<RequestDto>('/api/employee-requests', { data: input });
    expect(submitted.status).toBe(201);
    expect(submitted.body).toMatchObject({ kind: 'create', status: 'pending', employeeId: null });

    // Nothing created yet, and the owner sees it waiting.
    expect(await ctx.db.select().from(employees)).toHaveLength(0);
    const dash = await owner.get<{ pendingRequests: number }>('/api/dashboard');
    expect(dash.body.pendingRequests).toBe(1);

    // The owner sees the real values; the encoder sees them masked.
    const ownerView = await owner.get<RequestDetail>(`/api/employee-requests/${submitted.body.id}`);
    expect(ownerView.body.proposed.sssNo).toBe(input.sssNo);
    const encView = await enc.get<RequestDetail>(`/api/employee-requests/${submitted.body.id}`);
    expect(encView.body.proposed.sssNo).toBe('••••5678');

    const approved = await owner.post<RequestDto>(
      `/api/employee-requests/${submitted.body.id}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    const id = approved.body.resultEmployeeId;
    const [row] = await ctx.db
      .select()
      .from(employees)
      .where(eq(employees.id, id ?? ''));
    expect(row?.firstName).toBe('Proposed');

    const entries = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, id ?? ''));
    const create = entries.find((e) => e.action === 'employee.create');
    expect(create?.reason).toContain(email);

    const again = await owner.post<ErrorBody>(
      `/api/employee-requests/${submitted.body.id}/approve`,
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_PENDING');
  });

  it('rejects masked values and duplicate employee numbers on new employees', async () => {
    const { client: enc } = await encoderClient();
    const masked = await enc.post<ErrorBody>('/api/employee-requests', {
      data: employeeInput({ sssNo: '••••5678' }),
    });
    expect(masked.status).toBe(400);
    expect(masked.body.error.code).toBe('MASKED_VALUE');

    const existing = employeeInput();
    await owner.post('/api/employees', existing);
    const dup = await enc.post<ErrorBody>('/api/employee-requests', {
      data: employeeInput({ employeeNo: existing.employeeNo }),
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
  });

  it('still enforces the employee cap at approval time', async () => {
    await ctx.db.update(settings).set({ employeeCap: 1 });
    await owner.post('/api/employees', employeeInput());
    const { client: enc } = await encoderClient();
    const submitted = await enc.post<RequestDto>('/api/employee-requests', {
      data: employeeInput(),
    });
    const res = await owner.post<ErrorBody>(`/api/employee-requests/${submitted.body.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPLOYEE_CAP_EXCEEDED');
    const list = await owner.get<RequestDto[]>('/api/employee-requests?status=pending');
    expect(list.body.map((r) => r.id)).toContain(submitted.body.id);
  });
});

describe('edit requests', () => {
  it('keeps real gov IDs when the encoder leaves them masked, and applies the other changes', async () => {
    const original = employeeInput({ baseRate: '20000.00' });
    const created = await owner.post<{ id: string }>('/api/employees', original);
    const { client: enc } = await encoderClient();
    const seen = await enc.get<Record<string, unknown>>(`/api/employees/${created.body.id}`);
    const {
      id: _i,
      createdAt: _c,
      updatedAt: _u,
      sensitiveMasked: _m,
      missingGovIds: _g,
      ...asShown
    } = seen.body;
    const submitted = await enc.post<RequestDto>('/api/employee-requests', {
      employeeId: created.body.id,
      data: { ...asShown, baseRate: '25000.00' },
    });
    expect(submitted.status).toBe(201);

    const detail = await owner.get<RequestDetail>(`/api/employee-requests/${submitted.body.id}`);
    expect(detail.body.changes).toEqual([
      { field: 'baseRate', label: 'Base rate', from: '20000.00', to: '25000.00' },
    ]);

    const dup = await enc.post<ErrorBody>('/api/employee-requests', {
      employeeId: created.body.id,
      data: { ...asShown, baseRate: '26000.00' },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('REQUEST_PENDING');

    expect((await owner.post(`/api/employee-requests/${submitted.body.id}/approve`)).status).toBe(
      200,
    );
    const after = await owner.get<{ baseRate: string; sssNo: string; tin: string }>(
      `/api/employees/${created.body.id}`,
    );
    expect(after.body).toMatchObject({
      baseRate: '25000.00',
      sssNo: original.sssNo,
      tin: original.tin,
    });
  });

  it('can be rejected with a reason (employee unchanged) or cancelled by the requester', async () => {
    const created = await owner.post<{ id: string }>('/api/employees', employeeInput());
    const { client: enc } = await encoderClient();
    const r1 = await enc.post<RequestDto>('/api/employee-requests', {
      employeeId: created.body.id,
      data: employeeInput({ baseRate: '99999.00' }),
    });
    expect(
      (await owner.post(`/api/employee-requests/${r1.body.id}/reject`, { reason: '' })).status,
    ).toBe(400);
    const rejected = await owner.post<RequestDto>(`/api/employee-requests/${r1.body.id}/reject`, {
      reason: 'Rate not agreed',
    });
    expect(rejected.body).toMatchObject({ status: 'rejected', decisionNote: 'Rate not agreed' });
    const emp = await owner.get<{ baseRate: string }>(`/api/employees/${created.body.id}`);
    expect(emp.body.baseRate).toBe('20000.00');

    const r2 = await enc.post<RequestDto>('/api/employee-requests', {
      employeeId: created.body.id,
      data: employeeInput({ baseRate: '21000.00' }),
    });
    const cancelled = await enc.post<RequestDto>(`/api/employee-requests/${r2.body.id}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('encoders only see their own requests and cannot approve', async () => {
    const { client: a } = await encoderClient();
    const { client: b } = await encoderClient();
    const mine = await a.post<RequestDto>('/api/employee-requests', { data: employeeInput() });
    expect((await b.get(`/api/employee-requests/${mine.body.id}`)).status).toBe(404);
    expect((await b.get<RequestDto[]>('/api/employee-requests')).body).toHaveLength(0);
    expect((await a.post(`/api/employee-requests/${mine.body.id}/approve`)).status).toBe(403);
  });
});
