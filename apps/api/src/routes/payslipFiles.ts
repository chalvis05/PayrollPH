import { ZipArchive } from 'archiver';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employees, payrollRuns, payslips, settings } from '../db/schema';
import { writeAudit, type DbOrTx } from '../lib/audit';
import { badRequest, conflict, errorResponses, IdParamsSchema, notFound } from '../lib/http';
import { StoredSmtpSchema } from '../lib/mailer';
import { renderPayslipPdf, type PayslipPdfData } from '../lib/pdf/payslip';
import { requireOwner } from '../plugins/auth';
import { yearOf } from '../services/dates';
import { fullName } from '../services/employees';

type EmployeeRow = typeof employees.$inferSelect;
type RunRow = typeof payrollRuns.$inferSelect;
type PayslipRow = typeof payslips.$inferSelect;

export interface LoadedPayslip {
  payslip: PayslipRow;
  employee: EmployeeRow;
  pdf: PayslipPdfData;
}

const ZERO_YTD: PayslipPdfData['ytd'] = {
  gross: '0.00',
  taxableIncome: '0.00',
  withholdingTax: '0.00',
  sssEe: '0.00',
  philhealthEe: '0.00',
  pagibigEe: '0.00',
  net: '0.00',
};

/**
 * Load everything needed to print the payslips of one run (optionally one payslip).
 * YTD matches GET /api/payslips/:id: this payslip plus the employee's posted (approved/paid)
 * payslips of the same year up to this run's period end, summed in SQL (no JS money math).
 */
