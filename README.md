# PayrollPH

Self-hosted payroll for a household or small private team in the Philippines (up to 25 active
employees by default). Computes pay, premiums, SSS/PhilHealth/Pag-IBIG, BIR withholding,
13th month, final pay and the agency remittance reports — following PH statutory rules, with
every statutory figure kept as versioned data you can verify and update.

> Not affiliated with SSS, PhilHealth, Pag-IBIG or BIR. Verify the bundled rates against the
> latest circulars before your first live payroll (the app reminds you until you do).

## Deploying

See **[deploy/README.md](deploy/README.md)** — one script on an aaPanel (or any Linux) server,
using the server's own PostgreSQL 18:

```bash
./deploy/deploy.sh --non-interactive --domain payroll.example.com --admin-email you@example.com
```

## Repository layout

| Path                   | What                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `packages/shared`      | Zod schemas (used by API validation and web forms) and the pure payroll engine       |
| `apps/api`             | Fastify API, Drizzle schema/migrations, PDFs, reports, backups — docs at `/api/docs` |
| `apps/web`             | Vite + React 18 web app; `e2e/` holds the Playwright smoke test                      |
| `deploy`               | `deploy.sh` and the aaPanel guide                                                    |
| `PLAN.md`, `CLAUDE.md` | Build plan and working rules                                                         |

## Development

Requirements: Node 20+, pnpm 12, Docker.

```bash
pnpm install
cp .env.example .env            # then fill ENCRYPTION_KEY and SESSION_SECRET (openssl rand -hex 32)
docker compose up db -d         # PostgreSQL 18 for development (docker-compose.override.yml)
pnpm --filter @payrollph/api migrate
pnpm --filter @payrollph/api seed -- --sample   # reference data + 22 sample employees
pnpm --filter @payrollph/api dev                # API on :3000
pnpm --filter @payrollph/web dev                # web on :5173 (proxies /api)
```

Checks:

```bash
pnpm --filter @payrollph/shared test   # engine
pnpm --filter @payrollph/api test      # API routes against a throwaway test database
pnpm typecheck && pnpm lint
pnpm --filter @payrollph/api gen:client   # regenerate OpenAPI + web client types after API changes
```

Smoke test against a fresh deployment:

```bash
BASE_URL=http://localhost:8080 pnpm --filter @payrollph/web e2e
```
