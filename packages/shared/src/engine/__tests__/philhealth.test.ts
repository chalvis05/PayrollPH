import { describe, expect, it } from 'vitest';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import { computePhilhealth } from '../philhealth';
import { ratesWith } from './fixtures/rates';

const ph = (salary: string): string[] => {
  const c = computePhilhealth(salary, RATES_V1);
  return [c.base, c.premium, c.ee, c.er].map(toMoney);
};

describe('computePhilhealth (5%, floor 10,000, ceiling 100,000, 50/50)', () => {
  it('below the floor uses 10,000: premium 500, 250 / 250', () => {
    expect(ph('6000')).toEqual(['10000.00', '500.00', '250.00', '250.00']);
  });
  it('at the floor exactly: 10,000 × 5% = 500', () => {
    expect(ph('10000')).toEqual(['10000.00', '500.00', '250.00', '250.00']);
  });
  it('mid-range 25,000: 1,250 → 625 / 625', () => {
    expect(ph('25000')).toEqual(['25000.00', '1250.00', '625.00', '625.00']);
  });
  it('at the ceiling exactly: 100,000 × 5% = 5,000 → 2,500 / 2,500', () => {
    expect(ph('100000')).toEqual(['100000.00', '5000.00', '2500.00', '2500.00']);
  });
  it('above the ceiling uses 100,000', () => {
    expect(ph('180000')).toEqual(['100000.00', '5000.00', '2500.00', '2500.00']);
  });
  it('odd-centavo premium: 10,000.20 × 5% = 500.01 → shares still add up to the premium', () => {
    // 500.01 ÷ 2 = 250.005 → EE 250.01 (half-up), ER takes the rest 250.00.
    expect(ph('10000.20')).toEqual(['10000.20', '500.01', '250.01', '250.00']);
  });
  it('premium itself rounds half-up: 10,000.10 × 5% = 500.005 → 500.01', () => {
    expect(ph('10000.10')[1]).toBe('500.01');
  });
  it('reads rates from data: rate 4% on 25,000 = 1,000', () => {
    const rates = ratesWith((r) => {
      r.philhealth.rate = '0.04';
    });
    expect(toMoney(computePhilhealth('25000', rates).premium)).toBe('1000.00');
  });
});
