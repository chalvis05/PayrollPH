import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, employeeDocuments } from '../../db/schema';
import { sanitiseFileName, sniffType } from '../documents';
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

interface Doc {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest-of-png'),
]);
const PDF = Buffer.from('%PDF-1.7\n%fake pdf body\n');

function multipart(fileName: string, content: Buffer, mime: string) {
  const boundary = '----payrollphtest';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const upload = (client: TestClient, fileName: string, content: Buffer, mime: string) => {
  const { body, headers } = multipart(fileName, content, mime);
  return client.request<Doc & ErrorBody>('POST', `/api/employees/${empId}/documents`, body, {
    headers,
  });
};

describe('employee documents', () => {
  it('uploads, lists, downloads and deletes a document', async () => {
    const up = await upload(owner, '..\\..\\secret\\Contract <v2>.pdf', PDF, 'text/plain');
    expect(up.status).toBe(201);
    // Type comes from the bytes, not the client; the name is reduced to a safe base name.
    expect(up.body).toMatchObject({
      fileName: 'Contract v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });

    const [row] = await ctx.db
      .select()
      .from(employeeDocuments)
      .where(eq(employeeDocuments.id, up.body.id));
    expect(row?.storedName).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    const stored = join(ctx.app.config.uploadDir, row?.storedName ?? 'missing');
    expect(existsSync(stored)).toBe(true);

    const list = await owner.get<Doc[]>(`/api/employees/${empId}/documents`);
    expect(list.body.map((d) => d.id)).toEqual([up.body.id]);

    const dl = await owner.get<string>(`/api/documents/${up.body.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(String(dl.headers['content-disposition'])).toBe(
      `attachment; filename="Contract v2.pdf"; filename*=UTF-8''Contract%20v2.pdf`,
    );
    expect(dl.raw.equals(PDF)).toBe(true);

    expect((await owner.del(`/api/documents/${up.body.id}`)).status).toBe(200);
    expect(existsSync(stored)).toBe(false);
    expect((await owner.get(`/api/documents/${up.body.id}`)).status).toBe(404);

    const audits = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entity, 'employee_document'));
    expect(audits.map((a) => a.action).sort()).toEqual(['document.delete', 'document.upload']);
    expect(audits.find((a) => a.action === 'document.upload')?.after).toEqual({
      employeeId: empId,
      fileName: 'Contract v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
  });

  it('accepts PNG by magic bytes', async () => {
    const up = await upload(owner, 'id.png', PNG, 'image/png');
    expect(up.status).toBe(201);
    expect(up.body.mimeType).toBe('image/png');
  });

  it('rejects files whose bytes are not PDF/PNG/JPEG, whatever the client says', async () => {
    const before = readdirSync(ctx.app.config.uploadDir).length;
    const fake = await upload(
      owner,
      'evil.pdf',
      Buffer.from('<html><script>x</script>'),
      'application/pdf',
    );
    expect(fake.status).toBe(415);
    expect(fake.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const exe = await upload(owner, 'id.png', Buffer.from('MZ\x90\x00binary'), 'image/png');
    expect(exe.status).toBe(415);
    expect(readdirSync(ctx.app.config.uploadDir).length).toBe(before);
    expect(await ctx.db.select().from(employeeDocuments)).toHaveLength(0);
  });

  it('404s for unknown employees and forbids viewer uploads/deletes', async () => {
    const { body, headers } = multipart('a.pdf', PDF, 'application/pdf');
    const missing = await owner.request(
      'POST',
      '/api/employees/00000000-0000-4000-8000-000000000000/documents',
      body,
      { headers },
    );
    expect(missing.status).toBe(404);

    const up = await upload(owner, 'a.pdf', PDF, 'application/pdf');
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get(`/api/employees/${empId}/documents`)).status).toBe(200);
    expect((await upload(viewer, 'b.pdf', PDF, 'application/pdf')).status).toBe(403);
    expect((await viewer.del(`/api/documents/${up.body.id}`)).status).toBe(403);
  });

  it('sniffs and sanitises correctly', () => {
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniffType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sanitiseFileName('/etc/passwd')).toBe('passwd');
    expect(sanitiseFileName('...hidden')).toBe('hidden');
    expect(sanitiseFileName('a\r\nb.pdf')).toBe('ab.pdf');
    expect(sanitiseFileName('')).toBe('document');
  });
});
