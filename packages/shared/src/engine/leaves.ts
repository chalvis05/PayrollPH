import type { StatutoryRates } from '../schemas/rates';
import { dec, round2, type Dec, type Numeric } from '../money';

function parseDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`Bad date ${iso}`);
  return { y, m, d };
}

/** Completed months of service from `hireDate` to `asOf` (both YYYY-MM-DD). */
export function monthsOfService(hireDate: string, asOf: string): number {
  const a = parseDate(hireDate);
  const b = parseDate(asOf);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(months, 0);
}

export interface LeaveEntitlements {
  silDays: number;
  maternityDays: number;
  paternityDays: number;
  soloParentDays: number;
}

/** Statutory leave days available as of a date. Eligibility beyond service length is the caller's. */
export function leaveEntitlements(input: {
  hireDate: string;
  asOf: string;
  isSoloParent: boolean;
  rates: StatutoryRates;
}): LeaveEntitlements {
  const l = input.rates.leaves;
  const months = monthsOfService(input.hireDate, input.asOf);
  return {
    silDays: months >= l.silMinServiceMonths ? l.silDays : 0,
    maternityDays: l.maternityDays,
    paternityDays: l.paternityDays,
    soloParentDays:
      input.isSoloParent && months >= l.soloParentMinServiceMonths ? l.soloParentDays : 0,
  };
}

/** Cash conversion of unused SIL: unused days × daily rate. */
export function silCashConversion(unusedDays: Numeric, dailyRate: Numeric): Dec {
  return round2(dec(unusedDays).times(dailyRate));
}
