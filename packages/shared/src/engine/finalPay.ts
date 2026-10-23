import type { PayLine } from '../schemas/payslip';
import type { StatutoryRates } from '../schemas/rates';
import { dec, sum, toMoney, type Numeric } from '../money';
import { silCashConversion } from './leaves';
import { splitOtherBenefits, thirteenthAccrual } from './thirteenth';

export interface FinalPayInput {
  /** Net pay of the last (partial) period, computed with computePayslip. */
  lastSalaryNet: Numeric;
  /** Basic salary earned this year, including the last period. */
  basicEarnedYtd: Numeric;
  thirteenthPaidYtd: Numeric;
  unusedSilDays: Numeric;
  dailyRate: Numeric;
  otherBenefitsExemptUsedYtd: Numeric;
  outstandingLoans: readonly { code: string; label: string; balance: Numeric }[];
  /** From year-end annualization at separation: positive = still to withhold, negative = refund. */
  taxAdjustment: Numeric;
  rates: StatutoryRates;
}

export interface FinalPayResult {
  earnings: PayLine[];
  deductions: PayLine[];
  thirteenthMonth: { amount: string; exempt: string; taxable: string };
  lastSalaryNet: string;
  totalEarnings: string;
  totalDeductions: string;
  netFinalPay: string;
}

/** Separation pay-out: last salary, prorated 13th month, unused SIL, less loans and tax adjustment. */
export function computeFinalPay(input: FinalPayInput): FinalPayResult {
  const accrued = thirteenthAccrual(input.basicEarnedYtd, input.rates);
  const thirteenth = accrued.minus(input.thirteenthPaidYtd);
  const thirteenthDue = thirteenth.gt(0) ? thirteenth : dec(0);
  const split = splitOtherBenefits({
    amount: thirteenthDue,
    exemptUsedYtd: input.otherBenefitsExemptUsedYtd,
    rates: input.rates,
  });
  const sil = silCashConversion(input.unusedSilDays, input.dailyRate);

  const earnings: PayLine[] = [];
  if (thirteenthDue.gt(0)) {
    earnings.push({
      code: 'thirteenth_prorated',
      label: 'Prorated 13th month pay',
      category: 'thirteenth_month',
      amount: toMoney(thirteenthDue),
      taxClass: 'other_benefit',
    });
  }
  if (sil.gt(0)) {
    earnings.push({
      code: 'sil_conversion',
      label: 'Unused service incentive leave (cash)',
      category: 'leave_conversion',
      amount: toMoney(sil),
      taxClass: 'taxable',
      quantity: dec(input.unusedSilDays).toString(),
    });
  }

  const deductions: PayLine[] = input.outstandingLoans
    .filter((l) => dec(l.balance).gt(0))
    .map((l) => ({ code: l.code, label: l.label, category: 'loan', amount: toMoney(l.balance) }));
  const tax = dec(input.taxAdjustment);
  if (!tax.isZero()) {
    deductions.push({
      code: 'tax_annualization',
      label: tax.gt(0) ? 'Withholding tax (annualization)' : 'Tax refund (annualization)',
      category: 'withholding_tax',
      amount: toMoney(tax),
    });
  }

  const totalEarnings = sum(earnings.map((l) => l.amount));
  const totalDeductions = sum(deductions.map((l) => l.amount));
  const net = dec(input.lastSalaryNet).plus(totalEarnings).minus(totalDeductions);
  return {
    earnings,
    deductions,
    thirteenthMonth: {
      amount: toMoney(thirteenthDue),
      exempt: toMoney(split.exempt),
      taxable: toMoney(split.taxable),
    },
    lastSalaryNet: toMoney(input.lastSalaryNet),
    totalEarnings: toMoney(totalEarnings),
    totalDeductions: toMoney(totalDeductions),
    netFinalPay: toMoney(net),
  };
}
