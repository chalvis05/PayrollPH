import { describe, expect, it } from 'vitest';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import { computePagibig } from '../pagibig';
import { ratesWith } from './fixtures/rates';

const pi = (comp: string): string[] => {
  const c = computePagibig(comp, RATES_V1);
  return [c.base, c.ee, c.er].map(toMoney);
};

describe('computePagibig (EE 1% ≤ 1,500 else 2%; ER 2%; max base 10,000)', () => {
  it('1,000: EE 1% = 10, ER 2% = 20', () => {
    expect(pi('1000')).toEqual(['1000.00', '10.00', '20.00']);
  });
  it('exactly 1,500 is still the low tier: EE 15, ER 30', () => {
    expect(pi('1500')).toEqual(['1500.00', '15.00', '30.00']);
  });
  it('1,500.01 moves to the high tier: EE 2% = 30.0002 → 30.00, ER 30.00', () => {
    expect(pi('1500.01')).toEqual(['1500.01', '30.00', '30.00']);
  });
  it('5,000: EE 100, ER 100', () => {
    expect(pi('5000')).toEqual(['5000.00', '100.00', '100.00']);
  });
  it('exactly 10,000: EE 200, ER 200', () => {
    expect(pi('10000')).toEqual(['10000.00', '200.00', '200.00']);
  });
  it('above the cap: 45,000 → base 10,000, EE 200, ER 200', () => {
    expect(pi('45000')).toEqual(['10000.00', '200.00', '200.00']);
  });
  it('reads the cap from data: max base 5,000 → 100 / 100 on 20,000', () => {
    const rates = ratesWith((r) => {
      r.pagibig.maxBase = '5000';
    });
    const c = computePagibig('20000', rates);
    expect([c.ee, c.er].map(toMoney)).toEqual(['100.00', '100.00']);
  });
});
