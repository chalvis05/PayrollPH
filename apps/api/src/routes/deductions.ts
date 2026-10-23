import { CustomDeductionInputSchema, CustomDeductionSchema, toMoney } from '@payrollph/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { customDeductions, employees } from '../db/schema';
import { writeAudit, type DbOrTx } from '../lib/audit';
import {
  badRequest,
  conflict,
  errorResponses,
  IdParamsSchema,
  notFound,
  OkSchema,
} from '../lib/http';
import { requireOwner } from '../plugins/auth';

type DeductionRow = typeof customDeductions.$inferSelect;

// Shared schemas: the input (with `active`, positive amount, end ≥ start) and the response.
const DeductionBodySchema = CustomDeductionInputSchema;
type DeductionBody = z.infer<typeof DeductionBodySchema>;
const DeductionSchema = CustomDeductionSchema;
type Deduction = z.infer<typeof DeductionSchema>;

const ListQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  active: z.enum(['true', 'false']).optional(),
});

function toDto(d: DeductionRow): Deduction {
  return {
    id: d.id,
    employeeId: d.employeeId,
    label: d.label,
    amount: d.amount,
    recurrence: d.recurrence,
    startDate: d.startDate,
    endDate: d.endDate,
    active: d.active,
    appliedRunId: d.appliedRunId,
    createdAt: d.createdAt.toISOString(),
  };
}

function snapshot(d: DeductionRow | DeductionBody) {
  return {
    employeeId: d.employeeId,
    label: d.label,
    amount: d.amount,
    recurrence: d.recurrence,
    startDate: d.startDate,
    endDate: d.endDate,
    active: d.active,
  };
}

async function checkBody(db: DbOrTx, body: DeductionBody): Promise<void> {
  if (body.endDate !== null && body.endDate < body.startDate) {
    throw badRequest('VALIDATION_ERROR', 'The end date cannot be before the start date.', [
      { path: '/endDate', message: 'End date must be on or after the start date' },
    ]);
  }
  const [emp] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, body.employeeId));
  if (!emp) throw notFound('Employee');
}

const columns = (body: DeductionBody) => ({ ...body, amount: toMoney(body.amount) });

/** Lock a deduction for a write and refuse one-offs already taken by an approved run. */
async function lockEditable(db: DbOrTx, id: string): Promise<DeductionRow> {
  const [row] = await db
    .select()
    .from(customDeductions)
    .where(eq(customDeductions.id, id))
    .for('update');
  if (!row) throw notFound('Deduction');
  if (row.appliedRunId !== null) {
    throw conflict(
      'DEDUCTION_APPLIED',
      'This one-off deduction was already taken by an approved payroll run. Reopen that run to change it.',
      { payrollRunId: row.appliedRunId },
    );
  }
  return row;
}

export const deductionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['deductions'],
        summary: 'Custom deductions (one-off or recurring)',
        querystring: ListQuerySchema,
        response: { 200: z.array(DeductionSchema), ...errorResponses },
      },
    },
    async (request) => {
      const { employeeId, active } = request.query;
      const conds = [];
      if (employeeId) conds.push(eq(customDeductions.employeeId, employeeId));
      if (active) conds.push(eq(customDeductions.active, active === 'true'));
      const rows = await app.db
        .select()
        .from(customDeductions)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(customDeductions.startDate), asc(customDeductions.label));
      return rows.map(toDto);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['deductions'],
        summary: 'One custom deduction',
        params: IdParamsSchema,
        response: { 200: DeductionSchema, ...errorResponses },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select()
        .from(customDeductions)
        .where(eq(customDeductions.id, request.params.id));
      if (!row) throw notFound('Deduction');
      return toDto(row);
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['deductions'],
        summary: 'Add a custom deduction',
        body: DeductionBodySchema,
        response: { 201: DeductionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const row = await app.db.transaction(async (tx) => {
        await checkBody(tx, request.body);
        const [created] = await tx
          .insert(customDeductions)
          .values(columns(request.body))
          .returning();
        if (!created) throw new Error('Deduction insert returned no row');
        await writeAudit(tx, {
          actorId: me.id,
          action: 'deduction.create',
          entity: 'custom_deduction',
          entityId: created.id,
          after: snapshot(created),
        });
        return created;
      });
      return reply.status(201).send(toDto(row));
    },
  );

  app.put(
    '/:id',
    {
      schema: {
        tags: ['deductions'],
        summary: 'Edit a custom deduction (not one-offs already applied by an approved run)',
        params: IdParamsSchema,
        body: DeductionBodySchema,
        response: { 200: DeductionSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const row = await app.db.transaction(async (tx) => {
        const prev = await lockEditable(tx, request.params.id);
        await checkBody(tx, request.body);
        const [updated] = await tx
          .update(customDeductions)
          .set(columns(request.body))
          .where(eq(customDeductions.id, prev.id))
          .returning();
        if (!updated) throw new Error('Deduction update returned no row');
        await writeAudit(tx, {
          actorId: me.id,
          action: 'deduction.update',
          entity: 'custom_deduction',
          entityId: prev.id,
          before: snapshot(prev),
          after: snapshot(updated),
        });
        return updated;
      });
      return toDto(row);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['deductions'],
        summary: 'Delete a custom deduction (not one-offs already applied by an approved run)',
        params: IdParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      await app.db.transaction(async (tx) => {
        const prev = await lockEditable(tx, request.params.id);
        await tx.delete(customDeductions).where(eq(customDeductions.id, prev.id));
        await writeAudit(tx, {
          actorId: me.id,
          action: 'deduction.delete',
          entity: 'custom_deduction',
          entityId: prev.id,
          before: snapshot(prev),
        });
      });
      return { ok: true as const };
    },
  );
};
