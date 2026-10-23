import { z } from 'zod';
import { DateSchema, NonNegMoneySchema } from './common';

export const SettingsSchema = z.object({
  ownerName: z.string().trim().min(1).max(120),
  ownerAddress: z.string().trim().max(300).nullable(),
  ownerTin: z.string().trim().max(20).nullable(),
  ownerSssEmployerNo: z.string().trim().max(20).nullable(),
  ownerPhilhealthEmployerNo: z.string().trim().max(20).nullable(),
  ownerPagibigEmployerNo: z.string().trim().max(20).nullable(),
  payFrequency: z.enum(['semi_monthly', 'monthly']),
  defaultRegion: z.string().min(1),
  /** Maximum number of active employees (DB-enforced). Defaults to 25. */
  employeeCap: z.number().int().min(1).max(100),
  contributionSchedule: z.enum(['second_cutoff', 'split']),
  backupRetentionDays: z.number().int().min(1).max(365),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SmtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().max(200).nullable(),
  /** Write-only: omitted in responses; null keeps the stored password. */
  password: z.string().max(200).nullable(),
  fromAddress: z.email(),
});
export type SmtpSettings = z.infer<typeof SmtpSettingsSchema>;

export const MinimumWageInputSchema = z.object({
  region: z.string().trim().min(1).max(20),
  effectiveFrom: DateSchema,
  nonAgricultureDaily: NonNegMoneySchema,
  kasambahayMonthly: NonNegMoneySchema,
  wageOrder: z.string().trim().max(60).nullable(),
});
export type MinimumWageInput = z.infer<typeof MinimumWageInputSchema>;

export const AuditEntrySchema = z.object({
  id: z.uuid(),
  at: z.string(),
  actorId: z.uuid().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const BackupSchema = z.object({
  fileName: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});
export type Backup = z.infer<typeof BackupSchema>;

export const ReportFormatSchema = z.enum(['csv', 'pdf']);

export const MonthlyReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM'),
  format: ReportFormatSchema,
});
export type MonthlyReportQuery = z.infer<typeof MonthlyReportQuerySchema>;

export const YearlyReportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  format: ReportFormatSchema,
});
export type YearlyReportQuery = z.infer<typeof YearlyReportQuerySchema>;
