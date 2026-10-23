import { AuditEntrySchema } from '@payrollph/shared';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
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
        summary: 'Audit log, newest first (owner only). Page with `before` = last entry `at`.',
        querystring: z.object({
          entity: z.string().optional(),
          entityId: z.string().optional(),
          before: z.iso.datetime({ offset: true }).optional(),
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
      if (q.before) conds.push(lt(auditLog.at, new Date(q.before)));
      const rows = await app.db
        .select({ a: auditLog, email: users.email })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(auditLog.at))
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
