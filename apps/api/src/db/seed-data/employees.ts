import type { EmployeeInput } from '@payrollph/shared';

/*
 * 22 fictional sample employees for development and demos (seeded only with --sample).
 * Covers every pay type × employment type, all four daily-rate factors, kasambahay below
 * and above the RA 10361 threshold, below-minimum-wage and missing-gov-ID warnings,
 * de minimis and taxable allowances, and every payout method. All gov IDs are made up.
 */

type Sample = Pick<
  EmployeeInput,
  | 'firstName'
  | 'lastName'
  | 'sex'
  | 'position'
  | 'employmentType'
  | 'payType'
  | 'baseRate'
  | 'dailyFactor'
  | 'restDays'
  | 'hireDate'
> & {
  missingIds?: readonly ('sss' | 'philhealth' | 'pagibig' | 'tin')[];
  /** Twice-weekly (Wed & Sat) instead of the standard schedule. */
  paySchedule?: EmployeeInput['paySchedule'];
  payout?: EmployeeInput['payout'];
  allowances?: EmployeeInput['allowances'];
  dependents?: EmployeeInput['dependents'];
  isSoloParent?: boolean;
};

const SAMPLES: Sample[] = [
  // Monthly
  {
    firstName: 'Antonio',
    lastName: 'Reyes',
    sex: 'male',
    position: 'Household manager',
    employmentType: 'regular',
    payType: 'monthly',
    baseRate: '35000.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2019-06-01',
    allowances: [
      { name: 'Rice subsidy', amount: '1250.00', kind: 'de_minimis', deMinimisType: 'rice' },
    ],
    dependents: [{ name: 'Lea Reyes', relationship: 'Spouse', birthDate: '1988-02-14' }],
  },
  {
    firstName: 'Bea',
    lastName: 'Cruz',
    sex: 'female',
    position: 'Bookkeeper',
    employmentType: 'regular',
    payType: 'monthly',
    baseRate: '22000.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2021-01-11',
    allowances: [
      { name: 'Transportation', amount: '1000.00', kind: 'taxable', deMinimisType: null },
    ],
  },
  {
    firstName: 'Carlo',
    lastName: 'Mendoza',
    sex: 'male',
    position: 'Driver',
    employmentType: 'probationary',
    payType: 'monthly',
    baseRate: '18000.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2026-05-04',
  },
  {
    firstName: 'Divina',
    lastName: 'Garcia',
    sex: 'female',
    position: 'Cook',
    employmentType: 'kasambahay',
    payType: 'monthly',
    baseRate: '7800.00',
    dailyFactor: 365,
    restDays: [7],
    hireDate: '2022-03-15',
    isSoloParent: true,
    payout: {
      method: 'gcash',
      bankName: null,
      accountName: 'Divina Garcia',
      accountNumber: '09171230004',
    },
  },
  {
    firstName: 'Elena',
    lastName: 'Bautista',
    sex: 'female',
    position: 'Helper',
    employmentType: 'kasambahay',
    payType: 'monthly',
    baseRate: '4500.00',
    dailyFactor: 365,
    restDays: [7],
    hireDate: '2026-02-01',
    missingIds: ['sss', 'philhealth', 'pagibig', 'tin'],
    payout: { method: 'cash', bankName: null, accountName: null, accountNumber: null },
  },
  {
    firstName: 'Francis',
    lastName: 'Villanueva',
    sex: 'male',
    position: 'Estate administrator',
    employmentType: 'contractual',
    payType: 'monthly',
    baseRate: '60000.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2023-09-01',
  },
  // Semi-monthly (base rate is per cutoff)
  {
    firstName: 'Grace',
    lastName: 'Santos',
    sex: 'female',
    position: 'Personal assistant',
    employmentType: 'regular',
    payType: 'semi_monthly',
    baseRate: '12500.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2020-08-17',
    allowances: [
      { name: 'Rice subsidy', amount: '1250.00', kind: 'de_minimis', deMinimisType: 'rice' },
      { name: 'Laundry allowance', amount: '200.00', kind: 'de_minimis', deMinimisType: 'laundry' },
    ],
  },
  {
    firstName: 'Hector',
    lastName: 'Ramos',
    sex: 'male',
    position: 'Gardener',
    employmentType: 'regular',
    payType: 'semi_monthly',
    baseRate: '9000.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2018-04-02',
    dependents: [{ name: 'Mika Ramos', relationship: 'Child', birthDate: '2015-10-09' }],
  },
  {
    firstName: 'Irene',
    lastName: 'Flores',
    sex: 'female',
    position: 'Tutor',
    employmentType: 'probationary',
    payType: 'semi_monthly',
    baseRate: '8000.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2026-06-15',
  },
  {
    firstName: 'Jose',
    lastName: 'Aquino',
    sex: 'male',
    position: 'Houseboy',
    employmentType: 'kasambahay',
    payType: 'semi_monthly',
    baseRate: '4000.00',
    dailyFactor: 365,
    restDays: [7],
    hireDate: '2024-11-04',
  },
  {
    firstName: 'Karen',
    lastName: 'Lim',
    sex: 'female',
    position: 'Finance consultant',
    employmentType: 'contractual',
    payType: 'semi_monthly',
    baseRate: '50000.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2025-02-03',
  },
  // Daily
  {
    firstName: 'Leo',
    lastName: 'Domingo',
    sex: 'male',
    position: 'Carpenter',
    paySchedule: 'twice_weekly',
    employmentType: 'regular',
    payType: 'daily',
    baseRate: '755.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2017-07-10',
  },
  {
    firstName: 'Maria',
    lastName: 'Castillo',
    sex: 'female',
    position: 'Laundry staff',
    employmentType: 'regular',
    payType: 'daily',
    baseRate: '800.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2022-10-03',
    allowances: [
      { name: 'Meal allowance', amount: '500.00', kind: 'taxable', deMinimisType: null },
    ],
  },
  {
    firstName: 'Nestor',
    lastName: 'Pascual',
    sex: 'male',
    position: 'Pool maintenance',
    employmentType: 'probationary',
    payType: 'daily',
    baseRate: '755.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2026-04-20',
  },
  {
    firstName: 'Olivia',
    lastName: 'Navarro',
    sex: 'female',
    position: 'Seamstress',
    employmentType: 'contractual',
    payType: 'daily',
    baseRate: '900.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2024-01-08',
  },
  {
    firstName: 'Paolo',
    lastName: 'Torres',
    sex: 'male',
    position: 'Helper',
    employmentType: 'contractual',
    payType: 'daily',
    baseRate: '650.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2025-12-01',
    missingIds: ['tin'],
  },
  {
    firstName: 'Queenie',
    lastName: 'Salazar',
    sex: 'female',
    position: 'Nanny',
    paySchedule: 'twice_weekly',
    employmentType: 'kasambahay',
    payType: 'daily',
    baseRate: '400.00',
    dailyFactor: 393,
    restDays: [7],
    hireDate: '2023-05-22',
  },
  // Hourly
  {
    firstName: 'Ramon',
    lastName: 'De Leon',
    sex: 'male',
    position: 'Security guard',
    employmentType: 'regular',
    payType: 'hourly',
    baseRate: '120.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2021-09-13',
  },
  {
    firstName: 'Sofia',
    lastName: 'Gonzales',
    sex: 'female',
    position: 'Piano teacher',
    employmentType: 'contractual',
    payType: 'hourly',
    baseRate: '150.00',
    dailyFactor: 261,
    restDays: [6, 7],
    hireDate: '2025-06-02',
  },
  {
    firstName: 'Tomas',
    lastName: 'Rivera',
    sex: 'male',
    position: 'Night watchman',
    employmentType: 'probationary',
    payType: 'hourly',
    baseRate: '95.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2026-07-01',
  },
  {
    firstName: 'Ursula',
    lastName: 'Morales',
    sex: 'female',
    position: 'Cleaner',
    employmentType: 'contractual',
    payType: 'hourly',
    baseRate: '90.00',
    dailyFactor: 313,
    restDays: [7],
    hireDate: '2025-10-06',
    missingIds: ['tin'],
  },
  {
    firstName: 'Victor',
    lastName: 'Fernandez',
    sex: 'male',
    position: 'Caretaker',
    employmentType: 'regular',
    payType: 'hourly',
    baseRate: '200.00',
    dailyFactor: 393,
    restDays: [7],
    hireDate: '2016-03-01',
  },
];

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** Deterministic fake gov IDs in the right formats. */
function fakeIds(i: number) {
  return {
    sssNo: `34-${pad(1000000 + i * 7919, 7)}-${i % 10}`,
    philhealthNo: `12-${pad(100000000 + i * 104729, 9)}-${(i * 3) % 10}`,
    pagibigNo: `1210-${pad(1000 + i * 37, 4)}-${pad(2000 + i * 53, 4)}`,
    tin: `${pad(100 + i, 3)}-${pad(200 + i * 3, 3)}-${pad(300 + i * 7, 3)}-000`,
  };
}

