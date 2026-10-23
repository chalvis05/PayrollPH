import { describe, expect, it } from 'vitest';
import {
  PayslipComputationSchema,
  type PayLine,
  type PayslipComputation,
} from '../../schemas/payslip';
import { RATES_V1 } from '../../seed/ratesV1';
import { computePayslip, type PayslipInput } from '../computePayslip';
import { EMPTY_ATTENDANCE } from '../earnings';

const ALL_IDS = { sss: true, philhealth: true, pagibig: true, tin: true };

function base(overrides: Partial<PayslipInput> = {}): PayslipInput {
  return {
    employee: {
      payType: 'monthly',
      employmentType: 'regular',
      baseRate: '30000',
      dailyFactor: 261,
      govIds: ALL_IDS,
    },
    frequency: 'semi_monthly',
    attendance: EMPTY_ATTENDANCE,
    allowances: [],
    contributions: { share: 'none' },
    otherDeductions: [],
    ytd: { otherBenefitsExemptUsed: '0' },
    rates: RATES_V1,
    ...overrides,
  };
}

function run(input: PayslipInput): PayslipComputation {
  // Every result must satisfy the wire schema.
  return PayslipComputationSchema.parse(computePayslip(input));
}

const pairs = (lines: readonly PayLine[]): [string, string][] =>
  lines.map((l) => [l.code, l.amount]);
const warningCodes = (p: PayslipComputation): string[] => p.warnings.map((w) => w.code);

describe('computePayslip: monthly employee, semi-monthly cutoff (end to end)', () => {
  /*
   * Monthly 30,000, factor 261, 2nd cutoff with 50/50 contribution split.
   * daily = 30,000 × 12 ÷ 261 = 1,379.3103; hourly = 172.4138
   * basic = 30,000 ÷ 2 = 15,000
   * 2 h OT on an ordinary day: 2 × 172.4138 × 1.25 = 431.0345 → 431.03
   * 8 h on a regular holiday (100% already in salary): 8 × 172.4138 × 1.00 = 1,379.31
   * gross = 15,000 + 431.03 + 1,379.31 = 16,810.34
   * SSS on 30,000 → MSC 30,000: EE 1,000 + MPF 500 = 1,500 → 2nd half 750; ER 3,000 → 1,500; EC 30 → 15
   * PhilHealth 30,000 × 5% = 1,500 → EE 750 → 375; ER 375
   * Pag-IBIG base 10,000: EE 200 → 100; ER 100
   * EE statutory = 750 + 375 + 100 = 1,225
   * taxable = 16,810.34 − 1,225 = 15,585.34
   * semi-monthly tax = 0.15 × (15,585.34 − 10,416.6667) = 775.301 → 775.30
   * deductions = 1,225 + 775.30 = 2,000.30; net = 16,810.34 − 2,000.30 = 14,810.04
   * 13th accrual = 15,000 ÷ 12 = 1,250
   */
  const p = run(
    base({
      contributions: { share: 'second_half' },
      attendance: {
        ...EMPTY_ATTENDANCE,
        days: [
          { dayType: 'ordinary', hours: 0, otHours: 2, ndHours: 0, ndOtHours: 0 },
          { dayType: 'regular', hours: 8, otHours: 0, ndHours: 0, ndOtHours: 0 },
        ],
      },
    }),
  );

  it('rate basis', () => {
    expect(p.rateBasis).toEqual({ monthly: '30000.00', daily: '1379.31', hourly: '172.41' });
  });
  it('earnings and gross', () => {
    expect(pairs(p.earnings)).toEqual([
      ['basic', '15000.00'],
      ['ordinary_ot', '431.03'],
      ['regular_work', '1379.31'],
    ]);
    expect(p.grossPay).toBe('16810.34');
  });
  it('monthly contributions before the period share', () => {
    expect(p.monthlyContributions.sss).toMatchObject({
      msc: '30000.00',
      ee: '1500.00',
      er: '3000.00',
      ec: '30.00',
    });
    expect(p.monthlyContributions.philhealth).toMatchObject({
      premium: '1500.00',
      ee: '750.00',
      er: '750.00',
    });
    expect(p.monthlyContributions.pagibig).toMatchObject({ ee: '200.00', er: '200.00' });
  });
  it('employee deductions, tax, and net', () => {
    expect(pairs(p.employeeDeductions)).toEqual([
      ['sss_ee', '750.00'],
      ['philhealth_ee', '375.00'],
      ['pagibig_ee', '100.00'],
      ['withholding_tax', '775.30'],
    ]);
    expect(p.taxableIncome).toBe('15585.34');
    expect(p.withholdingTax).toBe('775.30');
    expect(p.totalDeductions).toBe('2000.30');
    expect(p.netPay).toBe('14810.04');
  });
  it('employer shares for the period', () => {
    expect(pairs(p.employerShares)).toEqual([
      ['sss_er', '1500.00'],
      ['sss_ec', '15.00'],
      ['philhealth_er', '375.00'],
      ['pagibig_er', '100.00'],
    ]);
  });
  it('13th month accrual on basic only (not OT/holiday premium)', () => {
    expect(p.basicEarned).toBe('15000.00');
    expect(p.thirteenthMonthAccrual).toBe('1250.00');
    expect(p.isMinimumWageEarner).toBe(false);
    expect(p.warnings).toEqual([]);
  });
});

