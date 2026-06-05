# Theia

Multi-tenant ticket CRM. Effect-TS v4 + SolidJS + Postgres 18.

See `ARCHITECTURE.md` for the design and `CLAUDE.md` for AI-agent guidance.

## Stack

- **Backend:** `effect@4.0.0-beta.78` — Cluster + RPC + HttpApi all live in `effect/unstable/*`.
- **Runtime:** Bun (Node 22 fallback).
- **DB:** Postgres 18 (native `uuidv7()`), `postgres-js` driver, Drizzle for schema/migrations and all queries.
- **Tenancy:** row-level — `tenant_id` column + Postgres RLS, `SET LOCAL app.tenant_id` per transaction via `Database.tx`.
- **Auth:** `better-auth` + `organization` plugin (tenants) + `dynamicAccessControl` (per-tenant runtime roles).
- **Frontend:** SolidJS SPA — `@solidjs/router`, `@kobalte/core`, `@tanstack/solid-table`, Tailwind v4, `lucide-solid`.
- **Tracing:** `@effect/opentelemetry` → OTLP collector → Jaeger (local) / Tempo (prod).

## Workflow — contract-first

`packages/domain` is the **source of truth**. Define Schemas, errors, events, RPC groups, and cluster messages there **before** implementing handlers. Server, client, DB, and docs all derive from `domain`.

## Effect v4 source reference

Clone `Effect-TS/effect-smol` at `~/Workspaces/oss/effect-smol`. Grep there (not training data or pre-2026 docs) for every v4 API question.

## Layout

```
apps/
  api/                 Bun-runtime backend entrypoint (Phase 7 boundary — see "Current state" below)
  web/                 Solid SPA — Vite, Tailwind, Kobalte, TanStack Table
packages/
  domain/              Branded IDs, entities, errors, events, RPC groups, cluster messages (Phase 1)
  db/                  Drizzle schema + migrations + tenant-bound tx runtime (Phase 2)
  auth/                better-auth instance + access control + Effect session middleware (Phase 3)
  rpc-server/          @effect/rpc handlers, Drizzle queries inside Database.tx (Phase 4)
  cluster-entities/    TicketEntity actor — state machine, event log, participants (Phase 5)
  rpc-client/          Browser typed RPC client (Phase 6)
  otel/                @effect/opentelemetry layer (Phase 7)
infra/
  docker-compose.yaml  Postgres 18 + OTel collector + Jaeger
  00-bootstrap.sql     CREATE ROLE app_user (NOBYPASSRLS) + Pg18 version check
  otel-collector.yaml
```

## Run

```bash
# 0. Prereqs: Docker, pnpm 10+, Bun (or Node 22).

# 1. Start Postgres 18 + OTel collector + Jaeger.
docker compose -f infra/docker-compose.yaml up -d

# 2. Install deps.
pnpm install

# 3. Apply DB migrations (schema + RLS + system_config seed + LISTEN/NOTIFY + pg_trgm).
DATABASE_URL=postgres://theia:theia@localhost:5432/theia \
  pnpm --filter @theia/db migrate

# 4. Typecheck + parity test (sanity).
pnpm typecheck
pnpm --filter @theia/db test

# 5. Start API process (currently holds open; HTTP wiring = Phase 7.x).
DATABASE_URL=postgres://theia:theia@localhost:5432/theia \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces \
  pnpm --filter @theia/api dev

# 6. Start Solid SPA (separate terminal).
pnpm --filter @theia/web dev
```

## Endpoints

| Service | URL |
| --- | --- |
| Web SPA | http://localhost:5173 |
| Jaeger UI | http://localhost:16686 |
| OTLP collector | http://localhost:4318 |
| Postgres | localhost:5432 (user `theia` / pass `theia` / db `theia`) |

## Current state

Phases 0–9 per `ARCHITECTURE.md` are committed.

✅ **Works end-to-end now:**
- DB schema + RLS + Workflow seed (5 migrations apply cleanly).
- `pnpm typecheck` clean across root + apps/api + apps/web.
- Drizzle parity test 11/11.
- Web SPA dev server renders shell + login form.
- TicketEntity Behavior with all 14 handlers (atomic ticket+event+participant writes).

⚠️ **Boundary work remaining:**
- `apps/api/src/main.ts` does not yet mount an HTTP server. The `effect/unstable/http` API is moving between betas; Phase 7.x wires `BunHttpServer` + `RpcServer.layerHttp` + `auth.handler`.
- `ticket.open` RPC handler dies at runtime — caller needs to construct the `<tenantId>:<ticketId>` entity address. Phase 5.x.
- `Pg LISTEN/NOTIFY` → `Stream` consumer for real-time `SubscribeEvents` — Phase 8.x (in-memory channel + decoder are wired).

## Conventions

- **Drizzle query builder** for all DB access; raw `sql\`...\`` reserved for `SET LOCAL` and ops Drizzle can't express. See CLAUDE.md.
- **Node subpath imports** (`#name` in each package's `package.json` `imports`) for intra-package paths; never `../*.js`.
- **Contract-first**: domain PRs land before any handler/db/UI work that consumes them.
- **`InfrastructureError`** in every RPC error union — handlers map `SqlError` / cluster errors at the boundary.
