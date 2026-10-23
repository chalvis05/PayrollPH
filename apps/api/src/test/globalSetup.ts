import postgres from 'postgres';
import { databaseUrl } from '../env';
import { runMigrations } from '../db/migrate';
import { testDbName } from './testDb';

/** Recreate the test database from scratch and migrate it, once per `vitest run`. */
export default async function setup(): Promise<void> {
  const name = testDbName();
  const admin = postgres(databaseUrl('postgres'), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(databaseUrl(name));
}
