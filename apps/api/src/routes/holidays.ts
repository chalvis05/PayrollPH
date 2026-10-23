import { HolidayInputSchema, HolidaySchema, type HolidayInput } from '@payrollph/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { holidays } from '../db/schema';
import { writeAudit, type DbOrTx } from '../lib/audit';
import { conflict, errorResponses, IdParamsSchema, notFound, OkSchema } from '../lib/http';
import { requireOwner } from '../plugins/auth';
import { isAttendanceLocked } from '../services/payrollRun';

type HolidayRow = typeof holidays.$inferSelect;

const snapshot = (h: HolidayRow | HolidayInput): HolidayInput => ({
  date: h.date,
  name: h.name,
  type: h.type,
});

/** A holiday changes day types (and so premiums) of posted payslips; refuse dates in posted runs. */
async function assertDateOpen(db: DbOrTx, date: string): Promise<void> {
  if (await isAttendanceLocked(db, date)) {
    throw conflict(
      'HOLIDAY_LOCKED',
      `${date} is inside an approved or paid payroll run. Reopen the run to change its holidays.`,
      { date },
    );
  }
}

export const holidayRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['holidays'],
        summary: 'Holiday calendar, optionally for one year',
        querystring: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
        response: { 200: z.array(HolidaySchema), ...errorResponses },
      },
    },
    async (request) => {
      const { year } = request.query;
      const rows = await app.db
        .select()
        .from(holidays)
        .where(
          year === undefined
            ? undefined
            : and(gte(holidays.date, `${year}-01-01`), lte(holidays.date, `${year}-12-31`)),
        )
        .orderBy(asc(holidays.date));
      return rows.map((h) => ({ id: h.id, ...snapshot(h) }));
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['holidays'],
        summary: 'Add a holiday (one per date)',
        body: HolidayInputSchema,
        response: { 201: HolidaySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const row = await app.db.transaction(async (tx) => {
        await assertDateOpen(tx, request.body.date);
        const [created] = await tx.insert(holidays).values(request.body).returning();
        if (!created) throw new Error('Holiday insert returned no row');
        await writeAudit(tx, {
          actorId: me.id,
          action: 'holiday.create',
          entity: 'holiday',
          entityId: created.id,
          after: snapshot(created),
        });
        return created;
      });
      return reply.status(201).send({ id: row.id, ...snapshot(row) });
    },
  );

  app.put(
    '/:id',
    {
      schema: {
        tags: ['holidays'],
        summary: 'Edit a holiday',
        params: IdParamsSchema,
        body: HolidayInputSchema,
        response: { 200: HolidaySchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const row = await app.db.transaction(async (tx) => {
        const [prev] = await tx.select().from(holidays).where(eq(holidays.id, request.params.id));
        if (!prev) throw notFound('Holiday');
        await assertDateOpen(tx, prev.date);
        if (request.body.date !== prev.date) await assertDateOpen(tx, request.body.date);
        const [updated] = await tx
          .update(holidays)
          .set(request.body)
          .where(eq(holidays.id, prev.id))
          .returning();
        if (!updated) throw new Error('Holiday update returned no row');
        await writeAudit(tx, {
          actorId: me.id,
          action: 'holiday.update',
          entity: 'holiday',
          entityId: prev.id,
          before: snapshot(prev),
          after: snapshot(updated),
        });
        return updated;
      });
      return { id: row.id, ...snapshot(row) };
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['holidays'],
        summary: 'Delete a holiday',
        params: IdParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      await app.db.transaction(async (tx) => {
        const [prev] = await tx.select().from(holidays).where(eq(holidays.id, request.params.id));
        if (!prev) throw notFound('Holiday');
        await assertDateOpen(tx, prev.date);
        await tx.delete(holidays).where(eq(holidays.id, prev.id));
        await writeAudit(tx, {
          actorId: me.id,
          action: 'holiday.delete',
          entity: 'holiday',
          entityId: prev.id,
          before: snapshot(prev),
        });
      });
      return { ok: true as const };
    },
  );
};
