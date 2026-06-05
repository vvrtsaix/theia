# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Theia — multi-tenant ticket CRM. **Effect-TS v4** backend + **SolidJS** SPA + **Postgres 18** + **OpenTelemetry**. Read `ARCHITECTURE.md` before making non-trivial changes — it carries the locked decisions, package map, and 10-phase plan.

## Commands

```bash
pnpm install           # install all workspace deps
pnpm typecheck         # tsc -b across all packages (uses project refs)
pnpm lint              # biome check .
pnpm lint:fix          # biome check --write .
pnpm format            # biome format --write .
pnpm test              # all package tests (vitest via @effect/vitest)
pnpm build             # tsc -b for emit-enabled packages
```

Per-package: `pnpm --filter @theia/<name> <script>`. Single test (once apps exist): `pnpm --filter @theia/<name> vitest run path/to.test.ts`.

## Stack — non-negotiable

- **Effect v4 (`effect@4.0.0-beta.78`)** pinned via pnpm `catalog:` across every package. Do NOT mix v3 + v4. Source of truth: `~/Workspaces/oss/effect-smol` (cloned). Grep there for any API question — training data is unreliable for v4.
- **Cluster, RPC, HttpApi, SQL, OTel core all live in `effect/unstable/*`** — there is **no** `@effect/cluster` or `@effect/rpc` package in v4.
- **Postgres 18** with native `uuidv7()` for time-ordered primary keys.
- **Bun** is the runtime. Node 22 is a fallback. Vitest + `@effect/vitest@beta` for tests.

## Architecture — what you have to know

### Contract-first

`packages/domain` is the **source of truth**. Schemas, errors, RPC groups, and cluster messages are defined there before any handler / DB / UI work. The dependency graph fans out from `domain`:

```
domain → db, auth, cluster-entities, rpc-server, rpc-client → apps/api, apps/web
```

A feature lands as: **domain PR** (Schema + error + RPC contract + cluster message) → **impl PRs** consuming those contracts. Never the other way around.

### Multi-tenancy (Row-Level Security)

Every tenant-scoped table carries `tenant_id uuid not null`. Postgres RLS policy: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. Every request begins a tx with `SET LOCAL app.tenant_id = $1`. The app **also** filters by `tenant_id` in queries — RLS is the backstop, not the only line.

`tenants`, `users`, `sessions`, `accounts` (better-auth-owned) have **no** `tenant_id` and **no** RLS.

### Cluster + Actor pattern

Each long-lived stateful aggregate is an `Entity` (`effect/unstable/cluster`). An entity = a set of `Rpc.make(...)` definitions packaged via `Entity.make(type, [rpcs])`. The handler layer holds in-memory state (Ref/SubscriptionRef). Cluster handles routing, mailbox serialization, passivation.

- `TicketEntity` — one actor per ticket. Owns the status state machine. Emits `TicketEvent` to the event log + cluster pub/sub.
- `TenantEntity` — one actor per tenant. Presence, settings, broadcast.

State-mutating messages are annotated `ClusterSchema.Persisted = true` so they survive runner crashes.

Single-node MVP: `BunClusterSocket.layer()` + `@effect/sql-pg` for `MessageStorage`. Tests: `TestRunner.layer`.

### RPC transport

`effect/unstable/rpc` — `Rpc.make(tag, { payload, success, error, stream? })` + `RpcGroup.make(...rpcs)`. Same `Rpc.make` is used for both transport RPCs and entity messages.

Errors are `Schema.TaggedErrorClass` instances. They are **yieldable** — `yield* new NotFound({...})` instead of `Effect.fail(...)`.

## Conventions

### DB access — Drizzle query builder, NOT raw SQL

All handler queries use Drizzle's typed query builder. Raw `sql\`...\`` template literals are only acceptable for `SET LOCAL` and operations Drizzle's builder cannot express (rare).

