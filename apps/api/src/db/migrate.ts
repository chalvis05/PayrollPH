import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { isMain } from '../lib/isMain';
import { createDb } from './client';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');

export async function runMigrations(url?: string): Promise<void> {
  const { db, sql } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  runMigrations()
    .then(() => console.log('Migrations applied.'))
    .catch((err: unknown) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
