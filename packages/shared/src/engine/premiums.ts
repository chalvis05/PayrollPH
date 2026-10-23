import type { DailyFactor, DayType, PayType } from '../schemas/common';
import type { PayLine } from '../schemas/payslip';
import type { StatutoryRates } from '../schemas/rates';
import { dec, toMoney, ZERO, type Dec, type Numeric } from '../money';

/** Hours worked on one kind of day within the period. ND hours are subsets of the totals. */
export interface DayHours {
  dayType: DayType;
  /** Regular (non-OT) hours worked on this kind of day. */
  hours: Numeric;
  otHours: Numeric;
  /** Regular hours falling in the night-differential window. */
  ndHours: Numeric;
  /** OT hours falling in the night-differential window. */
  ndOtHours: Numeric;
}

const DAY_LABELS: Record<DayType, string> = {
  ordinary: 'Ordinary day',
  rest_day: 'Rest day',
  special: 'Special non-working day',
  special_rest_day: 'Special day on rest day',
  regular: 'Regular holiday',
  regular_rest_day: 'Regular holiday on rest day',
  double: 'Double holiday',
  double_rest_day: 'Double holiday on rest day',
};

/** Rate multiplier for the first 8 hours of work on a given kind of day. */
export function dayMultiplier(dayType: DayType, rates: StatutoryRates): Dec {
  const p = rates.premiums;
  switch (dayType) {
    case 'ordinary':
      return dec(1);
    case 'rest_day':
      return dec(p.restDay);
    case 'special':
      return dec(p.special);
    case 'special_rest_day':
      return dec(p.specialRestDay);
    case 'regular':
      return dec(p.regular);
    case 'regular_rest_day':
      return dec(p.regularRestDay);
    case 'double':
      return dec(p.double);
    case 'double_rest_day':
      return dec(p.doubleRestDay);
  }
}

/** Rate for OT hours on a given kind of day, as a multiple of the hourly rate. */
export function otMultiplier(dayType: DayType, rates: StatutoryRates): Dec {
  if (dayType === 'ordinary') return dec(rates.premiums.otOrdinary);
  return dayMultiplier(dayType, rates).times(rates.premiums.otPremiumDay);
}

const isRestDay = (d: DayType): boolean => d.endsWith('rest_day');
const isRegularHoliday = (d: DayType): boolean => d.startsWith('regular') || d.startsWith('double');

/**
 * Share of the day's 100% already paid through the salary (1) or not (0).
 *
 * Monthly/semi-monthly: the regular-holiday 100% is in the salary, so only the additional
 * premium is added. Special days fall on salaried working days. Rest days are covered only
 * by the 365 and 393 factors, which pay every day of the year.
 * Daily/hourly: only ordinary days are paid through basic pay.
 */
export function salaryCoverage(dayType: DayType, payType: PayType, factor: DailyFactor): number {
  if (dayType === 'ordinary') return 1;
  if (payType === 'daily' || payType === 'hourly') return 0;
  if (isRegularHoliday(dayType)) return 1;
  if (isRestDay(dayType)) return factor === 365 || factor === 393 ? 1 : 0;
  return 1;
}

export interface PremiumInput {
  payType: PayType;
  factor: DailyFactor;
  hourly: Numeric;
  days: readonly DayHours[];
  rates: StatutoryRates;
}

function premiumLine(code: string, label: string, amount: Dec, quantity: Dec): PayLine {
  return {
    code,
    label,
    category: 'premium',
    amount: toMoney(amount),
    taxClass: 'mwe_exempt_eligible',
    quantity: quantity.toString(),
  };
}

/** Premium, OT, and night-differential lines for the period. Zero-amount lines are omitted. */
export function computePremiums(input: PremiumInput): PayLine[] {
  const { payType, factor, rates } = input;
  const hourly = dec(input.hourly);
  const nd = dec(rates.premiums.nightDiff);
  const lines: PayLine[] = [];

  for (const day of input.days) {
    const m = dayMultiplier(day.dayType, rates);
    const otM = otMultiplier(day.dayType, rates);
    const label = DAY_LABELS[day.dayType];
    const hours = dec(day.hours);
    const otHours = dec(day.otHours);
    const ndHours = dec(day.ndHours);
    const ndOtHours = dec(day.ndOtHours);

    if (day.dayType !== 'ordinary' && hours.gt(0)) {
      const toPay = m.minus(salaryCoverage(day.dayType, payType, factor));
      const amount = hours.times(hourly).times(toPay);
      if (amount.gt(0)) {
        lines.push(premiumLine(`${day.dayType}_work`, `${label} work`, amount, hours));
      }
    }
    if (otHours.gt(0)) {
      const amount = otHours.times(hourly).times(otM);
      lines.push(premiumLine(`${day.dayType}_ot`, `${label} overtime`, amount, otHours));
    }
    if (ndHours.gt(0)) {
      const amount = ndHours.times(hourly).times(m).times(nd);
      lines.push(premiumLine(`${day.dayType}_nd`, `${label} night differential`, amount, ndHours));
    }
    if (ndOtHours.gt(0)) {
      const amount = ndOtHours.times(hourly).times(otM).times(nd);
      lines.push(
        premiumLine(
          `${day.dayType}_nd_ot`,
          `${label} night differential on overtime`,
          amount,
          ndOtHours,
        ),
      );
    }
  }
  return lines;
}

/**
 * Pay for regular/double holidays NOT worked, for eligible daily/hourly staff (present or on
 * paid leave the workday before). Unworked pay = daily × (worked multiplier − 1), i.e. 100% for
 * a regular holiday and 200% for a double holiday. Monthly/semi-monthly staff get nothing extra:
 * it is already in the salary.
 */
export function unworkedHolidayPay(input: {
  payType: PayType;
  daily: Numeric;
  regularDays: Numeric;
  doubleDays: Numeric;
  rates: StatutoryRates;
}): PayLine[] {
  if (input.payType === 'monthly' || input.payType === 'semi_monthly') return [];
  const daily = dec(input.daily);
  const out: PayLine[] = [];
  const add = (code: string, label: string, days: Dec, dayType: DayType): void => {
    if (days.lte(0)) return;
    const amount = days.times(daily).times(dayMultiplier(dayType, input.rates).minus(1));
    out.push({
      code,
      label,
      category: 'holiday',
      amount: toMoney(amount),
      taxClass: 'mwe_exempt_eligible',
      quantity: days.toString(),
    });
  };
  add(
    'regular_holiday_unworked',
    'Regular holiday pay (not worked)',
    dec(input.regularDays),
    'regular',
  );
  add(
    'double_holiday_unworked',
    'Double holiday pay (not worked)',
    dec(input.doubleDays),
    'double',
  );
  return out;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Hours of a shift (start inclusive, end exclusive) inside the night-differential window.
 * A shift whose end is at or before its start crosses midnight.
 */
export function nightDiffHours(start: string, end: string, rates: StatutoryRates): Dec {
  const day = 24 * 60;
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += day;
  const ws = toMinutes(rates.nightDiffWindow.start);
  let we = toMinutes(rates.nightDiffWindow.end);
  if (we <= ws) we += day;
  let minutes = 0;
  // The window repeats daily; a shift spans at most 48h of the timeline.
  for (const offset of [-day, 0, day]) {
    const lo = Math.max(s, ws + offset);
    const hi = Math.min(e, we + offset);
    if (hi > lo) minutes += hi - lo;
  }
  return minutes === 0 ? ZERO : dec(minutes).div(60);
}
