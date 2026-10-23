import type { StatutoryRates } from '../schemas/rates';
import { dec, max, min, round2, ZERO, type Dec, type Numeric } from '../money';

/** 13th month accrual for basic salary earned in a period: basic ÷ divisor (12). */
export function thirteenthAccrual(basicEarned: Numeric, rates: StatutoryRates): Dec {
  return round2(dec(basicEarned).div(rates.thirteenthMonth.divisor));
}

export type ThirteenthPayoutMode = 'half' | 'full';

/**
 * Amount to pay out now. `half` (mid-year option) pays half of what has accrued so far, less
 * anything already paid; `full` pays the whole accrual less anything already paid. Never negative.
 */
export function thirteenthPayout(input: {
  accruedYtd: Numeric;
  paidYtd: Numeric;
  mode: ThirteenthPayoutMode;
}): Dec {
  const accrued = dec(input.accruedYtd);
  const target = input.mode === 'half' ? round2(accrued.div(2)) : accrued;
  return max(target.minus(input.paidYtd), ZERO);
}

export interface BenefitTaxability {
  exempt: Dec;
  taxable: Dec;
}

/**
 * Split a 13th-month / other-benefits amount into exempt and taxable parts against the annual
 * ceiling, given how much of the ceiling has already been used this year.
 */
export function splitOtherBenefits(input: {
  amount: Numeric;
  exemptUsedYtd: Numeric;
  rates: StatutoryRates;
}): BenefitTaxability {
  const amount = dec(input.amount);
  const remaining = max(
    dec(input.rates.benefits.otherBenefitsCeiling).minus(input.exemptUsedYtd),
    ZERO,
  );
  const exempt = min(amount, remaining);
  return { exempt, taxable: amount.minus(exempt) };
}
