# PayrollPH — Implementation Plan

Self-hosted payroll for personal/household use in the Philippines (≤25 active
employees, configurable). Status: **AWAITING APPROVAL** — no code written yet.

---

## 0. Open questions (need answers before / during the noted phase)

| #   | Question                                                                                                                                                                                                           | Blocks  | My default if you don't care                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------- |
| Q1  | Docker is **not installed** on this Windows machine. Phases 2, 3, 5 need Postgres + Docker to verify. Install Docker Desktop (WSL2), or run verification on the VPS?                                               | Phase 2 | You install Docker Desktop; I verify locally.       |
| Q2  | Local Node is v24; spec says Node 20. Images will use `node:20-alpine`; `engines` set to `>=20`. OK?                                                                                                               | Phase 1 | Yes                                                 |
| Q3  | Folder is not a git repo. I'll `git init` (branch `main`) at the start of Phase 1. Remote?                                                                                                                         | Phase 1 | No remote; local commits only                       |
| Q4  | Kasambahay threshold: RA 10361 says ₱5,000/month. DOLE has issued regional kasambahay wage orders since then. Seed ₱5,000 with a TODO to verify?                                                                   | Phase 2 | Yes, seed 5,000 + TODO                              |
| Q5  | Libraries implied by the spec but not named (see §3). OK to add?                                                                                                                                                   | Phase 3 | Yes                                                 |
| Q6  | Host PostgreSQL: should `deploy.sh` create the `payrollph` role + database (needs local superuser `psql`, e.g. aaPanel's `/www/server/pgsql/bin/psql`), or will you create them and put the credentials in `.env`? | Phase 5 | You create them; deploy.sh only checks and migrates |
| Q7  | How the API container reaches host PG: `network_mode: host` (simple, PG stays on 127.0.0.1) or bridge + `host.docker.internal` (needs PG `listen_addresses` + `pg_hba.conf` entry for the Docker subnet)?          | Phase 5 | Bridge + host-gateway, documented pg_hba line       |
| Q8  | Restore from the UI runs `pg_restore --clean` against the shared host server. Keep it, scoped to the `payrollph` database only?                                                                                    | Phase 5 | Yes, scoped to that database                        |

---

## 1. Statutory rates — seed v1 (`effective_from = 2025-01-01`)

These are the figures as I know them. **Every one gets a `// TODO VERIFY`
comment in the seed and a settings-page banner** until you mark v1 as verified.

- **SSS** (RA 11199, 2025 schedule): total 15% (EE 5%, ER 10%); MSC min ₱5,000,
  max ₱35,000, step ₱500; regular SS portion capped at MSC ₱20,000, and the MPF
  (WISP) tier covers ₱20,000.01–₱35,000 at the same EE/ER split; EC (employer
  only) is ₱10 if MSC < ₱15,000, else ₱30.
- **PhilHealth**: 5% premium, floor ₱10,000, ceiling ₱100,000, split 50/50.
- **Pag-IBIG**: EE 1% if monthly comp ≤ ₱1,500, else 2%; ER 2%; max fund salary ₱10,000.
- **BIR TRAIN (2023 onward) annual table**: 0–250k 0%; 250k–400k 15% of excess;
  400k–800k ₱22,500 + 20%; 800k–2M ₱102,500 + 25%; 2M–8M ₱402,500 + 30%;
  over 8M ₱2,202,500 + 35%. Period table = each annual bracket ÷ periods-per-year
  (12 / 24 / 52 / 313).
- **13th month + other benefits exemption ceiling**: ₱90,000; de minimis limits
  stored per type (rice, clothing, medical, etc.) as data.
- **Premium multipliers** (on the hourly rate): OT ordinary 1.25; rest day 1.30;
  special non-working 1.30; special on rest day 1.50; regular holiday 2.00;
  regular holiday on rest day 2.60; double holiday 3.00; OT on any of these = the
  day rate × 1.30; night differential +10% of the applicable rate (22:00–06:00).
- **Leaves**: SIL 5 days after 1 year of service (convertible to cash); maternity 105;
  paternity 7; solo parent 7.
- **Regional minimum wage table**: one row per region (NCR, CAR, I–XIII, BARMM),
  daily rate for non-agriculture plus a kasambahay monthly figure. Seeded with
  known values, all marked TODO VERIFY.

The engine never imports these numbers. It receives a `StatutoryRates` object
(validated by a zod schema). The API loads the version whose `effective_from`
is the latest one on or before the period end date.

---

## 2. Engine design (`packages/shared/src/engine`)

Pure functions only: no I/O, no `Date.now()`. Money uses `decimal.js` inside the
engine and becomes 2-dp strings at the boundary (matches `NUMERIC(14,2)`).
Rounding is half-up to centavos per line item.

- `rates/` — zod `StatutoryRatesSchema` and the TypeScript type.
- `dailyRate.ts` — monthly↔daily↔hourly using the employee's factor (313/261/365/393).
- `earnings.ts` — basic pay per period and pay type; regular-holiday rules
  (monthly/semi-monthly get the additional premium only; daily/hourly get 100% for an
  unworked regular holiday when eligible, i.e. present or on paid leave the
  workday before); undertime/tardiness/absence deductions.
- `premiums.ts` — OT, rest day, special and regular holiday (+OT on each), night differential.
- `sss.ts`, `philhealth.ts`, `pagibig.ts` — return `{ ee, er, ec? }` from monthly
  compensation. Semi-monthly splits are taken on the 2nd cutoff by default
  (configurable: split 50/50 or 2nd cutoff).
- `kasambahay.ts` — if monthly wage < threshold, EE share → 0 and ER pays both.
- `withholding.ts` — period tax from the divided table; `annualize()` gives
  tax due vs. withheld for the year.
- `thirteenth.ts` — accrual = basic earned ÷ 12; exempt up to the ceiling (shared
  with other benefits); excess taxable; mid-year half-payout option.
- `finalPay.ts` — prorated 13th, unused SIL cash conversion, last salary, loan payoff.
- `loans.ts` — amortization schedule and ledger balance.
- `computePayslip.ts` — puts it all together → `PayslipComputation` (lines,
  employer shares, warnings: below minimum wage, missing gov IDs, negative net).

**Tests (Vitest)** cover every premium rule; every BIR bracket boundary (±₱0.01
at each edge, annual and per-period ×4 divisors); SSS MSC min/max/step/MPF
boundary and both EC tiers; PhilHealth floor/ceiling; Pag-IBIG ₱1,500 tier and
cap; kasambahay above/below threshold; the 13th-month ceiling with and without
other benefits; all 4 daily-rate factors; annualization; and the final-pay sample.

---

## 3. Libraries (spec-named + implied)

Named in the spec: Vite, React 18, TS strict, Tailwind, TanStack Query, React Router,
react-hook-form, zod, Fastify, Drizzle, drizzle-kit, argon2, @fastify/rate-limit,
@fastify/helmet, @fastify/swagger, pdfkit, node-cron, Vitest, Playwright, ESLint, Prettier.

**Implied by features (Q5):** `decimal.js` (money math), `@fastify/cookie` +
`@fastify/session`-style signed cookie sessions stored in Postgres,
`@fastify/csrf-protection`, `@fastify/multipart` (CSV import, document
uploads, restore), `@fastify/swagger-ui`, `fastify-type-provider-zod`,
`otplib` + `qrcode` (TOTP), `nodemailer` (SMTP), `archiver` (batch payslip zip),
`csv-parse`/`csv-stringify`, `openapi-typescript` + `openapi-fetch` (typed
client), `@hookform/resolvers`, `postgres` (driver), `tsx` (dev runner).

---

## 4. File tree (target)

```
PayrollPH/
├─ CLAUDE.md  PLAN.md  README.md  package.json  pnpm-workspace.yaml
├─ tsconfig.base.json  eslint.config.js  .prettierrc  .editorconfig  .gitignore
├─ .env.example  docker-compose.yml
├─ packages/shared/
│  ├─ package.json (@payrollph/shared)  tsconfig.json  vitest.config.ts
│  └─ src/
│     ├─ index.ts
│     ├─ money.ts
│     ├─ schemas/        employee.ts attendance.ts payroll.ts rates.ts
│     │                  loan.ts deduction.ts settings.ts auth.ts report.ts
│     ├─ seed/ratesV1.ts the ONLY place v1 figures live (DB seed + tests import it)
│     └─ engine/         dailyRate.ts earnings.ts premiums.ts sss.ts philhealth.ts
│                        pagibig.ts contributions.ts (incl. kasambahay) withholding.ts
│                        thirteenth.ts leaves.ts finalPay.ts loans.ts computePayslip.ts
│        └─ __tests__/   one *.test.ts per module
├─ apps/api/
│  ├─ package.json (@payrollph/api)  tsconfig.json  vitest.config.ts  drizzle.config.ts
│  ├─ Dockerfile
│  ├─ drizzle/           generated SQL migrations (+ custom cap trigger)
│  └─ src/
│     ├─ server.ts  app.ts  env.ts
│     ├─ db/             schema.ts client.ts migrate.ts seed.ts seed-data/
│     │                  (holidays-2026.ts, rates-v1.ts, employees.ts, min-wage.ts)
│     ├─ lib/            crypto.ts (AES-256-GCM) audit.ts session.ts totp.ts
│     │                  pdf/payslip.ts pdf/report.ts mailer.ts backup.ts csv.ts
│     ├─ plugins/        auth.ts csrf.ts security.ts swagger.ts
│     ├─ routes/         setup auth users employees attendance holidays payroll
│     │                  payslips loans deductions reports settings rates backups audit
│     ├─ services/       payrollRun.ts finalPay.ts reports/*.ts
│     ├─ jobs/           nightlyBackup.ts
│     └─ __tests__/      route tests (one file per route group) + testDb.ts
├─ apps/web/
│  ├─ package.json (@payrollph/web)  tsconfig.json  vite.config.ts
│  ├─ tailwind.config.ts  index.html  Dockerfile  nginx.conf
│  ├─ e2e/smoke.spec.ts  playwright.config.ts
│  └─ src/
│     ├─ main.tsx  App.tsx  router.tsx
│     ├─ api/            client.ts  schema.d.ts (generated)  hooks/*.ts
│     ├─ components/     layout, forms, tables, RatesVerifyBanner, ThemeToggle
│     └─ pages/          Setup Login Dashboard Employees EmployeeForm Attendance
│                        Holidays PayrollRuns PayrollRunDetail FinalPay Loans
│                        Deductions Reports Settings Rates Backups Audit Users
└─ deploy/
   ├─ deploy.sh  README.md
   └─ scripts/          wait-for-db.sh backup.sh restore.sh
```

---

## 5. Data model (Phase 2 summary)

`users` (role owner|viewer, argon2 hash, totp_secret enc), `sessions`,
`audit_log` (actor, action, entity, entity_id, before jsonb, after jsonb, at),
`settings` (singleton: owner info, pay schedule, employee_cap, smtp enc,
rates_verified flag), `statutory_rates` (version, effective_from, data jsonb validated
by the shared zod schema, notes), `min_wages` (region, effective_from, daily,
kasambahay_monthly), `holidays` (date, name, type regular|special_non_working|special_working),
`employees` (gov IDs and account numbers as AES-256-GCM text `v1.iv.tag.ct`, employment_type, pay_type,
base_rate NUMERIC(14,2), daily_factor 313|261|365|393, region, rest_days,
hire/separation dates, status, bank/GCash), `employee_allowances` (taxable |
de_minimis + de-minimis type), `dependents`, `employee_documents` (file on the
uploads volume), `attendance` (per day: hours by category, undertime, tardy
minutes, absent, leave type), `leave_balances`, `payroll_runs` (period, kind
semi_monthly_1|semi_monthly_2|monthly|final_pay|thirteenth, status
draft|review|approved|paid, rates_version_id, reopen_reason),
`payslips` (frozen engine output as jsonb + denormalised totals for reports/YTD),
`loans` (sss|pagibig|company|cash_advance) + `loan_ledger`, `custom_deductions`.
13th-month accruals are read from `payslips.thirteenth_accrual`; backups are listed from
the backups volume (no tables).

**Employee cap:** an app-layer check plus a Postgres `BEFORE INSERT OR UPDATE`
trigger on `employees` that counts `status='active'` rows and compares them
to `settings.employee_cap` (advisory-locked so concurrent inserts can't both pass). It
raises `P0001 'EMPLOYEE_CAP_EXCEEDED'`, which the API maps to a clear 409 error. A second
trigger stops the cap being lowered below the current active count. All money columns are `NUMERIC(14,2)`, and the DB
session timezone is `Asia/Manila`.

---

## 6. Phases

### Phase 1 — Monorepo skeleton + `/packages/shared` (schemas + engine + tests)

- `git init`, pnpm workspace, tsconfig base (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), ESLint (`no-explicit-any: error`) + Prettier.
- Zod schemas for every entity / request body (shared by API + web).
- Engine modules + full Vitest suite (§2), using a test fixture of rates v1.
- **Verify:** `pnpm --filter @payrollph/shared test && pnpm typecheck` (+ `pnpm lint`)
- **Commit:** `feat(shared): payroll engine, zod schemas, and tests`

### Phase 2 — DB schema, migrations, seed

- Drizzle schema, drizzle-kit migrations, a custom SQL migration for the cap trigger.
- `docker-compose.yml` with the `db` service only, enough for this phase.
- Seed: settings, statutory_rates v1, min_wages, 2026 PH holidays (regular +
  special; proclamation-dependent dates like Eid flagged TODO), and 22 employees
  covering every pay type × employment type, including at least 2 kasambahay
  (one below threshold, one above) and a mix of 313/261/365/393 factors.
- `seed` always loads reference data (settings, rates v1, holidays, min wages) and is
  idempotent. The 22 sample employees load only with `--sample`, so `deploy.sh` never puts
  fake staff on the production server.
- **Verify:** `docker compose up db -d && pnpm --filter @payrollph/api migrate && pnpm --filter @payrollph/api seed -- --sample`
- **Commit:** `feat(api): database schema, migrations, and seed data`

### Phase 3 — API routes + OpenAPI + typed client

- Fastify app, zod type provider (shared schemas → validation + OpenAPI), Swagger UI at `/api/docs`.
- Auth: setup wizard (only works while no owner exists), login, logout, TOTP enroll/verify,
  viewer users, CSRF on mutating routes, rate limit on auth, helmet.
- Audit middleware/service on payroll run state changes, edits, deletes, reopen.
- Every route group from §4; payroll run state machine; final-pay service; PDF payslips,
  batch zip, SMTP send; reports (CSV + PDF); backups (pg_dump/pg_restore via the
  `postgresql18-client` in the API image — pg_dump must match the server major) + node-cron nightly job with 30-day retention.
- `pnpm --filter @payrollph/api gen:openapi` writes `openapi.json`, and
  `pnpm --filter @payrollph/web gen:client` runs `openapi-typescript`.
- Route tests: Vitest + `app.inject()` against a `payrollph_test` database (migrated fresh per run).
- **Verify:** `pnpm --filter @payrollph/api test`
- **Commit:** `feat(api): REST routes, OpenAPI docs, and typed client`

### Phase 4 — Web UI

- Vite + React 18 + Tailwind (class-based dark mode, toggle + system default), mobile-first layout.
- Pages from §4; forms use react-hook-form + `zodResolver(sharedSchema)`.
- Payroll review screen: per-employee breakdown, warnings, approve / mark paid / reopen (reason modal).
- Rates-unverified banner on Settings and Dashboard until rates v1 is marked verified.
- **Verify:** `pnpm --filter @payrollph/web build && pnpm typecheck` (+ `pnpm lint`)
- **Commit:** `feat(web): payroll web UI`

### Phase 5 — Docker, deploy.sh, README, smoke test

- Multi-stage Dockerfiles (api: node:20-alpine build → runtime with pg client;
  web: build → nginx:alpine serving `dist` and proxying `/api` → `api:3000`).
- Compose (production): `api` (`backups` + `uploads` volumes) and `web` bound to `127.0.0.1:8080`
  only. **No `db` container: the API uses the server's own PostgreSQL 18** (user decision,
  replacing the spec's compose `db` service). The dev-only PG 18 container lives in
  `docker-compose.override.yml`, which `deploy.sh` never loads (`-f docker-compose.yml`).
- `deploy.sh` step 3 becomes: check the host PG is reachable (`pg_isready`), then migrate + seed;
  there is no db healthcheck to wait on. pg_dump/pg_restore v18 in the API image connect to it.
- Open questions to settle before Phase 5 (see §0 Q6–Q8).
- `deploy/deploy.sh` per spec (idempotent, `set -euo pipefail`, `--non-interactive`,
  `--domain`, `--admin-email`, subcommands update|backup|restore|logs|down|status).
- `deploy/README.md`: aaPanel walkthrough (screens as text) + troubleshooting.
- Playwright smoke test: setup wizard → add employee → run payroll → download the payslip PDF
  and check it is a PDF.
- **Verify:** on a clean copy of the commit, against a freshly created role + database on the
  server's PostgreSQL 18 (passed as `POSTGRES_USER/DB/PASSWORD`, `DB_PORT`):
  `./deploy/deploy.sh --non-interactive --domain payroll.test --admin-email you@example.com`,
  then `BASE_URL=http://localhost:8080 pnpm --filter @payrollph/web exec playwright test`.
  Also exercised: `status`, `backup` (real pg_dump 18), `restore --yes`, idempotent re-run.
- **Commit:** `feat(deploy): docker images, aaPanel deploy script, and smoke test`

---

## 7. Parallelism (after Phase 1 is approved)

- Phase 1: one subagent writes the engine tests from §2 while I write the engine (TDD pairing).
- Phases 3 + 4: the API routes and the web scaffold (layout, router, theme, form components) run
  in parallel. Web pages wire to the generated client once Phase 3 is done.
- Phase 5: deploy.sh/README can be drafted alongside Phase 4.

## 8. Explicitly out of scope

BIR eFPS / Alphalist e-submission, multi-company support, employee self-service
portal, and anything not listed in the spec.
