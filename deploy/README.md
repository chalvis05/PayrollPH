# Deploying PayrollPH on an aaPanel server

PayrollPH runs as two Docker containers (`api` and `web`) next to the **server's own
PostgreSQL 18**. aaPanel's Nginx is the only public entry point: it terminates HTTPS and
proxies to the `web` container on `127.0.0.1:8080`, which serves the app and forwards `/api`
to the `api` container.

```
Internet ──HTTPS──▶ aaPanel Nginx (443) ──▶ 127.0.0.1:8080  web (nginx + SPA)
                                                      │ /api
                                                      ▼
                                                     api (Node) ──▶ PostgreSQL 18 on the host
                                                      │                (via host.docker.internal)
                                              volumes: uploads, backups
```

**Before you start:** a Linux VPS with aaPanel, 2 GB RAM or more, a domain whose DNS A record
points at the server, and SSH access as root (or a sudoer).

---

## 1. Install PostgreSQL 18 and create the database

```
aaPanel ▸ App Store ▸ search "PostgreSQL" ▸ PostgreSQL Manager ▸ Install
          ┌──────────────────────────────────────────┐
          │  Version: [ 18.x ▾ ]       [ Submit ]    │
          └──────────────────────────────────────────┘
```

Then create the role and database. Over SSH:

```bash
sudo -u postgres /www/server/pgsql/bin/psql
```

```sql
CREATE ROLE payrollph LOGIN PASSWORD 'choose-a-long-random-password';
CREATE DATABASE payrollph OWNER payrollph;
\q
```

(If PostgreSQL came from your distribution instead of aaPanel, plain `sudo -u postgres psql`
works.) Keep the password: you give it to the deploy script in step 3. Or skip choosing one and
let the script generate it, then run the two SQL lines it prints.

> **Created the database in aaPanel's _Databases_ page instead?** Then it is owned by
> `postgres`, and on PostgreSQL 15+ the app's role may not create anything in it — migrations
> fail with `permission denied for database payrollph`. Hand it over:
>
> ```sql
> ALTER DATABASE payrollph OWNER TO payrollph;
> \c payrollph
> ALTER SCHEMA public OWNER TO payrollph;
> ```

### Let the containers connect

Containers reach the host at the Docker bridge gateway (normally `172.17.0.1`). PostgreSQL must
listen there and allow that network.

```
aaPanel ▸ Databases ▸ PgSQL ▸ Settings (or edit the files below over SSH)
```

`postgresql.conf` (aaPanel: `/www/server/pgsql/data/postgresql.conf`):

```
listen_addresses = 'localhost,172.17.0.1'
```

`pg_hba.conf` (same folder) — add this line above any `reject` lines:

```
host  payrollph  payrollph  172.16.0.0/12  scram-sha-256
```

Restart PostgreSQL (`aaPanel ▸ App Store ▸ PostgreSQL Manager ▸ Restart`, or
`systemctl restart postgresql`). Port 5432 must **not** be opened in the aaPanel firewall:
only the local Docker network needs it.

## 2. Get the code

```bash
cd /www/wwwroot
git clone <your-repository-url> payrollph
cd payrollph
```

## 3. Run the deploy script

Interactive (asks for the domain and owner email):

```bash
POSTGRES_PASSWORD='the-password-from-step-1' ./deploy/deploy.sh
```

Or non-interactive:

```bash
POSTGRES_PASSWORD='the-password-from-step-1' \
  ./deploy/deploy.sh --non-interactive --domain payroll.example.com --admin-email you@example.com
```

What it does, every time (it is safe to re-run):

1. Checks for Docker and the Compose plugin; installs them only if missing (aaPanel's Docker
   app is fine).
2. First run only: copies `.env.example` to `.env` (mode 600) and generates `SESSION_SECRET`,
   `ENCRYPTION_KEY` and, if you did not pass one, `POSTGRES_PASSWORD`. Existing secrets are
   never regenerated.
3. Builds the images, waits until PostgreSQL accepts connections, runs migrations and the
   reference-data seed (rates v1, holidays, minimum wages — no sample employees), then starts
   the containers.
4. Binds the web container to `127.0.0.1:8080` only and prints the aaPanel steps below.

If it cannot reach or log in to PostgreSQL, it prints the exact SQL and `pg_hba.conf` line to
fix it.

> **Back up `.env`** somewhere safe (password manager). `ENCRYPTION_KEY` decrypts the stored
> SSS/PhilHealth/Pag-IBIG/TIN numbers and account numbers; without it they are unreadable,
> even from a database backup.

## 4. Publish it with aaPanel (reverse proxy + SSL)

```
aaPanel ▸ Website ▸ Add site
   ┌───────────────────────────────────────────────────────┐
   │ Domain name:   payroll.example.com                    │
   │ Description:   PayrollPH                              │
   │ Root dir:      /www/wwwroot/payroll.example.com       │
   │ FTP:           [ Not create ]                         │
   │ Database:      [ Not create ]   ← the DB already exists│
   │ PHP version:   [ Static ]                             │
   │                                         [ Submit ]    │
   └───────────────────────────────────────────────────────┘

aaPanel ▸ Website ▸ payroll.example.com ▸ Reverse proxy ▸ Add reverse proxy
   ┌───────────────────────────────────────────────────────┐
   │ Proxy name:   payrollph                               │
   │ Target URL:   http://127.0.0.1:8080                   │
   │ Sent Domain:  $host                                   │
   │                                         [ Submit ]    │
   └───────────────────────────────────────────────────────┘

aaPanel ▸ Website ▸ payroll.example.com ▸ SSL ▸ Let's Encrypt
   ☑ payroll.example.com                     [ Apply ]
   then turn on  [ Force HTTPS ]
```

