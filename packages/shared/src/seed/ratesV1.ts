import type { StatutoryRates } from '../schemas/rates';

/*
 * ============================================================================
 *  TODO VERIFY BEFORE THE FIRST LIVE PAYROLL RUN
 *  These are the statutory figures as last known when this file was written.
 *  Check every number against the latest circulars:
 *    - SSS contribution schedule (RA 11199; Circular 2024-006 for 2025)
 *    - PhilHealth premium circular (UHC Act; 5% from 2024/2025)
 *    - Pag-IBIG HDMF Circular 460 (max fund salary 10,000 from Feb 2024)
 *    - BIR TRAIN table for 2023 onwards (RA 10963), RR 11-2018, RR 4-2025 (de minimis)
 *    - DOLE handbook on holiday/premium pay; RA 10361 (Kasambahay)
 *  Seeded as statutory_rates version "v1"; the settings page shows a banner until
 *  the owner marks it verified. NEVER copy these numbers into engine/API logic.
 * ============================================================================
 */
export const RATES_V1_EFFECTIVE_FROM = '2025-01-01';

export const RATES_V1: StatutoryRates = {
  sss: {
    eeRate: '0.05', // TODO VERIFY
    erRate: '0.10', // TODO VERIFY
    mscMin: '5000', // TODO VERIFY
    mscMax: '35000', // TODO VERIFY
    mscStep: '500', // TODO VERIFY
    regularMscCap: '20000', // TODO VERIFY: MSC above this is the MPF (WISP) tier
    ecThreshold: '15000', // TODO VERIFY
    ecLow: '10', // TODO VERIFY
    ecHigh: '30', // TODO VERIFY
  },
  philhealth: {
    rate: '0.05', // TODO VERIFY
    floor: '10000', // TODO VERIFY
    ceiling: '100000', // TODO VERIFY
    eeShare: '0.5',
  },
  pagibig: {
    eeRateLow: '0.01', // TODO VERIFY
    eeRateHigh: '0.02', // TODO VERIFY
    lowThreshold: '1500', // TODO VERIFY
    erRate: '0.02', // TODO VERIFY
    maxBase: '10000', // TODO VERIFY
  },
  bir: {
    // TODO VERIFY: TRAIN annual table effective 2023-01-01
    annualBrackets: [
      { over: '0', base: '0', rate: '0' },
      { over: '250000', base: '0', rate: '0.15' },
      { over: '400000', base: '22500', rate: '0.20' },
      { over: '800000', base: '102500', rate: '0.25' },
      { over: '2000000', base: '402500', rate: '0.30' },
      { over: '8000000', base: '2202500', rate: '0.35' },
    ],
    // twice_weekly: paid every Wednesday and Saturday.
    periodsPerYear: { monthly: 12, semi_monthly: 24, weekly: 52, twice_weekly: 104, daily: 313 },
  },
  benefits: {
    otherBenefitsCeiling: '90000', // TODO VERIFY
    // TODO VERIFY: RR 4-2025 de minimis limits, expressed per year
    deMinimis: {
      rice: { label: 'Rice subsidy', annualLimit: '30000' },
      uniform: { label: 'Uniform and clothing allowance', annualLimit: '8000' },
      medical_dependents: {
        label: 'Medical cash allowance to dependents',
        annualLimit: '3750',
      },
      laundry: { label: 'Laundry allowance', annualLimit: '4800' },
      medical_assistance: { label: 'Actual medical assistance', annualLimit: '12000' },
      achievement_award: { label: 'Employee achievement award', annualLimit: '12000' },
      christmas_gift: { label: 'Christmas / anniversary gift', annualLimit: '6000' },
      cba_productivity: { label: 'CBA / productivity incentive', annualLimit: '12000' },
    },
  },
  thirteenthMonth: {
    divisor: '12',
    deadline: '12-24', // TODO VERIFY (PD 851: on or before December 24)
  },
  premiums: {
    otOrdinary: '1.25', // TODO VERIFY
    otPremiumDay: '1.30', // TODO VERIFY
    restDay: '1.30', // TODO VERIFY
    special: '1.30', // TODO VERIFY
    specialRestDay: '1.50', // TODO VERIFY
    regular: '2.00', // TODO VERIFY
    regularRestDay: '2.60', // TODO VERIFY
    double: '3.00', // TODO VERIFY
    doubleRestDay: '3.90', // TODO VERIFY
    nightDiff: '0.10', // TODO VERIFY
  },
  nightDiffWindow: { start: '22:00', end: '06:00' },
  workHoursPerDay: '8',
  kasambahay: {
    employerPaysEeShareBelow: '5000', // TODO VERIFY (RA 10361 sec. 30; check later wage orders)
  },
  leaves: {
    silDays: 5,
    silMinServiceMonths: 12,
    maternityDays: 105, // TODO VERIFY (RA 11210)
    paternityDays: 7, // TODO VERIFY (RA 8187)
    soloParentDays: 7, // TODO VERIFY (RA 11861)
    soloParentMinServiceMonths: 6, // TODO VERIFY (RA 11861)
  },
};
