import { describe, expect, it } from 'vitest';
import type { DailyFactor } from '../../schemas/common';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import { dailyFromMonthly, monthlyFromDaily, rateBasis, type RateBasis } from '../dailyRate';
import { ratesWith } from './fixtures/rates';

const money = (b: RateBasis): string[] => [b.monthly, b.daily, b.hourly].map((v) => toMoney(v));

describe('dailyFromMonthly / monthlyFromDaily', () => {
  // Daily = monthly × 12 ÷ factor. Monthly = factor × 100 makes daily exactly 1,200.
  it.each<[DailyFactor, string]>([
    [313, '31300'],
    [261, '26100'],
    [365, '36500'],
    [393, '39300'],
  ])('factor %i: monthly %s → daily 1,200 and back', (factor, monthly) => {
    expect(toMoney(dailyFromMonthly(monthly, factor))).toBe('1200.00');
    expect(toMoney(monthlyFromDaily('1200', factor))).toBe(toMoney(monthly));
  });

  // 20,000 × 12 = 240,000. ÷261 = 919.5402; ÷313 = 766.7732; ÷365 = 657.5342; ÷393 = 610.6870.
  it.each<[DailyFactor, string]>([
    [261, '919.54'],
    [313, '766.77'],
    [365, '657.53'],
    [393, '610.69'],
  ])('factor %i: monthly 20,000 → daily %s (unrounded internally)', (factor, daily) => {
    expect(toMoney(dailyFromMonthly('20000', factor))).toBe(daily);
  });
});

describe('rateBasis', () => {
  // Hourly = daily ÷ 8 (workHoursPerDay).
  it.each<[DailyFactor, string, string]>([
    // 240,000 ÷ 261 = 919.54023 → ÷8 = 114.94253
    [261, '919.54', '114.94'],
    // 240,000 ÷ 313 = 766.77316 → ÷8 = 95.84665
    [313, '766.77', '95.85'],
    // 240,000 ÷ 365 = 657.53425 → ÷8 = 82.19178
    [365, '657.53', '82.19'],
    // 240,000 ÷ 393 = 610.68702 → ÷8 = 76.33588
    [393, '610.69', '76.34'],
  ])('monthly 20,000, factor %i → daily %s, hourly %s', (factor, daily, hourly) => {
    expect(money(rateBasis('monthly', '20000', factor, RATES_V1))).toEqual([
      '20000.00',
      daily,
      hourly,
    ]);
  });

  it.each<[DailyFactor, string]>([
    [313, '31300'],
    [261, '26100'],
    [365, '36500'],
    [393, '39300'],
  ])('semi_monthly base is per cutoff: factor %i, cutoff = monthly %s ÷ 2', (factor, monthly) => {
    // Semi-monthly 15,650 ×2 = 31,300 etc.; daily = monthly × 12 ÷ factor = 1,200; hourly 150.
    const cutoff = (Number(monthly) / 2).toFixed(2);
    expect(money(rateBasis('semi_monthly', cutoff, factor, RATES_V1))).toEqual([
      toMoney(monthly),
      '1200.00',
      '150.00',
    ]);
  });

  it.each<[DailyFactor, string]>([
    // monthly = 1,200 × factor ÷ 12
    [313, '31300.00'],
    [261, '26100.00'],
    [365, '36500.00'],
    [393, '39300.00'],
  ])('daily 1,200, factor %i → monthly %s, hourly 150', (factor, monthly) => {
    expect(money(rateBasis('daily', '1200', factor, RATES_V1))).toEqual([
      monthly,
      '1200.00',
      '150.00',
    ]);
  });

  it.each<[DailyFactor, string]>([
    // daily = 150 × 8 = 1,200; monthly = 1,200 × factor ÷ 12
    [313, '31300.00'],
    [261, '26100.00'],
    [365, '36500.00'],
    [393, '39300.00'],
  ])('hourly 150, factor %i → daily 1,200, monthly %s', (factor, monthly) => {
    expect(money(rateBasis('hourly', '150', factor, RATES_V1))).toEqual([
      monthly,
      '1200.00',
      '150.00',
    ]);
  });

  it('daily 645 (non-round), factor 313 → monthly 645 × 313 ÷ 12 = 16,823.75', () => {
    // 645 × 313 = 201,885 ÷ 12 = 16,823.75; hourly 645 ÷ 8 = 80.625 → 80.63
    expect(money(rateBasis('daily', '645', 313, RATES_V1))).toEqual([
      '16823.75',
      '645.00',
      '80.63',
    ]);
  });

  it('reads hours per day from rates', () => {
    // With a 10-hour day: daily 1,200 → hourly 120; hourly 150 → daily 1,500.
    const rates = ratesWith((r) => {
      r.workHoursPerDay = '10';
    });
    expect(toMoney(rateBasis('daily', '1200', 313, rates).hourly)).toBe('120.00');
    expect(toMoney(rateBasis('hourly', '150', 313, rates).daily)).toBe('1500.00');
  });
});
