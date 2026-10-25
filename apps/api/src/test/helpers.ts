import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EmployeeInput } from '@payrollph/shared';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { configFromEnv, type AppConfig } from '../config';
import { createDb, type Db } from '../db/client';
import { seedReferenceData } from '../db/seed';
import { databaseUrl } from '../env';
import type { Mailer, MailMessage } from '../lib/mailer';
import { testDbName } from './testDb';

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  /** Every email the app tried to send. */
  sentMail: MailMessage[];
  close(): Promise<void>;
}

/** Build the app against the test database with a capturing mailer and temp file dirs. */
export async function createTestContext(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  const url = databaseUrl(testDbName());
  const { db, sql } = createDb(url);
  const sentMail: MailMessage[] = [];
  const mailer: Mailer = {
    async send(message) {
      sentMail.push(message);
    },
  };
  const base = configFromEnv();
  const app = await buildApp({
    db,
    config: {
      ...base,
      nodeEnv: 'test',
      databaseUrl: url,
      rateLimit: false,
      uploadDir: mkdtempSync(join(tmpdir(), 'payrollph-uploads-')),
      backupDir: mkdtempSync(join(tmpdir(), 'payrollph-backups-')),
      ...overrides,
    },
    mailerFactory: () => mailer,
  });
  await app.ready();
  return {
    app,
    db,
    sentMail,
    async close() {
      await app.close();
      await sql.end();
    },
  };
}

/** Empty every table and re-seed reference data (settings, rates v1, holidays, min wages). */
export async function resetDb(db: Db): Promise<void> {
  await db.execute(dsql`
    DO $$
    DECLARE t text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO t
      FROM pg_tables WHERE schemaname = 'public';
      IF t IS NOT NULL THEN EXECUTE 'TRUNCATE ' || t || ' RESTART IDENTITY CASCADE'; END IF;
    END $$;
  `);
  await seedReferenceData(db);
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string | number | string[] | undefined>;
  raw: Buffer;
}

/** Normalise a header that may be a single value or a list. */
export const headerList = (v: string | number | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [String(v)];

/** A tiny browser stand-in: keeps cookies and sends the CSRF header on mutating requests. */
export class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken: string | null = null;

  constructor(private readonly app: FastifyInstance) {}

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private storeCookies(setCookie: string | string[] | undefined): void {
    const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of list) {
      const [pair] = c.split(';');
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async refreshCsrf(): Promise<string> {
    const res = await this.request<{ token: string }>('GET', '/api/auth/csrf');
    this.csrfToken = res.body.token;
    return this.csrfToken;
  }

  /** Send a request. Mutating requests get a CSRF token unless `csrf: false`. */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    opts: { csrf?: boolean; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    const mutating = method !== 'GET';
    if (mutating && opts.csrf !== false && this.csrfToken === null) await this.refreshCsrf();
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (mutating && opts.csrf !== false && this.csrfToken) headers['x-csrf-token'] = this.csrfToken;
    const isBuffer = Buffer.isBuffer(payload);
    const res = await this.app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : isBuffer ? { payload } : { payload: payload as object }),
    });
    this.storeCookies(res.headers['set-cookie']);
    const type = String(res.headers['content-type'] ?? '');
    const body = type.includes('application/json') ? (res.json() as T) : (res.body as T);
    return { status: res.statusCode, body, headers: res.headers, raw: res.rawPayload };
  }

  get = <T = unknown>(url: string) => this.request<T>('GET', url);
  post = <T = unknown>(url: string, body?: unknown) => this.request<T>('POST', url, body ?? {});
  put = <T = unknown>(url: string, body?: unknown) => this.request<T>('PUT', url, body ?? {});
  del = <T = unknown>(url: string) => this.request<T>('DELETE', url);
}

export const OWNER = {
  ownerName: 'Test Owner',
  email: 'owner@example.test',
  password: 'correct-horse-battery',
  payFrequency: 'semi_monthly' as const,
  region: 'NCR',
};

/** Run the setup wizard and return a signed-in owner client. */
export async function ownerClient(app: FastifyInstance): Promise<TestClient> {
  const client = new TestClient(app);
  const res = await client.post('/api/setup', OWNER);
  if (res.status !== 201)
    throw new Error(`Setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return client;
}

/** Create a viewer via the owner and return a signed-in viewer client. */
export async function viewerClient(app: FastifyInstance, owner: TestClient): Promise<TestClient> {
  const creds = { name: 'Viewer', email: 'viewer@example.test', password: 'viewer-password-123' };
  const created = await owner.post('/api/users', creds);
  if (created.status !== 201) throw new Error(`Viewer create failed: ${created.status}`);
  const viewer = new TestClient(app);
  const res = await viewer.post('/api/auth/login', {
    email: creds.email,
    password: creds.password,
  });
  if (res.status !== 200) throw new Error(`Viewer login failed: ${res.status}`);
  return viewer;
}

let seq = 0;
/** A valid employee input with overrides. Employee numbers are unique per call. */
export function employeeInput(overrides: Partial<EmployeeInput> = {}): EmployeeInput {
  seq += 1;
  return {
    employeeNo: `T-${String(seq).padStart(4, '0')}`,
    firstName: 'Juan',
    middleName: null,
    lastName: 'Dela Cruz',
    birthDate: '1990-01-15',
    sex: 'male',
    civilStatus: 'single',
    isSoloParent: false,
    address: null,
    phone: null,
    email: null,
    position: 'Driver',
    region: 'NCR',
    sssNo: '34-1234567-8',
    philhealthNo: '12-345678901-2',
    pagibigNo: '1234-5678-9012',
    tin: '123-456-789-000',
    employmentType: 'regular',
    payType: 'monthly',
    paySchedule: 'standard',
    baseRate: '20000.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2020-01-06',
    status: 'active',
    separationDate: null,
    allowances: [],
    dependents: [],
    payout: { method: 'cash', bankName: null, accountName: null, accountNumber: null },
    ...overrides,
  };
}
