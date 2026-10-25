import type { EmployeeInput } from '@payrollph/shared';
import { EmployeeSchema } from '@payrollph/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { dependents, employeeAllowances, employees, settings } from '../db/schema';
import { maskTail, writeAudit, type DbOrTx } from '../lib/audit';
import type { FieldCipher } from '../lib/crypto';
import { conflict, notFound } from '../lib/http';

export type EmployeeRow = typeof employees.$inferSelect;

/** Response shape: like EmployeeSchema, but gov IDs/account numbers may be masked for viewers. */
export const EmployeeDetailSchema = EmployeeSchema.extend({
  sssNo: z.string().nullable(),
  philhealthNo: z.string().nullable(),
  pagibigNo: z.string().nullable(),
  tin: z.string().nullable(),
  payout: z.object({
    method: z.enum(['bank', 'gcash', 'cash']),
    bankName: z.string().nullable(),
    accountName: z.string().nullable(),
    accountNumber: z.string().nullable(),
  }),
  /** True when gov IDs/account numbers are masked (viewer role). */
  sensitiveMasked: z.boolean(),
  missingGovIds: z.array(z.enum(['sss', 'philhealth', 'pagibig', 'tin'])),
});
export type EmployeeDetail = z.infer<typeof EmployeeDetailSchema>;

export const EmployeeListItemSchema = z.object({
  id: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  position: z.string().nullable(),
  employmentType: EmployeeSchema.shape.employmentType,
  payType: EmployeeSchema.shape.payType,
  paySchedule: z.enum(['standard', 'twice_weekly']),
  baseRate: z.string(),
  dailyFactor: z.number().int(),
  region: z.string(),
  status: EmployeeSchema.shape.status,
  hireDate: z.string(),
  payoutMethod: z.enum(['bank', 'gcash', 'cash']),
  missingGovIds: z.array(z.enum(['sss', 'philhealth', 'pagibig', 'tin'])),
});
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;

export function missingGovIds(row: EmployeeRow): EmployeeListItem['missingGovIds'] {
  const out: EmployeeListItem['missingGovIds'] = [];
  if (!row.sssNoEnc) out.push('sss');
  if (!row.philhealthNoEnc) out.push('philhealth');
  if (!row.pagibigNoEnc) out.push('pagibig');
  if (!row.tinEnc) out.push('tin');
  return out;
}

export const fullName = (r: Pick<EmployeeRow, 'firstName' | 'middleName' | 'lastName'>): string =>
  [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ');

export function toListItem(row: EmployeeRow): EmployeeListItem {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    fullName: fullName(row),
    position: row.position,
    employmentType: row.employmentType,
    payType: row.payType,
    paySchedule: row.paySchedule,
    baseRate: row.baseRate,
    dailyFactor: row.dailyFactor,
    region: row.region,
    status: row.status,
    hireDate: row.hireDate,
    payoutMethod: row.payoutMethod,
    missingGovIds: missingGovIds(row),
  };
}

