import { describe, expect, it } from 'vitest';
import { toMoney } from '../../money';
import { amortizationSchedule, loanDeduction } from '../loans';

describe('amortizationSchedule', () => {
  it('10,000 at 3,000 → 3,000 × 3 then the 1,000 remainder', () => {
    const rows = amortizationSchedule('10000', '3000');
    expect(rows.map((r) => [r.installment, toMoney(r.amount), toMoney(r.balanceAfter)])).toEqual([
      [1, '3000.00', '7000.00'],
      [2, '3000.00', '4000.00'],
      [3, '3000.00', '1000.00'],
      [4, '1000.00', '0.00'],
    ]);
  });
  it('exact multiple: 9,000 at 3,000 → three equal rows, no zero row', () => {
    const rows = amortizationSchedule('9000', '3000');
    expect(rows.map((r) => toMoney(r.amount))).toEqual(['3000.00', '3000.00', '3000.00']);
    expect(toMoney(rows[rows.length - 1]?.balanceAfter ?? '-1')).toBe('0.00');
  });
  it('centavo remainder: 1,000.01 at 250 → last installment 0.01', () => {
    const rows = amortizationSchedule('1000.01', '250');
    expect(rows).toHaveLength(5);
    expect(toMoney(rows[4]?.amount ?? '-1')).toBe('0.01');
  });
  it('amortization larger than principal: one row for the principal', () => {
    expect(amortizationSchedule('500', '3000').map((r) => toMoney(r.amount))).toEqual(['500.00']);
  });
  it('rejects a non-positive amortization', () => {
    expect(() => amortizationSchedule('1000', '0')).toThrow();
  });
});

describe('loanDeduction: amortization capped at the balance', () => {
  it.each<[string, string, string]>([
    ['5000', '3000', '3000.00'], // balance covers the amortization
    ['500', '3000', '500.00'], // capped at the balance
    ['3000', '3000', '3000.00'], // exactly the balance
    ['0', '3000', '0.00'], // paid off
    ['-10', '3000', '0.00'], // over-paid ledger → nothing
  ])('balance %s, amortization %s → %s', (balance, amortization, expected) => {
    expect(toMoney(loanDeduction(balance, amortization))).toBe(expected);
  });
});
