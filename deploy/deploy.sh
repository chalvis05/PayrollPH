#!/usr/bin/env bash
# PayrollPH one-command deploy for an aaPanel (or any Linux) server.
#
#   ./deploy/deploy.sh                      first install / redeploy (interactive)
#   ./deploy/deploy.sh --non-interactive --domain payroll.example.com --admin-email me@example.com
#   ./deploy/deploy.sh update               git pull, rebuild, migrate, restart
#   ./deploy/deploy.sh backup               make a backup now (copied to ./backups/ too)
#   ./deploy/deploy.sh restore <file>       restore a .dump (path on this server, or a name in the volume)
#   ./deploy/deploy.sh logs [api|web]       follow logs
#   ./deploy/deploy.sh down                 stop the stack (volumes and data are kept)
#   ./deploy/deploy.sh status               containers, health, backups
#
# PostgreSQL 18 is the SERVER'S OWN database, not a container. Create the role and database
# first (see deploy/README.md); this script checks the connection and prints exact steps if it
# cannot connect. Safe to run repeatedly: existing secrets in .env are never regenerated.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROJECT="${COMPOSE_PROJECT_NAME:-payrollph}"
ENV_FILE="$ROOT/.env"
# Git Bash on Windows rewrites /paths in arguments; container paths must stay as written, so
# turn that off and convert host paths explicitly with host_path (a no-op on Linux).
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) export MSYS_NO_PATHCONV=1 ;; esac
host_path() {
  if [[ -n "${MSYS_NO_PATHCONV:-}" ]] && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s
' "$1"
  fi
}

# ------------------------------------------------------------------ output helpers
if [[ -t 1 ]]; then
  BOLD=$'\e[1m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' RESET=$'\e[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi
info() { printf '%s==>%s %s\n' "$GREEN$BOLD" "$RESET" "$*"; }
warn() { printf '%s!!%s %s\n' "$YELLOW$BOLD" "$RESET" "$*" >&2; }
die() {
  printf '%sxx%s %s\n' "$RED$BOLD" "$RESET" "$*" >&2
  exit 1
}

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }

# ------------------------------------------------------------------ arguments
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"
ASSUME_YES=0
COMMAND="deploy"
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --domain) DOMAIN="${2:?--domain needs a value}"; shift ;;
    --domain=*) DOMAIN="${1#*=}" ;;
    --admin-email) ADMIN_EMAIL="${2:?--admin-email needs a value}"; shift ;;
    --admin-email=*) ADMIN_EMAIL="${1#*=}" ;;
    -h | --help) usage; exit 0 ;;
    deploy | update | backup | restore | logs | down | status) COMMAND="$1" ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

compose() { docker compose -p "$PROJECT" -f "$(host_path "$ROOT/docker-compose.yml")" "$@"; }

# ------------------------------------------------------------------ .env helpers
env_get() {
  [[ -f "$ENV_FILE" ]] || return 0
  awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

# Set KEY=VALUE in .env (replace or append) without sed escaping pitfalls.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -F= -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $1 == k { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" >"$tmp"
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

ask() {
  # ask VAR "Question" [default]
  local var="$1" question="$2" default="${3:-}" answer
  if [[ "$NON_INTERACTIVE" == 1 ]]; then
    [[ -n "$default" ]] || die "$var is required in --non-interactive mode (flag or environment variable)."
    printf -v "$var" '%s' "$default"
    return
  fi
  read -r -p "$question${default:+ [$default]}: " answer
  printf -v "$var" '%s' "${answer:-$default}"
  [[ -n "${!var}" ]] || die "$var is required."
}

# ------------------------------------------------------------------ 1. Docker
ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    [[ "$(uname -s)" == Linux ]] || die "Docker is not installed. Install Docker Desktop, then re-run."
    [[ "$(id -u)" == 0 ]] || die "Docker is not installed. Re-run as root (sudo) so it can be installed."
    info "Installing Docker Engine (get.docker.com)…"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  if ! docker compose version >/dev/null 2>&1; then
    [[ "$(uname -s)" == Linux && "$(id -u)" == 0 ]] ||
      die "The Docker Compose plugin is missing. Install docker-compose-plugin, then re-run."
    info "Installing the Docker Compose plugin…"
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -qq && apt-get install -y -qq docker-compose-plugin
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y -q docker-compose-plugin
    elif command -v yum >/dev/null 2>&1; then
      yum install -y -q docker-compose-plugin
    else
      die "Cannot install the Compose plugin automatically on this system."
    fi
  fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not running (or you lack permission). Start it / use sudo."
  info "Docker $(docker version --format '{{.Server.Version}}'), $(docker compose version --short)"
}

