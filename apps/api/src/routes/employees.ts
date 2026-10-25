import { EmployeeInputSchema, EmployeeStatusSchema } from '@payrollph/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employees, loans, payslips } from '../db/schema';
import { writeAudit } from '../lib/audit';
import { conflict, errorResponses, IdParamsSchema, notFound, OkSchema } from '../lib/http';
import { requireOwner, requireUser } from '../plugins/auth';
import {
  auditSnapshot,
  createEmployee,
  EmployeeDetailSchema,
  EmployeeListItemSchema,
  loadEmployeeDetail,
  replaceEmployee,
  toListItem,
} from '../services/employees';

export const employeeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['employees'],
        summary: 'List employees',
        querystring: z.object({ status: EmployeeStatusSchema.optional() }),
        response: { 200: z.array(EmployeeListItemSchema), ...errorResponses },
      },
    },
    async (request) => {
      const { status } = request.query;
      const rows = await app.db
        .select()
        .from(employees)
        .where(status ? eq(employees.status, status) : undefined)
        .orderBy(asc(employees.employeeNo));
      return rows.map(toListItem);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['employees'],
        summary: 'Get one employee (gov IDs masked for viewers)',
        params: IdParamsSchema,
        response: { 200: EmployeeDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const detail = await loadEmployeeDetail(
        app.db,
        app.cipher,
        request.params.id,
        user.role !== 'owner',
      );
      if (!detail) throw notFound('Employee');
      return detail;
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['employees'],
        summary: 'Add an employee (active employees are capped)',
        body: EmployeeInputSchema,
        response: { 201: EmployeeDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const input = request.body;
      const id = await app.db.transaction((tx) =>
        createEmployee(tx, app.cipher, input, { actorId: me.id }),
      );
      const detail = await loadEmployeeDetail(app.db, app.cipher, id, false);
      if (!detail) throw notFound('Employee');
      return reply.status(201).send(detail);
    },
  );

  app.put(
    '/:id',
    {
      schema: {
        tags: ['employees'],
        summary: 'Replace an employee record (allowances and dependents included)',
        params: IdParamsSchema,
        body: EmployeeInputSchema,
        response: { 200: EmployeeDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const { id } = request.params;
      const input = request.body;
      await app.db.transaction((tx) =>
        replaceEmployee(tx, app.cipher, id, input, { actorId: me.id }),
      );
      const detail = await loadEmployeeDetail(app.db, app.cipher, id, false);
      if (!detail) throw notFound('Employee');
      return detail;
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['employees'],
        summary: 'Delete an employee with no payroll history (otherwise mark them separated)',
        params: IdParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const { id } = request.params;
      await app.db.transaction(async (tx) => {
        const before = await loadEmployeeDetail(tx, app.cipher, id, false);
        if (!before) throw notFound('Employee');
        const [history] = await tx
          .select({
            slips: sql<number>`(select count(*)::int from ${payslips} where ${payslips.employeeId} = ${id})`,
            loanCount: sql<number>`(select count(*)::int from ${loans} where ${loans.employeeId} = ${id})`,
          })
          .from(employees)
          .where(eq(employees.id, id));
        if ((history?.slips ?? 0) > 0 || (history?.loanCount ?? 0) > 0) {
          throw conflict(
            'HAS_HISTORY',
            'This employee has payslips or loans. Set their status to separated instead of deleting.',
          );
        }
        await tx.delete(employees).where(eq(employees.id, id));
        const {
          sensitiveMasked: _m,
          missingGovIds: _g,
          id: _i,
          createdAt: _c,
          updatedAt: _u,
          ...prev
        } = before;
        await writeAudit(tx, {
          actorId: me.id,
          action: 'employee.delete',
          entity: 'employee',
          entityId: id,
          before: auditSnapshot(prev),
        });
      });
      return { ok: true as const };
    },
  );
};
