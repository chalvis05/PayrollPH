import type { EmploymentType } from '../schemas/common';
import type { ContributionBreakdown } from '../schemas/payslip';
import type { StatutoryRates } from '../schemas/rates';
import { D, dec, toMoney, ZERO, type Dec, type Numeric } from '../money';
import { computePagibig } from './pagibig';
import { computePhilhealth } from './philhealth';
import { computeSss } from './sss';

/** Which part of the monthly contribution this payroll period deducts. */
export type ContributionShare = 'full' | 'first_half' | 'second_half' | 'none';

export interface MonthlyContributions {
  sss: ReturnType<typeof computeSss>;
  philhealth: ReturnType<typeof computePhilhealth>;
  pagibig: ReturnType<typeof computePagibig>;
  employerShoulderedEe: boolean;
}

/** True when RA 10361 makes the employer shoulder the EE share. */
export function kasambahayEmployerPaysEe(
  employmentType: EmploymentType,
  monthlyWage: Numeric,
  rates: StatutoryRates,
): boolean {
  return (
    employmentType === 'kasambahay' &&
    dec(monthlyWage).lt(rates.kasambahay.employerPaysEeShareBelow)
  );
}

/**
 * Monthly SSS, PhilHealth, and Pag-IBIG. For a kasambahay below the threshold, every EE share
 * moves to the employer (EE becomes zero; ER includes the former EE amount).
 */
export function computeMonthlyContributions(input: {
  employmentType: EmploymentType;
  sssMonthlyCompensation: Numeric;
  monthlyBasicSalary: Numeric;
  rates: StatutoryRates;
}): MonthlyContributions {
  const { rates } = input;
  const sss = computeSss(input.sssMonthlyCompensation, rates);
  const philhealth = computePhilhealth(input.monthlyBasicSalary, rates);
  const pagibig = computePagibig(input.monthlyBasicSalary, rates);
  const shoulder = kasambahayEmployerPaysEe(input.employmentType, input.monthlyBasicSalary, rates);
  if (!shoulder) return { sss, philhealth, pagibig, employerShoulderedEe: false };
  return {
    sss: {
      ...sss,
      er: sss.er.plus(sss.ee),
      erMpf: sss.erMpf.plus(sss.eeMpf),
      ee: ZERO,
      eeMpf: ZERO,
    },
    philhealth: { ...philhealth, er: philhealth.er.plus(philhealth.ee), ee: ZERO },
    pagibig: { ...pagibig, er: pagibig.er.plus(pagibig.ee), ee: ZERO },
    employerShoulderedEe: true,
  };
}

/**
 * Portion of a monthly amount deducted this period. Halves split so the two cutoffs always add
 * back to the monthly total (the second half takes any odd centavo).
 */
export function periodShare(monthly: Numeric, share: ContributionShare): Dec {
  const total = dec(monthly);
  const firstHalf = total.div(2).toDecimalPlaces(2, D.ROUND_DOWN);
  switch (share) {
    case 'full':
      return total;
    case 'first_half':
      return firstHalf;
    case 'second_half':
      return total.minus(firstHalf);
    case 'none':
      return ZERO;
  }
}

export function toBreakdown(c: MonthlyContributions): ContributionBreakdown {
  return {
    sss: {
      msc: toMoney(c.sss.msc),
      mscRegular: toMoney(c.sss.mscRegular),
      mscMpf: toMoney(c.sss.mscMpf),
      ee: toMoney(c.sss.ee),
      eeMpf: toMoney(c.sss.eeMpf),
      er: toMoney(c.sss.er),
      erMpf: toMoney(c.sss.erMpf),
      ec: toMoney(c.sss.ec),
    },
    philhealth: {
      base: toMoney(c.philhealth.base),
      premium: toMoney(c.philhealth.premium),
      ee: toMoney(c.philhealth.ee),
      er: toMoney(c.philhealth.er),
    },
    pagibig: {
      base: toMoney(c.pagibig.base),
      ee: toMoney(c.pagibig.ee),
      er: toMoney(c.pagibig.er),
    },
    employerShoulderedEe: c.employerShoulderedEe,
  };
}
