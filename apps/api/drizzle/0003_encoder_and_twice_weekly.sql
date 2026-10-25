CREATE TYPE "public"."change_request_kind" AS ENUM('create', 'update');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pay_schedule" AS ENUM('standard', 'twice_weekly');--> statement-breakpoint
ALTER TYPE "public"."payroll_run_kind" ADD VALUE 'twice_weekly';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'encoder';--> statement-breakpoint
CREATE TABLE "employee_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "change_request_kind" NOT NULL,
	"employee_id" uuid,
	"status" "change_request_status" DEFAULT 'pending' NOT NULL,
	"payload_enc" text NOT NULL,
	"summary" jsonb NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result_employee_id" uuid
);
--> statement-breakpoint
DROP INDEX "payroll_runs_regular_uq";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_schedule" "pay_schedule" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_result_employee_id_employees_id_fk" FOREIGN KEY ("result_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_requests_status_idx" ON "employee_change_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "change_requests_one_pending_uq" ON "employee_change_requests" USING btree ("employee_id") WHERE "employee_change_requests"."status" = 'pending' AND "employee_change_requests"."employee_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_regular_uq" ON "payroll_runs" USING btree ("kind","period_start") WHERE "payroll_runs"."kind" NOT IN ('thirteenth_month', 'final_pay');