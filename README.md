# Theia

Multi-tenant ticket CRM. Effect-TS v4 + SolidJS + Postgres 18.

See `ARCHITECTURE.md` for the design.

## Stack

- **Backend:** `effect@4.0.0-beta.78` (Cluster + RPC + HttpApi all inside `effect/unstable/*`)
- **Runtime:** Bun (Node 22 fallback)
- **DB:** Postgres 18 with native `uuidv7()`, `@effect/sql-pg`, Drizzle for schema/migrations
- **Tenancy:** row-level (`tenant_id` + RLS, `SET LOCAL` per tx)
- **Auth:** `better-auth` + organizations plugin = tenants
- **Frontend:** SolidJS SPA, Kobalte UI, TanStack Table, Tailwind, `modular-forms`
- **Tracing:** `@effect/opentelemetry` → OTLP → Jaeger / Tempo

## Workflow — contract-first

`packages/domain` is the source of truth. Define Schemas, errors, RPC groups, and cluster messages there **before** implementing handlers. Server, client, DB, and docs all derive from `domain`.

## Effect v4 source reference

Cloned at `~/Workspaces/oss/effect-smol`. Use it (not training data or pre-2026 docs) for every API question.

## Layout

```
apps/                 # api (Effect backend), web (Solid SPA)
packages/
  domain/             # Schemas, errors, RPC groups, cluster messages (Phase 1)
  db/                 # Drizzle schema + migrations (Phase 2)
  auth/               # better-auth + session middleware (Phase 3)
  cluster-entities/   # TicketEntity, TenantEntity (Phase 5)
  rpc-server/         # RPC handler impls (Phase 4)
  rpc-client/         # Generated client for Solid (Phase 6)
  otel/               # OpenTelemetry layer (Phase 7)
```

## Setup (Phase 0 — current)

```bash
pnpm install
pnpm typecheck
```
