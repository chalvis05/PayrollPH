# syntax=docker/dockerfile:1
# PayrollPH API — multi-stage: install + bundle, then a slim runtime with the PG 18 client tools.
# Build from the repo root: docker build -f apps/api/Dockerfile .

FROM node:20-alpine AS base
# argon2 has no musl prebuild, so it compiles during install (build tools stay out of runtime).
RUN apk add --no-cache python3 make g++ \
  && corepack enable && corepack prepare pnpm@12.10.1 --activate \
  && pnpm --version
# (pnpm 12 fetches its native binary on first run; doing it here caches it for every stage.)
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Full install (dev deps included) to bundle the API with esbuild.
FROM base AS build
RUN pnpm install --frozen-lockfile --filter @payrollph/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @payrollph/api build

# Production dependencies only (argon2 builds/links its native binary for musl here).
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @payrollph/api

FROM node:20-alpine AS runtime
# pg_dump/pg_restore must match the server's major version (PostgreSQL 18).
# libstdc++ is needed by argon2's compiled module.
RUN apk add --no-cache postgresql18-client tzdata libstdc++
ENV NODE_ENV=production \
    TZ=Asia/Manila \
    PORT=3000 \
    MIGRATIONS_DIR=/repo/apps/api/drizzle \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/backups
WORKDIR /repo/apps/api
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/drizzle ./drizzle
COPY apps/api/package.json ./
RUN mkdir -p /data/uploads /backups && chown -R node:node /data /backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]
