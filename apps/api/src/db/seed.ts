import {
  EmployeeInputSchema,
  HolidayInputSchema,
  MinimumWageInputSchema,
  RATES_V1,
  RATES_V1_EFFECTIVE_FROM,
  StatutoryRatesSchema,
} from '@payrollph/shared';
import { databaseUrl, env } from '../env';
import { createFieldCipher } from '../lib/crypto';
import { isMain } from '../lib/isMain';
import { createDb, type Db } from './client';
import { describeDbError, describeTarget } from './dbErrors';
import {
  dependents,
  employeeAllowances,
  employees,
  holidays,
  minWages,
  settings,
  statutoryRates,
} from './schema';
import { SAMPLE_EMPLOYEES } from './seed-data/employees';
import { HOLIDAYS_2026 } from './seed-data/holidays2026';
import { MIN_WAGES } from './seed-data/minWages';

export interface SeedSummary {
  settings: number;
  rates: number;
  holidays: number;
  minWages: number;
  employees: number;
}

/** Reference data needed by every install. Idempotent: existing rows are left untouched. */
export async function seedReferenceData(db: Db): Promise<Omit<SeedSummary, 'employees'>> {
  const s = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();

  const rates = await db
    .insert(statutoryRates)
    .values({
      version: 'v1',
      effectiveFrom: RATES_V1_EFFECTIVE_FROM,
      data: StatutoryRatesSchema.parse(RATES_V1),
      notes:
        'Seeded defaults. TODO VERIFY against the latest SSS, PhilHealth, Pag-IBIG, and BIR circulars before the first live run.',
      verified: false,
    })
    .onConflictDoNothing()
    .returning();

  const h = await db
    .insert(holidays)
    .values(HOLIDAYS_2026.map((x) => HolidayInputSchema.parse(x)))
    .onConflictDoNothing()
    .returning();

  const w = await db
    .insert(minWages)
    .values(MIN_WAGES.map((x) => MinimumWageInputSchema.parse(x)))
    .onConflictDoNothing()
    .returning();

  return { settings: s.length, rates: rates.length, holidays: h.length, minWages: w.length };
}

/** 22 fictional employees for development/demo. Skips any employee number that already exists. */
export async function seedSampleEmployees(db: Db): Promise<number> {
  const cipher = createFieldCipher(env.ENCRYPTION_KEY);
  let created = 0;
  for (const raw of SAMPLE_EMPLOYEES) {
    const e = EmployeeInputSchema.parse(raw);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(employees)
        .values({
          employeeNo: e.employeeNo,
          firstName: e.firstName,
          middleName: e.middleName,
          lastName: e.lastName,
          birthDate: e.birthDate,
          sex: e.sex,
          civilStatus: e.civilStatus,
          isSoloParent: e.isSoloParent,
          address: e.address,
          phone: e.phone,
          email: e.email,
          position: e.position,
          region: e.region,
          sssNoEnc: cipher.encryptNullable(e.sssNo),
          philhealthNoEnc: cipher.encryptNullable(e.philhealthNo),
          pagibigNoEnc: cipher.encryptNullable(e.pagibigNo),
          tinEnc: cipher.encryptNullable(e.tin),
          employmentType: e.employmentType,
          payType: e.payType,
          baseRate: e.baseRate,
          dailyFactor: e.dailyFactor,
          restDays: e.restDays,
          hireDate: e.hireDate,
          status: e.status,
          separationDate: e.separationDate,
          payoutMethod: e.payout.method,
          bankName: e.payout.bankName,
          accountName: e.payout.accountName,
          accountNumberEnc: cipher.encryptNullable(e.payout.accountNumber),
        })
        .onConflictDoNothing({ target: employees.employeeNo })
        .returning({ id: employees.id });
      if (!row) return;
      created += 1;
      if (e.allowances.length > 0) {
        await tx
          .insert(employeeAllowances)
          .values(e.allowances.map((a) => ({ ...a, employeeId: row.id })));
      }
      if (e.dependents.length > 0) {
        await tx.insert(dependents).values(e.dependents.map((d) => ({ ...d, employeeId: row.id })));
      }
    });
  }
  return created;
}

async function main(): Promise<void> {
  const withSamples = process.argv.includes('--sample');
  const { db, sql } = createDb();
  try {
    const ref = await seedReferenceData(db);
    const employeesCreated = withSamples ? await seedSampleEmployees(db) : 0;
    const summary: SeedSummary = { ...ref, employees: employeesCreated };
    console.log('Seed complete (new rows):', summary);
    if (!withSamples) console.log('Sample employees skipped (pass --sample to include them).');
    console.warn(
      '\n!! statutory_rates v1 is UNVERIFIED. Check every figure against the latest SSS, PhilHealth,\n' +
        '!! Pag-IBIG, and BIR circulars, then mark it verified in Settings → Rates.\n',
    );
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((err: unknown) => {
    const { summary, hint } = describeDbError(err, describeTarget(databaseUrl()));
    console.error(`Seed failed: ${summary}`);
    if (hint) console.error(`Fix: ${hint}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}
