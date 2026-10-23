import type { MinimumWageInput } from '@payrollph/shared';

/*
 * Regional minimum wages. TODO VERIFY every row against the NWPC/RTWPB wage orders.
 * Only NCR is seeded: figures for other regions were not reliably confirmed when this
 * file was written. Add your region's current non-agriculture daily rate and kasambahay
 * monthly rate before the first live run, or the below-minimum warning cannot fire.
 *
 * NCR history (each row is what was in force from that date):
 *   - Wage Order NCR-26: ₱695/day non-agriculture, from 2025-07-18
 *   - Wage Order NCR-DW-05: ₱7,000/month kasambahay
 *   - Wage Order NCR-DW-06: ₱7,800/month kasambahay, from 2026-02-07
 *   - ₱755/day from 2026-07-25 (reported as NCR-27; some reports say NCR-28 after a court
 *     challenge to NCR-27). TODO VERIFY which order is in force and whether a second
 *     tranche applies from 2027.
 */
export const MIN_WAGES: MinimumWageInput[] = [
  {
    region: 'NCR',
    effectiveFrom: '2025-07-18',
    nonAgricultureDaily: '695.00',
    kasambahayMonthly: '7000.00',
    wageOrder: 'NCR-26 / NCR-DW-05',
  },
  {
    region: 'NCR',
    effectiveFrom: '2026-02-07',
    nonAgricultureDaily: '695.00',
    kasambahayMonthly: '7800.00',
    wageOrder: 'NCR-26 / NCR-DW-06',
  },
  {
    region: 'NCR',
    effectiveFrom: '2026-07-25',
    nonAgricultureDaily: '755.00',
    kasambahayMonthly: '7800.00',
    wageOrder: 'NCR-27 (verify) / NCR-DW-06',
  },
];
