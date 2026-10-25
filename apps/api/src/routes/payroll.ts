import {
  CreatePayrollRunSchema,
  CreateThirteenthRunSchema,
  CreateTwiceWeeklyRunSchema,
  FinalPayRequestSchema,
  FinalPayResultSchema,
  PayrollRunKindSchema,
  PayrollRunSchema,
  PayrollRunStatusSchema,
  PayrollWarningSchema,
  PayslipSchema,
  ReopenPayrollRunSchema,
  dec,
  sum,
  toMoney,
} from '@payrollph/shared';
import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employees, payrollRuns, payslips, statutoryRates } from '../db/schema';
import { writeAudit } from '../lib/audit';
import { conflict, errorResponses, IdParamsSchema, notFound, OkSchema } from '../lib/http';
import { requireOwner } from '../plugins/auth';
import { yearOf } from '../services/dates';
import { fullName } from '../services/employees';
import {
  createFinalPayRun,
  createRegularRun,
  createThirteenthRun,
  createTwiceWeeklyRun,
  recomputeRun,
  runSnapshot,
  transitionRun,
  type RunAction,
  type RunRow,
} from '../services/payrollRun';

const RunSchema = PayrollRunSchema.extend({
  ratesVersion: z.string(),
  ratesVerified: z.boolean(),
  thirteenthMode: z.enum(['half', 'full']).nullable(),
  finalPayEmployeeId: z.uuid().nullable(),
  lastReopenReason: z.string().nullable(),
  contributionSchedule: z.enum(['second_cutoff', 'split']),
});

const PayslipSummarySchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  gross: z.string(),
  totalDeductions: z.string(),
  net: z.string(),
  employerShares: z.string(),
  warnings: z.array(PayrollWarningSchema),
});

const RunDetailSchema = RunSchema.extend({ payslips: z.array(PayslipSummarySchema) });

const PayslipDetailSchema = PayslipSchema.extend({
  employeeNo: z.string(),
  finalPay: FinalPayResultSchema.nullable(),
  run: z.object({
    kind: PayrollRunKindSchema,
    status: PayrollRunStatusSchema,
    periodStart: z.string(),
    periodEnd: z.string(),
    payDate: z.string(),
  }),
});

const RunQuerySchema = z.object({
  status: PayrollRunStatusSchema.optional(),
  kind: PayrollRunKindSchema.optional(),
});

async function toRunDto(
  db: Parameters<typeof writeAudit>[0],
  r: RunRow,
): Promise<z.infer<typeof RunSchema>> {
  const [rates] = await db
    .select({ version: statutoryRates.version, verified: statutoryRates.verified })
    .from(statutoryRates)
    .where(eq(statutoryRates.id, r.ratesVersionId));
  const [counts] = await db
    .select({
      employees: sql<number>`count(*)::int`,
      warnings: sql<number>`coalesce(sum(jsonb_array_length(${payslips.computation}->'warnings')), 0)::int`,
    })
    .from(payslips)
    .where(eq(payslips.payrollRunId, r.id));
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    payDate: r.payDate,
    ratesVersionId: r.ratesVersionId,
    ratesVersion: rates?.version ?? '?',
    ratesVerified: rates?.verified ?? false,
    totals: {
      gross: r.totalGross,
      deductions: r.totalDeductions,
      net: r.totalNet,
      employerShares: r.totalEmployerShares,
    },
    warningCount: counts?.warnings ?? 0,
    employeeCount: counts?.employees ?? 0,
    thirteenthMode:
      r.thirteenthMode === 'half' || r.thirteenthMode === 'full' ? r.thirteenthMode : null,
    finalPayEmployeeId: r.finalPayEmployeeId,
    lastReopenReason: r.lastReopenReason,
    contributionSchedule: r.contributionSchedule,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
  };
}

