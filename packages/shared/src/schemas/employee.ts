import { z } from 'zod';
import {
  DailyFactorSchema,
  DateSchema,
  EmploymentTypeSchema,
  NonNegMoneySchema,
  PayScheduleSchema,
  PayTypeSchema,
} from './common';

const optionalText = (max: number) => z.string().trim().max(max).nullable();

/** Gov ID formats are loose on purpose: people paste them with or without dashes. */
export const SssNumberSchema = z.string().regex(/^\d{2}-?\d{7}-?\d$/, 'SSS no. is 10 digits');
export const PhilhealthNumberSchema = z
  .string()
  .regex(/^\d{2}-?\d{9}-?\d$/, 'PhilHealth no. is 12 digits');
export const PagibigNumberSchema = z
  .string()
  .regex(/^\d{4}-?\d{4}-?\d{4}$/, 'Pag-IBIG MID no. is 12 digits');
export const TinSchema = z
  .string()
  .regex(/^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/, 'TIN is 9 digits plus optional branch code');

export const EmployeeStatusSchema = z.enum(['active', 'inactive', 'separated']);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

export const AllowanceKindSchema = z.enum(['taxable', 'de_minimis']);

export const AllowanceSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    /** Amount per payroll period. */
    amount: NonNegMoneySchema,
    kind: AllowanceKindSchema,
    /** Key into the rates' de minimis table; required when kind is de_minimis. */
    deMinimisType: z.string().nullable(),
  })
  .refine((a) => a.kind !== 'de_minimis' || a.deMinimisType !== null, {
    message: 'Choose a de minimis type',
    path: ['deMinimisType'],
  });
export type Allowance = z.infer<typeof AllowanceSchema>;

export const DependentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().min(1).max(40),
  birthDate: DateSchema.nullable(),
});
export type Dependent = z.infer<typeof DependentSchema>;

export const PayoutMethodSchema = z.enum(['bank', 'gcash', 'cash']);

export const PayoutSchema = z
  .object({
    method: PayoutMethodSchema,
    bankName: optionalText(80),
    accountName: optionalText(120),
    accountNumber: optionalText(40),
  })
  .refine((p) => p.method === 'cash' || (p.accountName && p.accountNumber), {
    message: 'Account name and number are required for bank/GCash',
    path: ['accountNumber'],
  });
export type Payout = z.infer<typeof PayoutSchema>;

export const EmployeeInputSchema = z.object({
  employeeNo: z.string().trim().min(1).max(20),
  firstName: z.string().trim().min(1).max(80),
  middleName: optionalText(80),
  lastName: z.string().trim().min(1).max(80),
  birthDate: DateSchema.nullable(),
  sex: z.enum(['female', 'male']).nullable(),
  civilStatus: z.enum(['single', 'married', 'widowed', 'separated']).nullable(),
  isSoloParent: z.boolean(),
  address: optionalText(300),
  phone: optionalText(30),
  email: z.email().nullable(),
  position: optionalText(80),
  region: z.string().min(1),

  sssNo: SssNumberSchema.nullable(),
  philhealthNo: PhilhealthNumberSchema.nullable(),
  pagibigNo: PagibigNumberSchema.nullable(),
  tin: TinSchema.nullable(),

  employmentType: EmploymentTypeSchema,
  payType: PayTypeSchema,
  /** standard = follows Settings (semi-monthly or monthly); twice_weekly = every Wed and Sat. */
  paySchedule: PayScheduleSchema.default('standard'),
  baseRate: NonNegMoneySchema,
  dailyFactor: DailyFactorSchema,
  /** Rest days as ISO weekday numbers (1 = Monday … 7 = Sunday). */
  restDays: z.array(z.number().int().min(1).max(7)).max(7),
  hireDate: DateSchema,
  status: EmployeeStatusSchema,
  separationDate: DateSchema.nullable(),

  allowances: z.array(AllowanceSchema).max(20),
  dependents: z.array(DependentSchema).max(10),
  payout: PayoutSchema,
});
export type EmployeeInput = z.infer<typeof EmployeeInputSchema>;

/**
 * A masked sensitive value as shown to encoders and viewers, e.g. "••••5678". In an encoder's
 * change request it means "keep the current value".
 */
export const MaskedValueSchema = z.string().regex(/^••••[0-9A-Za-z]{0,4}$/);
export const isMaskedValue = (v: string | null): boolean =>
  v !== null && MaskedValueSchema.safeParse(v).success;

/**
 * What an encoder submits for approval: a full employee record, where gov IDs that are still
 * masked mean "unchanged" (encoders never see the real numbers of existing employees).
 */
export const EmployeeChangeInputSchema = EmployeeInputSchema.extend({
  sssNo: z.union([SssNumberSchema, MaskedValueSchema]).nullable(),
  philhealthNo: z.union([PhilhealthNumberSchema, MaskedValueSchema]).nullable(),
  pagibigNo: z.union([PagibigNumberSchema, MaskedValueSchema]).nullable(),
  tin: z.union([TinSchema, MaskedValueSchema]).nullable(),
});
export type EmployeeChangeInput = z.infer<typeof EmployeeChangeInputSchema>;

export const ChangeRequestStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>;

export const RejectChangeRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(500),
});

export const EmployeeSchema = EmployeeInputSchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const EmployeeDocumentSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string(),
});
export type EmployeeDocument = z.infer<typeof EmployeeDocumentSchema>;
