import {
  ChangeRequestStatusSchema,
  EmployeeChangeInputSchema,
  RejectChangeRequestSchema,
} from '@payrollph/shared';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employeeChangeRequests, employees, users } from '../db/schema';
import { writeAudit, type DbOrTx } from '../lib/audit';
import {
  badRequest,
  conflict,
  errorResponses,
  forbidden,
  IdParamsSchema,
  notFound,
} from '../lib/http';
import type { SessionUser } from '../lib/session';
import { requireOwner, requireUser } from '../plugins/auth';
import {
  createEmployee,
  detailToInput,
  fullName,
  loadEmployeeDetail,
  replaceEmployee,
} from '../services/employees';
import {
  decodeChange,
  diffEmployee,
  encodeChange,
  maskEmployee,
  resolveChange,
} from '../services/employeeRequests';

const PersonSchema = z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable();

const ChangeRequestSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['create', 'update']),
  employeeId: z.uuid().nullable(),
  status: ChangeRequestStatusSchema,
  summary: z.object({ employeeNo: z.string(), fullName: z.string() }),
  requestedBy: PersonSchema,
  requestedAt: z.string(),
  decidedBy: PersonSchema,
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  resultEmployeeId: z.uuid().nullable(),
});

const ChangeRequestDetailSchema = ChangeRequestSchema.extend({
  proposed: EmployeeChangeInputSchema,
  changes: z.array(
    z.object({
      field: z.string(),
      label: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
  ),
});

const SubmitSchema = z.object({
  /** The employee to edit; omit or null to propose a new employee. */
  employeeId: z.uuid().nullable().default(null),
  data: EmployeeChangeInputSchema,
});

type RequestRow = typeof employeeChangeRequests.$inferSelect;

/** Encoders and the owner may use this; viewers may not. */
function requireSubmitter(user: SessionUser): void {
  if (user.role !== 'owner' && user.role !== 'encoder') {
    throw forbidden('Only the owner or an encoder can work with employee requests.');
  }
}

async function people(db: DbOrTx, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
  if (wanted.length === 0) return new Map<string, { id: string; name: string; email: string }>();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

async function toDtos(
  db: DbOrTx,
  rows: RequestRow[],
): Promise<z.infer<typeof ChangeRequestSchema>[]> {
  const who = await people(
    db,
    rows.flatMap((r) => [r.requestedBy, r.decidedBy]),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    employeeId: r.employeeId,
    status: r.status,
    summary: r.summary,
    requestedBy: r.requestedBy ? (who.get(r.requestedBy) ?? null) : null,
    requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy ? (who.get(r.decidedBy) ?? null) : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    resultEmployeeId: r.resultEmployeeId,
  }));
}

async function toDto(db: DbOrTx, row: RequestRow): Promise<z.infer<typeof ChangeRequestSchema>> {
  const [dto] = await toDtos(db, [row]);
  if (!dto) throw new Error('Request DTO mapping returned nothing');
  return dto;
}

export const employeeRequestRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (request) => {
    requireSubmitter(requireUser(request));
  });

  /** Load a request the caller may see: the owner sees all; an encoder only their own. */
  const loadVisible = async (db: DbOrTx, id: string, user: SessionUser): Promise<RequestRow> => {
    const [row] = await db
      .select()
      .from(employeeChangeRequests)
      .where(eq(employeeChangeRequests.id, id))
      .limit(1);
    if (!row || (user.role !== 'owner' && row.requestedBy !== user.id)) {
      throw notFound('Request');
    }
    return row;
  };

  app.get(
    '/',
    {
      schema: {
        tags: ['employee requests'],
        summary: 'Employee change requests (owner: all; encoder: their own), newest first',
        querystring: z.object({ status: ChangeRequestStatusSchema.optional() }),
        response: { 200: z.array(ChangeRequestSchema), ...errorResponses },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const conds: SQL[] = [];
      if (request.query.status) conds.push(eq(employeeChangeRequests.status, request.query.status));
      if (user.role !== 'owner') conds.push(eq(employeeChangeRequests.requestedBy, user.id));
      const rows = await app.db
        .select()
        .from(employeeChangeRequests)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(employeeChangeRequests.requestedAt))
        .limit(200);
      return toDtos(app.db, rows);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['employee requests'],
        summary: 'One request with the proposed record and a field-by-field diff',
        params: IdParamsSchema,
        response: { 200: ChangeRequestDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const row = await loadVisible(app.db, request.params.id, user);
      const proposed = decodeChange(app.cipher.decrypt(row.payloadEnc));
      const currentDetail = row.employeeId
        ? await loadEmployeeDetail(app.db, app.cipher, row.employeeId, false)
        : null;
      const current = currentDetail ? detailToInput(currentDetail) : null;
      const isOwner = user.role === 'owner';
      // The owner sees what approval will actually write (masked values resolved); others see
      // everything masked.
      let shown = proposed;
      if (isOwner && current) {
        try {
          shown = resolveChange(proposed, current);
        } catch {
          shown = proposed;
        }
      }
      const changes = isOwner
        ? diffEmployee(current, shown)
        : diffEmployee(current ? maskEmployee(current) : null, maskEmployee(proposed));
      const dto = await toDto(app.db, row);
      return { ...dto, proposed: isOwner ? shown : maskEmployee(proposed), changes };
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['employee requests'],
        summary: 'Submit a new employee or an edit for owner approval',
        body: SubmitSchema,
        response: { 201: ChangeRequestSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { employeeId, data } = request.body;
      const row = await app.db.transaction(async (tx) => {
        let current = null;
        if (employeeId) {
          const detail = await loadEmployeeDetail(tx, app.cipher, employeeId, false);
          if (!detail) throw notFound('Employee');
          current = detailToInput(detail);
          const [pending] = await tx
            .select({ id: employeeChangeRequests.id })
            .from(employeeChangeRequests)
            .where(
              and(
                eq(employeeChangeRequests.employeeId, employeeId),
                eq(employeeChangeRequests.status, 'pending'),
              ),
            )
            .limit(1);
          if (pending) {
            throw conflict(
              'REQUEST_PENDING',
              'This employee already has a change waiting for approval.',
              { id: pending.id },
            );
          }
        } else {
          const [taken] = await tx
            .select({ id: employees.id })
            .from(employees)
            .where(eq(employees.employeeNo, data.employeeNo))
            .limit(1);
          const [pendingSameNo] = await tx
            .select({ id: employeeChangeRequests.id })
            .from(employeeChangeRequests)
            .where(
              and(
                eq(employeeChangeRequests.status, 'pending'),
                eq(employeeChangeRequests.kind, 'create'),
                sql`${employeeChangeRequests.summary}->>'employeeNo' = ${data.employeeNo}`,
              ),
            )
            .limit(1);
          if (taken || pendingSameNo) {
            throw conflict('DUPLICATE', `Employee no. ${data.employeeNo} is already used.`);
          }
        }
        // Validate now (masked values resolved against the current record) so mistakes surface
        // to the encoder, not at approval time.
        resolveChange(data, current);
        const [created] = await tx
          .insert(employeeChangeRequests)
          .values({
            kind: employeeId ? 'update' : 'create',
            employeeId,
            payloadEnc: app.cipher.encrypt(encodeChange(data)),
            summary: { employeeNo: data.employeeNo, fullName: fullName(data) },
            requestedBy: user.id,
          })
          .returning();
        if (!created) throw new Error('Request insert returned no row');
        await writeAudit(tx, {
          actorId: user.id,
          action: 'employee_request.submit',
          entity: 'employee_request',
          entityId: created.id,
          after: {
            kind: created.kind,
            employeeId,
            changes: diffEmployee(current ? maskEmployee(current) : null, maskEmployee(data)).map(
              (c) => c.field,
            ),
          },
        });
        return created;
      });
      const dto = await toDto(app.db, row);
      return reply.status(201).send(dto);
    },
  );

  app.post(
    '/:id/cancel',
    {
      schema: {
        tags: ['employee requests'],
        summary: 'Withdraw a pending request (the requester or the owner)',
        params: IdParamsSchema,
        response: { 200: ChangeRequestSchema, ...errorResponses },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const row = await app.db.transaction(async (tx) => {
        const current = await loadVisible(tx, request.params.id, user);
        if (current.status !== 'pending') {
          throw conflict('NOT_PENDING', `This request is already ${current.status}.`);
        }
        const [updated] = await tx
          .update(employeeChangeRequests)
          .set({ status: 'cancelled', decidedBy: user.id, decidedAt: new Date() })
          .where(
            and(
              eq(employeeChangeRequests.id, current.id),
              eq(employeeChangeRequests.status, 'pending'),
            ),
          )
          .returning();
        if (!updated) throw conflict('NOT_PENDING', 'This request was just decided.');
        await writeAudit(tx, {
          actorId: user.id,
          action: 'employee_request.cancel',
          entity: 'employee_request',
          entityId: updated.id,
        });
        return updated;
      });
      const dto = await toDto(app.db, row);
      return dto;
    },
  );

  app.post(
    '/:id/approve',
    {
      schema: {
        tags: ['employee requests'],
        summary: 'Approve: create or update the employee exactly as a direct owner edit would',
        params: IdParamsSchema,
        response: { 200: ChangeRequestSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const row = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(employeeChangeRequests)
          .where(eq(employeeChangeRequests.id, request.params.id))
          .for('update')
          .limit(1);
        if (!current) throw notFound('Request');
        if (current.status !== 'pending') {
          throw conflict('NOT_PENDING', `This request is already ${current.status}.`);
        }
        const change = decodeChange(app.cipher.decrypt(current.payloadEnc));
        const [requester] = current.requestedBy
          ? await tx
              .select({ email: users.email })
              .from(users)
              .where(eq(users.id, current.requestedBy))
          : [];
        const reason = `Approved request ${current.id} from ${requester?.email ?? 'a removed user'}`;
        let resultId: string;
        if (current.kind === 'create') {
          resultId = await createEmployee(tx, app.cipher, resolveChange(change, null), {
            actorId: me.id,
            reason,
          });
        } else {
          if (!current.employeeId) throw badRequest('EMPLOYEE_GONE', 'The employee was deleted.');
          const detail = await loadEmployeeDetail(tx, app.cipher, current.employeeId, false);
          if (!detail) throw badRequest('EMPLOYEE_GONE', 'The employee was deleted.');
          const input = resolveChange(change, detailToInput(detail));
          await replaceEmployee(tx, app.cipher, current.employeeId, input, {
            actorId: me.id,
            reason,
          });
          resultId = current.employeeId;
        }
        const [updated] = await tx
          .update(employeeChangeRequests)
          .set({
            status: 'approved',
            decidedBy: me.id,
            decidedAt: new Date(),
            resultEmployeeId: resultId,
          })
          .where(eq(employeeChangeRequests.id, current.id))
          .returning();
        if (!updated) throw new Error('Request update returned no row');
        await writeAudit(tx, {
          actorId: me.id,
          action: 'employee_request.approve',
          entity: 'employee_request',
          entityId: updated.id,
          after: { employeeId: resultId, kind: updated.kind },
        });
        return updated;
      });
      const dto = await toDto(app.db, row);
      return dto;
    },
  );

  app.post(
    '/:id/reject',
    {
      schema: {
        tags: ['employee requests'],
        summary: 'Reject a pending request with a reason',
        params: IdParamsSchema,
        body: RejectChangeRequestSchema,
        response: { 200: ChangeRequestSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const row = await app.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(employeeChangeRequests)
          .set({
            status: 'rejected',
            decidedBy: me.id,
            decidedAt: new Date(),
            decisionNote: request.body.reason,
          })
          .where(
            and(
              eq(employeeChangeRequests.id, request.params.id),
              eq(employeeChangeRequests.status, 'pending'),
            ),
          )
          .returning();
        if (!updated) {
          const [exists] = await tx
            .select({ status: employeeChangeRequests.status })
            .from(employeeChangeRequests)
            .where(eq(employeeChangeRequests.id, request.params.id));
          if (!exists) throw notFound('Request');
          throw conflict('NOT_PENDING', `This request is already ${exists.status}.`);
        }
        await writeAudit(tx, {
          actorId: me.id,
          action: 'employee_request.reject',
          entity: 'employee_request',
          entityId: updated.id,
          reason: request.body.reason,
        });
        return updated;
      });
      const dto = await toDto(app.db, row);
      return dto;
    },
  );
};
