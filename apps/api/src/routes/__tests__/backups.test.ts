import { readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFileName,
  connectionParts,
  pgDumpMajorVersion,
  pruneBackups,
} from '../../lib/backup';
import {
  createTestContext,
  employeeInput,
  ownerClient,
  resetDb,
  viewerClient,
  OWNER,
  TestClient,
  type TestContext,
} from '../../test/helpers';

// Real dump/restore needs a PostgreSQL 18 client (pg_dump/pg_restore on PATH or in PG_BIN_DIR).
const pgMajor = await pgDumpMajorVersion();
const hasPg18 = pgMajor !== null && pgMajor >= 18;
const SKIP_REASON = `needs pg_dump >= 18 on PATH or in PG_BIN_DIR (found: ${pgMajor ?? 'none'})`;
if (!hasPg18) console.warn(`[backups.test] skipping real dump/restore round-trip: ${SKIP_REASON}`);

let ctx: TestContext;
let owner: TestClient;
let dir: string;
beforeAll(async () => {
  ctx = await createTestContext();
  dir = ctx.app.config.backupDir;
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
  owner = await ownerClient(ctx.app);
});

const DAY = 24 * 60 * 60 * 1000;

/** A fake dump file with a given age. */
function fakeDump(ageDays: number, content = 'PGDMP-fake'): string {
  const at = new Date(Date.now() - ageDays * DAY);
  const name = backupFileName(at);
  const path = join(dir, name);
  writeFileSync(path, content);
  utimesSync(path, at, at);
  return name;
}

interface Backup {
  name: string;
  size: number;
  createdAt: string;
}

describe('backup helpers', () => {
  it('names files payrollph-YYYYMMDD-HHmmss.dump in Manila time', () => {
    // 2026-03-01T18:30:05Z is 2026-03-02 02:30:05 in Manila (UTC+8).
    expect(backupFileName(new Date('2026-03-01T18:30:05Z'))).toBe('payrollph-20260302-023005.dump');
  });

  it('never puts the password in the connection URL', () => {
    const parts = connectionParts(
      'postgres://pay%40roll:s3cr%2Ft@db.local:5433/payrollph?sslmode=disable',
    );
    expect(parts.password).toBe('s3cr/t');
    expect(parts.url).not.toContain('s3cr');
    expect(parts.url).toBe('postgres://pay%40roll@db.local:5433/payrollph?sslmode=disable');
  });

  it('prunes only backup files older than the retention window', async () => {
    const old = fakeDump(40);
    const recent = fakeDump(5);
    writeFileSync(join(dir, 'notes.txt'), 'keep me');
    utimesSync(
      join(dir, 'notes.txt'),
      new Date(Date.now() - 100 * DAY),
      new Date(Date.now() - 100 * DAY),
    );
    const removed = await pruneBackups(dir, 30);
    expect(removed).toEqual([old]);
    const left = readdirSync(dir);
    expect(left).toContain(recent);
    expect(left).toContain('notes.txt');
    expect(left).not.toContain(old);
  });
});

