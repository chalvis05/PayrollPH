import { StatutoryRatesSchema, type StatutoryRates } from '@payrollph/shared';
import { and, desc, eq, lte } from 'drizzle-orm';
import { minWages, statutoryRates } from '../db/schema';
import type { DbOrTx } from '../lib/audit';
import { HttpError } from '../lib/http';

export interface RatesVersion {
  id: string;
  version: string;
  effectiveFrom: string;
  verified: boolean;
  data: StatutoryRates;
}

/** The rates version in force on `date`: the latest effective_from on or before it. */
export async function ratesForDate(db: DbOrTx, date: string): Promise<RatesVersion> {
  const [row] = await db
    .select()
    .from(statutoryRates)
    .where(lte(statutoryRates.effectiveFrom, date))
    .orderBy(desc(statutoryRates.effectiveFrom))
    .limit(1);
  if (!row) {
    throw new HttpError(
      409,
      'NO_RATES',
      `No statutory rates version is effective on ${date}. Add one in Settings → Rates.`,
    );
  }
  return {
    id: row.id,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    verified: row.verified,
    // Re-validate: the engine must only ever see well-formed rates.
    data: StatutoryRatesSchema.parse(row.data),
  };
}

export async function ratesById(db: DbOrTx, id: string): Promise<RatesVersion> {
  const [row] = await db.select().from(statutoryRates).where(eq(statutoryRates.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Rates version not found.');
  return {
    id: row.id,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    verified: row.verified,
    data: StatutoryRatesSchema.parse(row.data),
  };
}

export interface MinimumWage {
  daily: string;
  kasambahayMonthly: string;
}

/** Regional minimum wage in force on `date`, or null when the region has no data. */
export async function minimumWageFor(
  db: DbOrTx,
  region: string,
  date: string,
): Promise<MinimumWage | null> {
  const [row] = await db
    .select()
    .from(minWages)
    .where(and(eq(minWages.region, region), lte(minWages.effectiveFrom, date)))
    .orderBy(desc(minWages.effectiveFrom))
    .limit(1);
  return row ? { daily: row.nonAgricultureDaily, kasambahayMonthly: row.kasambahayMonthly } : null;
}
