import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formatPeso } from '../../lib/pdf/payslip';
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
  ctx.sentMail.length = 0;
  owner = await ownerClient(ctx.app);
});

interface RunDetail {
  id: string;
  status: string;
  periodEnd: string;
  payslips: {
    id: string;
    employeeId: string;
    employeeNo: string;
    employeeName: string;
    net: string;
  }[];
}
interface EmailResult {
  sent: { employeeId: string; payslipId: string; to: string }[];
  skipped: { employeeId: string; reason: string }[];
  failed: { employeeId: string; message: string }[];
}

/** Text drawn by pdfkit (uncompressed): hex strings inside TJ arrays, latin1-encoded. */
function pdfText(pdf: Buffer): string {
  const src = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of src.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const pieces = [...(m[1] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)].map((h) =>
      Buffer.from(h[1] ?? '', 'hex').toString('latin1'),
    );
    out.push(pieces.join(''));
  }
  return out.join('\n');
}

/** Minimal zip reader: walks the central directory and inflates each entry. */
function unzip(zip: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('No end-of-central-directory record');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n += 1) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory entry');
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function createEmployees() {
  const ana = await owner.post<{ id: string }>(
    '/api/employees',
    employeeInput({ firstName: 'Ana', lastName: 'Santos', email: 'ana@example.test' }),
  );
  const ben = await owner.post<{ id: string }>(
    '/api/employees',
    employeeInput({
      firstName: 'Ben',
      lastName: 'Reyes',
      email: 'ben@example.test',
      payType: 'daily',
      baseRate: '700.00',
    }),
  );
  const cara = await owner.post<{ id: string }>(
    '/api/employees',
    employeeInput({ firstName: 'Cara', lastName: 'Dela Cruz', email: null }),
  );
  for (const r of [ana, ben, cara]) expect(r.status).toBe(201);
  return { ana: ana.body.id, ben: ben.body.id, cara: cara.body.id };
}

async function createRun(approve: boolean): Promise<RunDetail> {
  const created = await owner.post<RunDetail>('/api/payroll-runs', {
    kind: 'semi_monthly_1',
    month: '2026-03',
    payDate: '2026-03-15',
    contributionSchedule: 'second_cutoff',
  });
  expect(created.status).toBe(201);
  if (!approve) return created.body;
  expect((await owner.post(`/api/payroll-runs/${created.body.id}/submit`)).status).toBe(200);
  const approved = await owner.post<RunDetail>(`/api/payroll-runs/${created.body.id}/approve`);
  expect(approved.status).toBe(200);
  expect(approved.body.status).toBe('approved');
  return approved.body;
}

async function configureSmtp() {
  const res = await owner.put('/api/settings/smtp', {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    username: 'mailer',
    password: 'smtp-secret',
    fromAddress: 'payroll@example.test',
  });
  expect(res.status).toBe(200);
}

describe('formatPeso', () => {
  it('groups thousands and keeps 2 decimals without number math', () => {
    expect(formatPeso('1234.56')).toBe('PHP 1,234.56');
    expect(formatPeso('1234567890.5')).toBe('PHP 1,234,567,890.50');
    expect(formatPeso('0')).toBe('PHP 0.00');
    expect(formatPeso('-250.00')).toBe('-PHP 250.00');
  });
});

