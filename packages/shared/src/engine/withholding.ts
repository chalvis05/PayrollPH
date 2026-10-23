import type { PayFrequency } from '../schemas/common';
import type { StatutoryRates, TaxBracket } from '../schemas/rates';
import { dec, round2, ZERO, type Dec, type Numeric } from '../money';

export function periodsPerYear(frequency: PayFrequency, rates: StatutoryRates): number {
  const n = rates.bir.periodsPerYear[frequency];
  if (n === undefined) throw new Error(`No periods-per-year configured for ${frequency}`);
  return n;
}

/** The annual table divided by periods per year (bounds and fixed amounts; rates unchanged). */
export function periodBrackets(frequency: PayFrequency, rates: StatutoryRates): TaxBracket[] {
  const n = periodsPerYear(frequency, rates);
  return rates.bir.annualBrackets.map((b) => ({
    over: dec(b.over).div(n).toString(),
    base: dec(b.base).div(n).toString(),
    rate: b.rate,
  }));
}

/** Graduated tax on an amount: base + rate × (income − over) for the highest bracket exceeded. */
export function taxOnIncome(income: Numeric, brackets: readonly TaxBracket[]): Dec {
  const amount = dec(income);
  let applicable: TaxBracket | undefined;
  for (const b of brackets) {
    if (amount.gt(b.over)) applicable = b;
  }
  if (!applicable) return ZERO;
  return round2(dec(applicable.base).plus(amount.minus(applicable.over).times(applicable.rate)));
}

export function annualTax(taxableIncome: Numeric, rates: StatutoryRates): Dec {
  return taxOnIncome(taxableIncome, rates.bir.annualBrackets);
}

export function periodWithholding(
  taxableIncome: Numeric,
  frequency: PayFrequency,
  rates: StatutoryRates,
): Dec {
  return taxOnIncome(taxableIncome, periodBrackets(frequency, rates));
}

export interface Annualization {
  taxDue: Dec;
  taxWithheld: Dec;
  /** Positive: still to withhold; negative: refund owed to the employee. */
  balance: Dec;
}

/** Year-end annualization: annual tax due on total taxable compensation vs. tax withheld. */
export function annualize(input: {
  annualTaxableCompensation: Numeric;
  taxWithheldYtd: Numeric;
  rates: StatutoryRates;
}): Annualization {
  const taxDue = annualTax(input.annualTaxableCompensation, input.rates);
  const taxWithheld = dec(input.taxWithheldYtd);
  return { taxDue, taxWithheld, balance: taxDue.minus(taxWithheld) };
}
