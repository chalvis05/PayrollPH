import type { DailyFactor, PayType } from '../schemas/common';
import type { StatutoryRates } from '../schemas/rates';
import { dec, type Dec, type Numeric } from '../money';

const MONTHS_PER_YEAR = 12;

/** Daily rate equivalent of a monthly salary: monthly × 12 ÷ factor. Unrounded. */
export function dailyFromMonthly(monthly: Numeric, factor: DailyFactor): Dec {
  return dec(monthly).times(MONTHS_PER_YEAR).div(factor);
}

/** Monthly equivalent of a daily rate: daily × factor ÷ 12. Unrounded. */
export function monthlyFromDaily(daily: Numeric, factor: DailyFactor): Dec {
  return dec(daily).times(factor).div(MONTHS_PER_YEAR);
}

export interface RateBasis {
  monthly: Dec;
  daily: Dec;
  hourly: Dec;
}

/**
 * Monthly/daily/hourly equivalents of a base rate.
 * `semi_monthly` base rates are per cutoff; `hourly` base rates are per hour.
 */
export function rateBasis(
  payType: PayType,
  baseRate: Numeric,
  factor: DailyFactor,
  rates: StatutoryRates,
): RateBasis {
  const hoursPerDay = dec(rates.workHoursPerDay);
  switch (payType) {
    case 'monthly':
    case 'semi_monthly': {
      const monthly = payType === 'monthly' ? dec(baseRate) : dec(baseRate).times(2);
      const daily = dailyFromMonthly(monthly, factor);
      return { monthly, daily, hourly: daily.div(hoursPerDay) };
    }
    case 'daily': {
      const daily = dec(baseRate);
      return { monthly: monthlyFromDaily(daily, factor), daily, hourly: daily.div(hoursPerDay) };
    }
    case 'hourly': {
      const hourly = dec(baseRate);
      const daily = hourly.times(hoursPerDay);
      return { monthly: monthlyFromDaily(daily, factor), daily, hourly };
    }
  }
}
