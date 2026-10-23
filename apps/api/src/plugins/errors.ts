import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { HttpError, type ErrorResponse } from '../lib/http';

interface PgLikeError {
  code?: string;
  message?: string;
  constraint_name?: string;
  detail?: string;
}

/** Drizzle wraps driver errors; walk the cause chain to find the Postgres error. */
function pgError(err: unknown): PgLikeError | null {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i += 1) {
    const c = cur as PgLikeError & { cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

const body = (code: string, message: string, details?: unknown): ErrorResponse => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send(body(err.code, err.message, err.details));
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send(
        body(
          'VALIDATION_ERROR',
          'Some fields are invalid.',
          err.validation.map((v) => ({
            path: v.instancePath,
            message: v.message,
          })),
        ),
      );
    }
    if (err.code === 'FST_CSRF_INVALID_TOKEN' || err.code === 'FST_CSRF_MISSING_SECRET') {
      return reply
        .status(403)
        .send(
          body('CSRF_INVALID', 'Your session token is missing or stale. Reload and try again.'),
        );
    }
    if (err.statusCode === 429) {
      return reply.status(429).send(body('RATE_LIMITED', 'Too many attempts. Wait and try again.'));
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send(body('FILE_TOO_LARGE', 'The file is too large.'));
    }

    const pg = pgError(err);
    if (pg?.code === 'P0001' && pg.message?.startsWith('EMPLOYEE_CAP_EXCEEDED')) {
      return reply
        .status(409)
        .send(
          body(
            'EMPLOYEE_CAP_EXCEEDED',
            `${pg.message.replace(/^EMPLOYEE_CAP_EXCEEDED:\s*/, '')}. Deactivate or separate an employee, or raise the cap in Settings.`,
          ),
        );
    }
    if (pg?.code === 'P0001' && pg.message?.startsWith('EMPLOYEE_CAP_BELOW_ACTIVE')) {
      return reply
        .status(409)
        .send(
          body(
            'EMPLOYEE_CAP_BELOW_ACTIVE',
            pg.message.replace(/^EMPLOYEE_CAP_BELOW_ACTIVE:\s*/, ''),
          ),
        );
    }
    if (pg?.code === '23505') {
      return reply
        .status(409)
        .send(
          body(
            'DUPLICATE',
            'A record with the same unique value already exists.',
            pg.constraint_name,
          ),
        );
    }
    if (pg?.code === '23503') {
      return reply
        .status(409)
        .send(body('IN_USE', 'This record is referenced by other records.', pg.constraint_name));
    }

    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send(body(err.code ?? 'BAD_REQUEST', err.message));
    }
    request.log.error({ err }, 'Unhandled error');
    return reply.status(500).send(body('INTERNAL', 'Something went wrong.'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found.`));
  });
}
