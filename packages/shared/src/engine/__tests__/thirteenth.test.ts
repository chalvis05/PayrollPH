import { describe, expect, it } from 'vitest';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import { splitOtherBenefits, thirteenthAccrual, thirteenthPayout } from '../thirteenth';
import { ratesWith } from './fixtures/rates';

describe('thirteenthAccrual = basic earned ÷ 12', () => {
  it.each<[string, string]>([
    ['24000', '2000.00'],
    ['25000', '2083.33'], // 2,083.333…
    ['12500', '1041.67'], // 1,041.666… → half-up
    ['0', '0.00'],
    ['300000', '25000.00'], // a full year at 25,000/month = one month's pay
  ])('%s → %s', (basic, accrual) => {
    expect(toMoney(thirteenthAccrual(basic, RATES_V1))).toBe(accrual);
  });
});

describe('thirteenthPayout', () => {
  it('half mode with nothing paid: 25,000 accrued → 12,500', () => {
    expect(toMoney(thirteenthPayout({ accruedYtd: '25000', paidYtd: '0', mode: 'half' }))).toBe(
      '12500.00',
    );
  });
  it('full mode after a half payout: 25,000 − 12,500 = 12,500', () => {
    expect(toMoney(thirteenthPayout({ accruedYtd: '25000', paidYtd: '12500', mode: 'full' }))).toBe(
      '12500.00',
    );
  });
  it('half mode rounds half-up: 1,000.01 ÷ 2 = 500.005 → 500.01', () => {
    expect(toMoney(thirteenthPayout({ accruedYtd: '1000.01', paidYtd: '0', mode: 'half' }))).toBe(
      '500.01',
    );
  });
  it('never negative: half target 6,000 but 7,000 already paid → 0', () => {
    expect(toMoney(thirteenthPayout({ accruedYtd: '12000', paidYtd: '7000', mode: 'half' }))).toBe(
      '0.00',
    );
  });
  it('full mode with nothing paid → the whole accrual', () => {
    expect(toMoney(thirteenthPayout({ accruedYtd: '18333.33', paidYtd: '0', mode: 'full' }))).toBe(
      '18333.33',
    );
  });
});

describe('splitOtherBenefits (ceiling 90,000 per year)', () => {
  const split = (amount: string, used: string): string[] => {
    const s = splitOtherBenefits({ amount, exemptUsedYtd: used, rates: RATES_V1 });
    return [s.exempt, s.taxable].map(toMoney);
  };
  it('exactly at the ceiling with no prior use: 90,000 all exempt', () => {
    expect(split('90000', '0')).toEqual(['90000.00', '0.00']);
  });
  it('one centavo over the ceiling: 90,000.01 → 90,000 exempt + 0.01 taxable', () => {
    expect(split('90000.01', '0')).toEqual(['90000.00', '0.01']);
  });
  it('above the ceiling: 100,000 → 90,000 exempt + 10,000 taxable', () => {
    expect(split('100000', '0')).toEqual(['90000.00', '10000.00']);
  });
  it('with prior exempt use of 70,000: 30,000 → 20,000 exempt + 10,000 taxable', () => {
    expect(split('30000', '70000')).toEqual(['20000.00', '10000.00']);
  });
  it('prior use fills the ceiling exactly: 89,999.99 + 0.01 used → 89,999.99 still exempt', () => {
    expect(split('89999.99', '0.01')).toEqual(['89999.99', '0.00']);
  });
  it('ceiling already exhausted (or over-used): everything taxable', () => {
    expect(split('5000', '90000')).toEqual(['0.00', '5000.00']);
    expect(split('5000', '95000')).toEqual(['0.00', '5000.00']);
  });
  it('reads the ceiling from rates: 82,000 → 100,000 splits 82,000 / 18,000', () => {
    const rates = ratesWith((r) => {
      r.benefits.otherBenefitsCeiling = '82000';
    });
    const s = splitOtherBenefits({ amount: '100000', exemptUsedYtd: '0', rates });
    expect([s.exempt, s.taxable].map(toMoney)).toEqual(['82000.00', '18000.00']);
  });
});
