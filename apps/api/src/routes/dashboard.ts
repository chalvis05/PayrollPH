import { PayrollRunKindSchema, PayrollRunStatusSchema } from '@payrollph/shared';
import { asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employees, holidays, payrollRuns, settings } from '../db/schema';
import { errorResponses } from '../lib/http';
import { manilaToday } from '../services/dates';
import { ratesForDate } from '../services/rates';

const DashboardSchema = z.object({
  activeEmployees: z.number().int(),
  employeeCap: z.number().int(),
  rates: z
    .object({ version: z.string(), effectiveFrom: z.string(), verified: z.boolean() })
    .nullable(),
  latestRuns: z.array(
    z.object({
      id: z.uuid(),
      kind: PayrollRunKindSchema,
      status: PayrollRunStatusSchema,
      periodStart: z.string(),
      periodEnd: z.string(),
      payDate: z.string(),
      totalNet: z.string(),
    }),
  ),
  upcomingHolidays: z.array(z.object({ date: z.string(), name: z.string(), type: z.string() })),
});

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['dashboard'],
        summary: 'Headcount, rates status, recent runs and upcoming holidays',
        response: { 200: DashboardSchema, ...errorResponses },
      },
    },
    async () => {
      const today = manilaToday();
      const [count] = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(eq(employees.status, 'active'));
      const [cfg] = await app.db.select({ cap: settings.employeeCap }).from(settings).limit(1);
      const rates = await ratesForDate(app.db, today).catch(() => null);
      const runs = await app.db
        .select()
        .from(payrollRuns)
        .orderBy(desc(payrollRuns.periodStart), desc(payrollRuns.createdAt))
        .limit(5);
      const hols = await app.db
        .select()
        .from(holidays)
        .where(gte(holidays.date, today))
        .orderBy(asc(holidays.date))
        .limit(5);
      return {
        activeEmployees: count?.n ?? 0,
        employeeCap: cfg?.cap ?? 25,
        rates: rates
          ? { version: rates.version, effectiveFrom: rates.effectiveFrom, verified: rates.verified }
          : null,
        latestRuns: runs.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          payDate: r.payDate,
          totalNet: r.totalNet,
        })),
        upcomingHolidays: hols.map((h) => ({ date: h.date, name: h.name, type: h.type })),
      };
    },
  );
};
