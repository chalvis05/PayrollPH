import type { StatutoryRates } from '../schemas/rates';
import { dec, min, round2, type Dec, type Numeric } from '../money';

export interface PagibigContribution {
  base: Dec;
  ee: Dec;
  er: Dec;
}

/**
 * Monthly Pag-IBIG contribution. The EE rate drops to the low tier when compensation is at or
 * below the threshold; both shares are computed on compensation capped at `maxBase`.
 */
export function computePagibig(
  monthlyCompensation: Numeric,
  rates: StatutoryRates,
): PagibigContribution {
  const p = rates.pagibig;
  const comp = dec(monthlyCompensation);
  const base = min(comp, p.maxBase);
  const eeRate = comp.lte(p.lowThreshold) ? p.eeRateLow : p.eeRateHigh;
  return { base, ee: round2(base.times(eeRate)), er: round2(base.times(p.erRate)) };
}
