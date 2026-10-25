import { z } from 'zod';

/** Money as a 2-dp decimal string, matching NUMERIC(14,2). */
export const MoneySchema = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'Must be an amount with at most 2 decimals');

/** Non-negative money. */
export const NonNegMoneySchema = MoneySchema.refine(
  (v) => !v.startsWith('-'),
  'Must not be negative',
);

/** Strictly positive money (no float conversion: checks the digits). */
export const PositiveMoneySchema = NonNegMoneySchema.refine(
  (v) => !/^0+(\.0+)?$/.test(v),
  'Must be more than zero',
);

/** Arbitrary-precision decimal string used for rates and multipliers. */
export const DecimalSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number');

/** Calendar date YYYY-MM-DD (interpreted in Asia/Manila). */
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const IdSchema = z.uuid();

export const PayTypeSchema = z.enum(['monthly', 'semi_monthly', 'daily', 'hourly']);
export type PayType = z.infer<typeof PayTypeSchema>;

export const EmploymentTypeSchema = z.enum([
  'regular',
  'probationary',
  'contractual',
  'kasambahay',
]);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

/** Daily-rate conversion factor (days per year the monthly salary covers). */
export const DailyFactorSchema = z.union([
  z.literal(313),
  z.literal(261),
  z.literal(365),
  z.literal(393),
]);
export type DailyFactor = z.infer<typeof DailyFactorSchema>;

/** Payroll frequency used to derive period withholding (periods per year come from rates). */
export const PayFrequencySchema = z.enum([
  'monthly',
  'semi_monthly',
  'weekly',
  'twice_weekly',
  'daily',
]);
export type PayFrequency = z.infer<typeof PayFrequencySchema>;

/**
 * How often an employee is paid. `standard` follows the pay frequency in Settings
 * (semi-monthly or monthly); `twice_weekly` is paid every Wednesday (Sun–Wed) and
 * Saturday (Thu–Sat).
 */
export const PayScheduleSchema = z.enum(['standard', 'twice_weekly']);
export type PaySchedule = z.infer<typeof PayScheduleSchema>;

/** Kind of day for premium computation. */
export const DayTypeSchema = z.enum([
  'ordinary',
  'rest_day',
  'special',
  'special_rest_day',
  'regular',
  'regular_rest_day',
  'double',
  'double_rest_day',
]);
export type DayType = z.infer<typeof DayTypeSchema>;
