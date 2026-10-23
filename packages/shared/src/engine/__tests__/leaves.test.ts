import { describe, expect, it } from 'vitest';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import { leaveEntitlements, monthsOfService, silCashConversion } from '../leaves';

describe('monthsOfService (completed months)', () => {
  it.each<[string, string, number]>([
    ['2024-01-15', '2024-01-15', 0],
    ['2024-01-15', '2024-02-14', 0], // day-of-month not yet reached
    ['2024-01-15', '2024-02-15', 1],
    ['2024-01-15', '2025-01-14', 11], // one day short of a year
    ['2024-01-15', '2025-01-15', 12],
    ['2024-03-10', '2025-02-28', 11], // 11 months + 18 days
    ['2020-06-01', '2025-05-31', 59],
    ['2025-06-01', '2025-01-01', 0], // as-of before hire → 0, never negative
  ])('%s → %s = %i', (hire, asOf, months) => {
    expect(monthsOfService(hire, asOf)).toBe(months);
  });
});

describe('leaveEntitlements', () => {
  it('SIL: 11 completed months → 0 days', () => {
    const e = leaveEntitlements({
      hireDate: '2024-01-15',
      asOf: '2025-01-14',
      isSoloParent: false,
      rates: RATES_V1,
    });
    expect(e.silDays).toBe(0);
  });
  it('SIL: 12 completed months → 5 days', () => {
    const e = leaveEntitlements({
      hireDate: '2024-01-15',
      asOf: '2025-01-15',
      isSoloParent: false,
      rates: RATES_V1,
    });
    expect(e.silDays).toBe(5);
  });
  it('solo parent: 5 months → 0; 6 months → 7 days; not a solo parent → 0', () => {
    const at = (asOf: string, isSoloParent: boolean): number =>
      leaveEntitlements({ hireDate: '2025-01-10', asOf, isSoloParent, rates: RATES_V1 })
        .soloParentDays;
    expect(at('2025-07-09', true)).toBe(0); // 5 months 29 days
    expect(at('2025-07-10', true)).toBe(7); // 6 months
    expect(at('2026-07-10', false)).toBe(0);
  });
  it('maternity and paternity come straight from rates', () => {
    const e = leaveEntitlements({
      hireDate: '2025-01-01',
      asOf: '2025-01-02',
      isSoloParent: false,
      rates: RATES_V1,
    });
    expect([e.maternityDays, e.paternityDays]).toEqual([105, 7]);
  });
});

describe('silCashConversion = unused days × daily rate', () => {
  it('5 × 645 = 3,225', () => {
    expect(toMoney(silCashConversion('5', '645'))).toBe('3225.00');
  });
  it('3 × 610.687 (unrounded daily) = 1,832.061 → 1,832.06', () => {
    expect(toMoney(silCashConversion('3', '610.687'))).toBe('1832.06');
  });
  it('half day: 0.5 × 800.25 = 400.125 → 400.13 (half-up)', () => {
    expect(toMoney(silCashConversion('0.5', '800.25'))).toBe('400.13');
  });
});
