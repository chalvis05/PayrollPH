import { describe, expect, it } from 'vitest';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import {
  computeMonthlyContributions,
  kasambahayEmployerPaysEe,
  periodShare,
  toBreakdown,
} from '../contributions';

describe('kasambahayEmployerPaysEe (threshold 5,000/month)', () => {
  it('kasambahay below the threshold → employer pays', () => {
    expect(kasambahayEmployerPaysEe('kasambahay', '4999.99', RATES_V1)).toBe(true);
  });
  it('kasambahay at the threshold → normal split', () => {
    expect(kasambahayEmployerPaysEe('kasambahay', '5000', RATES_V1)).toBe(false);
  });
  it('non-kasambahay below the threshold → normal split', () => {
    expect(kasambahayEmployerPaysEe('regular', '4000', RATES_V1)).toBe(false);
  });
});

describe('computeMonthlyContributions', () => {
  it('kasambahay at 4,000: every EE share moves to the employer', () => {
    // SSS: 4,000 < 5,250 → MSC 5,000; EE 250, ER 500, EC 10 → EE 0, ER 750.
    // PhilHealth: floor 10,000 × 5% = 500 → 250/250 → EE 0, ER 500.
    // Pag-IBIG: 4,000 > 1,500 → EE 2% = 80, ER 80 → EE 0, ER 160.
    const b = toBreakdown(
      computeMonthlyContributions({
        employmentType: 'kasambahay',
        sssMonthlyCompensation: '4000',
        monthlyBasicSalary: '4000',
        rates: RATES_V1,
      }),
    );
    expect(b.employerShoulderedEe).toBe(true);
    expect([b.sss.ee, b.sss.er, b.sss.ec, b.sss.eeMpf, b.sss.erMpf]).toEqual([
      '0.00',
      '750.00',
      '10.00',
      '0.00',
      '0.00',
    ]);
    expect([b.philhealth.premium, b.philhealth.ee, b.philhealth.er]).toEqual([
      '500.00',
      '0.00',
      '500.00',
    ]);
    expect([b.pagibig.ee, b.pagibig.er]).toEqual(['0.00', '160.00']);
  });

  it('kasambahay at exactly 5,000: normal shares', () => {
    // SSS MSC 5,000: 250 / 500 / EC 10; PhilHealth 250 / 250; Pag-IBIG 2% × 5,000 = 100 / 100.
    const b = toBreakdown(
      computeMonthlyContributions({
        employmentType: 'kasambahay',
        sssMonthlyCompensation: '5000',
        monthlyBasicSalary: '5000',
        rates: RATES_V1,
      }),
    );
    expect(b.employerShoulderedEe).toBe(false);
    expect([
      b.sss.ee,
      b.sss.er,
      b.philhealth.ee,
      b.philhealth.er,
      b.pagibig.ee,
      b.pagibig.er,
    ]).toEqual(['250.00', '500.00', '250.00', '250.00', '100.00', '100.00']);
  });

  it('non-kasambahay at 4,000: normal shares', () => {
    const b = toBreakdown(
      computeMonthlyContributions({
        employmentType: 'regular',
        sssMonthlyCompensation: '4000',
        monthlyBasicSalary: '4000',
        rates: RATES_V1,
      }),
    );
    expect(b.employerShoulderedEe).toBe(false);
    expect([b.sss.ee, b.sss.er, b.philhealth.ee, b.pagibig.ee, b.pagibig.er]).toEqual([
      '250.00',
      '500.00',
      '250.00',
      '80.00',
      '80.00',
    ]);
  });

  it('SSS uses its own compensation base; PhilHealth and Pag-IBIG use basic salary', () => {
    // SSS on 30,000 → MSC 30,000: EE 1,000 + MPF 500 = 1,500. PhilHealth on 20,000: 1,000 → 500.
    // Pag-IBIG on 20,000: capped 10,000 → 200.
    const b = toBreakdown(
      computeMonthlyContributions({
        employmentType: 'regular',
        sssMonthlyCompensation: '30000',
        monthlyBasicSalary: '20000',
        rates: RATES_V1,
      }),
    );
    expect([b.sss.msc, b.sss.ee, b.philhealth.ee, b.pagibig.ee]).toEqual([
      '30000.00',
      '1500.00',
      '500.00',
      '200.00',
    ]);
  });
});

describe('periodShare', () => {
  it('full / none', () => {
    expect(toMoney(periodShare('1025', 'full'))).toBe('1025.00');
    expect(toMoney(periodShare('1025', 'none'))).toBe('0.00');
  });
  it('even split: 1,025 → 512.50 + 512.50', () => {
    expect(toMoney(periodShare('1025', 'first_half'))).toBe('512.50');
    expect(toMoney(periodShare('1025', 'second_half'))).toBe('512.50');
  });
  it('odd centavo goes to the second half (documented contract): 250.01 → 125.00 + 125.01', () => {
    // contributions.ts doc: "the second half takes any odd centavo".
    expect(toMoney(periodShare('250.01', 'first_half'))).toBe('125.00');
    expect(toMoney(periodShare('250.01', 'second_half'))).toBe('125.01');
  });
  it('the two halves always add back to the monthly total', () => {
    for (const m of ['0.01', '250.01', '521.67', '1043.33', '3500.00', '999.99']) {
      const total = periodShare(m, 'first_half').plus(periodShare(m, 'second_half'));
      expect(toMoney(total)).toBe(toMoney(m));
    }
  });
});
