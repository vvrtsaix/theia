# syntax=docker/dockerfile:1.7
# Theia API — Node 24 LTS, native TS execution (no transpile step).
#
# Build stages:
#   1. `deps`       — install workspace deps via pnpm w/ frozen lockfile
#   2. `runtime`    — copy node_modules + source, run `node src/main.ts`
#
# Migration job (CMD override): `pnpm --filter @theia/db migrate`. Same
# image, different command — avoids shipping a second image.

ARG NODE_VERSION=24-alpine

# ─── deps ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Enable corepack so the pinned pnpm version in package.json is honored.
RUN corepack enable

# Copy only manifests first for layer cache reuse.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/cluster-entities/package.json packages/cluster-entities/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/otel/package.json packages/otel/
COPY packages/rpc-client/package.json packages/rpc-client/
COPY packages/rpc-server/package.json packages/rpc-server/

# `--frozen-lockfile` ensures CI parity. `--prod=false` keeps devDeps
# (drizzle-kit needed for the migration job entrypoint).
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ─── runtime ───────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

RUN corepack enable

# Copy installed deps + workspace links.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages ./packages

# Workspace source — needed because we run TS via Node's native stripper,
# no build artifact.
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY scripts ./scripts
COPY package.json pnpm-workspace.yaml ./

ENV NODE_ENV=production
EXPOSE 3000

# Drop to non-root for runtime. `node` user ships with the image (uid 1000).
USER node

# Default: API server. Migration job override at deploy: `pnpm db:migrate:prod`.
CMD ["node", "apps/api/src/main.ts"]
