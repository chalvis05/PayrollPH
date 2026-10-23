import type {
  DailyFactor,
  DayType,
  EmploymentType,
  HolidayType,
  LeaveType,
  LoanType,
  PayType,
  PayrollRunKind,
  PayrollRunStatus,
} from '@payrollph/shared';
import type { SelectOption } from '../components/forms';

/** Human labels for enum values, shared by every page so wording stays consistent. */
export const payTypeLabels: Record<PayType, string> = {
  monthly: 'Monthly',
  semi_monthly: 'Semi-monthly',
  daily: 'Daily',
  hourly: 'Hourly',
};

export const employmentTypeLabels: Record<EmploymentType, string> = {
  regular: 'Regular',
  probationary: 'Probationary',
  contractual: 'Contractual',
  kasambahay: 'Kasambahay',
};

export const dailyFactorLabels: Record<DailyFactor, string> = {
  261: '261 — 5-day week',
  313: '313 — 6-day week',
  365: '365 — every day paid',
  393: '393 — every day + holiday premiums',
};

export const runKindLabels: Record<PayrollRunKind, string> = {
  semi_monthly_1: '1st cutoff (1–15)',
  semi_monthly_2: '2nd cutoff (16–end)',
  monthly: 'Monthly',
  thirteenth_month: '13th month',
  final_pay: 'Final pay',
};

export const runStatusLabels: Record<PayrollRunStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  paid: 'Paid',
};

export const loanTypeLabels: Record<LoanType, string> = {
  sss: 'SSS loan',
  pagibig: 'Pag-IBIG loan',
  company: 'Company loan',
  cash_advance: 'Cash advance',
};

export const holidayTypeLabels: Record<HolidayType, string> = {
  regular: 'Regular holiday',
  special_non_working: 'Special non-working',
  special_working: 'Special working',
};

export const leaveTypeLabels: Record<LeaveType, string> = {
  sil: 'Service incentive leave',
  maternity: 'Maternity',
  paternity: 'Paternity',
  solo_parent: 'Solo parent',
  unpaid: 'Unpaid leave',
};

export const dayTypeLabels: Record<DayType, string> = {
  ordinary: 'Ordinary day',
  rest_day: 'Rest day',
  special: 'Special day',
  special_rest_day: 'Special day + rest day',
  regular: 'Regular holiday',
  regular_rest_day: 'Regular holiday + rest day',
  double: 'Double holiday',
  double_rest_day: 'Double holiday + rest day',
};

export const deductOnLabels: Record<'every_run' | 'first_cutoff' | 'second_cutoff', string> = {
  every_run: 'Every payroll run',
  first_cutoff: '1st cutoff only (1–15)',
  second_cutoff: '2nd cutoff only (16–end)',
};

export const loanStatusLabels: Record<'active' | 'paid' | 'cancelled', string> = {
  active: 'Active',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const ledgerKindLabels: Record<'disbursement' | 'payment' | 'adjustment', string> = {
  disbursement: 'Released',
  payment: 'Payroll deduction',
  adjustment: 'Adjustment',
};

export const recurrenceLabels: Record<'once' | 'every_run', string> = {
  every_run: 'Every payroll run',
  once: 'Once (next run only)',
};

export const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Turn a label map into select options, keeping the map's order. */
export function optionsFrom<K extends string | number>(labels: Record<K, string>): SelectOption[] {
  return (Object.entries(labels) as [string, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

/** Regions as the minimum-wage table names them. */
export const REGIONS = [
  'NCR',
  'CAR',
  'I',
  'II',
  'III',
  'IV-A',
  'IV-B',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'BARMM',
] as const;