Recommended additions in `Website ▸ payroll.example.com ▸ Config file`, inside the `server`
block (backup restores upload large files; payroll exports can take a while):

```nginx
client_max_body_size 2g;
proxy_read_timeout 600s;
proxy_send_timeout 600s;
```

Open `https://payroll.example.com/`. You land on the setup wizard: create the owner account.

## 5. Before the first live payroll

- **Settings ▸ Statutory rates:** check every figure in version v1 against the latest SSS,
  PhilHealth, Pag-IBIG and BIR circulars, add a new version if anything changed, then
  **Mark verified**. The dashboard warns until you do.
- **Settings ▸ Statutory rates ▸ Minimum wages:** only NCR is seeded. Add your region.
- **Holidays:** Eid'l Fitr and Eid'l Adha dates are estimates — correct them when proclaimed.
- **My account:** turn on two-factor authentication.
- **Settings ▸ SMTP** if you want to email payslips.

## Day-to-day operations

| Task                                                        | Command                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Update to the latest code (pull, rebuild, migrate, restart) | `./deploy/deploy.sh update`                                           |
| Back up now (also copied to `./backups/`)                   | `./deploy/deploy.sh backup`                                           |
| Restore a backup (replaces ALL data, signs everyone out)    | `./deploy/deploy.sh restore ./backups/payrollph-20261024-020000.dump` |
| Follow logs                                                 | `./deploy/deploy.sh logs` (or `logs api`)                             |
| Containers, health, backup list                             | `./deploy/deploy.sh status`                                           |
| Stop (data is kept)                                         | `./deploy/deploy.sh down`                                             |

**Backups.** A backup runs every night at 02:00 Manila time into the `backups` volume; dumps
older than the retention in Settings (default 30 days) are deleted. You can also back up,
download, delete and restore from **Settings ▸ Backups** in the app. Copy backups off the server
regularly (e.g. aaPanel ▸ Cron ▸ "Backup directory" to remote storage, or download them).

---

## Troubleshooting

**`Bind for 127.0.0.1:8080 failed: port is already allocated`** — something else uses 8080
(another aaPanel site, Tomcat, a second deploy). Pick a free port: set `WEB_PORT=8081` in
`.env`, re-run `./deploy/deploy.sh`, and point the aaPanel reverse proxy at
`http://127.0.0.1:8081`. Find the culprit with `ss -ltnp | grep 8080`.

**`PostgreSQL ... did not become reachable`** — PostgreSQL is not listening on the Docker bridge
or the firewall blocks it. Check `listen_addresses` includes `172.17.0.1`, restart PostgreSQL,
and verify from a container:
`docker run --rm --add-host=host.docker.internal:host-gateway postgres:18-alpine pg_isready -h host.docker.internal`.
If Docker uses a different bridge subnet, `ip -4 addr show docker0` shows the gateway to use.

**`Migrations failed (wrong password or missing database?)`** — `password authentication failed`
means `POSTGRES_PASSWORD` in `.env` differs from the role's password
(`ALTER ROLE payrollph PASSWORD '...'` to match). `no pg_hba.conf entry` means the `host` line
from step 1 is missing or below a `reject` line. `database "payrollph" does not exist` means
step 1 was skipped. `permission denied for database payrollph` (`42501`) means the role does not
own the database — usually because it was created in aaPanel's Databases page; run the
`ALTER DATABASE … OWNER TO` / `ALTER SCHEMA public OWNER TO` lines from step 1. The error line
always names the real cause and the `user@host:port/db` it tried (older versions only showed
`Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`; set `DEBUG=1` for the full stack).

**Permission denied on volumes / backups fail to write** — the API runs as the unprivileged
`node` user (uid 1000). Volumes created by Docker get the right owner automatically. If you
replaced a volume with a bind mount, fix ownership:
`chown -R 1000:1000 /path/to/backups /path/to/uploads`. Backups also need the PostgreSQL 18
client, which the image includes; a `PG_TOOLS_MISSING` error means an outdated image —
run `./deploy/deploy.sh update`.

**502 Bad Gateway in the browser** — the containers are down or still starting.
`./deploy/deploy.sh status`; if `api` is unhealthy, `./deploy/deploy.sh logs api`. A missing
`.env` value shows up there as `Invalid environment: ...`.

**Login works but you are immediately signed out** — the site is being served over plain HTTP.
Session cookies are `Secure`; finish the Let's Encrypt step and turn on Force HTTPS. (For a
throw-away HTTP-only test, `COOKIE_SECURE=false` in `.env` and redeploy.)

**SSL renewal fails** — aaPanel renews Let's Encrypt certificates automatically via its cron
job. Renewal uses HTTP validation on port 80, so keep port 80 open in the firewall and do not
let the reverse proxy capture `/.well-known/acme-challenge/` (aaPanel excludes it by default;
if you edited the proxy config by hand, add
`location ^~ /.well-known/acme-challenge/ { root /www/wwwroot/payroll.example.com; }`).
Check `aaPanel ▸ Website ▸ SSL` for the expiry date and the renewal log.

**`413 Request Entity Too Large` when restoring a backup** — add `client_max_body_size 2g;` to
the site's config (step 4).

**Wrong dates or times** — everything runs in `Asia/Manila`. The containers set `TZ` themselves;
the database session timezone is set by the migrations.

**Updating PostgreSQL** — the app needs PostgreSQL 18 (it uses `pg_dump` 18 for backups). After
a major upgrade of the server's PostgreSQL, rebuild with an image whose client matches.
