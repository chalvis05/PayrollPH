import { asc, eq, inArray } from 'drizzle-orm';
import { employees, loanLedger, loans } from '../../db/schema';
import type { PdfRow } from '../../lib/pdf/table';
import { manilaToday } from '../dates';
import { loanBalances } from '../loans';
import { addAll, employeeName, loadEmployer, type ReportContext, type ReportDoc } from './common';

type LoanStatus = (typeof loans.$inferSelect)['status'];

const LOAN_TYPE_LABELS: Record<(typeof loans.$inferSelect)['type'], string> = {
  sss: 'SSS loan',
  pagibig: 'Pag-IBIG loan',
  company: 'Company loan',
  cash_advance: 'Cash advance',
};

/** Loan ledgers. The current balance is the SUM of ledger amounts (see services/loans.ts). */
export async function loansReport(ctx: ReportContext, status?: LoanStatus): Promise<ReportDoc> {
  const employer = await loadEmployer(ctx.db);
  const list = await ctx.db
    .select({ l: loans, e: employees })
    .from(loans)
    .innerJoin(employees, eq(employees.id, loans.employeeId))
    .where(status ? eq(loans.status, status) : undefined)
    .orderBy(asc(employees.lastName), asc(employees.firstName), asc(loans.startDate));
  const ids = list.map((x) => x.l.id);
  const balances = await loanBalances(ctx.db, ids);
  const ledger =
    ids.length === 0
      ? []
      : await ctx.db
          .select()
          .from(loanLedger)
          .where(inArray(loanLedger.loanId, ids))
          .orderBy(asc(loanLedger.date), asc(loanLedger.createdAt));
  const ledgerByLoan = new Map<string, (typeof ledger)[number][]>();
  for (const row of ledger) {
    const arr = ledgerByLoan.get(row.loanId) ?? [];
    arr.push(row);
    ledgerByLoan.set(row.loanId, arr);
  }

  const header = [
    'Employee no.',
    'Employee',
    'Loan type',
    'Reference',
    'Principal',
    'Amortization',
    'Status',
    'Current balance',
    'Entry date',
    'Entry kind',
    'Entry amount',
    'Balance after',
    'Note',
  ];
  const csvRows: string[][] = [];
  const pdfRows: PdfRow[] = [];
  for (const { l, e } of list) {
    const balance = balances.get(l.id) ?? '0.00';
    const loanCells = [
      e.employeeNo,
      employeeName(e),
      LOAN_TYPE_LABELS[l.type],
      l.reference ?? '',
      l.principal,
      l.amortization,
      l.status,
      balance,
    ];
    const entries = ledgerByLoan.get(l.id) ?? [];
    if (entries.length === 0) csvRows.push([...loanCells, '', '', '', '', '']);
    for (const x of entries) {
      csvRows.push([...loanCells, x.date, x.kind, x.amount, x.balanceAfter, x.note ?? '']);
    }

    pdfRows.push({
      cells: [
        `${employeeName(e)} (${e.employeeNo})`,
        `${LOAN_TYPE_LABELS[l.type]}${l.reference ? ` ${l.reference}` : ''}`,
        l.status,
        l.startDate,
        `Principal ${l.principal} / amort. ${l.amortization}`,
        '',
        '',
        '',
      ],
      bold: true,
    });
    for (const x of entries) {
      pdfRows.push({ cells: ['', '', '', x.date, x.kind, x.amount, x.balanceAfter, x.note ?? ''] });
    }
    pdfRows.push({ cells: ['', '', '', '', 'Current balance', '', balance, ''], bold: true });
  }

  const totalOutstanding = addAll(list.map((x) => balances.get(x.l.id) ?? '0'));
  const title = `Loan Ledgers${status ? ` (${status})` : ''}`;
  return {
    fileBase: `loans${status ? `-${status}` : ''}-${manilaToday()}`,
    csv: { header, rows: csvRows },
    pdf: {
      title,
      subtitle: [
        `Employer: ${employer.name}`,
        `As of ${manilaToday()}. ${list.length} loan(s); total outstanding balance ${totalOutstanding}.`,
      ],
      footer: title,
      sections: [
        {
          columns: [
            { header: 'Employee', width: 2.2 },
            { header: 'Loan', width: 1.6 },
            { header: 'Status', width: 0.8 },
            { header: 'Date', width: 1 },
            { header: 'Kind', width: 2.2 },
            { header: 'Amount', money: true },
            { header: 'Balance', money: true },
            { header: 'Note', width: 1.8 },
          ],
          rows: pdfRows,
          totals: ['TOTAL OUTSTANDING', '', '', '', '', '', totalOutstanding, ''],
          emptyText: 'No loans.',
        },
      ],
    },
  };
}
