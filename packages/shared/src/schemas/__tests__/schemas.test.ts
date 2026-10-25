import { describe, expect, it } from 'vitest';
import { RATES_V1 } from '../../seed/ratesV1';
import { AttendanceEntryInputSchema } from '../attendance';
import { MoneySchema } from '../common';
import { AllowanceSchema, EmployeeInputSchema, PayoutSchema } from '../employee';
import { PAYROLL_TRANSITIONS, ReopenPayrollRunSchema } from '../payroll';
import { StatutoryRatesSchema } from '../rates';

describe('StatutoryRatesSchema', () => {
  it('accepts the seeded v1 rates', () => {
    expect(StatutoryRatesSchema.safeParse(RATES_V1).success).toBe(true);
  });

  it('rejects a rates object missing a section', () => {
    const { sss: _sss, ...rest } = RATES_V1;
    expect(StatutoryRatesSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-decimal rate strings', () => {
    const bad = { ...RATES_V1, philhealth: { ...RATES_V1.philhealth, rate: '5%' } };
    expect(StatutoryRatesSchema.safeParse(bad).success).toBe(false);
  });
});

describe('MoneySchema', () => {
  it.each(['0', '0.5', '12.34', '-1.00', '999999999999.99'])('accepts %s', (v) => {
    expect(MoneySchema.safeParse(v).success).toBe(true);
  });
  it.each(['1.234', 'abc', '1,000', '', '1e5'])('rejects %s', (v) => {
    expect(MoneySchema.safeParse(v).success).toBe(false);
  });
});

const validEmployee = {
  employeeNo: 'E-001',
  firstName: 'Maria',
  middleName: null,
  lastName: 'Santos',
  birthDate: '1990-05-01',
  sex: 'female',
  civilStatus: 'single',
  isSoloParent: false,
  address: null,
  phone: null,
  email: null,
  position: 'Cook',
  region: 'NCR',
  sssNo: '34-1234567-8',
  philhealthNo: '12-345678901-2',
  pagibigNo: '1234-5678-9012',
  tin: '123-456-789-000',
  employmentType: 'kasambahay',
  payType: 'monthly',
  baseRate: '7000.00',
  dailyFactor: 365,
  restDays: [7],
  hireDate: '2024-01-15',
  status: 'active',
  separationDate: null,
  allowances: [],
  dependents: [],
  payout: {
    method: 'gcash',
    bankName: null,
    accountName: 'Maria Santos',
    accountNumber: '09171234567',
  },
};

describe('EmployeeInputSchema', () => {
  it('accepts a complete employee', () => {
    const r = EmployeeInputSchema.safeParse(validEmployee);
    expect(r.error?.issues).toBeUndefined();
  });

  it('rejects a daily factor outside 313/261/365/393', () => {
    expect(EmployeeInputSchema.safeParse({ ...validEmployee, dailyFactor: 300 }).success).toBe(
      false,
    );
  });

  it('rejects malformed gov IDs', () => {
    expect(EmployeeInputSchema.safeParse({ ...validEmployee, sssNo: '123' }).success).toBe(false);
    expect(EmployeeInputSchema.safeParse({ ...validEmployee, tin: 'abc' }).success).toBe(false);
  });

  it('requires a de minimis type on de minimis allowances', () => {
    const r = AllowanceSchema.safeParse({
      name: 'Rice',
      amount: '1000.00',
      kind: 'de_minimis',
      deMinimisType: null,
    });
    expect(r.success).toBe(false);
  });

  it('requires account details for bank and GCash payouts but not cash', () => {
    expect(
      PayoutSchema.safeParse({
        method: 'bank',
        bankName: 'BPI',
        accountName: null,
        accountNumber: null,
      }).success,
    ).toBe(false);
    expect(
      PayoutSchema.safeParse({
        method: 'cash',
        bankName: null,
        accountName: null,
        accountNumber: null,
      }).success,
    ).toBe(true);
  });
});

describe('AttendanceEntryInputSchema', () => {
  const base = {
    employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    date: '2026-01-05',
    dayTypeOverride: null,
    regularHours: 8,
    otHours: 2,
    ndHours: 0,
    ndOtHours: 0,
    tardyMinutes: 0,
    undertimeMinutes: 0,
    absent: false,
    leaveType: null,
    notes: null,
  };

  it('accepts a normal day', () => {
    expect(AttendanceEntryInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects ND hours above regular hours', () => {
    expect(AttendanceEntryInputSchema.safeParse({ ...base, ndHours: 9 }).success).toBe(false);
  });

  it('rejects ND OT hours above OT hours', () => {
    expect(AttendanceEntryInputSchema.safeParse({ ...base, ndOtHours: 3 }).success).toBe(false);
  });

  it('rejects absent and on leave at the same time', () => {
    expect(
      AttendanceEntryInputSchema.safeParse({ ...base, absent: true, leaveType: 'sil' }).success,
    ).toBe(false);
  });
});

describe('payroll run rules', () => {
  it('only allows forward transitions; paid is terminal', () => {
    expect(PAYROLL_TRANSITIONS.draft).toEqual(['review']);
    expect(PAYROLL_TRANSITIONS.approved).toEqual(['paid']);
    expect(PAYROLL_TRANSITIONS.paid).toEqual([]);
  });

  it('requires a reopen reason', () => {
    expect(ReopenPayrollRunSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(ReopenPayrollRunSchema.safeParse({ reason: 'Wrong OT hours for J. Cruz' }).success).toBe(
      true,
    );
  });
});

describe('twice-weekly payouts', () => {
  it('only accepts a Wednesday or Saturday pay date', async () => {
    const { CreateTwiceWeeklyRunSchema } = await import('../payroll');
    // 2026-10-28 is a Wednesday, 2026-10-31 a Saturday, 2026-10-30 a Friday.
    expect(CreateTwiceWeeklyRunSchema.safeParse({ payDate: '2026-10-28' }).success).toBe(true);
    expect(CreateTwiceWeeklyRunSchema.safeParse({ payDate: '2026-10-31' }).success).toBe(true);
    expect(CreateTwiceWeeklyRunSchema.safeParse({ payDate: '2026-10-30' }).success).toBe(false);
  });

  it('defaults the pay schedule to standard', () => {
    const parsed = EmployeeInputSchema.parse(validEmployee);
    expect(parsed.paySchedule).toBe('standard');
  });
});

describe('employee change requests (encoder)', () => {
  it('accepts masked gov IDs as "unchanged", which a direct edit rejects', async () => {
    const { EmployeeChangeInputSchema } = await import('../employee');
    const masked = { ...validEmployee, sssNo: '••••5678', tin: '••••9000' };
    expect(EmployeeChangeInputSchema.safeParse(masked).success).toBe(true);
    expect(EmployeeInputSchema.safeParse(masked).success).toBe(false);
  });

  it('still validates real gov IDs', async () => {
    const { EmployeeChangeInputSchema } = await import('../employee');
    expect(EmployeeChangeInputSchema.safeParse({ ...validEmployee, sssNo: '12345' }).success).toBe(
      false,
    );
  });

  it('creates encoder users; never a second owner', async () => {
    const { CreateUserSchema } = await import('../auth');
    const base = { name: 'Enc', email: 'enc@example.test', password: 'long-enough-password' };
    expect(CreateUserSchema.parse({ ...base, role: 'encoder' }).role).toBe('encoder');
    expect(CreateUserSchema.parse(base).role).toBe('viewer');
    expect(CreateUserSchema.safeParse({ ...base, role: 'owner' }).success).toBe(false);
  });
});