describe('backup routes', () => {
  it('lists dump files newest first with size and date', async () => {
    const older = fakeDump(3, 'PGDMP-older');
    const newer = fakeDump(1, 'PGDMP-newer!');
    writeFileSync(join(dir, 'other.dump'), 'not ours');
    const res = await owner.get<Backup[]>('/api/backups');
    expect(res.status).toBe(200);
    expect(res.body.map((b) => b.name)).toEqual([newer, older]);
    expect(res.body[0]?.size).toBe('PGDMP-newer!'.length);
    expect(Date.parse(res.body[1]?.createdAt ?? '')).toBeLessThan(Date.now() - 2 * DAY);
  });

  it('downloads and deletes a backup, with an audit entry for the delete', async () => {
    const name = fakeDump(1, 'PGDMP-content');
    const dl = await owner.get(`/api/backups/${name}`);
    expect(dl.status).toBe(200);
    expect(dl.raw.toString()).toBe('PGDMP-content');
    expect(String(dl.headers['content-disposition'])).toContain(name);

    const del = await owner.del(`/api/backups/${name}`);
    expect(del.status).toBe(200);
    expect(readdirSync(dir)).not.toContain(name);
    expect((await owner.del(`/api/backups/${name}`)).status).toBe(404);
    expect((await owner.get(`/api/backups/${name}`)).status).toBe(404);

    const audit = await owner.get<{ action: string; entityId: string }[]>(
      '/api/audit?entity=backup',
    );
    expect(audit.body.some((a) => a.action === 'backup.delete' && a.entityId === name)).toBe(true);
  });

  it('rejects file names that are not backups (no path traversal)', async () => {
    writeFileSync(join(dir, 'secret.txt'), 'x');
    const bad = [
      '..%2F..%2Fetc%2Fpasswd',
      '..%5Csecret.txt',
      'secret.txt',
      'payrollph-20260101-000000.dump.txt',
      'payrollph-2026010-000000.dump',
      '%2E%2E%2Fpayrollph-20260101-000000.dump',
    ];
    for (const f of bad) {
      const get = await owner.get(`/api/backups/${f}`);
      expect(get.status, f).toBe(400);
      const del = await owner.del(`/api/backups/${f}`);
      expect(del.status, f).toBe(400);
    }
    const restore = await owner.post('/api/backups/restore', {
      file: '../secret.txt',
      confirm: 'RESTORE',
    });
    expect(restore.status).toBe(400);
    expect(readdirSync(dir)).toContain('secret.txt');
  });

  it('requires the RESTORE confirmation and an existing backup', async () => {
    const name = fakeDump(1);
    const noConfirm = await owner.post('/api/backups/restore', { file: name });
    expect(noConfirm.status).toBe(400);
    const wrong = await owner.post('/api/backups/restore', { file: name, confirm: 'yes' });
    expect(wrong.status).toBe(400);
    const empty = await owner.post<{ error: { code: string } }>('/api/backups/restore', {});
    expect(empty.status).toBe(400);
    const missing = await owner.post('/api/backups/restore', {
      file: 'payrollph-19990101-000000.dump',
      confirm: 'RESTORE',
    });
    expect(missing.status).toBe(404);
  });

  it('rejects a multipart upload without confirm, and a file that is not a dump', async () => {
    const boundary = '----payrollphtest';
    const body = (fields: Record<string, string>, file: string) =>
      Buffer.from(
        [
          ...Object.entries(fields).map(
            ([k, v]) =>
              `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.dump"\r\n` +
            `Content-Type: application/octet-stream\r\n\r\n${file}\r\n`,
          `--${boundary}--\r\n`,
        ].join(''),
      );
    const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    const noConfirm = await owner.request<{ error: { code: string } }>(
      'POST',
      '/api/backups/restore',
      body({}, 'PGDMPxxxx'),
      { headers },
    );
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.error.code).toBe('CONFIRM_REQUIRED');
    const notDump = await owner.request<{ error: { code: string } }>(
      'POST',
      '/api/backups/restore',
      body({ confirm: 'RESTORE' }, 'hello'),
      { headers },
    );
    expect(notDump.status).toBe(400);
    expect(notDump.body.error.code).toBe('NOT_A_BACKUP');
  });

  it('is owner only, including reads', async () => {
    const name = fakeDump(1);
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get('/api/backups')).status).toBe(403);
    expect((await viewer.get(`/api/backups/${name}`)).status).toBe(403);
    expect((await viewer.post('/api/backups')).status).toBe(403);
    expect((await viewer.del(`/api/backups/${name}`)).status).toBe(403);
    expect(
      (await viewer.post('/api/backups/restore', { file: name, confirm: 'RESTORE' })).status,
    ).toBe(403);
    expect(readdirSync(dir)).toContain(name);
  });

  it.skipIf(hasPg18)(
    'reports missing or wrong-version PostgreSQL client tools cleanly',
    async () => {
      const res = await owner.post<{ error: { code: string } }>('/api/backups');
      expect([500, 503]).toContain(res.status);
      expect(['PG_TOOLS_MISSING', 'BACKUP_FAILED']).toContain(res.body.error.code);
      expect(readdirSync(dir).filter((f) => f.endsWith('.partial'))).toEqual([]);
    },
  );

  it.skipIf(!hasPg18)(`dumps and restores the database for real (${SKIP_REASON})`, async () => {
    const before = await owner.post('/api/employees', employeeInput({ firstName: 'Kept' }));
    expect(before.status).toBe(201);
    const old = fakeDump(400);

    const created = await owner.post<Backup>('/api/backups');
    expect(created.status).toBe(201);
    expect(created.body.name).toMatch(/^payrollph-\d{8}-\d{6}\.dump$/);
    expect(created.body.size).toBeGreaterThan(0);
    // Retention (default 30 days) pruned the old fake dump.
    expect(readdirSync(dir)).not.toContain(old);

    const after = await owner.post('/api/employees', employeeInput({ firstName: 'Discarded' }));
    expect(after.status).toBe(201);

    const restored = await owner.post('/api/backups/restore', {
      file: created.body.name,
      confirm: 'RESTORE',
    });
    expect(restored.status).toBe(200);
    // Restoring signs everyone out: sessions from the dump must not come back to life.
    expect((await owner.get('/api/auth/me')).status).toBe(401);
    owner = new TestClient(ctx.app);
    const relogin = await owner.post('/api/auth/login', {
      email: OWNER.email,
      password: OWNER.password,
    });
    expect(relogin.status).toBe(200);
    const list = await owner.get<{ firstName?: string; fullName: string }[]>('/api/employees');
    const names = list.body.map((e) => e.fullName);
    expect(names.some((n) => n.startsWith('Kept'))).toBe(true);
    expect(names.some((n) => n.startsWith('Discarded'))).toBe(false);

    const audit = await owner.get<{ action: string }[]>('/api/audit?entity=backup');
    const actions = audit.body.map((a) => a.action);
    expect(actions).toContain('backup.create');
    expect(actions).toContain('backup.restore');
  });
});