describe('computePayslip: daily employee, semi-monthly cutoff (end to end)', () => {
  /*
   * Daily 800, factor 313; full monthly contributions taken this cutoff.
   * hourly = 100; monthly equivalent = 800 × 313 ÷ 12 = 20,866.6667
   * basic 11 × 800 = 8,800; paid leave 1 × 800 = 800; tardy 30 min = 0.5 × 100 = −50
   * unworked regular holiday (eligible) = 100% × 800 = 800
   * rest day 8 h × 100 × 1.30 = 1,040
   * ND 2 h on an ordinary day = 2 × 100 × 0.10 = 20
   * gross = 8,800 + 800 − 50 + 800 + 1,040 + 20 = 11,410
   * SSS on 20,866.67 → MSC 21,000: EE 1,000 + MPF 1,000 × 5% = 1,050; ER 2,000 + 100 = 2,100; EC 30
   * PhilHealth 20,866.6667 × 5% = 1,043.33 → EE 521.665 → 521.67; ER 521.66
   * Pag-IBIG: base 10,000 → 200 / 200
   * EE statutory = 1,050 + 521.67 + 200 = 1,771.67
   * taxable = 11,410 − 1,771.67 = 9,638.33 < 10,416.67 → tax 0
   * cash advance 500 → deductions 2,271.67; net = 11,410 − 2,271.67 = 9,138.33
   * basic earned = 8,800 + 800 − 50 = 9,550 → 13th = 795.833 → 795.83
   */
  const p = run(
    base({
      employee: {
        payType: 'daily',
        employmentType: 'regular',
        baseRate: '800',
        dailyFactor: 313,
        govIds: ALL_IDS,
      },
      contributions: { share: 'full' },
      attendance: {
        ...EMPTY_ATTENDANCE,
        daysWorked: 11,
        paidLeaveDays: 1,
        tardyMinutes: 30,
        unworkedRegularHolidays: 1,
        days: [
          { dayType: 'rest_day', hours: 8, otHours: 0, ndHours: 0, ndOtHours: 0 },
          { dayType: 'ordinary', hours: 8, otHours: 0, ndHours: 2, ndOtHours: 0 },
        ],
      },
      otherDeductions: [
        { code: 'cash_advance', label: 'Cash advance', category: 'deduction', amount: '500' },
      ],
    }),
  );

  it('rate basis', () => {
    expect(p.rateBasis).toEqual({ monthly: '20866.67', daily: '800.00', hourly: '100.00' });
  });
  it('earnings and gross', () => {
    expect(pairs(p.earnings)).toEqual([
      ['basic', '8800.00'],
      ['paid_leave', '800.00'],
      ['tardy_undertime', '-50.00'],
      ['regular_holiday_unworked', '800.00'],
      ['rest_day_work', '1040.00'],
      ['ordinary_nd', '20.00'],
    ]);
    expect(p.grossPay).toBe('11410.00');
  });
  it('deductions, tax, and net', () => {
    expect(pairs(p.employeeDeductions)).toEqual([
      ['sss_ee', '1050.00'],
      ['philhealth_ee', '521.67'],
      ['pagibig_ee', '200.00'],
      ['cash_advance', '500.00'],
    ]);
    expect(p.taxableIncome).toBe('9638.33');
    expect(p.withholdingTax).toBe('0.00');
    expect(p.totalDeductions).toBe('2271.67');
    expect(p.netPay).toBe('9138.33');
  });
  it('employer shares', () => {
    expect(pairs(p.employerShares)).toEqual([
      ['sss_er', '2100.00'],
      ['sss_ec', '30.00'],
      ['philhealth_er', '521.66'],
      ['pagibig_er', '200.00'],
    ]);
  });
  it('13th month accrual', () => {
    expect(p.basicEarned).toBe('9550.00');
    expect(p.thirteenthMonthAccrual).toBe('795.83');
  });
});

