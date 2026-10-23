import { ATTENDANCE_CSV_COLUMNS, type AttendanceEntryInput } from '@payrollph/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attendance, auditLog } from '../../db/schema';
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
let empNo: string;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  owner = await ownerClient(ctx.app);
  const input = employeeInput();
  const res = await owner.post<{ id: string }>('/api/employees', input);
  empId = res.body.id;
  empNo = input.employeeNo;
});

interface Entry extends AttendanceEntryInput {
  id: string;
  dayType: string;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const entry = (overrides: Partial<AttendanceEntryInput> = {}): AttendanceEntryInput => ({
  employeeId: empId,
  date: '2026-03-02',
  dayTypeOverride: null,
  regularHours: 8,
  otHours: 0,
  ndHours: 0,
  ndOtHours: 0,
  tardyMinutes: 0,
  undertimeMinutes: 0,
  absent: false,
  leaveType: null,
  notes: null,
  ...overrides,
});

function multipart(fileName: string, content: string | Buffer, mime = 'text/csv') {
  const boundary = '----payrollphtest';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function approveFirstMarchCutoff(): Promise<string> {
  const run = await owner.post<{ id: string }>('/api/payroll-runs', {
    kind: 'semi_monthly_1',
    month: '2026-03',
    payDate: '2026-03-15',
    contributionSchedule: 'second_cutoff',
  });
  expect(run.status).toBe(201);
  expect((await owner.post(`/api/payroll-runs/${run.body.id}/submit`)).status).toBe(200);
  expect((await owner.post(`/api/payroll-runs/${run.body.id}/approve`)).status).toBe(200);
  return run.body.id;
}

describe('attendance', () => {
  it('upserts an entry by employee and date, audits it, and lists it with the derived day type', async () => {
    const created = await owner.put<Entry>('/api/attendance', entry());
    expect(created.status).toBe(200);
    expect(created.body.dayType).toBe('ordinary');
    expect(created.body.regularHours).toBe(8);

    const updated = await owner.put<Entry>('/api/attendance', entry({ otHours: 2 }));
    expect(updated.status).toBe(200);
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.otHours).toBe(2);

    // 2026-03-07 is a Saturday, a rest day for the default employee.
    await owner.put('/api/attendance', entry({ date: '2026-03-07' }));
    // 2026-04-09 is Araw ng Kagitingan (regular holiday) in the seeded calendar.
    await owner.put('/api/attendance', entry({ date: '2026-04-09' }));
    // An override wins over the calendar.
    await owner.put('/api/attendance', entry({ date: '2026-03-03', dayTypeOverride: 'rest_day' }));

    const list = await owner.get<Entry[]>(
      `/api/attendance?from=2026-03-01&to=2026-04-30&employeeId=${empId}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.map((e) => [e.date, e.dayType])).toEqual([
      ['2026-03-02', 'ordinary'],
      ['2026-03-03', 'rest_day'],
      ['2026-03-07', 'rest_day'],
      ['2026-04-09', 'regular'],
    ]);

    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.entity, 'attendance'));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'attendance.create',
      'attendance.create',
      'attendance.create',
      'attendance.create',
      'attendance.update',
    ]);
    const update = audits.find((a) => a.action === 'attendance.update');
    expect(update?.before).toMatchObject({ otHours: 0 });
    expect(update?.after).toMatchObject({ otHours: 2 });
  });

  it('rejects invalid entries and unknown employees', async () => {
    const bad = await owner.put<ErrorBody>('/api/attendance', entry({ ndHours: 9 }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const both = await owner.put<ErrorBody>(
      '/api/attendance',
      entry({ absent: true, leaveType: 'sil' }),
    );
    expect(both.status).toBe(400);

    const unknown = await owner.put<ErrorBody>(
      '/api/attendance',
      entry({ employeeId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(unknown.status).toBe(404);

    const range = await owner.get<ErrorBody>('/api/attendance?from=2026-03-10&to=2026-03-01');
    expect(range.status).toBe(400);
  });

  it('deletes an entry with an audit row', async () => {
    const created = await owner.put<Entry>('/api/attendance', entry());
    const res = await owner.del(`/api/attendance/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(await ctx.db.select().from(attendance)).toHaveLength(0);
    const [audit] = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'attendance.delete'));
    expect(audit?.before).toMatchObject({ date: '2026-03-02', regularHours: 8 });
    expect((await owner.del(`/api/attendance/${created.body.id}`)).status).toBe(404);
  });

  it('lets viewers read but not write', async () => {
    const created = await owner.put<Entry>('/api/attendance', entry());
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get('/api/attendance?from=2026-03-01&to=2026-03-31')).status).toBe(200);
    expect((await viewer.put('/api/attendance', entry({ otHours: 1 }))).status).toBe(403);
    expect((await viewer.del(`/api/attendance/${created.body.id}`)).status).toBe(403);
    const { body, headers } = multipart('a.csv', ATTENDANCE_CSV_COLUMNS.join(','));
    const imp = await viewer.request('POST', '/api/attendance/import', body, { headers });
    expect(imp.status).toBe(403);
  });

  it('locks dates covered by an approved run (409 ATTENDANCE_LOCKED) until it is reopened', async () => {
    const early = await owner.put<Entry>('/api/attendance', entry({ date: '2026-03-02' }));
    const runId = await approveFirstMarchCutoff();

    const edit = await owner.put<ErrorBody>(
      '/api/attendance',
      entry({ date: '2026-03-02', otHours: 3 }),
    );
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('ATTENDANCE_LOCKED');
    const create = await owner.put<ErrorBody>('/api/attendance', entry({ date: '2026-03-15' }));
    expect(create.status).toBe(409);
    const del = await owner.del<ErrorBody>(`/api/attendance/${early.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('ATTENDANCE_LOCKED');

    // The second cutoff is still open.
    expect((await owner.put('/api/attendance', entry({ date: '2026-03-16' }))).status).toBe(200);

    const reopen = await owner.post(`/api/payroll-runs/${runId}/reopen`, {
      reason: 'Fix overtime for March 2',
    });
    expect(reopen.status).toBe(200);
    expect(
      (await owner.put('/api/attendance', entry({ date: '2026-03-02', otHours: 3 }))).status,
    ).toBe(200);
  });

  it('serves the CSV template', async () => {
    const res = await owner.get<string>('/api/attendance/template.csv');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    expect(res.body.trim()).toBe(ATTENDANCE_CSV_COLUMNS.join(','));
  });

  it('imports valid CSV rows and reports bad ones by row number', async () => {
    const lockedEmp = await owner.post<{ id: string }>('/api/employees', employeeInput());
    expect(lockedEmp.status).toBe(201);
    await approveFirstMarchCutoff();

    const csv = [
      ATTENDANCE_CSV_COLUMNS.join(','),
      // row 2: good
      `${empNo},2026-03-16,8,2,0,0,5,0,,,,"late, traffic"`,
      // row 3: good, absent
      `${empNo},2026-03-17,0,0,0,0,0,0,yes,,,`,
      // row 4: unknown employee
      `NOPE-1,2026-03-18,8,0,0,0,0,0,,,,`,
      // row 5: bad hours (nd > regular)
      `${empNo},2026-03-18,4,0,6,0,0,0,,,,`,
      // row 6: bad date
      `${empNo},18/03/2026,8,0,0,0,0,0,,,,`,
      // row 7: duplicate of row 2
      `${empNo},2026-03-16,8,0,0,0,0,0,,,,`,
      // row 8: locked by the approved first cutoff
      `${empNo},2026-03-05,8,0,0,0,0,0,,,,`,
      // row 9: good, leave and override
      `${empNo},2026-03-19,0,0,0,0,0,0,no,sil,special,`,
      // row 10: bad leave type
      `${empNo},2026-03-20,0,0,0,0,0,0,,vacation,,`,
    ].join('\r\n');
    const { body, headers } = multipart('dtr.csv', csv);
    const res = await owner.request<{
      imported: number;
      errors: { row: number; message: string }[];
    }>('POST', '/api/attendance/import', body, { headers });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(3);
    expect(res.body.errors.map((e) => e.row)).toEqual([4, 5, 6, 7, 8, 10]);
    expect(res.body.errors[0]?.message).toMatch(/Unknown employee_no "NOPE-1"/);
    expect(res.body.errors[1]?.message).toMatch(/ndHours/);
    expect(res.body.errors[3]?.message).toMatch(/Duplicate of row 2/);
    expect(res.body.errors[4]?.message).toMatch(/locked/);

    const rows = await owner.get<Entry[]>(
      `/api/attendance?from=2026-03-16&to=2026-03-31&employeeId=${empId}`,
    );
    expect(rows.body.map((r) => [r.date, r.dayType, r.absent, r.leaveType, r.notes])).toEqual([
      ['2026-03-16', 'ordinary', false, null, 'late, traffic'],
      ['2026-03-17', 'ordinary', true, null, null],
      ['2026-03-19', 'special', false, 'sil', null],
    ]);
    expect(rows.body[0]?.tardyMinutes).toBe(5);

    const [audit] = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'attendance.import'));
    expect(audit?.after).toEqual({ rows: 9, imported: 3, errors: 6 });
  });

  it('rejects a CSV with the wrong header', async () => {
    const { body, headers } = multipart('dtr.csv', 'employee,date\r\nX,2026-03-01');
    const res = await owner.request<ErrorBody>('POST', '/api/attendance/import', body, { headers });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_CSV_HEADER');
  });
});
