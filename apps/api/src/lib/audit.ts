import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

/** A transaction handle or the db itself; both expose insert/select/update. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AuditEntryInput {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Record who did what, with before/after snapshots. Callers must pass already-masked data:
 * never put decrypted gov IDs, account numbers, password hashes or TOTP secrets in here.
 */
export async function writeAudit(db: DbOrTx, entry: AuditEntryInput): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    reason: entry.reason ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

/** Show only the last 4 characters of a sensitive value. */
export function maskTail(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/[^0-9A-Za-z]/g, '');
  return digits.length <= 4 ? '••••' : `••••${digits.slice(-4)}`;
}