describe('computePayslip: minimum wage earner', () => {
  /*
   * Daily 645, f313: 13 days = 8,385; 40 h ordinary OT at 80.625 × 1.25 = 4,031.25
   * gross 12,416.25; contributions share 'none' so statutory EE = 0.
   * Non-MWE: tax = 0.15 × (12,416.25 − 10,416.6667) = 299.9375 → 299.94
   * MWE (rate ≤ regional minimum): basic, OT, holiday and ND are exempt → taxable 0, tax 0.
   */
  const input = (minimum: string): PayslipInput =>
    base({
      employee: {
        payType: 'daily',
        employmentType: 'regular',
        baseRate: '645',
        dailyFactor: 313,
        govIds: ALL_IDS,
      },
      attendance: {
        ...EMPTY_ATTENDANCE,
        daysWorked: 13,
        days: [{ dayType: 'ordinary', hours: 0, otHours: 40, ndHours: 0, ndOtHours: 0 }],
      },
      minimumWage: { daily: minimum },
    });

  it('rate equal to the regional minimum → MWE, exempt, no warning', () => {
    const p = run(input('645'));
    expect(p.grossPay).toBe('12416.25');
    expect(p.isMinimumWageEarner).toBe(true);
    expect(p.taxableIncome).toBe('0.00');
    expect(p.withholdingTax).toBe('0.00');
    expect(warningCodes(p)).toEqual([]);
  });
  it('rate above the minimum → taxed normally', () => {
    const p = run(input('610'));
    expect(p.isMinimumWageEarner).toBe(false);
    expect(p.taxableIncome).toBe('12416.25');
    expect(p.withholdingTax).toBe('299.94');
  });
  it('rate below the minimum → MWE plus a below_minimum_wage warning', () => {
    const p = run(input('695'));
    expect(p.isMinimumWageEarner).toBe(true);
    expect(p.withholdingTax).toBe('0.00');
    const w = p.warnings.find((x) => x.code === 'below_minimum_wage');
    expect(w?.severity).toBe('warning');
    expect(w?.message).toContain('645.00');
    expect(w?.message).toContain('695.00');
  });
  it('MWE still pays tax on a taxable allowance', () => {
    const p = run({
      ...input('645'),
      allowances: [{ code: 'transpo', name: 'Transport', amount: '1000', kind: 'taxable' }],
    });
    expect(p.isMinimumWageEarner).toBe(true);
    expect(p.taxableIncome).toBe('1000.00');
  });
  it('kasambahay is compared against the monthly kasambahay minimum', () => {
    const p = run(
      base({
        employee: {
          payType: 'monthly',
          employmentType: 'kasambahay',
          baseRate: '6000',
          dailyFactor: 365,
          govIds: ALL_IDS,
        },
        minimumWage: { daily: '645', kasambahayMonthly: '6500' },
      }),
    );
    expect(p.isMinimumWageEarner).toBe(true);
    expect(p.warnings.find((w) => w.code === 'below_minimum_wage')?.message).toContain('6500.00');
  });
});

