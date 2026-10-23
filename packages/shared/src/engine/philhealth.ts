import type { StatutoryRates } from '../schemas/rates';
import { clamp, round2, type Dec, type Numeric } from '../money';

export interface PhilhealthContribution {
  base: Dec;
  premium: Dec;
  ee: Dec;
  er: Dec;
}

/** Monthly PhilHealth premium on the basic salary, clamped to floor/ceiling, split EE/ER. */
export function computePhilhealth(
  monthlyBasicSalary: Numeric,
  rates: StatutoryRates,
): PhilhealthContribution {
  const p = rates.philhealth;
  const base = clamp(monthlyBasicSalary, p.floor, p.ceiling);
  const premium = round2(base.times(p.rate));
  const ee = round2(premium.times(p.eeShare));
  return { base, premium, ee, er: premium.minus(ee) };
}
