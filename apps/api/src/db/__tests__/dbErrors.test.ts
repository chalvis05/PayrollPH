import { describe, expect, it } from 'vitest';
import { describeDbError, describeTarget } from '../dbErrors';

/** Shape of a Drizzle query error wrapping a postgres-js error. */
const drizzleError = (cause: object) =>
  Object.assign(new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"'), { cause });

describe('describeDbError', () => {
  it('surfaces the Postgres cause instead of the wrapper message', () => {
    const d = describeDbError(
      drizzleError({ code: '42501', message: 'permission denied for database payrollph' }),
      'payrollph@db:5432/payrollph',
    );
    expect(d.summary).toBe(
      'permission denied for database payrollph [42501] (connecting to payrollph@db:5432/payrollph)',
    );
    expect(d.hint).toMatch(/ALTER DATABASE <db> OWNER TO <user>/);
  });

  it('gives the exact pg_hba.conf rule for a Docker client address', () => {
    const d = describeDbError(
      drizzleError({
        code: '28000',
        message:
          'no pg_hba.conf entry for host "172.20.0.2", user "payrollph", database "payrollph", no encryption',
      }),
      'payrollph@host.docker.internal:5432/payrollph',
    );
    expect(d.hint).toMatch(/host {2}payrollph {2}payrollph {2}172\.16\.0\.0\/12 {2}md5/);
  });

  it('uses a single-address rule for clients outside the Docker range', () => {
    const d = describeDbError(
      drizzleError({
        code: '28000',
        message: 'no pg_hba.conf entry for host "10.0.0.5", user "app", database "pay"',
      }),
      'app@x:5432/pay',
    );
    expect(d.hint).toMatch(/host {2}pay {2}app {2}10\.0\.0\.5\/32 {2}md5/);
  });

  it('names the address for connection refused (empty AggregateError message)', () => {
    const d = describeDbError(
      drizzleError({
        code: 'ECONNREFUSED',
        message: '',
        errors: [{ address: '127.0.0.1', port: 5432 }],
      }),
      'payrollph@localhost:5432/payrollph',
    );
    expect(d.summary).toMatch(/^connect ECONNREFUSED 127\.0\.0\.1:5432 \[ECONNREFUSED\]/);
    expect(d.hint).toMatch(/Nothing is listening/);
  });
});

describe('describeTarget', () => {
  it('never includes the password', () => {
    expect(describeTarget('postgres://u:s3cret@h:6543/db')).toBe('u@h:6543/db');
  });
});