describe('computePayslip: de minimis allowances (rice: 30,000/yr ÷ 24 = 1,250 per cutoff)', () => {
  // Monthly 30,000, no contributions this cutoff: base taxable = 15,000 → tax 0.15 × 4,583.33 = 687.50
  const rice = (amount: string, used = '0'): PayslipComputation =>
    run(
      base({
        allowances: [
          { code: 'rice', name: 'Rice', amount, kind: 'de_minimis', deMinimisType: 'rice' },
        ],
        ytd: { otherBenefitsExemptUsed: used },
      }),
    );

  it('within the limit: fully exempt de minimis', () => {
    const p = rice('1000');
    expect(
      p.earnings
        .filter((l) => l.category === 'allowance')
        .map((l) => [l.code, l.amount, l.taxClass]),
    ).toEqual([['rice', '1000.00', 'de_minimis']]);
    expect(p.grossPay).toBe('16000.00');
    expect(p.taxableIncome).toBe('15000.00');
    expect(p.withholdingTax).toBe('687.50');
    expect(p.otherBenefitsExemptUsed).toBe('0.00');
  });
  it('exactly at the limit: 1,250 fully exempt', () => {
    const p = rice('1250');
    expect(p.earnings.filter((l) => l.category === 'allowance').map((l) => l.amount)).toEqual([
      '1250.00',
    ]);
    expect(p.taxableIncome).toBe('15000.00');
  });
  it('over the limit: 2,000 → 1,250 de minimis + 750 other benefit, exempt under the 90k ceiling', () => {
    const p = rice('2000');
    expect(
      p.earnings
        .filter((l) => l.category === 'allowance')
        .map((l) => [l.code, l.amount, l.taxClass]),
    ).toEqual([
      ['rice', '1250.00', 'de_minimis'],
      ['rice_excess', '750.00', 'other_benefit'],
    ]);
    expect(p.grossPay).toBe('17000.00');
    expect(p.taxableIncome).toBe('15000.00');
    expect(p.otherBenefitsExemptUsed).toBe('750.00');
  });
  it('over the limit with the ceiling nearly used (89,900): 100 exempt, 650 taxable', () => {
    // taxable = 15,000 + 650 = 15,650 → 0.15 × (15,650 − 10,416.6667) = 785.00
    const p = rice('2000', '89900');
    expect(p.otherBenefitsExemptUsed).toBe('100.00');
    expect(p.taxableIncome).toBe('15650.00');
    expect(p.withholdingTax).toBe('785.00');
  });
  it('unknown de minimis type: warning, treated as taxable', () => {
    // taxable = 15,000 + 1,000 = 16,000 → 0.15 × 5,583.3333 = 837.50
    const p = run(
      base({
        allowances: [
          {
            code: 'gas',
            name: 'Gasoline',
            amount: '1000',
            kind: 'de_minimis',
            deMinimisType: 'gasoline',
          },
        ],
      }),
    );
    expect(warningCodes(p)).toEqual(['unknown_de_minimis_type']);
    expect(p.earnings.find((l) => l.code === 'gas')?.taxClass).toBe('taxable');
    expect(p.taxableIncome).toBe('16000.00');
    expect(p.withholdingTax).toBe('837.50');
  });
  it('de minimis with no type at all: warning, treated as taxable', () => {
    const p = run(
      base({ allowances: [{ code: 'x', name: 'Misc', amount: '500', kind: 'de_minimis' }] }),
    );
    expect(warningCodes(p)).toEqual(['unknown_de_minimis_type']);
    expect(p.taxableIncome).toBe('15500.00');
  });
  it('a de minimis type named like an Object prototype key is still unknown', () => {
    // 'constructor' is not a configured de minimis type; it must not be looked up on Object.prototype.
    const p = run(
      base({
        allowances: [
          {
            code: 'c',
            name: 'Odd',
            amount: '500',
            kind: 'de_minimis',
            deMinimisType: 'constructor',
          },
        ],
      }),
    );
    expect(warningCodes(p)).toEqual(['unknown_de_minimis_type']);
    expect(p.taxableIncome).toBe('15500.00');
  });
  it('a taxable allowance raises taxable income without a warning', () => {
    const p = run(
      base({ allowances: [{ code: 't', name: 'Transport', amount: '1000', kind: 'taxable' }] }),
    );
    expect(warningCodes(p)).toEqual([]);
    expect(p.taxableIncome).toBe('16000.00');
  });
});