# ------------------------------------------------------------------ 2. .env
init_env() {
  local created=0
  if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$ROOT/.env.example" ]] || die ".env.example is missing."
    cp "$ROOT/.env.example" "$ENV_FILE"
    created=1
    info "Created .env from .env.example"
  fi
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."

  # Secrets: generate once, never overwrite (rotating ENCRYPTION_KEY would lose gov IDs).
  [[ -n "$(env_get SESSION_SECRET)" ]] || env_set SESSION_SECRET "$(openssl rand -hex 32)"
  [[ -n "$(env_get ENCRYPTION_KEY)" ]] || env_set ENCRYPTION_KEY "$(openssl rand -hex 32)"

  # Database credentials for the server's PostgreSQL. Environment variables win on first run
  # (e.g. when you already created the role); otherwise a strong password is generated for the
  # role you will create.
  if [[ "$created" == 1 ]]; then
    env_set POSTGRES_USER "${POSTGRES_USER:-payrollph}"
    env_set POSTGRES_DB "${POSTGRES_DB:-payrollph}"
    env_set POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-$(openssl rand -hex 24)}"
    env_set DB_PORT "${DB_PORT:-5432}"
    [[ -z "${DB_HOST:-}" ]] || env_set DB_HOST "$DB_HOST"
  fi
  local pw
  pw="$(env_get POSTGRES_PASSWORD)"
  if [[ -z "$pw" || "$pw" == change-me ]]; then env_set POSTGRES_PASSWORD "$(openssl rand -hex 24)"; fi

  local current_domain current_email
  current_domain="$(env_get DOMAIN)"
  current_email="$(env_get ADMIN_EMAIL)"
  [[ "$current_domain" == payroll.example.com ]] && current_domain=""
  [[ "$current_email" == owner@example.com ]] && current_email=""
  if [[ -n "${DOMAIN:-}" ]]; then env_set DOMAIN "$DOMAIN"; elif [[ -z "$current_domain" ]]; then
    ask DOMAIN "Domain for PayrollPH (e.g. payroll.example.com)"
    env_set DOMAIN "$DOMAIN"
  fi
  if [[ -n "${ADMIN_EMAIL:-}" ]]; then env_set ADMIN_EMAIL "$ADMIN_EMAIL"; elif [[ -z "$current_email" ]]; then
    ask ADMIN_EMAIL "Owner email (pre-filled in the setup wizard)"
    env_set ADMIN_EMAIL "$ADMIN_EMAIL"
  fi
}

