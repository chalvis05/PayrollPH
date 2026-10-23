import type { StatutoryRates } from '../schemas/rates';
import { D, dec, round2, type Dec, type Numeric } from '../money';

export interface SssContribution {
  msc: Dec;
  mscRegular: Dec;
  mscMpf: Dec;
  /** Total EE share, including the MPF portion. */
  ee: Dec;
  eeMpf: Dec;
  /** Total ER share (excluding EC), including the MPF portion. */
  er: Dec;
  erMpf: Dec;
  ec: Dec;
}

/**
 * Monthly Salary Credit for a monthly compensation. Brackets are centred on each step:
 * compensation below `mscMin + step/2` maps to `mscMin`; otherwise to the nearest step,
 * with the half-step boundary rounding up; capped at `mscMax`.
 */
export function sssMsc(monthlyCompensation: Numeric, rates: StatutoryRates): Dec {
  const { mscMin, mscMax, mscStep } = rates.sss;
  const comp = dec(monthlyCompensation);
  const step = dec(mscStep);
  if (comp.lt(dec(mscMin).plus(step.div(2)))) return dec(mscMin);
  const steps = comp.minus(mscMin).plus(step.div(2)).div(step).toDecimalPlaces(0, D.ROUND_FLOOR);
  return D.min(dec(mscMin).plus(steps.times(step)), mscMax);
}

/** Monthly SSS contribution (regular SS + MPF/WISP tier + EC). */
export function computeSss(monthlyCompensation: Numeric, rates: StatutoryRates): SssContribution {
  const s = rates.sss;
  const msc = sssMsc(monthlyCompensation, rates);
  const mscRegular = D.min(msc, s.regularMscCap);
  const mscMpf = D.max(msc.minus(s.regularMscCap), 0);
  const eeRegular = round2(mscRegular.times(s.eeRate));
  const eeMpf = round2(mscMpf.times(s.eeRate));
  const erRegular = round2(mscRegular.times(s.erRate));
  const erMpf = round2(mscMpf.times(s.erRate));
  const ec = msc.lt(s.ecThreshold) ? dec(s.ecLow) : dec(s.ecHigh);
  return {
    msc,
    mscRegular,
    mscMpf,
    ee: eeRegular.plus(eeMpf),
    eeMpf,
    er: erRegular.plus(erMpf),
    erMpf,
    ec,
  };
}
