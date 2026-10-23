import {
  MonthlyReportQuerySchema,
  ReportFormatSchema,
  YearlyReportQuerySchema,
} from '@payrollph/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses } from '../lib/http';
import { requireOwner, requireUser } from '../plugins/auth';
import { bir1601cReport, bir2316Report } from '../services/reports/bir';
import type { ReportContext } from '../services/reports/common';
import { disbursementReport } from '../services/reports/disbursement';
import { loansReport } from '../services/reports/loans';
import { sendReport } from '../services/reports/output';
import { payrollRegisterReport } from '../services/reports/payrollRegister';
import { pagibigReport, philhealthReport, sssReport } from '../services/reports/statutory';
import { thirteenthMonthReport } from '../services/reports/thirteenth';

const Bir2316QuerySchema = YearlyReportQuerySchema.extend({ employeeId: z.uuid().optional() });
const RegisterQuerySchema = z.object({ runId: z.uuid(), format: ReportFormatSchema });
const LoansQuerySchema = z.object({
  format: ReportFormatSchema,
  status: z.enum(['active', 'paid', 'cancelled']).optional(),
});
const DisbursementQuerySchema = z.object({
  runId: z.uuid(),
  method: z.enum(['bank', 'gcash', 'cash']).optional(),
  format: ReportFormatSchema.default('csv'),
});

const FILE_NOTE = 'Returns a file download (text/csv or application/pdf).';

/**
 * Report exports. Remittance and BIR reports count only approved/paid runs; "month" means runs
 * whose period ends in that month. Viewers may read; gov IDs are masked for them, and the
 * payout file (decrypted account numbers) is owner-only.
 */
export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctxFor = (request: FastifyRequest): ReportContext => ({
    db: app.db,
    cipher: app.cipher,
    mask: requireUser(request).role !== 'owner',
  });
  const schema = <Q extends z.ZodType>(summary: string, querystring: Q) => ({
    tags: ['reports'],
    summary,
    description: FILE_NOTE,
    querystring,
    response: errorResponses,
  });

  app.get(
    '/sss',
    { schema: schema('SSS monthly contribution list (R-3 style)', MonthlyReportQuerySchema) },
    async (request, reply) =>
      sendReport(
        reply,
        await sssReport(ctxFor(request), request.query.month),
        request.query.format,
      ),
  );

  app.get(
    '/philhealth',
    { schema: schema('PhilHealth monthly remittance (RF-1 style)', MonthlyReportQuerySchema) },
    async (request, reply) =>
      sendReport(
        reply,
        await philhealthReport(ctxFor(request), request.query.month),
        request.query.format,
      ),
  );

  app.get(
    '/pagibig',
    { schema: schema('Pag-IBIG monthly remittance (MCRF style)', MonthlyReportQuerySchema) },
    async (request, reply) =>
      sendReport(
        reply,
        await pagibigReport(ctxFor(request), request.query.month),
        request.query.format,
      ),
  );

  app.get(
    '/bir-1601c',
    { schema: schema('BIR 1601-C monthly remittance figures', MonthlyReportQuerySchema) },
    async (request, reply) =>
      sendReport(
        reply,
        await bir1601cReport(ctxFor(request), request.query.month),
        request.query.format,
      ),
  );

  app.get(
    '/bir-2316',
    {
      schema: schema(
        'BIR 2316 annual compensation and tax summary per employee (PDF: one page each)',
        Bir2316QuerySchema,
      ),
    },
    async (request, reply) =>
      sendReport(
        reply,
        await bir2316Report(ctxFor(request), request.query.year, request.query.employeeId),
        request.query.format,
      ),
  );

  app.get(
    '/payroll-register',
    {
      schema: schema(
        'Payroll register for one run (any status; drafts are labelled)',
        RegisterQuerySchema,
      ),
    },
    async (request, reply) =>
      sendReport(
        reply,
        await payrollRegisterReport(ctxFor(request), request.query.runId),
        request.query.format,
      ),
  );

  app.get(
    '/loans',
    { schema: schema('Loan ledgers with current balances', LoansQuerySchema) },
    async (request, reply) =>
      sendReport(
        reply,
        await loansReport(ctxFor(request), request.query.status),
        request.query.format,
      ),
  );

  app.get(
    '/thirteenth-month',
    {
      schema: schema(
        '13th month accrued, paid, balance and exempt/taxable parts',
        YearlyReportQuerySchema,
      ),
    },
    async (request, reply) =>
      sendReport(
        reply,
        await thirteenthMonthReport(ctxFor(request), request.query.year),
        request.query.format,
      ),
  );

  app.get(
    '/disbursement',
    {
      schema: schema(
        'Bank/GCash payout file for a posted run (owner only: full account numbers)',
        DisbursementQuerySchema,
      ),
    },
    async (request, reply) => {
      requireOwner(request);
      return sendReport(
        reply,
        await disbursementReport(ctxFor(request), request.query.runId, request.query.method),
        request.query.format,
      );
    },
  );
};
