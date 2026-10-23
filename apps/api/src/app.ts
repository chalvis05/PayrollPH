import cookie from '@fastify/cookie';
import csrf from '@fastify/csrf-protection';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config';
import type { Db } from './db/client';
import { createFieldCipher } from './lib/crypto';
import { smtpMailerFactory, type MailerFactory } from './lib/mailer';
import { findSessionUser, SESSION_COOKIE } from './lib/session';
import { readAnyWriteOwner } from './plugins/auth';
import { registerErrorHandler } from './plugins/errors';
import { attendanceRoutes } from './routes/attendance';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { dashboardRoutes } from './routes/dashboard';
import { deductionRoutes } from './routes/deductions';
import { documentRoutes } from './routes/documents';
import { employeeRoutes } from './routes/employees';
import { holidayRoutes } from './routes/holidays';
import { loanRoutes } from './routes/loans';
import { payrollRoutes } from './routes/payroll';
import { payslipFileRoutes } from './routes/payslipFiles';
import { reportRoutes } from './routes/reports';
import { settingsRoutes } from './routes/settings';
import { setupRoutes } from './routes/setup';
import { userRoutes } from './routes/users';
import './types';

export interface BuildAppOptions {
  db: Db;
  config: AppConfig;
  mailerFactory?: MailerFactory;
  logger?: boolean;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', opts.db);
  app.decorate('config', config);
  app.decorate('cipher', createFieldCipher(config.encryptionKey));
  app.decorate('mailerFactory', opts.mailerFactory ?? smtpMailerFactory);
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  registerErrorHandler(app);

  await app.register(helmet, {
    // The API only serves JSON/files; swagger-ui gets its own CSP via staticCSP below.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(csrf, {
    sessionPlugin: '@fastify/cookie',
    cookieKey: 'pp_csrf',
    cookieOpts: {
      signed: true,
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      path: '/',
    },
    getToken: (req) => {
      const header = req.headers['x-csrf-token'];
      return Array.isArray(header) ? header[0] : header;
    },
  });
  // Global limit plus stricter per-route limits on auth routes (route `config.rateLimit`).
  // Not registered at all when disabled (tests), which also turns the per-route limits off.
  if (config.rateLimit) {
    await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  }
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'PayrollPH API',
        description:
          'Self-hosted Philippine payroll. All mutating requests need the `x-csrf-token` header from `GET /api/auth/csrf`.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
        },
      },
      security: [{ cookieAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs', staticCSP: true });

  // Session lookup for every request.
  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    request.sessionToken = unsigned.value;
    request.user = await findSessionUser(app.db, unsigned.value);
  });

  // CSRF on every mutating request (double-submit: signed secret cookie + header token).
  app.addHook('onRequest', (request, reply, done) => {
    if (!MUTATING.has(request.method)) return done();
    app.csrfProtection(request, reply, done);
  });

  app.get('/api/health', { schema: { hide: true } }, async () => ({ ok: true }));

  // Public: first-run setup and authentication.
  await app.register(setupRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });

  // Everything else: any signed-in user may read; only the owner may change things.
  await app.register(
    async (scope) => {
      scope.addHook('onRequest', readAnyWriteOwner);
      await scope.register(userRoutes, { prefix: '/users' });
      await scope.register(dashboardRoutes, { prefix: '/dashboard' });
      await scope.register(settingsRoutes);
      await scope.register(employeeRoutes, { prefix: '/employees' });
      await scope.register(documentRoutes);
      await scope.register(attendanceRoutes, { prefix: '/attendance' });
      await scope.register(holidayRoutes, { prefix: '/holidays' });
      await scope.register(loanRoutes, { prefix: '/loans' });
      await scope.register(deductionRoutes, { prefix: '/deductions' });
      await scope.register(payrollRoutes);
      await scope.register(payslipFileRoutes);
      await scope.register(reportRoutes, { prefix: '/reports' });
      await scope.register(backupRoutes, { prefix: '/backups' });
      await scope.register(auditRoutes, { prefix: '/audit' });
    },
    { prefix: '/api' },
  );

  return app;
}
