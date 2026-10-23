import { dec, min, ZERO, type Dec, type Numeric } from '../money';

export interface AmortizationRow {
  installment: number;
  amount: Dec;
  balanceAfter: Dec;
}

/** Equal installments of `amortization` until the principal is repaid; the last one takes the remainder. */
export function amortizationSchedule(principal: Numeric, amortization: Numeric): AmortizationRow[] {
  const per = dec(amortization);
  if (per.lte(0)) throw new Error('Amortization must be positive');
  const rows: AmortizationRow[] = [];
  let balance = dec(principal);
  let i = 1;
  while (balance.gt(0)) {
    const amount = min(per, balance);
    balance = balance.minus(amount);
    rows.push({ installment: i, amount, balanceAfter: balance });
    i += 1;
  }
  return rows;
}

/** Deduction for this period: the amortization, capped at the outstanding balance. */
export function loanDeduction(balance: Numeric, amortization: Numeric): Dec {
  const b = dec(balance);
  if (b.lte(0)) return ZERO;
  return min(amortization, b);
}
