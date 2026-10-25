import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FinalPayResult, PayslipComputation, StatutoryRates } from '@payrollph/shared';

/** Money column: NUMERIC(14,2), returned as a string. */
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const hours = (name: string) => numeric(name, { precision: 5, scale: 2 });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const pk = () => uuid('id').primaryKey().defaultRandom();
const day = (name: string) => date(name, { mode: 'string' });

// ---------------------------------------------------------------- enums
export const roleEnum = pgEnum('role', ['owner', 'viewer', 'encoder']);
export const payScheduleEnum = pgEnum('pay_schedule', ['standard', 'twice_weekly']);
export const changeRequestKindEnum = pgEnum('change_request_kind', ['create', 'update']);
export const changeRequestStatusEnum = pgEnum('change_request_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);
export const payTypeEnum = pgEnum('pay_type', ['monthly', 'semi_monthly', 'daily', 'hourly']);
export const employmentTypeEnum = pgEnum('employment_type', [
  'regular',
  'probationary',
  'contractual',
  'kasambahay',
]);
export const employeeStatusEnum = pgEnum('employee_status', ['active', 'inactive', 'separated']);
export const sexEnum = pgEnum('sex', ['female', 'male']);
export const civilStatusEnum = pgEnum('civil_status', [
  'single',
  'married',
  'widowed',
  'separated',
]);
export const allowanceKindEnum = pgEnum('allowance_kind', ['taxable', 'de_minimis']);
export const payoutMethodEnum = pgEnum('payout_method', ['bank', 'gcash', 'cash']);
export const holidayTypeEnum = pgEnum('holiday_type', [
  'regular',
  'special_non_working',
  'special_working',
]);
export const dayTypeEnum = pgEnum('day_type', [
  'ordinary',
  'rest_day',
  'special',
  'special_rest_day',
  'regular',
  'regular_rest_day',
  'double',
  'double_rest_day',
]);
export const leaveTypeEnum = pgEnum('leave_type', [
  'sil',
  'maternity',
  'paternity',
  'solo_parent',
  'unpaid',
]);
export const payFrequencyEnum = pgEnum('pay_frequency', ['semi_monthly', 'monthly']);
export const contributionScheduleEnum = pgEnum('contribution_schedule', ['second_cutoff', 'split']);
export const payrollRunKindEnum = pgEnum('payroll_run_kind', [
  'semi_monthly_1',
  'semi_monthly_2',
  'monthly',
  'thirteenth_month',
  'final_pay',
  'twice_weekly',
]);
export const payrollRunStatusEnum = pgEnum('payroll_run_status', [
  'draft',
  'review',
  'approved',
  'paid',
]);
export const loanTypeEnum = pgEnum('loan_type', ['sss', 'pagibig', 'company', 'cash_advance']);
export const loanStatusEnum = pgEnum('loan_status', ['active', 'paid', 'cancelled']);
export const deductOnEnum = pgEnum('deduct_on', ['every_run', 'first_cutoff', 'second_cutoff']);
export const ledgerKindEnum = pgEnum('ledger_kind', ['disbursement', 'payment', 'adjustment']);
export const recurrenceEnum = pgEnum('recurrence', ['once', 'every_run']);

// ---------------------------------------------------------------- auth & audit
export const users = pgTable(
  'users',
  {
    id: pk(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    /** AES-256-GCM encrypted TOTP secret. */
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** False until the second factor is verified for TOTP users. */
    mfaPassed: boolean('mfa_passed').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_at_idx').on(t.at)],
);

// ---------------------------------------------------------------- settings & reference data
export const settings = pgTable(
  'settings',
  {
    id: smallint('id').primaryKey().default(1),
    ownerName: text('owner_name').notNull().default(''),
    ownerAddress: text('owner_address'),
    ownerTin: text('owner_tin'),
    ownerSssEmployerNo: text('owner_sss_employer_no'),
    ownerPhilhealthEmployerNo: text('owner_philhealth_employer_no'),
    ownerPagibigEmployerNo: text('owner_pagibig_employer_no'),
    payFrequency: payFrequencyEnum('pay_frequency').notNull().default('semi_monthly'),
    defaultRegion: text('default_region').notNull().default('NCR'),
    employeeCap: integer('employee_cap').notNull().default(25),
    contributionSchedule: contributionScheduleEnum('contribution_schedule')
      .notNull()
      .default('second_cutoff'),
    backupRetentionDays: integer('backup_retention_days').notNull().default(30),
    /** SMTP config; the password inside is encrypted. */
    smtp: jsonb('smtp'),
    setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('settings_singleton', sql`${t.id} = 1`),
    check('settings_cap_positive', sql`${t.employeeCap} >= 1`),
  ],
);

export const statutoryRates = pgTable('statutory_rates', {
  id: pk(),
  version: text('version').notNull().unique(),
  effectiveFrom: day('effective_from').notNull().unique(),
  /** Validated against StatutoryRatesSchema on write. */
  data: jsonb('data').$type<StatutoryRates>().notNull(),
  notes: text('notes'),
  verified: boolean('verified').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const minWages = pgTable(
  'min_wages',
  {
    id: pk(),
    region: text('region').notNull(),
    effectiveFrom: day('effective_from').notNull(),
    nonAgricultureDaily: money('non_agriculture_daily').notNull(),
    kasambahayMonthly: money('kasambahay_monthly').notNull(),
    wageOrder: text('wage_order'),
  },
  (t) => [uniqueIndex('min_wages_region_from_uq').on(t.region, t.effectiveFrom)],
);

export const holidays = pgTable('holidays', {
  id: pk(),
  date: day('date').notNull().unique(),
  name: text('name').notNull(),
  type: holidayTypeEnum('type').notNull(),
});

// ---------------------------------------------------------------- employees
export const employees = pgTable(
  'employees',
  {
    id: pk(),
    employeeNo: text('employee_no').notNull().unique(),
    firstName: text('first_name').notNull(),
    middleName: text('middle_name'),
    lastName: text('last_name').notNull(),
    birthDate: day('birth_date'),
    sex: sexEnum('sex'),
    civilStatus: civilStatusEnum('civil_status'),
    isSoloParent: boolean('is_solo_parent').notNull().default(false),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    position: text('position'),
    region: text('region').notNull(),
    // Gov IDs, AES-256-GCM encrypted (see lib/crypto.ts).
    sssNoEnc: text('sss_no_enc'),
    philhealthNoEnc: text('philhealth_no_enc'),
    pagibigNoEnc: text('pagibig_no_enc'),
    tinEnc: text('tin_enc'),
    employmentType: employmentTypeEnum('employment_type').notNull(),
    payType: payTypeEnum('pay_type').notNull(),
    paySchedule: payScheduleEnum('pay_schedule').notNull().default('standard'),
    baseRate: money('base_rate').notNull(),
    dailyFactor: smallint('daily_factor').notNull(),
    /** ISO weekdays (1 = Mon … 7 = Sun). */
    restDays: smallint('rest_days')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    hireDate: day('hire_date').notNull(),
    status: employeeStatusEnum('status').notNull().default('active'),
    separationDate: day('separation_date'),
    payoutMethod: payoutMethodEnum('payout_method').notNull().default('cash'),
    bankName: text('bank_name'),
    accountName: text('account_name'),
    accountNumberEnc: text('account_number_enc'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('employees_daily_factor', sql`${t.dailyFactor} IN (313, 261, 365, 393)`),
    check('employees_base_rate_nonneg', sql`${t.baseRate} >= 0`),
    index('employees_status_idx').on(t.status),
  ],
);

export const employeeAllowances = pgTable(
  'employee_allowances',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    amount: money('amount').notNull(),
    kind: allowanceKindEnum('kind').notNull(),
    deMinimisType: text('de_minimis_type'),
  },
  (t) => [index('allowances_employee_idx').on(t.employeeId)],
);

export const dependents = pgTable(
  'dependents',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    relationship: text('relationship').notNull(),
    birthDate: day('birth_date'),
  },
  (t) => [index('dependents_employee_idx').on(t.employeeId)],
);

export const employeeDocuments = pgTable(
  'employee_documents',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    /** Name on the uploads volume (random, no user input). */
    storedName: text('stored_name').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('documents_employee_idx').on(t.employeeId)],
);

// ---------------------------------------------------------------- attendance & leave
export const attendance = pgTable(
  'attendance',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    dayTypeOverride: dayTypeEnum('day_type_override'),
    regularHours: hours('regular_hours').notNull().default('0'),
    otHours: hours('ot_hours').notNull().default('0'),
    ndHours: hours('nd_hours').notNull().default('0'),
    ndOtHours: hours('nd_ot_hours').notNull().default('0'),
    tardyMinutes: integer('tardy_minutes').notNull().default(0),
    undertimeMinutes: integer('undertime_minutes').notNull().default(0),
    absent: boolean('absent').notNull().default(false),
    leaveType: leaveTypeEnum('leave_type'),
    notes: text('notes'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_employee_date_uq').on(t.employeeId, t.date),
    index('attendance_date_idx').on(t.date),
  ],
);

export const leaveBalances = pgTable(
  'leave_balances',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    year: smallint('year').notNull(),
    leaveType: leaveTypeEnum('leave_type').notNull(),
    entitledDays: numeric('entitled_days', { precision: 6, scale: 2 }).notNull(),
    usedDays: numeric('used_days', { precision: 6, scale: 2 }).notNull().default('0'),
    convertedDays: numeric('converted_days', { precision: 6, scale: 2 }).notNull().default('0'),
  },
  (t) => [uniqueIndex('leave_balances_uq').on(t.employeeId, t.year, t.leaveType)],
);

// ---------------------------------------------------------------- payroll
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: pk(),
    kind: payrollRunKindEnum('kind').notNull(),
    status: payrollRunStatusEnum('status').notNull().default('draft'),
    periodStart: day('period_start').notNull(),
    periodEnd: day('period_end').notNull(),
    payDate: day('pay_date').notNull(),
    ratesVersionId: uuid('rates_version_id')
      .notNull()
      .references(() => statutoryRates.id),
    contributionSchedule: contributionScheduleEnum('contribution_schedule').notNull(),
    /** 13th-month runs: 'half' or 'full'. */
    thirteenthMode: text('thirteenth_mode'),
    /** Final-pay runs: the separated employee. */
    finalPayEmployeeId: uuid('final_pay_employee_id').references(() => employees.id),
    totalGross: money('total_gross').notNull().default('0'),
    totalDeductions: money('total_deductions').notNull().default('0'),
    totalNet: money('total_net').notNull().default('0'),
    totalEmployerShares: money('total_employer_shares').notNull().default('0'),
    lastReopenReason: text('last_reopen_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    check('payroll_runs_period', sql`${t.periodEnd} >= ${t.periodStart}`),
    // One regular run per kind and period; 13th-month and final-pay runs may repeat.
    uniqueIndex('payroll_runs_regular_uq')
      .on(t.kind, t.periodStart)
      // Written as NOT IN the one-off kinds: a just-added enum value (twice_weekly) cannot be
      // used in the migration's own transaction, and a ::text cast is not IMMUTABLE.
      .where(sql`${t.kind} NOT IN ('thirteenth_month', 'final_pay')`),
  ],
);

export const payslips = pgTable(
  'payslips',
  {
    id: pk(),
    payrollRunId: uuid('payroll_run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    /** Full engine output, frozen at computation time. */
    computation: jsonb('computation').$type<PayslipComputation>().notNull(),
    /** Final-pay runs only: prorated 13th, SIL conversion, loan payoff and tax adjustment. */
    finalPay: jsonb('final_pay').$type<FinalPayResult>(),
    // Denormalised totals for reports and YTD.
    gross: money('gross').notNull(),
    taxableIncome: money('taxable_income').notNull(),
    withholdingTax: money('withholding_tax').notNull(),
    sssEe: money('sss_ee').notNull(),
    sssEr: money('sss_er').notNull(),
    sssEc: money('sss_ec').notNull(),
    sssMpfEe: money('sss_mpf_ee').notNull().default('0'),
    sssMpfEr: money('sss_mpf_er').notNull().default('0'),
    philhealthEe: money('philhealth_ee').notNull(),
    philhealthEr: money('philhealth_er').notNull(),
    pagibigEe: money('pagibig_ee').notNull(),
    pagibigEr: money('pagibig_er').notNull(),
    basicEarned: money('basic_earned').notNull(),
    thirteenthAccrual: money('thirteenth_accrual').notNull(),
    thirteenthPaid: money('thirteenth_paid').notNull().default('0'),
    otherBenefitsExemptUsed: money('other_benefits_exempt_used').notNull(),
    totalDeductions: money('total_deductions').notNull(),
    net: money('net').notNull(),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payslips_run_employee_uq').on(t.payrollRunId, t.employeeId),
    index('payslips_employee_idx').on(t.employeeId),
  ],
);

// ---------------------------------------------------------------- loans & deductions
export const loans = pgTable(
  'loans',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    type: loanTypeEnum('type').notNull(),
    reference: text('reference'),
    principal: money('principal').notNull(),
    amortization: money('amortization').notNull(),
    deductOn: deductOnEnum('deduct_on').notNull().default('every_run'),
    startDate: day('start_date').notNull(),
    status: loanStatusEnum('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [
    check('loans_amortization_positive', sql`${t.amortization} > 0`),
    index('loans_employee_idx').on(t.employeeId),
  ],
);

export const loanLedger = pgTable(
  'loan_ledger',
  {
    id: pk(),
    loanId: uuid('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    payrollRunId: uuid('payroll_run_id').references(() => payrollRuns.id, {
      onDelete: 'set null',
    }),
    kind: ledgerKindEnum('kind').notNull(),
    /** Disbursement positive; payments negative. */
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('loan_ledger_loan_idx').on(t.loanId)],
);

export const customDeductions = pgTable(
  'custom_deductions',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    amount: money('amount').notNull(),
    recurrence: recurrenceEnum('recurrence').notNull(),
    startDate: day('start_date').notNull(),
    endDate: day('end_date'),
    /** For one-off deductions: the run that consumed it. */
    appliedRunId: uuid('applied_run_id').references(() => payrollRuns.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('custom_deductions_employee_idx').on(t.employeeId)],
);

// ---------------------------------------------------------------- employee change requests
/**
 * Employee additions and edits submitted by an encoder. Nothing changes in `employees` until
 * the owner approves. The proposed record contains gov IDs and account numbers, so it is stored
 * encrypted (AES-256-GCM JSON); `summary` holds only what lists need.
 */
export const employeeChangeRequests = pgTable(
  'employee_change_requests',
  {
    id: pk(),
    kind: changeRequestKindEnum('kind').notNull(),
    /** The employee being edited; null for a new-employee request. */
    employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
    status: changeRequestStatusEnum('status').notNull().default('pending'),
    payloadEnc: text('payload_enc').notNull(),
    summary: jsonb('summary').$type<{ employeeNo: string; fullName: string }>().notNull(),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    /** The employee created or updated by approval. */
    resultEmployeeId: uuid('result_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('change_requests_status_idx').on(t.status, t.requestedAt),
    // At most one pending edit per existing employee.
    uniqueIndex('change_requests_one_pending_uq')
      .on(t.employeeId)
      .where(sql`${t.status} = 'pending' AND ${t.employeeId} IS NOT NULL`),
  ],
);
