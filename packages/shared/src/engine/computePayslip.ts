import type { DailyFactor, EmploymentType, PayFrequency, PayType } from '../schemas/common';
import type { PayLine, PayrollWarning, PayslipComputation } from '../schemas/payslip';
import type { StatutoryRates } from '../schemas/rates';
import { dec, max, min, sum, toMoney, ZERO, type Dec, type Numeric } from '../money';
import {
  computeMonthlyContributions,
  periodShare,
  toBreakdown,
  type ContributionShare,
} from './contributions';
import { rateBasis } from './dailyRate';
import { computeBasicPay, type AttendanceSummary } from './earnings';
import { computePremiums, unworkedHolidayPay } from './premiums';
import { splitOtherBenefits, thirteenthAccrual } from './thirteenth';
import { periodsPerYear, periodWithholding } from './withholding';

export interface AllowanceInput {
  code: string;
  name: string;
  amount: Numeric;
  kind: 'taxable' | 'de_minimis';
  /** Key into `rates.benefits.deMinimis` when kind is de_minimis. */
  deMinimisType?: string;
}

export interface OtherDeductionInput {
  code: string;
  label: string;
  category: 'loan' | 'deduction';
  amount: Numeric;
}

/** Contribution amounts actually deducted in a period (per agency, EE/ER/EC). */
export interface ContributionAmounts {
  sssEe: Numeric;
  sssEr: Numeric;
  sssEc: Numeric;
  philhealthEe: Numeric;
  philhealthEr: Numeric;
  pagibigEe: Numeric;
  pagibigEr: Numeric;
}

export interface PayslipInput {
  employee: {
    payType: PayType;
    employmentType: EmploymentType;
    baseRate: Numeric;
    dailyFactor: DailyFactor;
    /** Which government IDs are on file. */
    govIds: { sss: boolean; philhealth: boolean; pagibig: boolean; tin: boolean };
  };
  frequency: PayFrequency;
  attendance: AttendanceSummary;
  allowances: readonly AllowanceInput[];
  contributions: {
    share: ContributionShare;
    /** Defaults to the monthly equivalent of the base rate. */
    sssMonthlyCompensation?: Numeric;
    /** Defaults to the monthly equivalent of the base rate. */
    monthlyBasicSalary?: Numeric;
    /**
     * With share 'second_half': what the first cutoff already deducted for this month. The
     * second cutoff then takes the monthly total minus these amounts (never below zero), so the
     * two halves always add up to the month's actual contribution even when pay varied.
     */
    alreadyDeducted?: ContributionAmounts;
  };
  otherDeductions: readonly OtherDeductionInput[];
  ytd: {
    /** Exempt 13th-month/other-benefits amount already used this year. */
    otherBenefitsExemptUsed: Numeric;
  };
  /** Applicable regional minimum wage, if known. */
  minimumWage?: { daily?: Numeric; kasambahayMonthly?: Numeric };
  rates: StatutoryRates;
}

const isEarningTaxable = (line: PayLine, mwe: boolean): boolean =>
  line.taxClass === 'taxable' || (line.taxClass === 'mwe_exempt_eligible' && !mwe);

