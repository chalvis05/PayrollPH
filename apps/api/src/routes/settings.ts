import {
  CreateRatesVersionSchema,
  EmailSchema,
  MinimumWageInputSchema,
  SettingsSchema,
  SmtpSettingsSchema,
  StatutoryRatesVersionSchema,
} from '@payrollph/shared';
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { minWages, settings, statutoryRates } from '../db/schema';
import { writeAudit } from '../lib/audit';
import { badRequest, errorResponses, IdParamsSchema, notFound, OkSchema } from '../lib/http';
import { StoredSmtpSchema } from '../lib/mailer';
import { ownerOnly, requireOwner } from '../plugins/auth';

const SettingsResponseSchema = SettingsSchema.extend({
  setupCompleted: z.boolean(),
});

const SmtpResponseSchema = z.object({
  configured: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  secure: z.boolean(),
  username: z.string().nullable(),
  fromAddress: z.string().nullable(),
  hasPassword: z.boolean(),
});

const MinimumWageSchema = MinimumWageInputSchema.extend({ id: z.uuid() });

type SettingsRow = typeof settings.$inferSelect;

function toSettingsDto(s: SettingsRow): z.infer<typeof SettingsResponseSchema> {
  return {
    ownerName: s.ownerName,
    ownerAddress: s.ownerAddress,
    ownerTin: s.ownerTin,
    ownerSssEmployerNo: s.ownerSssEmployerNo,
    ownerPhilhealthEmployerNo: s.ownerPhilhealthEmployerNo,
    ownerPagibigEmployerNo: s.ownerPagibigEmployerNo,
    payFrequency: s.payFrequency,
    defaultRegion: s.defaultRegion,
    employeeCap: s.employeeCap,
    contributionSchedule: s.contributionSchedule,
    backupRetentionDays: s.backupRetentionDays,
    setupCompleted: s.setupCompletedAt !== null,
  };
}

