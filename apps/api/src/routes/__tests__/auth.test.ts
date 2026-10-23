import { generate } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  headerList,
  OWNER,
  ownerClient,
  resetDb,
  TestClient,
  viewerClient,
  type TestContext,
} from '../../test/helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
});

describe('setup wizard', () => {
  it('reports that setup is needed, then creates the owner once', async () => {
    const anon = new TestClient(ctx.app);
    const status = await anon.get<{ needsSetup: boolean }>('/api/setup/status');
    expect(status.body.needsSetup).toBe(true);

    const owner = await ownerClient(ctx.app);
    const me = await owner.get<{ user: { role: string; email: string } }>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ role: 'owner', email: OWNER.email });

    const again = await new TestClient(ctx.app).post<{ error: { code: string } }>('/api/setup', {
      ...OWNER,
      email: 'other@example.test',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_SET_UP');
    expect((await anon.get<{ needsSetup: boolean }>('/api/setup/status')).body.needsSetup).toBe(
      false,
    );
  });

  it('rejects a weak password with a validation error', async () => {
    const res = await new TestClient(ctx.app).post<{ error: { code: string } }>('/api/setup', {
      ...OWNER,
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('login and sessions', () => {
  it('accepts the right password, rejects the wrong one, and logs out', async () => {
    await ownerClient(ctx.app);
    const c = new TestClient(ctx.app);
    const bad = await c.post<{ error: { code: string } }>('/api/auth/login', {
      email: OWNER.email,
      password: 'wrong-password-xyz',
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');

    const unknown = await c.post<{ error: { code: string } }>('/api/auth/login', {
      email: 'nobody@example.test',
      password: 'whatever-password',
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');

    const ok = await c.post('/api/auth/login', {
      email: OWNER.email.toUpperCase(),
      password: OWNER.password,
    });
    expect(ok.status).toBe(200);
    expect(headerList(ok.headers['set-cookie'])).toEqual(
      expect.arrayContaining([expect.stringMatching(/pp_session=.*HttpOnly.*SameSite=Strict/i)]),
    );
    expect((await c.get('/api/auth/me')).status).toBe(200);

    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('requires a session for protected routes', async () => {
    const res = await new TestClient(ctx.app).get<{ error: { code: string } }>('/api/employees');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects mutating requests without a CSRF token', async () => {
    const owner = await ownerClient(ctx.app);
    const res = await owner.request<{ error: { code: string } }>(
      'POST',
      '/api/auth/logout',
      {},
      { csrf: false },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a CSRF token that does not match the cookie secret', async () => {
    const owner = await ownerClient(ctx.app);
    const res = await owner.request<{ error: { code: string } }>(
      'POST',
      '/api/auth/logout',
      {},
      {
        csrf: false,
        headers: { 'x-csrf-token': 'forged-token' },
      },
    );
    expect(res.status).toBe(403);
  });

  it('changing the password signs out other sessions', async () => {
    const owner = await ownerClient(ctx.app);
    const other = new TestClient(ctx.app);
    await other.post('/api/auth/login', { email: OWNER.email, password: OWNER.password });
    const res = await owner.post('/api/auth/password', {
      currentPassword: OWNER.password,
      newPassword: 'a-brand-new-password',
    });
    expect(res.status).toBe(200);
    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});

describe('TOTP two-factor', () => {
  it('enrolls, then requires and verifies the code at login, then disables', async () => {
    const owner = await ownerClient(ctx.app);
    const setup = await owner.post<{ secret: string; otpauthUrl: string; qrDataUrl: string }>(
      '/api/auth/totp/setup',
    );
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const { secret } = setup.body;

    const wrongEnable = await owner.post('/api/auth/totp/enable', { code: '000000' });
    expect(wrongEnable.status).toBe(400);
    const enable = await owner.post('/api/auth/totp/enable', { code: await generate({ secret }) });
    expect(enable.status).toBe(200);

    const c = new TestClient(ctx.app);
    const noCode = await c.post<{ error: { code: string } }>('/api/auth/login', {
      email: OWNER.email,
      password: OWNER.password,
    });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('TOTP_REQUIRED');
    const badCode = await c.post<{ error: { code: string } }>('/api/auth/login', {
      email: OWNER.email,
      password: OWNER.password,
      totpCode: '123456',
    });
    expect(badCode.body.error.code).toBe('INVALID_TOTP');
    const good = await c.post('/api/auth/login', {
      email: OWNER.email,
      password: OWNER.password,
      totpCode: await generate({ secret }),
    });
    expect(good.status).toBe(200);

    const disable = await c.post('/api/auth/totp/disable', { code: await generate({ secret }) });
    expect(disable.status).toBe(200);
    const plain = await new TestClient(ctx.app).post('/api/auth/login', {
      email: OWNER.email,
      password: OWNER.password,
    });
    expect(plain.status).toBe(200);
  });
});

describe('viewer role', () => {
  it('can read but not change anything, and cannot manage users', async () => {
    const owner = await ownerClient(ctx.app);
    const viewer = await viewerClient(ctx.app, owner);
    expect((await viewer.get('/api/employees')).status).toBe(200);
    expect((await viewer.get('/api/settings')).status).toBe(200);
    const write = await viewer.put<{ error: { code: string } }>('/api/settings', {});
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('FORBIDDEN');
    expect((await viewer.get('/api/users')).status).toBe(403);
    expect((await viewer.get('/api/audit')).status).toBe(403);
    expect((await viewer.get('/api/settings/smtp')).status).toBe(403);
  });

  it('the owner can remove a viewer but not themselves', async () => {
    const owner = await ownerClient(ctx.app);
    await viewerClient(ctx.app, owner);
    const list = await owner.get<{ id: string; role: string }[]>('/api/users');
    const viewerRow = list.body.find((u) => u.role === 'viewer');
    const ownerRow = list.body.find((u) => u.role === 'owner');
    expect((await owner.del(`/api/users/${ownerRow?.id}`)).status).toBe(400);
    expect((await owner.del(`/api/users/${viewerRow?.id}`)).status).toBe(200);
  });
});

describe('rate limiting (production setting)', () => {
  it('locks out repeated login attempts with 429', async () => {
    const limited = await createTestContext({ rateLimit: true });
    try {
      const c = new TestClient(limited.app);
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await c.post('/api/auth/login', {
          email: OWNER.email,
          password: 'nope-nope-nope',
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('proxy trust (production setting)', () => {
  it('a spoofed leftmost X-Forwarded-For does not get around the login rate limit', async () => {
    const limited = await createTestContext({ rateLimit: true, trustProxy: 1 });
    try {
      const c = new TestClient(limited.app);
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        // The client invents a new address each time; the proxy appends the real one.
        const res = await c.request(
          'POST',
          '/api/auth/login',
          { email: OWNER.email, password: 'nope-nope-nope' },
          { headers: { 'x-forwarded-for': `203.0.113.${i}, 198.51.100.7` } },
        );
        statuses.push(res.status);
      }
      expect(statuses[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('OpenAPI docs', () => {
  it('serves the OpenAPI document and the docs UI', async () => {
    const json = await ctx.app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(json.statusCode).toBe(200);
    const doc = json.json() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/auth/login', '/api/employees/']),
    );
    const ui = await ctx.app.inject({ method: 'GET', url: '/api/docs/' });
    expect(ui.statusCode).toBe(200);
  });
});
