CREATE TYPE "public"."allowance_kind" AS ENUM('taxable', 'de_minimis');--> statement-breakpoint
CREATE TYPE "public"."civil_status" AS ENUM('single', 'married', 'widowed', 'separated');--> statement-breakpoint
CREATE TYPE "public"."contribution_schedule" AS ENUM('second_cutoff', 'split');--> statement-breakpoint
CREATE TYPE "public"."day_type" AS ENUM('ordinary', 'rest_day', 'special', 'special_rest_day', 'regular', 'regular_rest_day', 'double', 'double_rest_day');--> statement-breakpoint
CREATE TYPE "public"."deduct_on" AS ENUM('every_run', 'first_cutoff', 'second_cutoff');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'inactive', 'separated');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('regular', 'probationary', 'contractual', 'kasambahay');--> statement-breakpoint
CREATE TYPE "public"."holiday_type" AS ENUM('regular', 'special_non_working', 'special_working');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('sil', 'maternity', 'paternity', 'solo_parent', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('disbursement', 'payment', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('active', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."loan_type" AS ENUM('sss', 'pagibig', 'company', 'cash_advance');--> statement-breakpoint
CREATE TYPE "public"."pay_frequency" AS ENUM('semi_monthly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."pay_type" AS ENUM('monthly', 'semi_monthly', 'daily', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('bank', 'gcash', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_kind" AS ENUM('semi_monthly_1', 'semi_monthly_2', 'monthly', 'thirteenth_month', 'final_pay');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'review', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('once', 'every_run');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male');--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"day_type_override" "day_type",
	"regular_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"ot_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"nd_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"nd_ot_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tardy_minutes" integer DEFAULT 0 NOT NULL,
	"undertime_minutes" integer DEFAULT 0 NOT NULL,
	"absent" boolean DEFAULT false NOT NULL,
	"leave_type" "leave_type",
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"reason" text,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "custom_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"recurrence" "recurrence" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"applied_run_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dependents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"birth_date" date
);
--> statement-breakpoint
CREATE TABLE "employee_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"kind" "allowance_kind" NOT NULL,
	"de_minimis_type" text
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_documents_stored_name_unique" UNIQUE("stored_name")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_no" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"birth_date" date,
	"sex" "sex",
	"civil_status" "civil_status",
	"is_solo_parent" boolean DEFAULT false NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"position" text,
	"region" text NOT NULL,
	"sss_no_enc" text,
	"philhealth_no_enc" text,
	"pagibig_no_enc" text,
	"tin_enc" text,
	"employment_type" "employment_type" NOT NULL,
	"pay_type" "pay_type" NOT NULL,
	"base_rate" numeric(14, 2) NOT NULL,
	"daily_factor" smallint NOT NULL,
	"rest_days" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"hire_date" date NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"separation_date" date,
	"payout_method" "payout_method" DEFAULT 'cash' NOT NULL,
	"bank_name" text,
	"account_name" text,
	"account_number_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_no_unique" UNIQUE("employee_no"),
	CONSTRAINT "employees_daily_factor" CHECK ("employees"."daily_factor" IN (313, 261, 365, 393)),
	CONSTRAINT "employees_base_rate_nonneg" CHECK ("employees"."base_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"type" "holiday_type" NOT NULL,
	CONSTRAINT "holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"leave_type" "leave_type" NOT NULL,
	"entitled_days" numeric(6, 2) NOT NULL,
	"used_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"converted_days" numeric(6, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"payroll_run_id" uuid,
	"kind" "ledger_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "loan_type" NOT NULL,
	"reference" text,
	"principal" numeric(14, 2) NOT NULL,
	"amortization" numeric(14, 2) NOT NULL,
	"deduct_on" "deduct_on" DEFAULT 'every_run' NOT NULL,
	"start_date" date NOT NULL,
	"status" "loan_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loans_amortization_positive" CHECK ("loans"."amortization" > 0)
);
--> statement-breakpoint
CREATE TABLE "min_wages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" text NOT NULL,
	"effective_from" date NOT NULL,
	"non_agriculture_daily" numeric(14, 2) NOT NULL,
	"kasambahay_monthly" numeric(14, 2) NOT NULL,
	"wage_order" text
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "payroll_run_kind" NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"rates_version_id" uuid NOT NULL,
	"contribution_schedule" "contribution_schedule" NOT NULL,
	"thirteenth_mode" text,
	"final_pay_employee_id" uuid,
	"total_gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_net" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_employer_shares" numeric(14, 2) DEFAULT '0' NOT NULL,
	"last_reopen_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payroll_runs_period" CHECK ("payroll_runs"."period_end" >= "payroll_runs"."period_start")
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"computation" jsonb NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"taxable_income" numeric(14, 2) NOT NULL,
	"withholding_tax" numeric(14, 2) NOT NULL,
	"sss_ee" numeric(14, 2) NOT NULL,
	"sss_er" numeric(14, 2) NOT NULL,
	"sss_ec" numeric(14, 2) NOT NULL,
	"sss_mpf_ee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sss_mpf_er" numeric(14, 2) DEFAULT '0' NOT NULL,
	"philhealth_ee" numeric(14, 2) NOT NULL,
	"philhealth_er" numeric(14, 2) NOT NULL,
	"pagibig_ee" numeric(14, 2) NOT NULL,
	"pagibig_er" numeric(14, 2) NOT NULL,
	"basic_earned" numeric(14, 2) NOT NULL,
	"thirteenth_accrual" numeric(14, 2) NOT NULL,
	"thirteenth_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_benefits_exempt_used" numeric(14, 2) NOT NULL,
	"total_deductions" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mfa_passed" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"owner_name" text DEFAULT '' NOT NULL,
	"owner_address" text,
	"owner_tin" text,
	"owner_sss_employer_no" text,
	"owner_philhealth_employer_no" text,
	"owner_pagibig_employer_no" text,
	"pay_frequency" "pay_frequency" DEFAULT 'semi_monthly' NOT NULL,
	"default_region" text DEFAULT 'NCR' NOT NULL,
	"employee_cap" integer DEFAULT 25 NOT NULL,
	"contribution_schedule" "contribution_schedule" DEFAULT 'second_cutoff' NOT NULL,
	"backup_retention_days" integer DEFAULT 30 NOT NULL,
	"smtp" jsonb,
	"setup_completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_cap_positive" CHECK ("settings"."employee_cap" >= 1)
);
--> statement-breakpoint
CREATE TABLE "statutory_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"effective_from" date NOT NULL,
	"data" jsonb NOT NULL,
	"notes" text,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_rates_version_unique" UNIQUE("version"),
	CONSTRAINT "statutory_rates_effective_from_unique" UNIQUE("effective_from")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_deductions" ADD CONSTRAINT "custom_deductions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_deductions" ADD CONSTRAINT "custom_deductions_applied_run_id_payroll_runs_id_fk" FOREIGN KEY ("applied_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependents" ADD CONSTRAINT "dependents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_ledger" ADD CONSTRAINT "loan_ledger_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_ledger" ADD CONSTRAINT "loan_ledger_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_rates_version_id_statutory_rates_id_fk" FOREIGN KEY ("rates_version_id") REFERENCES "public"."statutory_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_final_pay_employee_id_employees_id_fk" FOREIGN KEY ("final_pay_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_employee_date_uq" ON "attendance" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_date_idx" ON "attendance" USING btree ("date");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "custom_deductions_employee_idx" ON "custom_deductions" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "dependents_employee_idx" ON "dependents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "allowances_employee_idx" ON "employee_allowances" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "documents_employee_idx" ON "employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balances_uq" ON "leave_balances" USING btree ("employee_id","year","leave_type");--> statement-breakpoint
CREATE INDEX "loan_ledger_loan_idx" ON "loan_ledger" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "loans_employee_idx" ON "loans" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "min_wages_region_from_uq" ON "min_wages" USING btree ("region","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_regular_uq" ON "payroll_runs" USING btree ("kind","period_start") WHERE "payroll_runs"."kind" IN ('semi_monthly_1', 'semi_monthly_2', 'monthly');--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_employee_uq" ON "payslips" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payslips_employee_idx" ON "payslips" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));