function toRatesDto(
  r: typeof statutoryRates.$inferSelect,
): z.infer<typeof StatutoryRatesVersionSchema> {
  return {
    id: r.id,
    version: r.version,
    effectiveFrom: r.effectiveFrom,
    notes: r.notes,
    verified: r.verified,
    data: r.data,
    createdAt: r.createdAt.toISOString(),
  };
}

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  const loadSettings = async (): Promise<SettingsRow> => {
    const [row] = await app.db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (row) return row;
    const [created] = await app.db.insert(settings).values({ id: 1 }).returning();
    if (!created) throw new Error('Could not create settings row');
    return created;
  };

  // ---------------------------------------------------------------- general settings
  app.get(
    '/settings',
    {
      schema: {
        tags: ['settings'],
        summary: 'Owner info, pay schedule, employee cap and backup retention',
        response: { 200: SettingsResponseSchema, ...errorResponses },
      },
    },
    async () => toSettingsDto(await loadSettings()),
  );

  app.put(
    '/settings',
    {
      schema: {
        tags: ['settings'],
        summary: 'Update settings (the cap cannot go below the active headcount)',
        body: SettingsSchema,
        response: { 200: SettingsResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const before = await loadSettings();
      const [after] = await app.db
        .update(settings)
        .set(request.body)
        .where(eq(settings.id, 1))
        .returning();
      if (!after) throw new Error('Settings update returned no row');
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'settings.update',
        entity: 'settings',
        entityId: '1',
        before: toSettingsDto(before),
        after: toSettingsDto(after),
      });
      return toSettingsDto(after);
    },
  );

  // ---------------------------------------------------------------- SMTP (owner only)
  app.get(
    '/settings/smtp',
    {
      onRequest: ownerOnly,
      schema: {
        tags: ['settings'],
        summary: 'SMTP settings (password never returned)',
        response: { 200: SmtpResponseSchema, ...errorResponses },
      },
    },
    async () => {
      const s = await loadSettings();
      const parsed = StoredSmtpSchema.safeParse(s.smtp);
      if (!parsed.success) {
        return {
          configured: false,
          host: null,
          port: null,
          secure: false,
          username: null,
          fromAddress: null,
          hasPassword: false,
        };
      }
      const v = parsed.data;
      return {
        configured: true,
        host: v.host,
        port: v.port,
        secure: v.secure,
        username: v.username,
        fromAddress: v.fromAddress,
        hasPassword: v.passwordEnc !== null,
      };
    },
  );

  app.put(
    '/settings/smtp',
    {
      schema: {
        tags: ['settings'],
        summary: 'Save SMTP settings; a null password keeps the stored one',
        body: SmtpSettingsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const prev = StoredSmtpSchema.safeParse((await loadSettings()).smtp);
      const body = request.body;
      const passwordEnc =
        body.password !== null
          ? app.cipher.encrypt(body.password)
          : prev.success
            ? prev.data.passwordEnc
            : null;
      const stored = StoredSmtpSchema.parse({
        host: body.host,
        port: body.port,
        secure: body.secure,
        username: body.username,
        passwordEnc,
        fromAddress: body.fromAddress,
      });
      await app.db.update(settings).set({ smtp: stored }).where(eq(settings.id, 1));
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'settings.smtp_update',
        entity: 'settings',
        entityId: '1',
        after: {
          host: body.host,
          port: body.port,
          username: body.username,
          fromAddress: body.fromAddress,
        },
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/settings/smtp/test',
    {
      schema: {
        tags: ['settings'],
        summary: 'Send a test email with the saved SMTP settings',
        body: z.object({ to: EmailSchema }),
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      requireOwner(request);
      const parsed = StoredSmtpSchema.safeParse((await loadSettings()).smtp);
      if (!parsed.success) throw badRequest('SMTP_NOT_CONFIGURED', 'Save SMTP settings first.');
      const mailer = app.mailerFactory({
        ...parsed.data,
        password: app.cipher.decryptNullable(parsed.data.passwordEnc),
      });
      try {
        await mailer.send({
          to: request.body.to,
          subject: 'PayrollPH test email',
          text: 'Your SMTP settings work.',
        });
      } catch (err) {
        throw badRequest('SMTP_SEND_FAILED', `Sending failed: ${(err as Error).message}`);
      }
      return { ok: true as const };
    },
  );

  // ---------------------------------------------------------------- statutory rates versions
  app.get(
    '/rates',
    {
      schema: {
        tags: ['rates'],
        summary: 'All statutory rates versions, newest effective date first',
        response: { 200: z.array(StatutoryRatesVersionSchema), ...errorResponses },
      },
    },
    async () => {
      const rows = await app.db
        .select()
        .from(statutoryRates)
        .orderBy(desc(statutoryRates.effectiveFrom));
      return rows.map(toRatesDto);
    },
  );

  app.post(
    '/rates',
    {
      schema: {
        tags: ['rates'],
        summary: 'Add a new rates version with its effective date (existing versions never change)',
        body: CreateRatesVersionSchema,
        response: { 201: StatutoryRatesVersionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const [row] = await app.db
        .insert(statutoryRates)
        .values({ ...request.body, verified: false })
        .returning();
      if (!row) throw new Error('Rates insert returned no row');
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'rates.create',
        entity: 'statutory_rates',
        entityId: row.id,
        after: { version: row.version, effectiveFrom: row.effectiveFrom, data: row.data },
      });
      return reply.status(201).send(toRatesDto(row));
    },
  );

  app.post(
    '/rates/:id/verify',
    {
      schema: {
        tags: ['rates'],
        summary: 'Mark a rates version as checked against the latest circulars',
        params: IdParamsSchema,
        response: { 200: StatutoryRatesVersionSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const [row] = await app.db
        .update(statutoryRates)
        .set({ verified: true, verifiedAt: new Date() })
        .where(eq(statutoryRates.id, request.params.id))
        .returning();
      if (!row) throw notFound('Rates version');
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'rates.verify',
        entity: 'statutory_rates',
        entityId: row.id,
        after: { version: row.version, verified: true },
      });
      return toRatesDto(row);
    },
  );

  // ---------------------------------------------------------------- minimum wages
  app.get(
    '/min-wages',
    {
      schema: {
        tags: ['rates'],
        summary: 'Regional minimum wage table',
        response: { 200: z.array(MinimumWageSchema), ...errorResponses },
      },
    },
    async () => {
      const rows = await app.db
        .select()
        .from(minWages)
        .orderBy(asc(minWages.region), desc(minWages.effectiveFrom));
      return rows.map((r) => ({
        id: r.id,
        region: r.region,
        effectiveFrom: r.effectiveFrom,
        nonAgricultureDaily: r.nonAgricultureDaily,
        kasambahayMonthly: r.kasambahayMonthly,
        wageOrder: r.wageOrder,
      }));
    },
  );

  app.post(
    '/min-wages',
    {
      schema: {
        tags: ['rates'],
        summary: 'Add a minimum wage row for a region from an effective date',
        body: MinimumWageInputSchema,
        response: { 201: MinimumWageSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const me = requireOwner(request);
      const [row] = await app.db.insert(minWages).values(request.body).returning();
      if (!row) throw new Error('Min wage insert returned no row');
      await writeAudit(app.db, {
        actorId: me.id,
        action: 'min_wage.create',
        entity: 'min_wages',
        entityId: row.id,
        after: request.body,
      });
      return reply.status(201).send({ id: row.id, ...request.body });
    },
  );
};
