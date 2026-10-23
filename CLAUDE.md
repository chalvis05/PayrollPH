# PayrollPH — working rules for Claude

Self-hosted PH payroll for personal use (≤25 active employees). Full plan: `PLAN.md`.

## Stack conventions

- pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` (`@payrollph/shared`), `deploy/`.
- TypeScript strict everywhere, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  **No `any`** (ESLint `no-explicit-any: error`). Zero ESLint errors before a commit.
- Shared zod schemas in `packages/shared/src/schemas` drive BOTH the API validation
  (fastify zod type provider → OpenAPI) and the web forms (`zodResolver`). Never redefine a shape locally.
- Money: `NUMERIC(14,2)` in Postgres, `decimal.js` in the engine, 2-dp strings on the wire.
  Never use JS `number` arithmetic for money. Round half-up per line item.
- Time: the app timezone is `Asia/Manila`. Dates are `YYYY-MM-DD` strings in schemas.
  The engine never calls `Date.now()`.
- API: Fastify + Drizzle. Every payroll run state change, edit, delete, and reopen writes `audit_log`
  (actor, before JSON, after JSON). Gov IDs are AES-256-GCM encrypted with `ENCRYPTION_KEY`.
- DB: **PostgreSQL 18**. Production uses the **server's own PostgreSQL 18** (no db container;
  user decision). Local dev/tests use the `postgres:18-alpine` container from
  `docker-compose.override.yml`. pg_dump/pg_restore in the API image must also be v18.
  On this PC a native Postgres holds 5432, so dev commands run with `DB_PORT=5433`.
- Web: Vite + React 18 + Tailwind (class dark mode) + TanStack Query + React Router; mobile-first.
- Don't add features or dependencies outside `PLAN.md` without asking the user.

## RATES ARE DATA, NOT CODE

- No statutory figure (SSS/PhilHealth/Pag-IBIG/BIR/13th ceiling/premium multipliers/
  min wage/kasambahay threshold/leave days) may appear as a literal in engine or API logic.
- The engine takes a `StatutoryRates` object (zod-validated). Figures live only in the
  `statutory_rates` table (versioned by `effective_from`), the single seed file
  `packages/shared/src/seed/ratesV1.ts` (used by the DB seed and the tests), and test-local
  modified copies of it.
- Engine code may only contain structural constants (12 months/year, 60 min/hour, 24 h/day).
- New rates mean a new version row with a new `effective_from`, never an edit to an old one
  that a payroll run used.
- Seed v1 carries `TODO VERIFY` comments; the UI shows a banner until the owner marks it verified.

## Phase / commit rules

- Work one phase at a time, as listed in `PLAN.md`.
- At the end of each phase: run its verification command, paste the **actual fresh output**,
  and only then commit with a conventional message (`feat(scope): ...`).
  Never claim a phase passes without fresh output.
- One commit per phase (fix-ups within a phase are amended into a new commit, not hidden).

## Verification commands

| Phase | Command                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `pnpm --filter @payrollph/shared test && pnpm typecheck && pnpm lint`                                                                               |
| 2     | `docker compose up db -d && pnpm --filter @payrollph/api migrate && pnpm --filter @payrollph/api seed -- --sample`                                  |
| 3     | `pnpm --filter @payrollph/api test`                                                                                                                 |
| 4     | `pnpm --filter @payrollph/web build && pnpm typecheck && pnpm lint`                                                                                 |
| 5     | `./deploy/deploy.sh --non-interactive --domain payroll.test --admin-email you@example.com` then `pnpm --filter @payrollph/web exec playwright test` |

## Status

- [x] Phase 1 — shared engine + schemas (560 tests)
- [x] Phase 2 — schema, migrations, cap trigger, seed (re-verified on PostgreSQL 18)
- [x] Phase 3 — API routes, OpenAPI (62 paths), typed client, 105 route tests
- [ ] Phase 4
- [ ] Phase 5