describe('payslip PDF', () => {
  it('renders one payslip with the employee, every line, NET and YTD; viewers may read it', async () => {
    await createEmployees();
    const run = await createRun(true);
    const slip = run.payslips.find((p) => p.employeeName.includes('Santos'));
    expect(slip).toBeDefined();
    const res = await owner.get(`/api/payslips/${slip?.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(String(res.headers['content-disposition'])).toContain(
      `${slip?.employeeNo}-Santos-${run.periodEnd}.pdf`,
    );
    expect(res.raw.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const text = pdfText(res.raw);
    expect(text).toContain('Ana Santos');
    expect(text).toContain('NET PAY');
    expect(text).toContain(formatPeso(slip?.net ?? 'x'));
    expect(text).toContain('Test Owner');
    expect(text).toContain('Year to date (2026)');
    expect(text).toContain('Withholding tax');
    expect(text).toContain('Pag-IBIG (employer share)');
    expect(text).not.toContain('DRAFT');

    // Every earning line from the computation is printed.
    const detail = await owner.get<{
      computation: { earnings: { label: string; amount: string }[] };
    }>(`/api/payslips/${slip?.id}`);
    for (const line of detail.body.computation.earnings) {
      expect(text).toContain(line.label);
      expect(text).toContain(formatPeso(line.amount));
    }

    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get(`/api/payslips/${slip?.id}/pdf`)).status).toBe(200);
  });

  it('watermarks draft runs and 404s unknown payslips', async () => {
    await createEmployees();
    const run = await createRun(false);
    const res = await owner.get(`/api/payslips/${run.payslips[0]?.id}/pdf`);
    expect(res.status).toBe(200);
    expect(pdfText(res.raw)).toContain('DRAFT');
    const missing = await owner.get('/api/payslips/00000000-0000-4000-8000-000000000000/pdf');
    expect(missing.status).toBe(404);
  });
});

describe('payslips zip', () => {
  it('contains one PDF per employee named <employeeNo>-<lastname>-<periodEnd>.pdf', async () => {
    await createEmployees();
    const run = await createRun(true);
    const res = await owner.get(`/api/payroll-runs/${run.id}/payslips.zip`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const files = unzip(res.raw);
    expect(files.size).toBe(3);
    const expected = run.payslips.map((p) => {
      const last = p.employeeName.includes('Dela Cruz')
        ? 'Dela_Cruz'
        : (p.employeeName.split(' ').pop() ?? '');
      return `${p.employeeNo}-${last}-${run.periodEnd}.pdf`;
    });
    expect([...files.keys()].sort()).toEqual(expected.sort());
    for (const [name, pdf] of files) {
      expect(pdf.subarray(0, 4).toString('latin1'), name).toBe('%PDF');
    }
    expect(
      (await owner.get('/api/payroll-runs/00000000-0000-4000-8000-000000000000/payslips.zip'))
        .status,
    ).toBe(404);
  });
});

describe('emailing payslips', () => {
  it('sends one message with a PDF per employee with an email and skips the rest', async () => {
    const ids = await createEmployees();
    const run = await createRun(true);
    await configureSmtp();
    const res = await owner.post<EmailResult>(`/api/payroll-runs/${run.id}/payslips/email`);
    expect(res.status).toBe(200);
    expect(res.body.sent.map((s) => s.employeeId).sort()).toEqual([ids.ana, ids.ben].sort());
    expect(res.body.skipped).toEqual([{ employeeId: ids.cara, reason: 'no_email' }]);
    expect(res.body.failed).toEqual([]);

    expect(ctx.sentMail).toHaveLength(2);
    expect(ctx.sentMail.map((m) => m.to).sort()).toEqual(['ana@example.test', 'ben@example.test']);
    for (const m of ctx.sentMail) {
      expect(m.attachments).toHaveLength(1);
      const att = m.attachments?.[0];
      expect(att?.contentType).toBe('application/pdf');
      expect(att?.filename).toMatch(new RegExp(`-${run.periodEnd}\\.pdf$`));
      expect(att?.content.subarray(0, 4).toString('latin1')).toBe('%PDF');
    }
    const anaMail = ctx.sentMail.find((m) => m.to === 'ana@example.test');
    expect(pdfText(anaMail?.attachments?.[0]?.content ?? Buffer.alloc(0))).toContain('Ana Santos');

    const detail = await owner.get<RunDetail>(`/api/payroll-runs/${run.id}`);
    expect(detail.status).toBe(200);
    const audit = await owner.get<{ action: string; entityId: string }[]>(
      '/api/audit?entity=payroll_run',
    );
    expect(audit.body.some((a) => a.action === 'payslips.email' && a.entityId === run.id)).toBe(
      true,
    );
  });

  it('can target specific employees and reports ids that are not in the run', async () => {
    const ids = await createEmployees();
    const run = await createRun(true);
    await configureSmtp();
    const stranger = '00000000-0000-4000-8000-000000000001';
    const res = await owner.post<EmailResult>(`/api/payroll-runs/${run.id}/payslips/email`, {
      employeeIds: [ids.ben, stranger],
    });
    expect(res.status).toBe(200);
    expect(res.body.sent.map((s) => s.employeeId)).toEqual([ids.ben]);
    expect(res.body.skipped).toEqual([{ employeeId: stranger, reason: 'not_in_run' }]);
    expect(ctx.sentMail).toHaveLength(1);
  });

  it('needs SMTP settings and an approved run', async () => {
    await createEmployees();
    const draft = await createRun(false);
    await configureSmtp();
    const notApproved = await owner.post<{ error: { code: string } }>(
      `/api/payroll-runs/${draft.id}/payslips/email`,
    );
    expect(notApproved.status).toBe(409);
    expect(notApproved.body.error.code).toBe('RUN_NOT_APPROVED');

    await resetDb(ctx.db);
    owner = await ownerClient(ctx.app);
    await createEmployees();
    const run = await createRun(true);
    const noSmtp = await owner.post<{ error: { code: string } }>(
      `/api/payroll-runs/${run.id}/payslips/email`,
    );
    expect(noSmtp.status).toBe(400);
    expect(noSmtp.body.error.code).toBe('SMTP_NOT_CONFIGURED');
    expect(ctx.sentMail).toHaveLength(0);
  });

  it('is owner only', async () => {
    await createEmployees();
    const run = await createRun(true);
    await configureSmtp();
    const viewer = await viewerClient(ctx.app, owner);
    const res = await viewer.post(`/api/payroll-runs/${run.id}/payslips/email`);
    expect(res.status).toBe(403);
    expect(ctx.sentMail).toHaveLength(0);
  });
});
