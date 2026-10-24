/**
 * Turn a database error into one readable line plus a fix. Drizzle wraps driver errors as
 * "Failed query: <first statement>", which hides the real reason (connection refused, wrong
 * password, missing privileges…) inside a nested `cause`.
 */

interface ErrLike {
  message?: unknown;
  code?: unknown;
  cause?: unknown;
  errors?: unknown;
  address?: unknown;
  port?: unknown;
}

/** The innermost error that carries a Postgres SQLSTATE or a Node network code. */
function rootCause(err: unknown): ErrLike {
  let cur = err as ErrLike;
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i += 1) {
    if (typeof cur.code === 'string') return cur;
    if (!cur.cause) break;
    cur = cur.cause as ErrLike;
  }
  return cur ?? {};
}

const hints: Record<string, string> = {
  ECONNREFUSED:
    'Nothing is listening there. Check DB_HOST/DB_PORT, that PostgreSQL is running, and (in Docker) that listen_addresses includes the Docker bridge address (e.g. 172.17.0.1).',
  ENOTFOUND: 'The host name does not resolve. Check DB_HOST.',
  ETIMEDOUT:
    'The connection timed out. A firewall may be blocking the Docker network → the PostgreSQL port.',
  EHOSTUNREACH: 'The host is unreachable from here. Check DB_HOST and the network.',
  '28P01': 'Wrong password: POSTGRES_PASSWORD must match the role (ALTER ROLE <user> PASSWORD …).',
  '28000':
    'The role does not exist, or pg_hba.conf has no matching "host" line for this database/user/address.',
  '3D000': 'The database does not exist: CREATE DATABASE <db> OWNER <user>;',
  '42501':
    'The role lacks privileges in this database. Make it the owner: ALTER DATABASE <db> OWNER TO <user>; and, on PostgreSQL 15+, ALTER SCHEMA public OWNER TO <user>; (run inside the database).',
  '57P03': 'PostgreSQL is starting up. Wait a moment and retry.',
};

export interface DescribedDbError {
  summary: string;
  hint: string | null;
}

export function describeDbError(err: unknown, target: string): DescribedDbError {
  const root = rootCause(err);
  const code = typeof root.code === 'string' ? root.code : null;
  let message = typeof root.message === 'string' && root.message ? root.message : '';
  // Node reports ECONNREFUSED as an AggregateError with an empty message; name the address.
  if (!message && Array.isArray(root.errors) && root.errors.length > 0) {
    const first = root.errors[0] as ErrLike;
    message = `connect ${String(code)} ${String(first.address ?? '')}:${String(first.port ?? '')}`;
  }
  if (!message) message = err instanceof Error ? err.message : String(err);
  return {
    summary: `${message}${code ? ` [${code}]` : ''} (connecting to ${target})`,
    hint: code ? (hints[code] ?? null) : null,
  };
}

/** `user@host:port/db` from a postgres URL, without the password. */
export function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${decodeURIComponent(u.username)}@${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'the configured database';
  }
}
