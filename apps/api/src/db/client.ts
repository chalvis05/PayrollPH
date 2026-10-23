import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { databaseUrl } from '../env';
import * as schema from './schema';

export function createDb(url: string = databaseUrl()) {
  const sql = postgres(url, {
    max: 10,
    connection: { TimeZone: 'Asia/Manila' },
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>['db'];
