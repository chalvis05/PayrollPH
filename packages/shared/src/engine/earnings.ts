import type { PayFrequency, PayType } from '../schemas/common';
import type { PayLine } from '../schemas/payslip';
import type { StatutoryRates } from '../schemas/rates';
import { dec, max, round2, sum, toMoney, ZERO, type Dec, type Numeric } from '../money';
import type { RateBasis } from './dailyRate';
import type { DayHours } from './premiums';
import { periodsPerYear } from './withholding';

/** Attendance totals for one employee in one payroll period. */
export interface AttendanceSummary {
  /** Daily staff: ordinary days worked (rest days/holidays go in `days`). */
  daysWorked: Numeric;
  /** Hourly staff: ordinary hours worked. */
  regularHours: Numeric;
  paidLeaveDays: Numeric;
  /** Monthly/semi-monthly staff: unpaid absence days deducted from the salary. */
  absentDays: Numeric;
  tardyMinutes: Numeric;
  undertimeMinutes: Numeric;
  /** Hours on each kind of day, for premiums/OT/night differential. */
  days: readonly DayHours[];
  /** Daily/hourly staff: eligible regular holidays not worked. */
  unworkedRegularHolidays: Numeric;
  unworkedDoubleHolidays: Numeric;
}

export const EMPTY_ATTENDANCE: AttendanceSummary = {
  daysWorked: 0,
  regularHours: 0,
  paidLeaveDays: 0,
  absentDays: 0,
  tardyMinutes: 0,
  undertimeMinutes: 0,
  days: [],
  unworkedRegularHolidays: 0,
  unworkedDoubleHolidays: 0,
};

function basicLine(
  code: string,
  label: string,
  category: 'basic' | 'attendance_deduction',
  amount: Dec,
  quantity: Numeric,
): PayLine {
  return {
    code,
    label,
    category,
    amount: toMoney(amount),
    taxClass: 'mwe_exempt_eligible',
    quantity: dec(quantity).toString(),
  };
}

export interface BasicPayResult {
  lines: PayLine[];
  /** Basic salary actually earned (basic + paid leave − attendance deductions), for 13th month. */
  basicEarned: Dec;
}

/** Basic pay, paid leave, and attendance deductions for the period. Zero lines are omitted. */
export function computeBasicPay(input: {
  payType: PayType;
  basis: RateBasis;
  frequency: PayFrequency;
  attendance: AttendanceSummary;
  rates: StatutoryRates;
}): BasicPayResult {
  const { payType, basis, attendance: a } = input;
  const lines: PayLine[] = [];
  const push = (l: PayLine): void => {
    if (!dec(l.amount).isZero()) lines.push(l);
  };

  if (payType === 'monthly' || payType === 'semi_monthly') {
    const n = periodsPerYear(input.frequency, input.rates);
    push(basicLine('basic', 'Basic salary', 'basic', basis.monthly.times(12).div(n), 1));
    push(
      basicLine(
        'absences',
        'Absences',
        'attendance_deduction',
        dec(a.absentDays).times(basis.daily).negated(),
        a.absentDays,
      ),
    );
  } else if (payType === 'daily') {
    push(
      basicLine('basic', 'Basic pay', 'basic', dec(a.daysWorked).times(basis.daily), a.daysWorked),
    );
  } else {
    push(
      basicLine(
        'basic',
        'Basic pay',
        'basic',
        dec(a.regularHours).times(basis.hourly),
        a.regularHours,
      ),
    );
  }

  if (payType !== 'monthly' && payType !== 'semi_monthly') {
    push(
      basicLine(
        'paid_leave',
        'Paid leave',
        'basic',
        dec(a.paidLeaveDays).times(basis.daily),
        a.paidLeaveDays,
      ),
    );
  }

  if (payType !== 'hourly') {
    const minutes = dec(a.tardyMinutes).plus(a.undertimeMinutes);
    push(
      basicLine(
        'tardy_undertime',
        'Tardiness / undertime',
        'attendance_deduction',
        minutes.div(60).times(basis.hourly).negated(),
        minutes,
      ),
    );
  }

  const basicEarned = max(sum(lines.map((l) => l.amount)), ZERO);
  return { lines, basicEarned: round2(basicEarned) };
}
