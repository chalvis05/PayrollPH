import { z } from 'zod';
import { DateSchema, DecimalSchema, PayFrequencySchema } from './common';

/**
 * Statutory rates. Every statutory figure the engine uses lives in this object,
 * which is stored as a versioned row in `statutory_rates`. Never hard-code these.
 */
export const TaxBracketSchema = z.object({
  /** Lower bound (exclusive): bracket applies to income over this amount. */
  over: DecimalSchema,
  /** Fixed tax at the lower bound. */
  base: DecimalSchema,
  /** Marginal rate on the excess over `over`. */
  rate: DecimalSchema,
});
export type TaxBracket = z.infer<typeof TaxBracketSchema>;

export const PremiumMultipliersSchema = z.object({
  /** OT on an ordinary working day (e.g. 1.25). */
  otOrdinary: DecimalSchema,
  /** OT premium on a rest day / holiday, applied on that day's rate (e.g. 1.30). */
  otPremiumDay: DecimalSchema,
  restDay: DecimalSchema,
  special: DecimalSchema,
  specialRestDay: DecimalSchema,
  regular: DecimalSchema,
  regularRestDay: DecimalSchema,
  double: DecimalSchema,
  doubleRestDay: DecimalSchema,
  /** Night differential as a fraction of the applicable hourly rate (e.g. 0.10). */
  nightDiff: DecimalSchema,
});
export type PremiumMultipliers = z.infer<typeof PremiumMultipliersSchema>;

export const DeMinimisLimitSchema = z.object({
  label: z.string(),
  /** Exempt amount per year; per-period limit = annual / periods per year. */
  annualLimit: DecimalSchema,
});

export const StatutoryRatesSchema = z.object({
  sss: z.object({
    eeRate: DecimalSchema,
    erRate: DecimalSchema,
    mscMin: DecimalSchema,
    mscMax: DecimalSchema,
    mscStep: DecimalSchema,
    /** MSC above this goes to the MPF (WISP) tier. */
    regularMscCap: DecimalSchema,
    /** EC: MSC strictly below this pays `ecLow`, otherwise `ecHigh`. */
    ecThreshold: DecimalSchema,
    ecLow: DecimalSchema,
    ecHigh: DecimalSchema,
  }),
  philhealth: z.object({
    rate: DecimalSchema,
    floor: DecimalSchema,
    ceiling: DecimalSchema,
    /** Employee share of the premium (e.g. 0.5). */
    eeShare: DecimalSchema,
  }),
  pagibig: z.object({
    /** EE rate when monthly compensation is at or below `lowThreshold`. */
    eeRateLow: DecimalSchema,
    eeRateHigh: DecimalSchema,
    lowThreshold: DecimalSchema,
    erRate: DecimalSchema,
    maxBase: DecimalSchema,
  }),
  bir: z.object({
    annualBrackets: z.array(TaxBracketSchema).min(1),
    periodsPerYear: z.record(PayFrequencySchema, z.number().int().positive()),
  }),
  benefits: z.object({
    /** Ceiling on exempt 13th month pay and other benefits per year. */
    otherBenefitsCeiling: DecimalSchema,
    deMinimis: z.record(z.string(), DeMinimisLimitSchema),
  }),
  thirteenthMonth: z.object({
    /** Months in a year the accrual is divided by (12). */
    divisor: DecimalSchema,
    /** Payout deadline as MM-DD. */
    deadline: z.string().regex(/^\d{2}-\d{2}$/),
  }),
  premiums: PremiumMultipliersSchema,
  nightDiffWindow: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  workHoursPerDay: DecimalSchema,
  kasambahay: z.object({
    /** Below this monthly wage the employer shoulders the EE share of SSS/PhilHealth/Pag-IBIG. */
    employerPaysEeShareBelow: DecimalSchema,
  }),
  leaves: z.object({
    silDays: z.number().int().nonnegative(),
    silMinServiceMonths: z.number().int().nonnegative(),
    maternityDays: z.number().int().nonnegative(),
    paternityDays: z.number().int().nonnegative(),
    soloParentDays: z.number().int().nonnegative(),
    soloParentMinServiceMonths: z.number().int().nonnegative(),
  }),
});
export type StatutoryRates = z.infer<typeof StatutoryRatesSchema>;

export const StatutoryRatesVersionSchema = z.object({
  id: z.uuid(),
  version: z.string().min(1),
  effectiveFrom: DateSchema,
  notes: z.string().nullable(),
  verified: z.boolean(),
  data: StatutoryRatesSchema,
  createdAt: z.string(),
});
export type StatutoryRatesVersion = z.infer<typeof StatutoryRatesVersionSchema>;

export const CreateRatesVersionSchema = z.object({
  version: z.string().min(1),
  effectiveFrom: DateSchema,
  notes: z.string().max(2000).nullable(),
  data: StatutoryRatesSchema,
});
export type CreateRatesVersion = z.infer<typeof CreateRatesVersionSchema>;