export const payrollRoutes: FastifyPluginAsyncZod = async (app) => {
  const loadDetail = async (id: string): Promise<z.infer<typeof RunDetailSchema>> => {
    const [run] = await app.db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
    if (!run) throw notFound('Payroll run');
    const slips = await app.db
      .select({ p: payslips, e: employees })
      .from(payslips)
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(eq(payslips.payrollRunId, id))
      .orderBy(asc(employees.employeeNo));
    return {
      ...(await toRunDto(app.db, run)),
      payslips: slips.map(({ p, e }) => ({
        id: p.id,
        employeeId: e.id,
        employeeNo: e.employeeNo,
        employeeName: fullName(e),
        gross: p.gross,
        totalDeductions: p.totalDeductions,
        net: p.net,
        employerShares: toMoney(sum([p.sssEr, p.sssEc, p.philhealthEr, p.pagibigEr])),
        warnings: p.computation.warnings,
      })),
    };
  };

  app.get(
    '/payroll-runs',
    {
      schema: {
        tags: ['payroll'],
        summary: 'Payroll runs, newest period first',
        querystring: RunQuerySchema,
        response: { 200: z.array(RunSchema), ...errorResponses },
      },
    },
    async (request) => {
      const { status, kind } = request.query;
      const conds = [];
      if (status) conds.push(eq(payrollRuns.status, status));
      if (kind) conds.push(eq(payrollRuns.kind, kind));
      const rows = await app.db
        .select()
        .from(payrollRuns)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(payrollRuns.periodStart), desc(payrollRuns.createdAt));
      return Promise.all(rows.map((r) => toRunDto(app.db, r)));
    },
  );

  app.post(
    '/payroll-runs',
    {
      schema: {
        tags: ['payroll'],
        summary: 'Create and compute a semi-monthly (1–15 / 16–EOM) or monthly draft run',
        body: CreatePayrollRunSchema,
        response: { 201: RunDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const id = await app.db.transaction((tx) => createRegularRun(tx, request.body, me.id));
      return reply.status(201).send(await loadDetail(id));
    },
  );

  app.post(
    '/payroll-runs/thirteenth-month',
    {
      schema: {
        tags: ['payroll'],
        summary: '13th-month payout run (mid-year half or full balance)',
        body: CreateThirteenthRunSchema,
        response: { 201: RunDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const id = await app.db.transaction((tx) => createThirteenthRun(tx, request.body, me.id));
      return reply.status(201).send(await loadDetail(id));
    },
  );

  app.post(
    '/payroll-runs/twice-weekly',
    {
      schema: {
        tags: ['payroll'],
        summary:
          'Twice-weekly payout for staff on that schedule: Wednesday pays Sun–Wed, Saturday pays Thu–Sat',
        body: CreateTwiceWeeklyRunSchema,
        response: { 201: RunDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const id = await app.db.transaction((tx) => createTwiceWeeklyRun(tx, request.body, me.id));
      return reply.status(201).send(await loadDetail(id));
    },
  );

  app.post(
    '/final-pay',
    {
      schema: {
        tags: ['payroll'],
        summary:
          'Final pay for a separating employee: last salary, prorated 13th, unused SIL, loan payoff, tax annualization',
        body: FinalPayRequestSchema,
        response: { 201: RunDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const id = await app.db.transaction((tx) => createFinalPayRun(tx, request.body, me.id));
      return reply.status(201).send(await loadDetail(id));
    },
  );

  app.get(
    '/payroll-runs/:id',
    {
      schema: {
        tags: ['payroll'],
        summary: 'A run with its per-employee breakdown and warnings',
        params: IdParamsSchema,
        response: { 200: RunDetailSchema, ...errorResponses },
      },
    },
    async (request) => loadDetail(request.params.id),
  );

  app.post(
    '/payroll-runs/:id/recompute',
    {
      schema: {
        tags: ['payroll'],
        summary: 'Recompute a draft run from current attendance, loans and deductions',
        params: IdParamsSchema,
        response: { 200: RunDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      requireOwner(request);
      await app.db.transaction((tx) => recomputeRun(tx, request.params.id));
      return loadDetail(request.params.id);
    },
  );

  const actions: { path: string; action: Exclude<RunAction, 'reopen'>; summary: string }[] = [
    { path: 'submit', action: 'submit', summary: 'Draft → review (recomputes first)' },
    { path: 'return', action: 'return', summary: 'Review → draft' },
    {
      path: 'approve',
      action: 'approve',
      summary: 'Review → approved: locks the run and posts loan payments',
    },
    { path: 'mark-paid', action: 'mark_paid', summary: 'Approved → paid' },
  ];
  for (const a of actions) {
    app.post(
      `/payroll-runs/:id/${a.path}`,
      {
        schema: {
          tags: ['payroll'],
          summary: a.summary,
          params: IdParamsSchema,
          response: { 200: RunDetailSchema, ...errorResponses },
        },
      },
      async (request) => {
        const me = requireOwner(request);
        await app.db.transaction((tx) =>
          transitionRun(tx, request.params.id, a.action, me.id, null),
        );
        return loadDetail(request.params.id);
      },
    );
  }

  app.post(
    '/payroll-runs/:id/reopen',
    {
      schema: {
        tags: ['payroll'],
        summary: 'Reopen an approved/paid run back to draft (reason required, audited)',
        params: IdParamsSchema,
        body: ReopenPayrollRunSchema,
        response: { 200: RunDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      await app.db.transaction((tx) =>
        transitionRun(tx, request.params.id, 'reopen', me.id, request.body.reason),
      );
      return loadDetail(request.params.id);
    },
  );

  app.delete(
    '/payroll-runs/:id',
    {
      schema: {
        tags: ['payroll'],
        summary: 'Delete a draft run',
        params: IdParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      await app.db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, request.params.id))
          .for('update');
        if (!run) throw notFound('Payroll run');
        if (run.status !== 'draft') {
          throw conflict('RUN_NOT_DRAFT', 'Only draft runs can be deleted. Reopen it first.');
        }
        await tx.delete(payrollRuns).where(eq(payrollRuns.id, run.id));
        await writeAudit(tx, {
          actorId: me.id,
          action: 'payroll_run.delete',
          entity: 'payroll_run',
          entityId: run.id,
          before: runSnapshot(run),
        });
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/payslips/:id',
    {
      schema: {
        tags: ['payroll'],
        summary: 'One payslip: every earning, premium, deduction, employer share, and YTD',
        params: IdParamsSchema,
        response: { 200: PayslipDetailSchema, ...errorResponses },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select({ p: payslips, e: employees, r: payrollRuns })
        .from(payslips)
        .innerJoin(employees, eq(employees.id, payslips.employeeId))
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
        .where(eq(payslips.id, request.params.id));
      if (!row) throw notFound('Payslip');
      const { p, e, r } = row;
      // YTD = posted payslips of the same year up to this run's period end, plus this one.
      const [ytd] = await app.db
        .select({
          gross: sql<string>`coalesce(sum(${payslips.gross}), 0)::text`,
          taxableIncome: sql<string>`coalesce(sum(${payslips.taxableIncome}), 0)::text`,
          withholdingTax: sql<string>`coalesce(sum(${payslips.withholdingTax}), 0)::text`,
          sssEe: sql<string>`coalesce(sum(${payslips.sssEe}), 0)::text`,
          philhealthEe: sql<string>`coalesce(sum(${payslips.philhealthEe}), 0)::text`,
          pagibigEe: sql<string>`coalesce(sum(${payslips.pagibigEe}), 0)::text`,
          net: sql<string>`coalesce(sum(${payslips.net}), 0)::text`,
        })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
        .where(
          and(
            eq(payslips.employeeId, e.id),
            ne(payslips.id, p.id),
            inArray(payrollRuns.status, ['approved', 'paid']),
            sql`extract(year from ${payrollRuns.periodEnd}) = ${yearOf(r.periodEnd)}`,
            lte(payrollRuns.periodEnd, r.periodEnd),
          ),
        );
      const add = (a: string | undefined, b: string) => toMoney(dec(a ?? '0').plus(b));
      return {
        id: p.id,
        payrollRunId: r.id,
        employeeId: e.id,
        employeeNo: e.employeeNo,
        employeeName: fullName(e),
        computation: p.computation,
        finalPay: p.finalPay ?? null,
        run: {
          kind: r.kind,
          status: r.status,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          payDate: r.payDate,
        },
        ytd: {
          gross: add(ytd?.gross, p.gross),
          taxableIncome: add(ytd?.taxableIncome, p.taxableIncome),
          withholdingTax: add(ytd?.withholdingTax, p.withholdingTax),
          sssEe: add(ytd?.sssEe, p.sssEe),
          philhealthEe: add(ytd?.philhealthEe, p.philhealthEe),
          pagibigEe: add(ytd?.pagibigEe, p.pagibigEe),
          net: add(ytd?.net, p.net),
        },
      };
    },
  );
};
