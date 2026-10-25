import { ChangePasswordSchema, LoginSchema, TotpVerifySchema, UserSchema } from '@payrollph/shared';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { users } from '../db/schema';
import { writeAudit } from '../lib/audit';
import { badRequest, errorResponses, OkSchema, unauthorized } from '../lib/http';
import { createSession, deleteSession, deleteUserSessions, SESSION_COOKIE } from '../lib/session';
import { newTotpSecret, totpEnrollment, verifyTotp } from '../lib/totp';
import { requireUser } from '../plugins/auth';

export function setSessionCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  token: string,
  expires: Date,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    signed: true,
    httpOnly: true,
    sameSite: 'strict',
    secure: app.config.cookieSecure,
    path: '/',
    expires,
  });
}

export function toUserDto(u: {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'viewer' | 'encoder';
  totpEnabled: boolean;
  createdAt: Date;
}): z.infer<typeof UserSchema> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    totpEnabled: u.totpEnabled,
    createdAt: u.createdAt.toISOString(),
  };
}

const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

// A real argon2id hash of random bytes, so unknown emails take as long as wrong passwords.
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> =>
  (dummyHash ??= argon2.hash(randomBytes(32), { type: argon2.argon2id }));

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/csrf',
    {
      schema: {
        tags: ['auth'],
        summary: 'Get a CSRF token; send it as x-csrf-token on every mutating request',
        security: [],
        response: { 200: z.object({ token: z.string() }) },
      },
    },
    async (_request, reply) => ({ token: reply.generateCsrf() }),
  );

  app.post(
    '/login',
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Sign in. Users with 2FA must include totpCode.',
        security: [],
        body: LoginSchema,
        response: { 200: z.object({ user: UserSchema }), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { email, password, totpCode } = request.body;
      const [user] = await app.db
        .select()
        .from(users)
        .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
        .limit(1);
      const hash = user?.passwordHash ?? (await getDummyHash());
      const ok = await argon2.verify(hash, password).catch(() => false);
      if (!user || !ok) throw unauthorized('INVALID_CREDENTIALS', 'Wrong email or password.');

      if (user.totpEnabled) {
        if (!totpCode)
          throw unauthorized('TOTP_REQUIRED', 'Enter the code from your authenticator app.');
        const secret = user.totpSecretEnc ? app.cipher.decrypt(user.totpSecretEnc) : null;
        if (!secret || !(await verifyTotp(secret, totpCode))) {
          throw unauthorized('INVALID_TOTP', 'That code is not valid. Try the latest one.');
        }
      }

      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const session = await createSession(app.db, user.id, app.config.sessionTtlHours);
      setSessionCookie(app, reply, session.token, session.expiresAt);
      return { user: toUserDto(user) };
    },
  );

  app.post(
    '/logout',
    { schema: { tags: ['auth'], summary: 'Sign out', response: { 200: OkSchema } } },
    async (request, reply) => {
      if (request.sessionToken) await deleteSession(app.db, request.sessionToken);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true as const };
    },
  );

  app.get(
    '/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'The signed-in user',
        response: { 200: z.object({ user: UserSchema }), ...errorResponses },
      },
    },
    async (request) => ({ user: toUserDto(requireUser(request)) }),
  );

  app.post(
    '/password',
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Change your password (signs out other sessions)',
        body: ChangePasswordSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireUser(request);
      const [row] = await app.db.select().from(users).where(eq(users.id, me.id)).limit(1);
      if (!row || !(await argon2.verify(row.passwordHash, request.body.currentPassword))) {
        throw badRequest('WRONG_PASSWORD', 'Your current password is wrong.');
      }
      const passwordHash = await argon2.hash(request.body.newPassword, { type: argon2.argon2id });
      await app.db.update(users).set({ passwordHash }).where(eq(users.id, me.id));
      await deleteUserSessions(app.db, me.id);
      const session = await createSession(app.db, me.id, app.config.sessionTtlHours);
      setSessionCookie(app, reply, session.token, session.expiresAt);
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'user.password_change',
        entity: 'user',
        entityId: me.id,
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/totp/setup',
    {
      schema: {
        tags: ['auth'],
        summary: 'Start 2FA enrollment: returns a secret and QR code (not active until enabled)',
        response: {
          200: z.object({ secret: z.string(), otpauthUrl: z.string(), qrDataUrl: z.string() }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const me = requireUser(request);
      if (me.totpEnabled) throw badRequest('TOTP_ALREADY_ENABLED', '2FA is already on.');
      const secret = newTotpSecret();
      await app.db
        .update(users)
        .set({ totpSecretEnc: app.cipher.encrypt(secret) })
        .where(eq(users.id, me.id));
      return { secret, ...(await totpEnrollment(secret, me.email)) };
    },
  );

  app.post(
    '/totp/enable',
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Turn on 2FA by confirming a code from the app',
        body: TotpVerifySchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireUser(request);
      const [row] = await app.db.select().from(users).where(eq(users.id, me.id)).limit(1);
      if (!row?.totpSecretEnc) throw badRequest('TOTP_NOT_STARTED', 'Start 2FA setup first.');
      if (!(await verifyTotp(app.cipher.decrypt(row.totpSecretEnc), request.body.code))) {
        throw badRequest('INVALID_TOTP', 'That code is not valid. Try the latest one.');
      }
      await app.db.update(users).set({ totpEnabled: true }).where(eq(users.id, me.id));
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'user.totp_enable',
        entity: 'user',
        entityId: me.id,
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/totp/disable',
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Turn off 2FA (requires a current code)',
        body: TotpVerifySchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireUser(request);
      const [row] = await app.db.select().from(users).where(eq(users.id, me.id)).limit(1);
      if (!row?.totpEnabled || !row.totpSecretEnc) {
        throw badRequest('TOTP_NOT_ENABLED', '2FA is not on.');
      }
      if (!(await verifyTotp(app.cipher.decrypt(row.totpSecretEnc), request.body.code))) {
        throw badRequest('INVALID_TOTP', 'That code is not valid. Try the latest one.');
      }
      await app.db
        .update(users)
        .set({ totpEnabled: false, totpSecretEnc: null })
        .where(eq(users.id, me.id));
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'user.totp_disable',
        entity: 'user',
        entityId: me.id,
      });
      return { ok: true as const };
    },
  );
};
