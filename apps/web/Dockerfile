# syntax=docker/dockerfile:1
# PayrollPH web — build the Vite app, serve it with nginx, proxy /api to the api service.
# Build from the repo root: docker build -f apps/web/Dockerfile .

FROM node:20-alpine AS build
# pnpm 12 fetches its native binary on first run; do it once in its own cached layer.
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate && pnpm --version
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @payrollph/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @payrollph/web build

FROM nginx:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
