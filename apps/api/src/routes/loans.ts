import {
  dec,
  LoanAdjustmentSchema,
  LoanInputSchema,
  LoanLedgerEntrySchema,
  LoanSchema,
  LoanUpdateSchema,
  toMoney,
} from '@payrollph/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employees, loanLedger, loans } from '../db/schema';
import { writeAudit, type DbOrTx } from '../lib/audit';
import { badRequest, conflict, errorResponses, IdParamsSchema, notFound } from '../lib/http';
import { requireOwner } from '../plugins/auth';
import { loanBalance, loanBalances, recordDisbursement } from '../services/loans';

type LoanRow = typeof loans.$inferSelect;
type Loan = z.infer<typeof LoanSchema>;

const LoanDetailSchema = LoanSchema.extend({ ledger: z.array(LoanLedgerEntrySchema) });
type LoanDetail = z.infer<typeof LoanDetailSchema>;

const ListQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  status: LoanSchema.shape.status.optional(),
});

function toLoanDto(l: LoanRow, balance: string): Loan {
  return {
    id: l.id,
    employeeId: l.employeeId,
    type: l.type,
    reference: l.reference,
    principal: l.principal,
    amortization: l.amortization,
    deductOn: l.deductOn,
    startDate: l.startDate,
    balance,
    status: l.status,
    notes: l.notes,
  };
}

/** Audit snapshot without the derived balance. */
function loanSnapshot(l: LoanRow) {
  return {
    employeeId: l.employeeId,
    type: l.type,
    reference: l.reference,
    principal: l.principal,
    amortization: l.amortization,
    deductOn: l.deductOn,
    startDate: l.startDate,
    status: l.status,
    notes: l.notes,
  };
}

async function loadDetail(db: DbOrTx, id: string): Promise<LoanDetail> {
  const [loan] = await db.select().from(loans).where(eq(loans.id, id));
  if (!loan) throw notFound('Loan');
  const ledger = await db
    .select()
    .from(loanLedger)
    .where(eq(loanLedger.loanId, id))
    .orderBy(asc(loanLedger.date), asc(loanLedger.createdAt), asc(loanLedger.kind));
  return {
    ...toLoanDto(loan, await loanBalance(db, id)),
    ledger: ledger.map((r) => ({
      id: r.id,
      loanId: r.loanId,
      date: r.date,
      payrollRunId: r.payrollRunId,
      kind: r.kind,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      note: r.note,
    })),
  };
}

/** Lock and return a loan for a write. */
async function lockLoan(db: DbOrTx, id: string): Promise<LoanRow> {
  const [loan] = await db.select().from(loans).where(eq(loans.id, id)).for('update');
  if (!loan) throw notFound('Loan');
  return loan;
}

