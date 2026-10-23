import { AuditEntrySchema } from '@payrollph/shared';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditLog, users } from '../db/schema';
import { errorResponses } from '../lib/http';
import { ownerOnly } from '../plugins/auth';

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      onRequest: ownerOnly,
      schema: {
        tags: ['audit'],
        summary:
          'Audit log, newest first (owner only). Page with `before` + `beforeId` = the last entry `at` and `id`.',
        querystring: z.object({
          entity: z.string().optional(),
          entityId: z.string().optional(),
          before: z.iso.datetime({ offset: true }).optional(),
          /** Tie-breaker for entries sharing the same `at` across a page boundary. */
          beforeId: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.array(AuditEntrySchema), ...errorResponses },
      },
    },
    async (request) => {
      const q = request.query;
      const conds: SQL[] = [];
      if (q.entity) conds.push(eq(auditLog.entity, q.entity));
      if (q.entityId) conds.push(eq(auditLog.entityId, q.entityId));
      if (q.before) {
        const at = new Date(q.before);
        const cursor = q.beforeId
          ? or(lt(auditLog.at, at), and(eq(auditLog.at, at), lt(auditLog.id, q.beforeId)))
          : lt(auditLog.at, at);
        if (cursor) conds.push(cursor);
      }
      const rows = await app.db
        .select({ a: auditLog, email: users.email })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(q.limit);
      return rows.map(({ a, email }) => ({
        id: a.id,
        at: a.at.toISOString(),
        actorId: a.actorId,
        actorEmail: email,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        reason: a.reason,
        before: a.before,
        after: a.after,
      }));
    },
  );
};
