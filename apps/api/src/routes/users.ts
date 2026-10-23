import { CreateViewerSchema, UserSchema } from '@payrollph/shared';
import argon2 from 'argon2';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { users } from '../db/schema';
import { writeAudit } from '../lib/audit';
import { badRequest, errorResponses, IdParamsSchema, notFound, OkSchema } from '../lib/http';
import { deleteUserSessions } from '../lib/session';
import { ownerOnly, requireOwner } from '../plugins/auth';
import { toUserDto } from './auth';

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', ownerOnly);

  app.get(
    '/',
    {
      schema: {
        tags: ['users'],
        summary: 'List users (owner only)',
        response: { 200: z.array(UserSchema), ...errorResponses },
      },
    },
    async () => {
      const rows = await app.db.select().from(users).orderBy(asc(users.createdAt));
      return rows.map(toUserDto);
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['users'],
        summary: 'Add a read-only viewer',
        body: CreateViewerSchema,
        response: { 201: UserSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const passwordHash = await argon2.hash(request.body.password, { type: argon2.argon2id });
      const [created] = await app.db
        .insert(users)
        .values({
          name: request.body.name,
          email: request.body.email,
          passwordHash,
          role: 'viewer',
        })
        .returning();
      if (!created) throw new Error('Viewer insert returned no row');
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'user.create',
        entity: 'user',
        entityId: created.id,
        after: { name: created.name, email: created.email, role: created.role },
      });
      return reply.status(201).send(toUserDto(created));
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['users'],
        summary: 'Remove a viewer (the owner cannot be removed)',
        params: IdParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const [row] = await app.db.select().from(users).where(eq(users.id, request.params.id));
      if (!row) throw notFound('User');
      if (row.role === 'owner')
        throw badRequest('CANNOT_DELETE_OWNER', 'The owner cannot be removed.');
      await deleteUserSessions(app.db, row.id);
      await app.db.delete(users).where(eq(users.id, row.id));
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'user.delete',
        entity: 'user',
        entityId: row.id,
        before: { name: row.name, email: row.email, role: row.role },
      });
      return { ok: true as const };
    },
  );
};