export async function loadEmployeeDetail(
  db: DbOrTx,
  cipher: FieldCipher,
  id: string,
  mask: boolean,
): Promise<EmployeeDetail | null> {
  const [row] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!row) return null;
  const allowances = await db
    .select()
    .from(employeeAllowances)
    .where(eq(employeeAllowances.employeeId, id));
  const deps = await db.select().from(dependents).where(eq(dependents.employeeId, id));
  const reveal = (enc: string | null): string | null => {
    const plain = cipher.decryptNullable(enc);
    return mask ? maskTail(plain) : plain;
  };
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    birthDate: row.birthDate,
    sex: row.sex,
    civilStatus: row.civilStatus,
    isSoloParent: row.isSoloParent,
    address: row.address,
    phone: row.phone,
    email: row.email,
    position: row.position,
    region: row.region,
    sssNo: reveal(row.sssNoEnc),
    philhealthNo: reveal(row.philhealthNoEnc),
    pagibigNo: reveal(row.pagibigNoEnc),
    tin: reveal(row.tinEnc),
    employmentType: row.employmentType,
    payType: row.payType,
    paySchedule: row.paySchedule,
    baseRate: row.baseRate,
    dailyFactor: row.dailyFactor as EmployeeDetail['dailyFactor'],
    restDays: row.restDays,
    hireDate: row.hireDate,
    status: row.status,
    separationDate: row.separationDate,
    allowances: allowances.map((a) => ({
      name: a.name,
      amount: a.amount,
      kind: a.kind,
      deMinimisType: a.deMinimisType,
    })),
    dependents: deps.map((d) => ({
      name: d.name,
      relationship: d.relationship,
      birthDate: d.birthDate,
    })),
    payout: {
      method: row.payoutMethod,
      bankName: row.bankName,
      accountName: row.accountName,
      accountNumber: reveal(row.accountNumberEnc),
    },
    sensitiveMasked: mask,
    missingGovIds: missingGovIds(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Audit-safe snapshot: sensitive values masked to their last 4 characters. */
export function auditSnapshot(e: EmployeeInput): Record<string, unknown> {
  return {
    ...e,
    sssNo: maskTail(e.sssNo),
    philhealthNo: maskTail(e.philhealthNo),
    pagibigNo: maskTail(e.pagibigNo),
    tin: maskTail(e.tin),
    payout: { ...e.payout, accountNumber: maskTail(e.payout.accountNumber) },
  };
}

/** Column values for an insert/update from validated input. */
export function employeeColumns(e: EmployeeInput, cipher: FieldCipher) {
  return {
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
    paySchedule: e.paySchedule,
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
  };
}

/**
 * App-level cap check (the DB trigger is the backstop). `excludeId` skips the employee being
 * updated so an already-active employee can be edited at the cap.
 */
export async function assertCapAllowsActive(db: DbOrTx | Db, excludeId?: string): Promise<void> {
  const [cfg] = await db.select({ cap: settings.employeeCap }).from(settings).limit(1);
  const cap = cfg?.cap ?? 25;
  const where = excludeId
    ? and(eq(employees.status, 'active'), ne(employees.id, excludeId))
    : eq(employees.status, 'active');
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(employees)
    .where(where);
  const active = row?.n ?? 0;
  if (active + 1 > cap) {
    throw conflict(
      'EMPLOYEE_CAP_EXCEEDED',
      `You already have ${active} active employees and the cap is ${cap}. Deactivate or separate an employee, or raise the cap in Settings.`,
      { active, cap },
    );
  }
}

/** Who made a change, for the audit entry (approvals name the requester in `reason`). */
export interface ChangeActor {
  actorId: string | null;
  reason?: string | null;
}

/** Insert an employee with allowances and dependents, enforcing the cap. Returns the id. */
export async function createEmployee(
  tx: DbOrTx,
  cipher: FieldCipher,
  input: EmployeeInput,
  actor: ChangeActor,
): Promise<string> {
  if (input.status === 'active') await assertCapAllowsActive(tx);
  const [row] = await tx
    .insert(employees)
    .values(employeeColumns(input, cipher))
    .returning({ id: employees.id });
  if (!row) throw new Error('Employee insert returned no row');
  if (input.allowances.length > 0) {
    await tx
      .insert(employeeAllowances)
      .values(input.allowances.map((a) => ({ ...a, employeeId: row.id })));
  }
  if (input.dependents.length > 0) {
    await tx.insert(dependents).values(input.dependents.map((d) => ({ ...d, employeeId: row.id })));
  }
  await writeAudit(tx, {
    actorId: actor.actorId,
    action: 'employee.create',
    entity: 'employee',
    entityId: row.id,
    reason: actor.reason ?? null,
    after: auditSnapshot(input),
  });
  return row.id;
}

/** The current record as an EmployeeInput (decrypted), for diffs and "keep current" values. */
export function detailToInput(d: EmployeeDetail): EmployeeInput {
  const {
    sensitiveMasked: _m,
    missingGovIds: _g,
    id: _i,
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = d;
  return rest;
}

/** Replace an employee record (allowances and dependents included), enforcing the cap. */
export async function replaceEmployee(
  tx: DbOrTx,
  cipher: FieldCipher,
  id: string,
  input: EmployeeInput,
  actor: ChangeActor,
): Promise<void> {
  const before = await loadEmployeeDetail(tx, cipher, id, false);
  if (!before) throw notFound('Employee');
  if (input.status === 'active' && before.status !== 'active') {
    await assertCapAllowsActive(tx, id);
  }
  await tx.update(employees).set(employeeColumns(input, cipher)).where(eq(employees.id, id));
  await tx.delete(employeeAllowances).where(eq(employeeAllowances.employeeId, id));
  await tx.delete(dependents).where(eq(dependents.employeeId, id));
  if (input.allowances.length > 0) {
    await tx
      .insert(employeeAllowances)
      .values(input.allowances.map((a) => ({ ...a, employeeId: id })));
  }
  if (input.dependents.length > 0) {
    await tx.insert(dependents).values(input.dependents.map((d) => ({ ...d, employeeId: id })));
  }
  await writeAudit(tx, {
    actorId: actor.actorId,
    action: 'employee.update',
    entity: 'employee',
    entityId: id,
    reason: actor.reason ?? null,
    before: auditSnapshot(detailToInput(before)),
    after: auditSnapshot(input),
  });
}
