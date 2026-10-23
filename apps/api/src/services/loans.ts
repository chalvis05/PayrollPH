import { dec } from '@payrollph/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { loanLedger, loans } from '../db/schema';
import type { DbOrTx } from '../lib/audit';

/**
 * Loan balances are the SUM of ledger amounts (disbursement +principal, payments negative,
 * adjustments ±), so they never depend on row ordering.
 */
export async function loanBalances(db: DbOrTx, loanIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (loanIds.length === 0) return out;
  const rows = await db
    .select({
      loanId: loanLedger.loanId,
      balance: sql<string>`coalesce(sum(${loanLedger.amount}), 0)::numeric(14,2)::text`,
    })
    .from(loanLedger)
    .where(inArray(loanLedger.loanId, loanIds))
    .groupBy(loanLedger.loanId);
  for (const id of loanIds) out.set(id, '0.00');
  for (const r of rows) out.set(r.loanId, r.balance);
  return out;
}

export async function loanBalance(db: DbOrTx, loanId: string): Promise<string> {
  return (await loanBalances(db, [loanId])).get(loanId) ?? '0.00';
}

/** Record the initial disbursement for a new loan. */
export async function recordDisbursement(
  db: DbOrTx,
  loan: { id: string; principal: string; startDate: string },
): Promise<void> {
  await db.insert(loanLedger).values({
    loanId: loan.id,
    date: loan.startDate,
    kind: 'disbursement',
    amount: loan.principal,
    balanceAfter: loan.principal,
    note: 'Loan released',
  });
}

/** Remove a payroll run's loan payments (used when a run is reopened) and reactivate loans. */
export async function reverseRunLoanPayments(db: DbOrTx, payrollRunId: string): Promise<void> {
  const affected = await db
    .delete(loanLedger)
    .where(and(eq(loanLedger.payrollRunId, payrollRunId), eq(loanLedger.kind, 'payment')))
    .returning({ loanId: loanLedger.loanId });
  const ids = [...new Set(affected.map((a) => a.loanId))];
  if (ids.length === 0) return;
  const balances = await loanBalances(db, ids);
  for (const id of ids) {
    if (dec(balances.get(id) ?? '0').gt(0)) {
      await db
        .update(loans)
        .set({ status: 'active' })
        .where(and(eq(loans.id, id), eq(loans.status, 'paid')));
    }
  }
}