export const SAMPLE_EMPLOYEES: EmployeeInput[] = SAMPLES.map((s, idx) => {
  const i = idx + 1;
  const ids = fakeIds(i);
  const missing = new Set(s.missingIds ?? []);
  const method = (['bank', 'gcash', 'cash'] as const)[i % 3] ?? 'cash';
  const payout: EmployeeInput['payout'] =
    s.payout ??
    (method === 'bank'
      ? {
          method,
          bankName: 'BDO',
          accountName: `${s.firstName} ${s.lastName}`,
          accountNumber: `0012${pad(i * 1234567, 8)}`,
        }
      : method === 'gcash'
        ? {
            method,
            bankName: null,
            accountName: `${s.firstName} ${s.lastName}`,
            accountNumber: `0917${pad(i * 98765, 7)}`,
          }
        : { method, bankName: null, accountName: null, accountNumber: null });
  return {
    employeeNo: `E-${pad(i, 3)}`,
    firstName: s.firstName,
    middleName: null,
    lastName: s.lastName,
    birthDate: `${1975 + (i % 25)}-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
    sex: s.sex,
    civilStatus: s.dependents?.some((d) => d.relationship === 'Spouse') ? 'married' : 'single',
    isSoloParent: s.isSoloParent ?? false,
    address: 'Quezon City, Metro Manila',
    phone: null,
    email: null,
    position: s.position,
    region: 'NCR',
    sssNo: missing.has('sss') ? null : ids.sssNo,
    philhealthNo: missing.has('philhealth') ? null : ids.philhealthNo,
    pagibigNo: missing.has('pagibig') ? null : ids.pagibigNo,
    tin: missing.has('tin') ? null : ids.tin,
    employmentType: s.employmentType,
    payType: s.payType,
    paySchedule: s.paySchedule ?? 'standard',
    baseRate: s.baseRate,
    dailyFactor: s.dailyFactor,
    restDays: s.restDays,
    hireDate: s.hireDate,
    status: 'active',
    separationDate: null,
    allowances: s.allowances ?? [],
    dependents: s.dependents ?? [],
    payout,
  };
});
