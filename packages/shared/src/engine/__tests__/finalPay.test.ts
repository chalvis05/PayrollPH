import { describe, expect, it } from 'vitest';
import { RATES_V1 } from '../../seed/ratesV1';
import { computeFinalPay, type FinalPayInput } from '../finalPay';

function input(overrides: Partial<FinalPayInput>): FinalPayInput {
  return {
    lastSalaryNet: '0',
    basicEarnedYtd: '0',
    thirteenthPaidYtd: '0',
    unusedSilDays: '0',
    dailyRate: '0',
    otherBenefitsExemptUsedYtd: '0',
    outstandingLoans: [],
    taxAdjustment: '0',
    rates: RATES_V1,
    ...overrides,
  };
}

describe('computeFinalPay', () => {
  it('sample: prorated 13th, SIL conversion, loan payoff, tax still to withhold', () => {
    /*
     * 13th = 150,000 ÷ 12 = 12,500 (none paid yet) → all exempt (ceiling 90,000 unused)
     * SIL = 5 × 1,000 = 5,000
     * earnings = 17,500; deductions = SSS loan 3,000 + tax 500 = 3,500 (paid-off loan skipped)
     * net = 10,000 + 17,500 − 3,500 = 24,000
     */
    const r = computeFinalPay(
      input({
        lastSalaryNet: '10000',
        basicEarnedYtd: '150000',
        unusedSilDays: '5',
        dailyRate: '1000',
        outstandingLoans: [
          { code: 'sss_loan', label: 'SSS salary loan', balance: '3000' },
          { code: 'old_loan', label: 'Old loan', balance: '0' },
        ],
        taxAdjustment: '500',
      }),
    );
    expect(r.earnings.map((l) => [l.code, l.amount, l.taxClass])).toEqual([
      ['thirteenth_prorated', '12500.00', 'other_benefit'],
      ['sil_conversion', '5000.00', 'taxable'],
    ]);
    expect(r.deductions.map((l) => [l.code, l.amount, l.category])).toEqual([
      ['sss_loan', '3000.00', 'loan'],
      ['tax_annualization', '500.00', 'withholding_tax'],
    ]);
    expect(r.thirteenthMonth).toEqual({ amount: '12500.00', exempt: '12500.00', taxable: '0.00' });
    expect([r.lastSalaryNet, r.totalEarnings, r.totalDeductions, r.netFinalPay]).toEqual([
      '10000.00',
      '17500.00',
      '3500.00',
      '24000.00',
    ]);
  });

  it('prorated 13th less a mid-year payout', () => {
    // 240,000 ÷ 12 = 20,000 accrued − 10,000 paid = 10,000
    const r = computeFinalPay(input({ basicEarnedYtd: '240000', thirteenthPaidYtd: '10000' }));
    expect(r.thirteenthMonth.amount).toBe('10000.00');
    expect(r.netFinalPay).toBe('10000.00');
  });

  it('13th over the remaining exemption: 125,000 ÷ 12 = 10,416.67; 85,000 used → 5,000 exempt, 5,416.67 taxable', () => {
    const r = computeFinalPay(
      input({ basicEarnedYtd: '125000', otherBenefitsExemptUsedYtd: '85000' }),
    );
    expect(r.thirteenthMonth).toEqual({
      amount: '10416.67',
      exempt: '5000.00',
      taxable: '5416.67',
    });
  });

  it('13th already fully paid: no line, nothing negative', () => {
    // 60,000 ÷ 12 = 5,000 accrued, 6,000 paid → 0 due
    const r = computeFinalPay(
      input({ lastSalaryNet: '5000', basicEarnedYtd: '60000', thirteenthPaidYtd: '6000' }),
    );
    expect(r.earnings).toEqual([]);
    expect(r.thirteenthMonth.amount).toBe('0.00');
    expect(r.netFinalPay).toBe('5000.00');
  });

  it('tax refund from annualization increases final pay', () => {
    // net = 5,000 − (−800) = 5,800
    const r = computeFinalPay(input({ lastSalaryNet: '5000', taxAdjustment: '-800' }));
    expect(r.deductions.map((l) => [l.code, l.label, l.amount])).toEqual([
      ['tax_annualization', 'Tax refund (annualization)', '-800.00'],
    ]);
    expect(r.netFinalPay).toBe('5800.00');
  });

  it('SIL conversion uses the unrounded daily rate: 3 × 610.687 = 1,832.06', () => {
    const r = computeFinalPay(input({ unusedSilDays: '3', dailyRate: '610.687022900763' }));
    expect(r.earnings.map((l) => [l.code, l.amount, l.quantity])).toEqual([
      ['sil_conversion', '1832.06', '3'],
    ]);
  });

  it('loans exceeding everything else can make final pay negative', () => {
    // 2,000 + 0 − 7,500 = −5,500
    const r = computeFinalPay(
      input({
        lastSalaryNet: '2000',
        outstandingLoans: [{ code: 'loan', label: 'Company loan', balance: '7500' }],
      }),
    );
    expect(r.netFinalPay).toBe('-5500.00');
  });
});
