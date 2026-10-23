import { z } from 'zod';
import { MoneySchema } from './common';

/** How an earning line is treated for withholding tax. */
export const TaxClassSchema = z.enum([
  /** Always taxable. */
  'taxable',
  /** Taxable unless the employee is a minimum wage earner (basic, holiday, OT, ND). */
  'mwe_exempt_eligible',
  /** Exempt de minimis within its limit. */
  'de_minimis',
  /** 13th month and other benefits: exempt up to the annual ceiling. */
  'other_benefit',
  'non_taxable',
]);
export type TaxClass = z.infer<typeof TaxClassSchema>;

export const LineCategorySchema = z.enum([
  'basic',
  'attendance_deduction',
  'premium',
  'holiday',
  'allowance',
  'thirteenth_month',
  'leave_conversion',
  'statutory_ee',
  'statutory_er',
  'withholding_tax',
  'loan',
  'deduction',
]);
export type LineCategory = z.infer<typeof LineCategorySchema>;

export const PayLineSchema = z.object({
  code: z.string(),
  label: z.string(),
  category: LineCategorySchema,
  amount: MoneySchema,
  taxClass: TaxClassSchema.optional(),
  /** Hours/days/minutes the line is based on, for display. */
  quantity: z.string().optional(),
});
export type PayLine = z.infer<typeof PayLineSchema>;

export const WarningCodeSchema = z.enum([
  'below_minimum_wage',
  'missing_gov_ids',
  'negative_net',
  'kasambahay_employer_shoulders_ee',
  'unknown_de_minimis_type',
]);
export type WarningCode = z.infer<typeof WarningCodeSchema>;

export const PayrollWarningSchema = z.object({
  code: WarningCodeSchema,
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string(),
});
export type PayrollWarning = z.infer<typeof PayrollWarningSchema>;

export const ContributionBreakdownSchema = z.object({
  sss: z.object({
    msc: MoneySchema,
    mscRegular: MoneySchema,
    mscMpf: MoneySchema,
    ee: MoneySchema,
    eeMpf: MoneySchema,
    er: MoneySchema,
    erMpf: MoneySchema,
    ec: MoneySchema,
  }),
  philhealth: z.object({
    base: MoneySchema,
    premium: MoneySchema,
    ee: MoneySchema,
    er: MoneySchema,
  }),
  pagibig: z.object({ base: MoneySchema, ee: MoneySchema, er: MoneySchema }),
  /** Kasambahay below the threshold: employer pays the EE share too. */
  employerShoulderedEe: z.boolean(),
});
export type ContributionBreakdown = z.infer<typeof ContributionBreakdownSchema>;

export const PayslipComputationSchema = z.object({
  rateBasis: z.object({ monthly: MoneySchema, daily: MoneySchema, hourly: MoneySchema }),
  isMinimumWageEarner: z.boolean(),
  earnings: z.array(PayLineSchema),
  grossPay: MoneySchema,
  /** Monthly amounts before the period share is applied. */
  monthlyContributions: ContributionBreakdownSchema,
  employeeDeductions: z.array(PayLineSchema),
  employerShares: z.array(PayLineSchema),
  taxableIncome: MoneySchema,
  withholdingTax: MoneySchema,
  basicEarned: MoneySchema,
  thirteenthMonthAccrual: MoneySchema,
  otherBenefitsExemptUsed: MoneySchema,
  totalDeductions: MoneySchema,
  netPay: MoneySchema,
  warnings: z.array(PayrollWarningSchema),
});
export type PayslipComputation = z.infer<typeof PayslipComputationSchema>;

export const FinalPayResultSchema = z.object({
  earnings: z.array(PayLineSchema),
  deductions: z.array(PayLineSchema),
  thirteenthMonth: z.object({ amount: MoneySchema, exempt: MoneySchema, taxable: MoneySchema }),
  lastSalaryNet: MoneySchema,
  totalEarnings: MoneySchema,
  totalDeductions: MoneySchema,
  netFinalPay: MoneySchema,
});
export type FinalPayResult = z.infer<typeof FinalPayResultSchema>;
