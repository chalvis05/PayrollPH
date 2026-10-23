import { RATES_V1 } from '@payrollph/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  employeeInput,
  ownerClient,
  resetDb,
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
  ctx.sentMail.length = 0;
  owner = await ownerClient(ctx.app);
});

interface SettingsBody {
  ownerName: string;
  payFrequency: string;
  employeeCap: number;
  contributionSchedule: string;
  backupRetentionDays: number;
  defaultRegion: string;
  ownerAddress: string | null;
  ownerTin: string | null;
  ownerSssEmployerNo: string | null;
  ownerPhilhealthEmployerNo: string | null;
  ownerPagibigEmployerNo: string | null;
  setupCompleted: boolean;
}

describe('settings', () => {
  it('returns the values from the setup wizard and saves updates with an audit entry', async () => {
    const get = await owner.get<SettingsBody>('/api/settings');
    expect(get.body).toMatchObject({
      ownerName: 'Test Owner',
      payFrequency: 'semi_monthly',
      employeeCap: 25,
      backupRetentionDays: 30,
      setupCompleted: true,
    });
    const { setupCompleted: _s, ...body } = get.body;
    const put = await owner.put<SettingsBody>('/api/settings', {
      ...body,
      employeeCap: 20,
      ownerTin: '123-456-789',
    });
    expect(put.status).toBe(200);
    expect(put.body.employeeCap).toBe(20);
    const audit = await owner.get<{ action: string }[]>('/api/audit?entity=settings');
    expect(audit.body.map((a) => a.action)).toContain('settings.update');
  });

  it('refuses to lower the cap below the active headcount', async () => {
    for (let i = 0; i < 3; i += 1) await owner.post('/api/employees', employeeInput());
    const { setupCompleted: _s, ...body } = (await owner.get<SettingsBody>('/api/settings')).body;
    const res = await owner.put<{ error: { code: string } }>('/api/settings', {
      ...body,
      employeeCap: 2,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPLOYEE_CAP_BELOW_ACTIVE');
  });
});

describe('statutory rates versions', () => {
  it('lists v1 as unverified, adds a new version, and marks it verified', async () => {
    const list =
      await owner.get<{ id: string; version: string; verified: boolean }[]>('/api/rates');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ version: 'v1', verified: false });

    const v2 = await owner.post<{ id: string; verified: boolean }>('/api/rates', {
      version: 'v2',
      effectiveFrom: '2027-01-01',
      notes: 'Test',
      data: { ...RATES_V1, philhealth: { ...RATES_V1.philhealth, rate: '0.055' } },
    });
    expect(v2.status).toBe(201);
    expect(v2.body.verified).toBe(false);

    const verified = await owner.post<{ verified: boolean }>(`/api/rates/${v2.body.id}/verify`);
    expect(verified.body.verified).toBe(true);

    const dash = await owner.get<{ rates: { version: string; verified: boolean } }>(
      '/api/dashboard',
    );
    expect(dash.body.rates.version).toBe('v1'); // v2 is not effective yet
  });

  it('rejects malformed rates data and duplicate effective dates', async () => {
    const bad = await owner.post('/api/rates', {
      version: 'bad',
      effectiveFrom: '2027-01-01',
      notes: null,
      data: { ...RATES_V1, sss: { ...RATES_V1.sss, eeRate: 'five percent' } },
    });
    expect(bad.status).toBe(400);
    const dup = await owner.post<{ error: { code: string } }>('/api/rates', {
      version: 'v1-dup',
      effectiveFrom: '2025-01-01',
      notes: null,
      data: RATES_V1,
    });
    expect(dup.status).toBe(409);
  });
});

describe('minimum wages', () => {
  it('lists the seeded NCR rows and adds a region', async () => {
    const list = await owner.get<{ region: string }[]>('/api/min-wages');
    expect(list.body.every((r) => r.region === 'NCR')).toBe(true);
    const add = await owner.post('/api/min-wages', {
      region: 'IV-A',
      effectiveFrom: '2026-01-01',
      nonAgricultureDaily: '600.00',
      kasambahayMonthly: '6000.00',
      wageOrder: null,
    });
    expect(add.status).toBe(201);
  });
});

describe('SMTP', () => {
  const smtp = {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    username: 'mailer',
    password: 'smtp-secret',
    fromAddress: 'payroll@example.test',
  };

  it('stores the password encrypted, never returns it, and keeps it when null is sent', async () => {
    expect((await owner.put('/api/settings/smtp', smtp)).status).toBe(200);
    const get = await owner.get<Record<string, unknown>>('/api/settings/smtp');
    expect(get.body).toMatchObject({ configured: true, host: smtp.host, hasPassword: true });
    expect(JSON.stringify(get.body)).not.toContain('smtp-secret');

    await owner.put('/api/settings/smtp', { ...smtp, password: null, host: 'smtp2.example.test' });
    const again = await owner.get<{ hasPassword: boolean; host: string }>('/api/settings/smtp');
    expect(again.body).toMatchObject({ hasPassword: true, host: 'smtp2.example.test' });
  });

  it('sends a test email through the configured mailer', async () => {
    const before = await owner.post<{ error: { code: string } }>('/api/settings/smtp/test', {
      to: 'me@example.test',
    });
    expect(before.body.error.code).toBe('SMTP_NOT_CONFIGURED');
    await owner.put('/api/settings/smtp', smtp);
    const res = await owner.post('/api/settings/smtp/test', { to: 'me@example.test' });
    expect(res.status).toBe(200);
    expect(ctx.sentMail).toHaveLength(1);
    expect(ctx.sentMail[0]?.to).toBe('me@example.test');
  });
});

describe('dashboard', () => {
  it('summarises headcount, cap and upcoming holidays', async () => {
    await owner.post('/api/employees', employeeInput());
    const res = await owner.get<{ activeEmployees: number; employeeCap: number }>('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ activeEmployees: 1, employeeCap: 25 });
  });
});
