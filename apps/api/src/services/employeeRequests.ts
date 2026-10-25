import {
  EmployeeChangeInputSchema,
  EmployeeInputSchema,
  isMaskedValue,
  type EmployeeChangeInput,
  type EmployeeInput,
} from '@payrollph/shared';
import { maskTail } from '../lib/audit';
import { badRequest } from '../lib/http';

/** The four gov ID fields that encoders only ever see masked. */
const GOV_ID_FIELDS = ['sssNo', 'philhealthNo', 'pagibigNo', 'tin'] as const;

/**
 * Turn an encoder's submission into a real employee record. A masked gov ID or account number
 * means "keep the current value"; on a new employee there is no current value, so it is an error.
 * The result is validated with the same schema as a direct edit.
 */
export function resolveChange(
  change: EmployeeChangeInput,
  current: EmployeeInput | null,
): EmployeeInput {
  const resolved: Record<string, unknown> = { ...change, payout: { ...change.payout } };
  for (const field of GOV_ID_FIELDS) {
    const value = change[field];
    if (value !== null && isMaskedValue(value)) {
      if (!current) throw badRequest('MASKED_VALUE', `Enter the full ${field} for a new employee.`);
      resolved[field] = current[field];
    }
  }
  if (isMaskedValue(change.payout.accountNumber)) {
    if (!current) throw badRequest('MASKED_VALUE', 'Enter the full account number.');
    (resolved.payout as EmployeeInput['payout']).accountNumber = current.payout.accountNumber;
  }
  const parsed = EmployeeInputSchema.safeParse(resolved);
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      parsed.error.issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message })),
    );
  }
  return parsed.data;
}

/** Mask gov IDs and the account number, for anyone but the owner. */
export function maskEmployee<T extends EmployeeChangeInput | EmployeeInput>(e: T): T {
  const out = { ...e, payout: { ...e.payout, accountNumber: maskTail(e.payout.accountNumber) } };
  for (const field of GOV_ID_FIELDS) {
    const v = e[field];
    out[field] = (v === null || isMaskedValue(v) ? v : maskTail(v)) as T[typeof field];
  }
  return out;
}

export function encodeChange(change: EmployeeChangeInput): string {
  return JSON.stringify(change);
}

export function decodeChange(json: string): EmployeeChangeInput {
  return EmployeeChangeInputSchema.parse(JSON.parse(json));
}

const FIELD_LABELS: Record<string, string> = {
  employeeNo: 'Employee no.',
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  birthDate: 'Birth date',
  sex: 'Sex',
  civilStatus: 'Civil status',
  isSoloParent: 'Solo parent',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  position: 'Position',
  region: 'Region',
  sssNo: 'SSS no.',
  philhealthNo: 'PhilHealth no.',
  pagibigNo: 'Pag-IBIG no.',
  tin: 'TIN',
  employmentType: 'Employment type',
  payType: 'Pay type',
  paySchedule: 'Pay schedule',
  baseRate: 'Base rate',
  dailyFactor: 'Daily-rate factor',
  restDays: 'Rest days',
  hireDate: 'Hire date',
  status: 'Status',
  separationDate: 'Separation date',
  allowances: 'Allowances',
  dependents: 'Dependents',
  payout: 'Payout',
};

const show = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v);

export interface FieldChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

/** Field-by-field differences (from = current, to = proposed). New employees diff against nothing. */
export function diffEmployee(
  current: EmployeeChangeInput | EmployeeInput | null,
  proposed: EmployeeChangeInput | EmployeeInput,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const from = current ? show((current as Record<string, unknown>)[field]) : null;
    const to = show((proposed as Record<string, unknown>)[field]);
    if (from !== to) changes.push({ field, label, from, to });
  }
  return changes;
}
