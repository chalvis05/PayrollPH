import { spawn } from 'node:child_process';
import { open, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import { writeAudit, type DbOrTx } from './audit';
import { HttpError } from './http';

/** Backup file names we create and accept. Anything else is rejected (no path traversal). */
export const BACKUP_NAME_RE = /^payrollph-\d{8}-\d{6}\.dump$/;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export function isBackupName(name: string): boolean {
  return BACKUP_NAME_RE.test(name);
}

/** Absolute path of a backup inside `dir`; throws 400 for anything that is not a backup name. */
export function backupPath(dir: string, name: string): string {
  if (!isBackupName(name)) throw new HttpError(400, 'INVALID_FILENAME', 'Not a backup file name.');
  return join(dir, name);
}

/** `payrollph-YYYYMMDD-HHmmss.dump` in Asia/Manila time. */
export function backupFileName(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00';
  return `payrollph-${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}.dump`;
}

/** Path to a PostgreSQL client binary: `PG_BIN_DIR` if set, else whatever is on PATH. */
export function pgBinary(name: 'pg_dump' | 'pg_restore'): string {
  const dir = process.env.PG_BIN_DIR;
  if (!dir) return name;
  return join(dir, process.platform === 'win32' ? `${name}.exe` : name);
}

/** Split a connection URL into a password-free URL and the password (passed via PGPASSWORD). */
export function connectionParts(databaseUrl: string): { url: string; password: string | null } {
  const u = new URL(databaseUrl);
  const password = u.password ? decodeURIComponent(u.password) : null;
  u.password = '';
  return { url: u.toString(), password };
}

interface RunResult {
  stdout: string;
  stderr: string;
}

/** Run a binary with an argument array (never through a shell). */
function run(bin: string, args: string[], password: string | null): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.PGPASSWORD;
    if (password !== null) env.PGPASSWORD = password;
    const child = spawn(bin, args, { env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new HttpError(
            503,
            'PG_TOOLS_MISSING',
            `${bin} was not found. Install the PostgreSQL 18 client tools or set PG_BIN_DIR.`,
          ),
        );
      } else reject(err);
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.trim().slice(0, 2000)}`));
    });
  });
}

/** Major version of the pg_dump that would be used, or null when it can't be run. */
export async function pgDumpMajorVersion(): Promise<number | null> {
  try {
    const { stdout } = await run(pgBinary('pg_dump'), ['--version'], null);
    const m = /(\d+)(?:\.\d+)?/.exec(stdout);
    return m?.[1] ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export async function listBackups(dir: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!isBackupName(name)) continue;
    const st = await stat(join(dir, name)).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ name, size: st.size, createdAt: st.mtime.toISOString() });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Dump the database (custom format) into `dir`. Writes to a temp name and renames on success. */
export async function createBackup(
  dir: string,
  databaseUrl: string,
  now = new Date(),
): Promise<BackupInfo> {
  await mkdir(dir, { recursive: true });
  const name = backupFileName(now);
  const target = join(dir, name);
  if (await stat(target).catch(() => null)) {
    throw new HttpError(
      409,
      'BACKUP_EXISTS',
      'A backup was just made. Wait a second and try again.',
    );
  }
  const partial = `${target}.partial`;
  const { url, password } = connectionParts(databaseUrl);
  try {
    await run(
      pgBinary('pg_dump'),
      ['--format=custom', '--no-owner', '--no-acl', `--file=${partial}`, `--dbname=${url}`],
      password,
    );
    await rename(partial, target);
  } catch (err) {
    await rm(partial, { force: true });
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, 'BACKUP_FAILED', (err as Error).message);
  }
  const st = await stat(target);
  return { name, size: st.size, createdAt: st.mtime.toISOString() };
}

/** True when the file starts with the pg_dump custom-format magic bytes. */
export async function isCustomDump(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fh.read(buf, 0, 5, 0);
    return bytesRead === 5 && buf.toString('latin1') === 'PGDMP';
  } finally {
    await fh.close();
  }
}

/** Replace the contents of the one configured database with a dump, in a single transaction. */
export async function restoreBackup(file: string, databaseUrl: string): Promise<void> {
  if (!(await isCustomDump(file))) {
    throw new HttpError(400, 'NOT_A_BACKUP', 'The file is not a PostgreSQL custom-format dump.');
  }
  const { url, password } = connectionParts(databaseUrl);
  try {
    await run(
      pgBinary('pg_restore'),
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '--single-transaction',
        `--dbname=${url}`,
        file,
      ],
      password,
    );
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, 'RESTORE_FAILED', (err as Error).message);
  }
}

export async function deleteBackup(dir: string, name: string): Promise<boolean> {
  const path = backupPath(dir, name);
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return false;
  await rm(path);
  return true;
}

/** Delete backups whose modification time is more than `retentionDays` before `now`. */
export async function pruneBackups(
  dir: string,
  retentionDays: number,
  now = new Date(),
): Promise<string[]> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const b of await listBackups(dir)) {
    if (Date.parse(b.createdAt) < cutoff) {
      await rm(join(dir, b.name), { force: true });
      removed.push(b.name);
    }
  }
  return removed;
}

/** One backup/restore at a time per process. */
let busy = false;
export async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busy)
    throw new HttpError(
      409,
      'BACKUP_BUSY',
      'Another backup or restore is running. Try again shortly.',
    );
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

/** Retention from settings (default 30 days). */
export async function retentionDays(db: DbOrTx): Promise<number> {
  const [s] = await db
    .select({ days: settings.backupRetentionDays })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return s?.days ?? 30;
}

/**
 * Make a backup now, then delete dumps past the retention window. Audits both.
 * Used by POST /api/backups (actor = owner) and the nightly job (actor = null).
 */
export async function backupAndPrune(
  db: DbOrTx,
  opts: {
    backupDir: string;
    databaseUrl: string;
    actorId: string | null;
    trigger: 'manual' | 'nightly';
  },
): Promise<{ backup: BackupInfo; pruned: string[] }> {
  return exclusive(async () => {
    const backup = await createBackup(opts.backupDir, opts.databaseUrl);
    await writeAudit(db, {
      actorId: opts.actorId,
      action: 'backup.create',
      entity: 'backup',
      entityId: backup.name,
      after: { ...backup, trigger: opts.trigger },
    });
    const days = await retentionDays(db);
    const pruned = await pruneBackups(opts.backupDir, days);
    if (pruned.length > 0) {
      await writeAudit(db, {
        actorId: opts.actorId,
        action: 'backup.prune',
        entity: 'backup',
        after: { deleted: pruned, retentionDays: days, trigger: opts.trigger },
      });
    }
    return { backup, pruned };
  });
}
