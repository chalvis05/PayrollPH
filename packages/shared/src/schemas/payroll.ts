import { z } from 'zod';
import { DateSchema, MoneySchema, NonNegMoneySchema } from './common';
import { PayslipComputationSchema } from './payslip';

export const PayrollRunKindSchema = z.enum([
  'semi_monthly_1',
  'semi_monthly_2',
  'monthly',
  'thirteenth_month',
  'final_pay',
]);
export type PayrollRunKind = z.infer<typeof PayrollRunKindSchema>;

export const PayrollRunStatusSchema = z.enum(['draft', 'review', 'approved', 'paid']);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatusSchema>;

/** Allowed forward transitions; reopen (approved/paid → draft) is a separate action with a reason. */
export const PAYROLL_TRANSITIONS: Record<PayrollRunStatus, readonly PayrollRunStatus[]> = {
  draft: ['review'],
  review: ['draft', 'approved'],
  approved: ['paid'],
  paid: [],
};

export const CreatePayrollRunSchema = z
  .object({
    kind: z.enum(['semi_monthly_1', 'semi_monthly_2', 'monthly']),
    /** Any date inside the target month (YYYY-MM-DD); the period is derived from the kind. */
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM'),
    payDate: DateSchema,
    /** For semi-monthly runs: deduct statutory contributions on the 2nd cutoff or split 50/50. */
    contributionSchedule: z.enum(['second_cutoff', 'split']),
  })
  .strict();
export type CreatePayrollRunInput = z.infer<typeof CreatePayrollRunSchema>;

export const CreateThirteenthRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  mode: z.enum(['half', 'full']),
  payDate: DateSchema,
});
export type CreateThirteenthRunInput = z.infer<typeof CreateThirteenthRunSchema>;

export const ReopenPayrollRunSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export type ReopenPayrollRunInput = z.infer<typeof ReopenPayrollRunSchema>;

export const PayrollRunSchema = z.object({
  id: z.uuid(),
  kind: PayrollRunKindSchema,
  status: PayrollRunStatusSchema,
  periodStart: DateSchema,
  periodEnd: DateSchema,
  payDate: DateSchema,
  ratesVersionId: z.uuid(),
  totals: z.object({
    gross: MoneySchema,
    deductions: MoneySchema,
    net: MoneySchema,
    employerShares: MoneySchema,
  }),
  warningCount: z.number().int(),
  employeeCount: z.number().int(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
});
export type PayrollRun = z.infer<typeof PayrollRunSchema>;

export const PayslipSchema = z.object({
  id: z.uuid(),
  payrollRunId: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  computation: PayslipComputationSchema,
  ytd: z.object({
    gross: MoneySchema,
    taxableIncome: MoneySchema,
    withholdingTax: MoneySchema,
    sssEe: MoneySchema,
    philhealthEe: MoneySchema,
    pagibigEe: MoneySchema,
    net: MoneySchema,
  }),
});
export type Payslip = z.infer<typeof PayslipSchema>;

export const FinalPayRequestSchema = z.object({
  employeeId: z.uuid(),
  separationDate: DateSchema,
  payDate: DateSchema,
  unusedSilDays: z.number().min(0).max(366),
  reason: z.string().trim().min(1).max(300),
});
export type FinalPayRequest = z.infer<typeof FinalPayRequestSchema>;

export const LoanTypeSchema = z.enum(['sss', 'pagibig', 'company', 'cash_advance']);
export type LoanType = z.infer<typeof LoanTypeSchema>;

export const LoanInputSchema = z
  .object({
    employeeId: z.uuid(),
    type: LoanTypeSchema,
    reference: z.string().trim().max(60).nullable(),
    principal: NonNegMoneySchema,
    /** Amount deducted per deduction period. */
    amortization: NonNegMoneySchema,
    /** Deduct on every run, or only on the 1st or 2nd semi-monthly cutoff. */
    deductOn: z.enum(['every_run', 'first_cutoff', 'second_cutoff']),
    startDate: DateSchema,
    notes: z.string().max(300).nullable(),
  })
  .refine((l) => Number(l.amortization) > 0, {
    message: 'Amortization must be more than zero',
    path: ['amortization'],
  });
export type LoanInput = z.infer<typeof LoanInputSchema>;

export const LoanSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  type: LoanTypeSchema,
  reference: z.string().nullable(),
  principal: MoneySchema,
  amortization: MoneySchema,
  deductOn: z.enum(['every_run', 'first_cutoff', 'second_cutoff']),
  startDate: DateSchema,
  balance: MoneySchema,
  status: z.enum(['active', 'paid', 'cancelled']),
  notes: z.string().nullable(),
});
export type Loan = z.infer<typeof LoanSchema>;

export const LoanLedgerEntrySchema = z.object({
  id: z.uuid(),
  loanId: z.uuid(),
  date: DateSchema,
  payrollRunId: z.uuid().nullable(),
  kind: z.enum(['disbursement', 'payment', 'adjustment']),
  amount: MoneySchema,
  balanceAfter: MoneySchema,
  note: z.string().nullable(),
});
export type LoanLedgerEntry = z.infer<typeof LoanLedgerEntrySchema>;

export const CustomDeductionInputSchema = z.object({
  employeeId: z.uuid(),
  label: z.string().trim().min(1).max(80),
  amount: NonNegMoneySchema,
  /** One-off deductions apply to the next run only; recurring ones apply until ended. */
  recurrence: z.enum(['once', 'every_run']),
  startDate: DateSchema,
  endDate: DateSchema.nullable(),
});
export type CustomDeductionInput = z.infer<typeof CustomDeductionInputSchema>;
