import { dec } from '@payrollph/shared';
import { and, asc, eq } from 'drizzle-orm';
import { employees, payrollRuns, payslips } from '../../db/schema';
import { conflict, notFound } from '../../lib/http';
import {
  employeeName,
  loadEmployer,
  POSTED_STATUSES,
  RUN_KIND_LABELS,
  tableDoc,
  totalsRow,
  type ReportContext,
  type ReportDoc,
} from './common';

export type PayoutMethod = (typeof employees.$inferSelect)['payoutMethod'];

const METHOD_LABELS: Record<PayoutMethod, string> = { bank: 'Bank', gcash: 'GCash', cash: 'Cash' };

/**
 * Bank/GCash payout file for a posted run. Account numbers are decrypted: callers must make
 * sure only the owner gets here. Only positive net pay is listed.
 */
export async function disbursementReport(
  ctx: ReportContext,
  runId: string,
  method?: PayoutMethod,
): Promise<ReportDoc> {
  const [run] = await ctx.db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) throw notFound('Payroll run');
  if (!(POSTED_STATUSES as readonly string[]).includes(run.status)) {
    throw conflict('RUN_NOT_POSTED', 'Approve the payroll run before exporting the payout file.');
  }
  const employer = await loadEmployer(ctx.db);
  const slips = await ctx.db
    .select({ p: payslips, e: employees })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(
      and(
        eq(payslips.payrollRunId, run.id),
        method ? eq(employees.payoutMethod, method) : undefined,
      ),
    )
    .orderBy(asc(employees.lastName), asc(employees.firstName), asc(employees.employeeNo));

  const reference = `PAYROLL ${run.periodStart} TO ${run.periodEnd}`;
  const rows = slips
    .filter(({ p }) => dec(p.net).gt(0))
    .map(({ p, e }) => [
      e.employeeNo,
      employeeName(e),
      METHOD_LABELS[e.payoutMethod],
      e.bankName ?? '',
      e.accountName ?? '',
      ctx.cipher.decryptNullable(e.accountNumberEnc) ?? '',
      p.net,
      reference,
    ]);
  const columns = [
    { header: 'Employee no.', width: 0.9 },
    { header: 'Name', width: 2.2 },
    { header: 'Method', width: 0.7 },
    { header: 'Bank', width: 1.2 },
    { header: 'Account name', width: 1.8 },
    { header: 'Account number', width: 1.4 },
    { header: 'Amount', money: true },
    { header: 'Reference', width: 2 },
  ];
  return tableDoc({
    fileBase: `disbursement-${run.periodEnd}-${method ?? 'all'}`,
    title: `Payout List — ${RUN_KIND_LABELS[run.kind]} ${run.periodStart} to ${run.periodEnd}`,
    subtitle: [
      `Employer: ${employer.name}`,
      `Pay date: ${run.payDate}    Method: ${method ? METHOD_LABELS[method] : 'All'}    Status: ${run.status.toUpperCase()}`,
    ],
    columns,
    rows,
    totals: totalsRow(rows, columns.length, [6]),
    emptyText: 'Nobody to pay with this method.',
  });
}