```ts
// ✅ idiomatic
const rows = await tx
  .select()
  .from(DbSchema.tickets)
  .where(and(eq(DbSchema.tickets.tenantId, tenantId), lt(DbSchema.tickets.updatedAt, cursor)))
  .orderBy(desc(DbSchema.tickets.updatedAt))
  .limit(limit)

// ❌ avoid
const rows = await sql`
  SELECT * FROM ticket WHERE tenant_id = ${tenantId}
    AND updated_at < ${cursor}
  ORDER BY updated_at DESC LIMIT ${limit}
`
```

**Why:**
- Refactor-safe — schema rename propagates through types.
- Snake-case casing handled automatically by `drizzle-orm` config.
- Composable predicates (`and`/`or`/`eq`/`lt`/`inArray`/`isNull`).
- Type-narrowed `.returning({ field })` projections.

All tenant-scoped queries run inside `Database.tx(async (tx) => ...)` — the helper opens a Drizzle transaction and issues `SET LOCAL app.tenant_id` so RLS isolates rows automatically. System-wide queries (e.g. `system_config`) use `Database.db.select()` directly.

### Import paths

Inside a package: use **Node subpath imports** (`#name` in `package.json` `imports`). Across packages: use the workspace name (`@theia/<pkg>` via `exports` map). **Never** use `../*.js`, `./*.js` for cross-directory intra-package imports.

```ts
// inside @theia/domain
import { TicketId } from "#ids"
import { Ticket } from "#entities/Ticket"

// inside @theia/api (consumer)
import { Ticket } from "@theia/domain/entities"
```

TS `paths` is compile-only; emit preserves the alias and breaks downstream. Subpath imports resolve at runtime relative to the source file's nearest `package.json` — they work everywhere. No `tsc-alias` plugin needed.

### v4 Schema API gotchas

- `Schema.Union(members)` takes an **array**: `Schema.Union([A, B, C])`. NOT spread.
- `Schema.Literals([...])` for an array of literals. `Schema.Literal(x)` for a single one.
- `Schema.Class<Self>(name)(fields)` and `Schema.TaggedClass<Self>()(tag, fields)` and `Schema.TaggedErrorClass<Self>()(tag, fields)` — note the `()()` shape.
- Validation predicates use `.check(Schema.isMinLength(1))`, not `.pipe(Schema.minLength(1))`.
- Branded IDs: `Schema.String.check(Schema.isMinLength(36)).pipe(Schema.brand("XId"))`.
- `Either` is gone — use `Result.Result<A, E>`.
- `Effect.catchAll` is now `Effect.catch`. `Layer.scoped` is now `Layer.effect`. See `~/Workspaces/oss/effect-smol/migration/v3-to-v4.md` for the full rename map.

### Effect v4 service definition

Shape goes in the **second type parameter**, not as a runtime argument:

```ts
class Database extends Context.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<unknown, Error>
}>()("app/Database") {}
```

Methods are plain TS function signatures inside the shape — not `Schema.*`. Access via `Database.use((db) => db.query(...))` or `yield* Database`. No more auto-accessors.

## Where to look when stuck

1. **API question:** grep `~/Workspaces/oss/effect-smol/packages/effect/src/` for the symbol.
2. **Runnable example:** `~/Workspaces/oss/effect-smol/ai-docs/src/<topic>/*.ts` or `~/Workspaces/oss/effect-smol/packages/effect/test/`.
3. **v3 → v4 port:** `~/Workspaces/oss/effect-smol/migration/v3-to-v4.md` (rename map + behavior changes).

## Current state

Phase 0 (workspace) + Phase 1 (domain contracts) merged. `packages/domain` defines: 6 branded IDs, 3 entities (Tenant/User/Ticket + TicketSummary), 9 tagged errors + `DomainError` union, 6 ticket events with versioned envelope, `TicketRpc` group (9 RPCs incl. stream), `TicketEntity` (8 actor messages). `pnpm typecheck` passes.

Next phases per `ARCHITECTURE.md`: Phase 2 (Drizzle + RLS bootstrap), Phase 3 (better-auth + session middleware), Phase 4 (RPC server impl), Phase 5 (Cluster + TicketEntity behavior).