export async function loadRunPayslips(
  db: DbOrTx,
  run: RunRow,
  only?: { payslipId?: string; employeeIds?: string[] },
): Promise<LoadedPayslip[]> {
  const conds = [eq(payslips.payrollRunId, run.id)];
  if (only?.payslipId) conds.push(eq(payslips.id, only.payslipId));
  if (only?.employeeIds) conds.push(inArray(payslips.employeeId, only.employeeIds));
  const rows = await db
    .select({ p: payslips, e: employees })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(and(...conds))
    .orderBy(asc(employees.employeeNo));
  if (rows.length === 0) return [];

  const ytdRows = await db
    .select({
      employeeId: payslips.employeeId,
      gross: sql<string>`coalesce(sum(${payslips.gross}), 0)::numeric(14,2)::text`,
      taxableIncome: sql<string>`coalesce(sum(${payslips.taxableIncome}), 0)::numeric(14,2)::text`,
      withholdingTax: sql<string>`coalesce(sum(${payslips.withholdingTax}), 0)::numeric(14,2)::text`,
      sssEe: sql<string>`coalesce(sum(${payslips.sssEe}), 0)::numeric(14,2)::text`,
      philhealthEe: sql<string>`coalesce(sum(${payslips.philhealthEe}), 0)::numeric(14,2)::text`,
      pagibigEe: sql<string>`coalesce(sum(${payslips.pagibigEe}), 0)::numeric(14,2)::text`,
      net: sql<string>`coalesce(sum(${payslips.net}), 0)::numeric(14,2)::text`,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(
      and(
        inArray(
          payslips.employeeId,
          rows.map((r) => r.e.id),
        ),
        or(
          eq(payslips.payrollRunId, run.id),
          and(
            inArray(payrollRuns.status, ['approved', 'paid']),
            sql`extract(year from ${payrollRuns.periodEnd}) = ${yearOf(run.periodEnd)}`,
            lte(payrollRuns.periodEnd, run.periodEnd),
          ),
        ),
      ),
    )
    .groupBy(payslips.employeeId);
  const ytdBy = new Map(ytdRows.map(({ employeeId, ...rest }) => [employeeId, rest]));

  const [s] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const employer = {
    name: s?.ownerName ?? '',
    address: s?.ownerAddress ?? null,
    tin: s?.ownerTin ?? null,
  };

  return rows.map(({ p, e }) => ({
    payslip: p,
    employee: e,
    pdf: {
      employer,
      employee: {
        employeeNo: e.employeeNo,
        name: fullName(e),
        position: e.position,
        payType: e.payType,
      },
      run: {
        kind: run.kind,
        status: run.status,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        payDate: run.payDate,
      },
      computation: p.computation,
      finalPay: p.finalPay ?? null,
      ytd: ytdBy.get(e.id) ?? ZERO_YTD,
    },
  }));
}

/** `<employeeNo>-<lastname>-<periodEnd>.pdf`, restricted to filename-safe characters. */
export function payslipFileName(
  employee: Pick<EmployeeRow, 'employeeNo' | 'lastName'>,
  periodEnd: string,
): string {
  const safe = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '') || 'x';
  return `${safe(employee.employeeNo)}-${safe(employee.lastName)}-${periodEnd}.pdf`;
}

const EmailBodySchema = z.object({ employeeIds: z.array(z.uuid()).max(500).optional() }).optional();

const EmailResultSchema = z.object({
  sent: z.array(z.object({ employeeId: z.uuid(), payslipId: z.uuid(), to: z.string() })),
  skipped: z.array(z.object({ employeeId: z.uuid(), reason: z.enum(['no_email', 'not_in_run']) })),
  failed: z.array(z.object({ employeeId: z.uuid(), message: z.string() })),
});

export const payslipFileRoutes: FastifyPluginAsyncZod = async (app) => {
  const compress = app.config.nodeEnv !== 'test';

  const loadRun = async (id: string): Promise<RunRow> => {
    const [run] = await app.db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
    if (!run) throw notFound('Payroll run');
    return run;
  };

  app.get(
    '/payslips/:id/pdf',
    {
      schema: {
        tags: ['payslips'],
        summary: 'One payslip as a PDF (draft runs carry a DRAFT watermark)',
        params: IdParamsSchema,
        produces: ['application/pdf'],
        response: { 200: z.unknown().describe('PDF file'), ...errorResponses },
      },
    },
    async (request, reply) => {
      const [slip] = await app.db
        .select({ runId: payslips.payrollRunId })
        .from(payslips)
        .where(eq(payslips.id, request.params.id))
        .limit(1);
      if (!slip) throw notFound('Payslip');
      const run = await loadRun(slip.runId);
      const [loaded] = await loadRunPayslips(app.db, run, { payslipId: request.params.id });
      if (!loaded) throw notFound('Payslip');
      const pdf = await renderPayslipPdf(loaded.pdf, { compress });
      return reply
        .type('application/pdf')
        .header(
          'content-disposition',
          `inline; filename="${payslipFileName(loaded.employee, run.periodEnd)}"`,
        )
        .header('cache-control', 'private, no-store')
        .send(pdf);
    },
  );

  app.get(
    '/payroll-runs/:id/payslips.zip',
    {
      schema: {
        tags: ['payslips'],
        summary: 'All payslips of a run as PDFs in one zip (streamed)',
        params: IdParamsSchema,
        produces: ['application/zip'],
        response: { 200: z.unknown().describe('Zip of PDF files'), ...errorResponses },
      },
    },
    async (request, reply) => {
      const run = await loadRun(request.params.id);
      const loaded = await loadRunPayslips(app.db, run);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on('warning', (err) => request.log.warn({ err }, 'payslip zip warning'));
      // Produce entries while the response streams; errors abort the stream.
      void (async () => {
        for (const item of loaded) {
          const pdf = await renderPayslipPdf(item.pdf, { compress });
          archive.append(pdf, { name: payslipFileName(item.employee, run.periodEnd) });
        }
        await archive.finalize();
      })().catch((err: unknown) => {
        request.log.error({ err }, 'payslip zip failed');
        archive.destroy(err instanceof Error ? err : new Error(String(err)));
      });
      return reply
        .type('application/zip')
        .header(
          'content-disposition',
          `attachment; filename="payslips-${run.kind}-${run.periodEnd}.zip"`,
        )
        .header('cache-control', 'private, no-store')
        .send(archive);
    },
  );

  app.post(
    '/payroll-runs/:id/payslips/email',
    {
      schema: {
        tags: ['payslips'],
        summary:
          'Email each payslip PDF to its employee (approved/paid runs; employees without email are skipped)',
        params: IdParamsSchema,
        body: EmailBodySchema,
        response: { 200: EmailResultSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const run = await loadRun(request.params.id);
      if (run.status !== 'approved' && run.status !== 'paid') {
        throw conflict(
          'RUN_NOT_APPROVED',
          'Payslips can only be emailed for approved or paid runs.',
        );
      }
      const [s] = await app.db
        .select({ smtp: settings.smtp })
        .from(settings)
        .where(eq(settings.id, 1));
      const smtp = StoredSmtpSchema.safeParse(s?.smtp);
      if (!smtp.success) {
        throw badRequest('SMTP_NOT_CONFIGURED', 'Set up outgoing email (SMTP) in Settings first.');
      }
      const mailer = app.mailerFactory({
        ...smtp.data,
        password: app.cipher.decryptNullable(smtp.data.passwordEnc),
      });

      const requested = request.body?.employeeIds
        ? [...new Set(request.body.employeeIds)]
        : undefined;
      const loaded = await loadRunPayslips(
        app.db,
        run,
        requested ? { employeeIds: requested } : undefined,
      );
      const result: z.infer<typeof EmailResultSchema> = { sent: [], skipped: [], failed: [] };
      if (requested) {
        const present = new Set(loaded.map((l) => l.employee.id));
        for (const id of requested) {
          if (!present.has(id)) result.skipped.push({ employeeId: id, reason: 'not_in_run' });
        }
      }

      for (const item of loaded) {
        const { employee, payslip } = item;
        const to = employee.email?.trim();
        if (!to) {
          result.skipped.push({ employeeId: employee.id, reason: 'no_email' });
          continue;
        }
        try {
          const pdf = await renderPayslipPdf(item.pdf, { compress });
          const employerName = item.pdf.employer.name || 'your employer';
          await mailer.send({
            to,
            subject: `Payslip for ${run.periodStart} to ${run.periodEnd}`,
            text:
              `Hi ${employee.firstName},\n\n` +
              `Attached is your payslip for ${run.periodStart} to ${run.periodEnd} (pay date ${run.payDate}).\n\n` +
              `— ${employerName}\n`,
            attachments: [
              {
                filename: payslipFileName(employee, run.periodEnd),
                content: pdf,
                contentType: 'application/pdf',
              },
            ],
          });
          await app.db
            .update(payslips)
            .set({ emailedAt: new Date() })
            .where(eq(payslips.id, payslip.id));
          result.sent.push({ employeeId: employee.id, payslipId: payslip.id, to });
        } catch (err) {
          request.log.warn({ err, employeeId: employee.id }, 'payslip email failed');
          result.failed.push({ employeeId: employee.id, message: (err as Error).message });
        }
      }

      await writeAudit(app.db, {
        actorId: me.id,
        action: 'payslips.email',
        entity: 'payroll_run',
        entityId: run.id,
        after: {
          sent: result.sent.map((r) => r.employeeId),
          skipped: result.skipped,
          failed: result.failed.map((r) => r.employeeId),
        },
      });
      return result;
    },
  );
};