# ------------------------------------------------------------------ 3. database
db_help() {
  local user db port
  user="$(env_get POSTGRES_USER)"
  db="$(env_get POSTGRES_DB)"
  port="$(env_get DB_PORT)"
  cat >&2 <<EOF

${BOLD}PayrollPH could not use the server's PostgreSQL 18.${RESET} Do this once, then re-run:

  1. Create the role and database (password is POSTGRES_PASSWORD in $ENV_FILE):
       sudo -u postgres psql -p ${port:-5432}
       CREATE ROLE ${user:-payrollph} LOGIN PASSWORD '<POSTGRES_PASSWORD from .env>';
       CREATE DATABASE ${db:-payrollph} OWNER ${user:-payrollph};
     (aaPanel's PostgreSQL client is usually /www/server/pgsql/bin/psql.)

  2. Let the Docker bridge network connect. In postgresql.conf:
       listen_addresses = 'localhost,172.17.0.1'
     and in pg_hba.conf:
       host  ${db:-payrollph}  ${user:-payrollph}  172.16.0.0/12  scram-sha-256
     then restart PostgreSQL (aaPanel → Databases → PgSQL → restart).

  3. If the firewall blocks it, allow 172.16.0.0/12 → port ${port:-5432}.

EOF
}

wait_for_db() {
  local host port user db
  host="$(env_get DB_HOST)"
  host="${host:-host.docker.internal}"
  port="$(env_get DB_PORT)"
  user="$(env_get POSTGRES_USER)"
  db="$(env_get POSTGRES_DB)"
  info "Waiting for PostgreSQL at $host:${port:-5432}…"
  for _ in $(seq 1 30); do
    if compose run --rm --no-deps -T api pg_isready -q -h "$host" -p "${port:-5432}" -U "$user" -d "$db" >/dev/null 2>&1; then
      info "PostgreSQL is accepting connections."
      return 0
    fi
    sleep 2
  done
  db_help
  die "PostgreSQL at $host:${port:-5432} did not become reachable."
}

migrate_and_seed() {
  info "Running database migrations…"
  compose run --rm --no-deps -T api node dist/migrate.js || {
    db_help
    die "Migrations failed (wrong password or missing database?)."
  }
  info "Seeding reference data (idempotent; no sample employees)…"
  compose run --rm --no-deps -T api node dist/seed.js
}

wait_for_health() {
  local port url
  port="$(env_get WEB_PORT)"
  url="http://127.0.0.1:${port:-8080}/api/health"
  info "Waiting for $url…"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1 || wget -qO- "$url" >/dev/null 2>&1; then
      info "PayrollPH is up."
      return 0
    fi
    sleep 2
  done
  compose ps >&2
  die "The app did not become healthy. Check: ./deploy/deploy.sh logs"
}

print_aapanel_steps() {
  local domain port
  domain="$(env_get DOMAIN)"
  port="$(env_get WEB_PORT)"
  cat <<EOF

${BOLD}PayrollPH is running on http://127.0.0.1:${port:-8080} (this server only).${RESET}
Publish it through aaPanel's Nginx:

  1. aaPanel → Website → Add site → Domain: ${domain}  (PHP: Static, no database)
  2. Site → Reverse proxy → Add → Target URL: http://127.0.0.1:${port:-8080}  → Save
  3. Site → SSL → Let's Encrypt → select ${domain} → Apply → turn on "Force HTTPS"
  4. Open https://${domain}/ and complete the setup wizard.

Before the first live payroll: Settings → Statutory rates → verify every figure against the
latest SSS, PhilHealth, Pag-IBIG and BIR circulars, then mark the version verified.
EOF
}

# ------------------------------------------------------------------ commands
cmd_deploy() {
  ensure_docker
  init_env
  info "Building images…"
  compose build
  wait_for_db
  migrate_and_seed
  info "Starting containers…"
  compose up -d --remove-orphans
  wait_for_health
  print_aapanel_steps
}

cmd_update() {
  ensure_docker
  [[ -f "$ENV_FILE" ]] || die "No .env yet. Run ./deploy/deploy.sh first."
  if [[ -d "$ROOT/.git" ]]; then
    info "Pulling the latest code…"
    git -C "$ROOT" pull --ff-only
  else
    warn "Not a git checkout; rebuilding the current files."
  fi
  init_env
  compose build
  wait_for_db
  migrate_and_seed
  compose up -d --remove-orphans
  wait_for_health
}

cmd_backup() {
  info "Creating a backup…"
  local out name
  out="$(compose exec -T api node dist/backup.js create)"
  printf '%s\n' "$out"
  name="$(printf '%s\n' "$out" | sed -n 's/^Created \(payrollph-[0-9]*-[0-9]*\.dump\).*/\1/p')"
  if [[ -n "$name" ]]; then
    mkdir -p "$ROOT/backups"
    compose cp "api:/backups/$name" "$(host_path "$ROOT/backups/$name")"
    info "Copied to $ROOT/backups/$name — keep a copy off this server too."
  fi
}

cmd_restore() {
  local src="${ARGS[0]:-}" name
  [[ -n "$src" ]] || die "Usage: ./deploy/deploy.sh restore <file.dump>"
  name="$(basename "$src")"
  [[ "$name" =~ ^payrollph-[0-9]{8}-[0-9]{6}\.dump$ ]] ||
    die "Backup files are named payrollph-YYYYMMDD-HHMMSS.dump (got $name). Rename it to match."
  if [[ -f "$src" ]]; then
    info "Copying $src into the backups volume…"
    compose cp "$(host_path "$src")" "api:/backups/$name"
  fi
  if [[ "$ASSUME_YES" != 1 ]]; then
    [[ "$NON_INTERACTIVE" == 1 ]] && die "Restoring needs --yes in --non-interactive mode."
    warn "This REPLACES ALL DATA in the PayrollPH database with $name and signs everyone out."
    local answer
    read -r -p "Type RESTORE to continue: " answer
    [[ "$answer" == RESTORE ]] || die "Cancelled."
  fi
  compose exec -T api node dist/backup.js restore "$name"
}

cmd_logs() { compose logs -f --tail=200 "${ARGS[@]}"; }

cmd_down() {
  compose down
  info "Stopped. Your data is safe: it lives in PostgreSQL and the uploads/backups volumes."
}

cmd_status() {
  compose ps
  local port
  port="$(env_get WEB_PORT)"
  if curl -fsS "http://127.0.0.1:${port:-8080}/api/health" >/dev/null 2>&1; then
    info "Health: OK"
  else
    warn "Health: not responding on 127.0.0.1:${port:-8080}"
  fi
  compose exec -T api node dist/backup.js list || true
}

case "$COMMAND" in
  deploy) cmd_deploy ;;
  update) cmd_update ;;
  backup) cmd_backup ;;
  restore) cmd_restore ;;
  logs) cmd_logs ;;
  down) cmd_down ;;
  status) cmd_status ;;
esac