/** Compute one employee's payslip for one period. Pure: all inputs explicit, no I/O. */
export function computePayslip(input: PayslipInput): PayslipComputation {
  const { employee, rates, frequency } = input;
  const basis = rateBasis(employee.payType, employee.baseRate, employee.dailyFactor, rates);
  const warnings: PayrollWarning[] = [];

  // Minimum wage status.
  let isMinimumWageEarner = false;
  const mw = input.minimumWage;
  if (mw) {
    const isKasambahay = employee.employmentType === 'kasambahay';
    const floor = isKasambahay ? mw.kasambahayMonthly : mw.daily;
    const actual = isKasambahay ? basis.monthly : basis.daily;
    if (floor !== undefined) {
      isMinimumWageEarner = actual.lte(floor);
      if (actual.lt(floor)) {
        warnings.push({
          code: 'below_minimum_wage',
          severity: 'warning',
          message: isKasambahay
            ? `Monthly wage ${toMoney(actual)} is below the kasambahay minimum ${toMoney(floor)}.`
            : `Daily rate ${toMoney(actual)} is below the regional minimum ${toMoney(floor)}.`,
        });
      }
    }
  }

  // Earnings.
  const basic = computeBasicPay({
    payType: employee.payType,
    basis,
    frequency,
    attendance: input.attendance,
    rates,
  });
  const earnings: PayLine[] = [...basic.lines];
  earnings.push(
    ...unworkedHolidayPay({
      payType: employee.payType,
      daily: basis.daily,
      regularDays: input.attendance.unworkedRegularHolidays,
      doubleDays: input.attendance.unworkedDoubleHolidays,
      rates,
    }),
  );
  earnings.push(
    ...computePremiums({
      payType: employee.payType,
      factor: employee.dailyFactor,
      hourly: basis.hourly,
      days: input.attendance.days,
      rates,
    }),
  );

  // Allowances: de minimis within the per-period limit is exempt; the excess counts as an
  // "other benefit" against the annual ceiling.
  const n = periodsPerYear(frequency, rates);
  let otherBenefits: Dec = ZERO;
  for (const a of input.allowances) {
    const amount = dec(a.amount);
    if (amount.isZero()) continue;
    const limitDef =
      a.kind === 'de_minimis' &&
      a.deMinimisType !== undefined &&
      Object.hasOwn(rates.benefits.deMinimis, a.deMinimisType)
        ? rates.benefits.deMinimis[a.deMinimisType]
        : undefined;
    if (a.kind === 'de_minimis' && !limitDef) {
      warnings.push({
        code: 'unknown_de_minimis_type',
        severity: 'warning',
        message: `Allowance "${a.name}" has no known de minimis type; treated as taxable.`,
      });
    }
    if (!limitDef) {
      earnings.push({
        code: a.code,
        label: a.name,
        category: 'allowance',
        amount: toMoney(amount),
        taxClass: 'taxable',
      });
      continue;
    }
    const limit = dec(limitDef.annualLimit).div(n);
    const exempt = min(amount, limit);
    const excess = amount.minus(exempt);
    earnings.push({
      code: a.code,
      label: a.name,
      category: 'allowance',
      amount: toMoney(exempt),
      taxClass: 'de_minimis',
    });
    if (excess.gt(0)) {
      otherBenefits = otherBenefits.plus(excess);
      earnings.push({
        code: `${a.code}_excess`,
        label: `${a.name} (over de minimis limit)`,
        category: 'allowance',
        amount: toMoney(excess),
        taxClass: 'other_benefit',
      });
    }
  }

  const grossPay = sum(earnings.map((l) => l.amount));

  // Contributions.
  const monthlyBasic = input.contributions.monthlyBasicSalary ?? basis.monthly;
  const monthly = computeMonthlyContributions({
    employmentType: employee.employmentType,
    sssMonthlyCompensation: input.contributions.sssMonthlyCompensation ?? basis.monthly,
    monthlyBasicSalary: monthlyBasic,
    rates,
  });
  if (monthly.employerShoulderedEe) {
    warnings.push({
      code: 'kasambahay_employer_shoulders_ee',
      severity: 'info',
      message:
        'Kasambahay below the wage threshold: employer pays the employee share of SSS, PhilHealth, and Pag-IBIG.',
    });
  }
  const share = input.contributions.share;
  const already = share === 'second_half' ? input.contributions.alreadyDeducted : undefined;
  const portion = (monthlyAmount: Numeric, key: keyof ContributionAmounts): Dec =>
    already ? max(dec(monthlyAmount).minus(already[key]), ZERO) : periodShare(monthlyAmount, share);
  const sssEe = portion(monthly.sss.ee, 'sssEe');
  const phEe = portion(monthly.philhealth.ee, 'philhealthEe');
  const piEe = portion(monthly.pagibig.ee, 'pagibigEe');
  const statutoryEe = sssEe.plus(phEe).plus(piEe);

  // Withholding tax.
  const benefitSplit = splitOtherBenefits({
    amount: otherBenefits,
    exemptUsedYtd: input.ytd.otherBenefitsExemptUsed,
    rates,
  });
  const taxableEarnings = sum(
    earnings.filter((l) => isEarningTaxable(l, isMinimumWageEarner)).map((l) => l.amount),
  ).plus(benefitSplit.taxable);
  const taxableIncome = max(
    isMinimumWageEarner ? taxableEarnings : taxableEarnings.minus(statutoryEe),
    ZERO,
  );
  const withholdingTax = periodWithholding(taxableIncome, frequency, rates);

  // Deductions.
  const employeeDeductions: PayLine[] = [];
  const ded = (
    code: string,
    label: string,
    category: PayLine['category'],
    amount: Numeric,
  ): void => {
    if (!dec(amount).isZero()) {
      employeeDeductions.push({ code, label, category, amount: toMoney(amount) });
    }
  };
  ded('sss_ee', 'SSS (employee share)', 'statutory_ee', sssEe);
  ded('philhealth_ee', 'PhilHealth (employee share)', 'statutory_ee', phEe);
  ded('pagibig_ee', 'Pag-IBIG (employee share)', 'statutory_ee', piEe);
  ded('withholding_tax', 'Withholding tax', 'withholding_tax', withholdingTax);
  for (const d of input.otherDeductions) ded(d.code, d.label, d.category, d.amount);

  const employerShares: PayLine[] = [];
  const er = (code: string, label: string, amount: Numeric): void => {
    if (!dec(amount).isZero()) {
      employerShares.push({ code, label, category: 'statutory_er', amount: toMoney(amount) });
    }
  };
  er('sss_er', 'SSS (employer share)', portion(monthly.sss.er, 'sssEr'));
  er('sss_ec', 'SSS EC (employer)', portion(monthly.sss.ec, 'sssEc'));
  er(
    'philhealth_er',
    'PhilHealth (employer share)',
    portion(monthly.philhealth.er, 'philhealthEr'),
  );
  er('pagibig_er', 'Pag-IBIG (employer share)', portion(monthly.pagibig.er, 'pagibigEr'));

  const totalDeductions = sum(employeeDeductions.map((l) => l.amount));
  const netPay = grossPay.minus(totalDeductions);

  const missing = (['sss', 'philhealth', 'pagibig', 'tin'] as const).filter(
    (k) => !employee.govIds[k],
  );
  if (missing.length > 0) {
    warnings.push({
      code: 'missing_gov_ids',
      severity: 'warning',
      message: `Missing government IDs: ${missing.map((k) => k.toUpperCase()).join(', ')}.`,
    });
  }
  if (netPay.lt(0)) {
    warnings.push({
      code: 'negative_net',
      severity: 'error',
      message: `Net pay is negative (${toMoney(netPay)}).`,
    });
  }

  return {
    rateBasis: {
      monthly: toMoney(basis.monthly),
      daily: toMoney(basis.daily),
      hourly: toMoney(basis.hourly),
    },
    isMinimumWageEarner,
    earnings,
    grossPay: toMoney(grossPay),
    monthlyContributions: toBreakdown(monthly),
    employeeDeductions,
    employerShares,
    taxableIncome: toMoney(taxableIncome),
    withholdingTax: toMoney(withholdingTax),
    basicEarned: toMoney(basic.basicEarned),
    thirteenthMonthAccrual: toMoney(thirteenthAccrual(basic.basicEarned, rates)),
    otherBenefitsExemptUsed: toMoney(benefitSplit.exempt),
    totalDeductions: toMoney(totalDeductions),
    netPay: toMoney(netPay),
    warnings,
  };
}
