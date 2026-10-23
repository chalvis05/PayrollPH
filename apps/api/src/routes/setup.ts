import { SetupSchema, UserSchema } from '@payrollph/shared';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { settings, users } from '../db/schema';
import { writeAudit } from '../lib/audit';
import { conflict, errorResponses } from '../lib/http';
import { createSession } from '../lib/session';
import { setSessionCookie, toUserDto } from './auth';

export const setupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/setup/status',
    {
      schema: {
        tags: ['setup'],
        summary: 'Whether the first-run setup wizard still needs to run',
        security: [],
        response: {
          200: z.object({ needsSetup: z.boolean(), adminEmail: z.string().nullable() }),
        },
      },
    },
    async () => {
      const [owner] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'owner'))
        .limit(1);
      return { needsSetup: !owner, adminEmail: owner ? null : app.config.adminEmail };
    },
  );

  app.post(
    '/setup',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        tags: ['setup'],
        summary: 'Create the owner account (only works once)',
        security: [],
        body: SetupSchema,
        response: { 201: z.object({ user: UserSchema }), ...errorResponses },
      },
    },
    async (request, reply) => {
      const input = request.body;
      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const user = await app.db.transaction(async (tx) => {
        // Serialise concurrent setup attempts; only the first may create the owner.
        await tx.execute("select pg_advisory_xact_lock(hashtext('payrollph_setup'))");
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, 'owner'))
          .limit(1);
        if (existing) throw conflict('ALREADY_SET_UP', 'Setup has already been completed.');
        const [created] = await tx
          .insert(users)
          .values({ name: input.ownerName, email: input.email, passwordHash, role: 'owner' })
          .returning();
        if (!created) throw new Error('Owner insert returned no row');
        await tx
          .insert(settings)
          .values({
            id: 1,
            ownerName: input.ownerName,
            payFrequency: input.payFrequency,
            defaultRegion: input.region,
            setupCompletedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: settings.id,
            set: {
              ownerName: input.ownerName,
              payFrequency: input.payFrequency,
              defaultRegion: input.region,
              setupCompletedAt: new Date(),
            },
          });
        await writeAudit(tx, {
          actorId: created.id,
          action: 'setup.complete',
          entity: 'user',
          entityId: created.id,
          after: { name: created.name, email: created.email, role: created.role },
        });
        return created;
      });
      const session = await createSession(app.db, user.id, app.config.sessionTtlHours);
      setSessionCookie(app, reply, session.token, session.expiresAt);
      return reply.status(201).send({ user: toUserDto(user) });
    },
  );
};