describe('computePayslip: warnings', () => {
  it('missing government IDs lists each one', () => {
    const p = run(
      base({
        employee: {
          payType: 'monthly',
          employmentType: 'regular',
          baseRate: '30000',
          dailyFactor: 261,
          govIds: { sss: false, philhealth: true, pagibig: true, tin: false },
        },
      }),
    );
    const w = p.warnings.find((x) => x.code === 'missing_gov_ids');
    expect(w?.severity).toBe('warning');
    expect(w?.message).toBe('Missing government IDs: SSS, TIN.');
  });

  it('negative net pay is an error', () => {
    // net = 15,000 − 687.50 tax − 20,000 loan = −5,687.50
    const p = run(
      base({
        otherDeductions: [
          { code: 'loan', label: 'Company loan', category: 'loan', amount: '20000' },
        ],
      }),
    );
    expect(p.netPay).toBe('-5687.50');
    const w = p.warnings.find((x) => x.code === 'negative_net');
    expect(w?.severity).toBe('error');
  });

  it('kasambahay below the threshold: info warning, EE shares 0, employer pays them', () => {
    /*
     * Monthly 4,000, paid monthly, full contributions.
     * SSS MSC 5,000: EE 250 + ER 500 → ER 750; EC 10
     * PhilHealth floor 10,000 → 500: ER 500
     * Pag-IBIG 4,000 × 2% = 80 + 80 → ER 160
     */
    const p = run(
      base({
        employee: {
          payType: 'monthly',
          employmentType: 'kasambahay',
          baseRate: '4000',
          dailyFactor: 365,
          govIds: ALL_IDS,
        },
        frequency: 'monthly',
        contributions: { share: 'full' },
      }),
    );
    const w = p.warnings.find((x) => x.code === 'kasambahay_employer_shoulders_ee');
    expect(w?.severity).toBe('info');
    expect(p.employeeDeductions).toEqual([]);
    expect(pairs(p.employerShares)).toEqual([
      ['sss_er', '750.00'],
      ['sss_ec', '10.00'],
      ['philhealth_er', '500.00'],
      ['pagibig_er', '160.00'],
    ]);
    expect(p.netPay).toBe('4000.00');
  });

  it('kasambahay at the threshold: no info warning, normal EE shares', () => {
    const p = run(
      base({
        employee: {
          payType: 'monthly',
          employmentType: 'kasambahay',
          baseRate: '5000',
          dailyFactor: 365,
          govIds: ALL_IDS,
        },
        frequency: 'monthly',
        contributions: { share: 'full' },
      }),
    );
    expect(warningCodes(p)).toEqual([]);
    // SSS 250, PhilHealth 250, Pag-IBIG 100
    expect(pairs(p.employeeDeductions)).toEqual([
      ['sss_ee', '250.00'],
      ['philhealth_ee', '250.00'],
      ['pagibig_ee', '100.00'],
    ]);
  });
});