export const loanRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['loans'],
        summary: 'Loans with their current balance (sum of the ledger)',
        querystring: ListQuerySchema,
        response: { 200: z.array(LoanSchema), ...errorResponses },
      },
    },
    async (request) => {
      const { employeeId, status } = request.query;
      const conds = [];
      if (employeeId) conds.push(eq(loans.employeeId, employeeId));
      if (status) conds.push(eq(loans.status, status));
      const rows = await app.db
        .select()
        .from(loans)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(loans.startDate), desc(loans.createdAt));
      const balances = await loanBalances(
        app.db,
        rows.map((r) => r.id),
      );
      return rows.map((r) => toLoanDto(r, balances.get(r.id) ?? '0.00'));
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['loans'],
        summary: 'One loan with its ledger (oldest first)',
        params: IdParamsSchema,
        response: { 200: LoanDetailSchema, ...errorResponses },
      },
    },
    async (request) => loadDetail(app.db, request.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['loans'],
        summary: 'Record a loan and its disbursement',
        body: LoanInputSchema,
        response: { 201: LoanDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const input = request.body;
      if (!dec(input.principal).gt(0)) {
        throw badRequest('VALIDATION_ERROR', 'Principal must be more than zero.', [
          { path: '/principal', message: 'Principal must be more than zero' },
        ]);
      }
      const id = await app.db.transaction(async (tx) => {
        const [emp] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.id, input.employeeId));
        if (!emp) throw notFound('Employee');
        const [row] = await tx
          .insert(loans)
          .values({
            ...input,
            principal: toMoney(input.principal),
            amortization: toMoney(input.amortization),
          })
          .returning();
        if (!row) throw new Error('Loan insert returned no row');
        await recordDisbursement(tx, row);
        await writeAudit(tx, {
          actorId: me.id,
          action: 'loan.create',
          entity: 'loan',
          entityId: row.id,
          after: loanSnapshot(row),
        });
        return row.id;
      });
      return reply.status(201).send(await loadDetail(app.db, id));
    },
  );

  app.put(
    '/:id',
    {
      schema: {
        tags: ['loans'],
        summary: 'Edit reference, amortization, deduction schedule or notes',
        params: IdParamsSchema,
        body: LoanUpdateSchema,
        response: { 200: LoanDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const body = request.body;
      await app.db.transaction(async (tx) => {
        const prev = await lockLoan(tx, request.params.id);
        const [updated] = await tx
          .update(loans)
          .set({
            reference: body.reference,
            amortization: toMoney(body.amortization),
            deductOn: body.deductOn,
            notes: body.notes,
          })
          .where(eq(loans.id, prev.id))
          .returning();
        if (!updated) throw new Error('Loan update returned no row');
        await writeAudit(tx, {
          actorId: me.id,
          action: 'loan.update',
          entity: 'loan',
          entityId: prev.id,
          before: loanSnapshot(prev),
          after: loanSnapshot(updated),
        });
      });
      return loadDetail(app.db, request.params.id);
    },
  );

  app.post(
    '/:id/adjustments',
    {
      schema: {
        tags: ['loans'],
        summary:
          'Manual payment outside payroll (negative) or correction (±). The balance cannot go below zero.',
        params: IdParamsSchema,
        body: LoanAdjustmentSchema,
        response: { 200: LoanDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const { date, amount, note } = request.body;
      await app.db.transaction(async (tx) => {
        const loan = await lockLoan(tx, request.params.id);
        if (loan.status === 'cancelled') {
          throw conflict('LOAN_CANCELLED', 'This loan is cancelled.');
        }
        const before = dec(await loanBalance(tx, loan.id));
        const after = before.plus(amount);
        if (after.lt(0)) {
          throw badRequest(
            'BALANCE_BELOW_ZERO',
            `The balance is ${toMoney(before)}; this adjustment would take it below zero.`,
          );
        }
        await tx.insert(loanLedger).values({
          loanId: loan.id,
          date,
          kind: 'adjustment',
          amount: toMoney(amount),
          balanceAfter: toMoney(after),
          note,
        });
        const status = after.isZero() ? 'paid' : 'active';
        if (status !== loan.status) {
          await tx.update(loans).set({ status }).where(eq(loans.id, loan.id));
        }
        await writeAudit(tx, {
          actorId: me.id,
          action: 'loan.adjust',
          entity: 'loan',
          entityId: loan.id,
          reason: note,
          before: { balance: toMoney(before), status: loan.status },
          after: { date, amount: toMoney(amount), balance: toMoney(after), status },
        });
      });
      return loadDetail(app.db, request.params.id);
    },
  );

  app.post(
    '/:id/cancel',
    {
      schema: {
        tags: ['loans'],
        summary: 'Cancel a loan entered by mistake (only while no payroll has deducted it)',
        params: IdParamsSchema,
        response: { 200: LoanDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      await app.db.transaction(async (tx) => {
        const loan = await lockLoan(tx, request.params.id);
        if (loan.status === 'cancelled') {
          throw conflict('LOAN_CANCELLED', 'This loan is already cancelled.');
        }
        const [payment] = await tx
          .select({ id: loanLedger.id })
          .from(loanLedger)
          .where(and(eq(loanLedger.loanId, loan.id), eq(loanLedger.kind, 'payment')))
          .limit(1);
        if (payment) {
          throw conflict(
            'LOAN_HAS_PAYMENTS',
            'Payroll has already deducted this loan. Record an adjustment instead of cancelling.',
          );
        }
        await tx.update(loans).set({ status: 'cancelled' }).where(eq(loans.id, loan.id));
        await writeAudit(tx, {
          actorId: me.id,
          action: 'loan.cancel',
          entity: 'loan',
          entityId: loan.id,
          before: loanSnapshot(loan),
          after: { ...loanSnapshot(loan), status: 'cancelled' },
        });
      });
      return loadDetail(app.db, request.params.id);
    },
  );
};
