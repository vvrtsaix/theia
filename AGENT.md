# AGENT.md

Vendor-agnostic guidance for AI coding agents (Claude Code, Cursor, Copilot, Aider, etc.) working in this repository. Mirrors `CLAUDE.md`; both stay in sync.

## Project

Theia — multi-tenant ticket CRM. **Effect-TS v4** backend + **SolidJS** SPA + **Postgres 18** + **OpenTelemetry**. Read `ARCHITECTURE.md` before non-trivial changes — locked decisions, package map, 10-phase plan.

## Commands

```bash
pnpm install                              # install all workspace deps
pnpm typecheck                            # tsc -b across all packages
pnpm lint                                 # biome check .
pnpm lint:fix                             # biome check --write .
pnpm format                               # biome format --write .
pnpm test                                 # all package tests (vitest)
pnpm build                                # tsc -b for emit-enabled packages

# Single package
pnpm --filter @theia/<name> <script>

# Single test file
pnpm --filter @theia/<name> vitest run path/to.test.ts

# DB migrations (requires DATABASE_URL)
pnpm --filter @theia/db migrate

# Local infra (Pg 18 + OTel collector + Jaeger)
docker compose -f infra/docker-compose.yaml up -d
```

## Stack — non-negotiable

- **Effect v4** (`effect@4.0.0-beta.78`) pinned via pnpm `catalog:` everywhere. Do NOT mix v3 + v4. Source of truth: `~/Workspaces/oss/effect-smol` (cloned). Grep there for v4 API questions — training data is unreliable for v4.
- **Cluster, RPC, HttpApi, SQL, OTel core live in `effect/unstable/*`** — there is **no** `@effect/cluster` or `@effect/rpc` package.
- **Postgres 18** with native `uuidv7()` for time-ordered PKs.
- **Node 24 LTS** runtime (native TS execution is stable — no flag needed). `@effect/vitest@beta` for tests.
- **Drizzle ORM** pinned at `^0.45.2` via `pnpm overrides` (dedupes peer ranges across better-auth + drizzle-kit).

## Architecture — minimum viable knowledge

### Contract-first — ALWAYS

`packages/domain` is the **source of truth**. Schemas, errors, events, RPC groups, and cluster messages are defined there before any handler / db / UI work. Dep graph:

```
domain → db, auth, otel
       → cluster-entities, rpc-server, rpc-client
       → apps/api, apps/web
```

A feature lands as: **domain PR** (Schema + error + RPC contract + cluster message) → **impl PRs** that consume those contracts. Never the other way around.

**Rule:** every new field, error, event, RPC, or cluster message starts as a `Schema.*` / `Rpc.make` / `Entity.make` in `packages/domain`. No handler, no DB column, no UI form may ship without its contract landed first. If a UI form needs a shape, derive it from the domain schema — do not invent a parallel type. Reuse domain `Schema.TaggedErrorClass` instances in UI error states.

### Multi-tenancy via RLS

Every tenant-scoped table carries `tenant_id uuid not null`. Postgres policy: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. Every request opens a tx via `Database.tx(...)` which issues `SET LOCAL app.tenant_id = $1` before any query. App also filters by `tenant_id` in WHERE — RLS is the backstop, not the only line.

better-auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `organization_role`) have **no** RLS — better-auth enforces authorization at the application layer. The `system_config` table is also non-RLS (system-wide).

### System-wide defaults

`system_config` (key/JSONB) seeds new tenants. On tenant creation the handler reads `system_config.workflow_defaults` and inserts a per-tenant `workflow` row. Edits to existing tenants never propagate from system; super-admin (`UserKind === "system"`) edits affect future tenants only.

### Cluster + Actor

Each long-lived stateful aggregate is an `Entity` (`effect/unstable/cluster`). An entity = a set of `Rpc.make(...)` definitions packaged via `Entity.make(type, [rpcs])`. Cluster handles routing, mailbox serialization, passivation.

- `TicketEntity` — one actor per ticket. Address shape: `<tenantId>:<ticketId>`. Owns status state machine, atomic ticket+event+participant writes, optimistic concurrency via `version` field.

State-mutating messages annotated `ClusterSchema.Persisted = true` so they survive runner crashes. Cluster runtime: `TestRunner.layer` for dev/tests; `NodeClusterSocket` + Pg-backed `MessageStorage` for prod.

### RPC

`effect/unstable/rpc` — `Rpc.make(tag, { payload, success, error, stream? })` + `RpcGroup.make(...rpcs)`. Same `Rpc.make` is used for both transport RPCs and entity messages.

Errors are `Schema.TaggedErrorClass` — **yieldable**: `yield* new NotFound({...})` instead of `Effect.fail(...)`. Every RPC error union includes `InfrastructureError` so handlers can map `SqlError`/cluster errors at the boundary.

### Identity & roles

- `UserKind` (closed enum: `customer | internal | system`) — set at user creation, never changes. Drives visibility + auth rules.
- `UserRole` (per-tenant, branded string) — stored in `organization_role` via better-auth `dynamicAccessControl`. Tenant admins create/edit roles at runtime. One user can hold a different role in each tenant.

## Conventions

### DB access — Drizzle query builder, NOT raw SQL

All handler queries use Drizzle's typed query builder. Raw `sql\`...\`` is reserved for `SET LOCAL` and ops Drizzle can't express (rare).

```ts
// ✅ idiomatic
const rows = await tx
  .select()
  .from(DbSchema.tickets)
  .where(and(eq(DbSchema.tickets.tenantId, tenantId), lt(DbSchema.tickets.updatedAt, cursor)))
  .orderBy(desc(DbSchema.tickets.updatedAt))
  .limit(limit)

// ❌ avoid
const rows = await sql`SELECT * FROM ticket WHERE tenant_id = ${tenantId} ...`
```

**Why:** refactor-safe (schema rename → type errors propagate), composable predicates, type-narrowed `.returning({ field })` projections.

All tenant-scoped queries go inside `Database.tx(async (tx) => ...)` (reads `CurrentSession`) or `Database.txAs(tenantId, async (tx) => ...)` (entity-side, explicit tenant). System-wide queries (e.g. `system_config`) use `Database.db.select()` directly.

### Import paths — Node subpath imports (`#name`)

Inside a package: use `#name` (declared in `package.json` `imports`). Across packages: use workspace name (`@theia/<pkg>` via `exports` map). **Never** use `../*.js` / `./*.js` for cross-directory intra-package imports.

```ts
// inside @theia/domain
import { TicketId } from "#ids"
import { Ticket } from "#entities/Ticket"

// inside @theia/api (consumer)
import { Ticket } from "@theia/domain/entities"
```

TS `paths` is compile-only — emit preserves the alias and breaks downstream. Subpath imports resolve at runtime via the source file's nearest `package.json` — work everywhere. No `tsc-alias` plugin needed.

### v4 Schema API gotchas

- `Schema.Union(members)` takes an **array**: `Schema.Union([A, B, C])`. NOT spread.
- `Schema.Literals([...])` for an array of literals. `Schema.Literal(x)` for a single one.
- `Schema.Class<Self>(name)(fields)` and `Schema.TaggedClass<Self>()(tag, fields)` and `Schema.TaggedErrorClass<Self>()(tag, fields)` — note the `()()` shape.
- Validation predicates: `.check(Schema.isMinLength(1))`, NOT `.pipe(Schema.minLength(1))`.
- Branded IDs: `Schema.String.check(Schema.isMinLength(36)).pipe(Schema.brand("XId"))`.
- `Either` is gone → `Result.Result<A, E>`.
- `Effect.catchAll` → `Effect.catch`. `Layer.scoped` → `Layer.effect`. Full rename map at `~/Workspaces/oss/effect-smol/migration/v3-to-v4.md`.
- `Schema.decode(s)` is a schema combinator — to **run** decoding inside Effect use `Schema.decodeEffect(s)(value)` or `Schema.decodeUnknownEffect(s)(value)`. Decode failure tag is `"SchemaError"`, not `"ParseError"`.
- `Queue.offerUnsafe(queue, value)` for sync push (NOT `Queue.unsafeOffer` — v4 swapped suffix convention).
- `Stream.async` → `Stream.callback`. Callback receives a `Queue.Queue<A>` — use `Queue.offerUnsafe`; return `Effect.acquireRelease(register, cleanup)` to attach a finalizer.
- `Scope.extend` → `Scope.provide`.
- `Mailbox` → `Queue.Queue`.

### Frontend — Kobalte + modular-forms (non-negotiable)

**UI primitives: `@kobalte/core`.** Do NOT hand-roll dialogs, popovers, dropdowns, tabs, checkboxes, switches, toasts, comboboxes, tooltips, accordions, etc. — Kobalte ships unstyled, accessible primitives. Compose Kobalte parts and apply project styles. Only build a custom component when Kobalte has no equivalent; document the gap in the file header when you do.

**Forms: `@modular-forms/solid` + Effect `Schema`.** Every form binds to a domain `Schema.*` shape via an Effect Schema adapter (`packages/web/src/lib/modular-forms-effect-schema.ts`-style). The form's payload type **is** the domain RPC payload type — no DTO mirrors.

```ts
// ✅ idiomatic
import { createForm, valiForm } from "@modular-forms/solid"  // or effect adapter
import { LoginPayload } from "@theia/domain/rpc/auth"

const [form, { Form, Field }] = createForm<typeof LoginPayload.Type>({
  validate: effectSchema(LoginPayload),
})
```

**Why:** one schema → server validation, client validation, RPC encode/decode, and types stay in lockstep. Any drift surfaces at `pnpm typecheck`. See `apps/web/src/auth/Login.tsx` for the wired pattern.

### Non-null assertions (`!`)

`noNonNullAssertion` is `warn` in `biome.json`, not `error`. Permitted in two contexts only:

1. **Provable invariants in state-machine code** — e.g. `rows[0]!` immediately after `if (rows.length === 0) throw …`. The control-flow already proved presence; the `!` is documentation, not coercion.
2. **Workflow-derived defaults** — looking up a status/priority key that the workflow guarantees exists by validation.

Anywhere else, prefer explicit `?? throwUnreachable("...")` or early-return guards. New code adding `!` outside these two contexts gets pushed back in review.

### Effect v4 service definition

Shape goes in the **second type parameter**, not as a runtime argument:

```ts
class Database extends Context.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<unknown, Error>
}>()("app/Database") {}
```

Methods are plain TS function signatures inside the shape — not `Schema.*`. Access via `Database.use((db) => db.query(...))` or `yield* Database`. No auto-accessors.

## Where to look when stuck

1. **API question:** grep `~/Workspaces/oss/effect-smol/packages/effect/src/` for the symbol.
2. **Runnable example:** `~/Workspaces/oss/effect-smol/ai-docs/src/<topic>/*.ts` or `~/Workspaces/oss/effect-smol/packages/effect/test/`.
3. **v3 → v4 port:** `~/Workspaces/oss/effect-smol/migration/v3-to-v4.md`.
4. **better-auth docs:** [organization plugin](https://www.better-auth.com/docs/plugins/organization), [dynamicAccessControl](https://www.better-auth.com/docs/plugins/organization#dynamic-access-control).

## Current state

Phases 0–9 per `ARCHITECTURE.md` are **committed**.

✅ **Works:**
- DB schema + RLS + Workflow seed + LISTEN/NOTIFY triggers (8 migrations).
- `pnpm typecheck` clean across root + apps/api + apps/web. Lint: 0 errors.
- Drizzle parity test 11/11.
- Web SPA dev server renders shell + login form (modular-forms + Effect Schema + Kobalte).
- TicketEntity Behavior with 14 handlers (atomic ticket + event + participant writes).
- OTel SDK + per-RPC-group `Effect.withSpan` + 500-boundary cause logging in `rpc-server/src/http.ts`.
- `NodeHttpServer` mount at `:3000`; RPC + better-auth handlers wired.
- All RPC handlers wired (ticket, workflow, system, notification list/markRead/markAllRead/**stream**, search, bulk, audit). Cluster mutations delegate to `TicketEntity` via `<tenantId>:<ticketId>` address built from `CurrentSession`.
- `EventChannel` service (`@theia/db`) — dedicated Pg `LISTEN` connection → `PubSub` → `Stream`. Drives `ticket.events` + `notification.stream` real-time.

⚠️ **Remaining (deferred):**
- Prod cluster runtime — `NodeClusterSocket.layer()` + `@effect/sql-pg` `MessageStorage` not yet wired. Single-node `TestRunner` covers dev.
- Notification delivery transport (email / webhook). Event log + in-app stream exist; no external sink.
- Integration tests beyond the Drizzle parity test.
- Web-side rpc-client consumption of streaming endpoints (`ticket.events`, `notification.stream`).

## v4 quirks logged (workarounds in code, search for these notes if confused)

- **`Entity.toLayer` HandlerServices doesn't exclude `CurrentAddress`** → leaks into Layer R. `apps/api/src/main.ts` casts `AppLive` to `Layer<never, unknown, never>` until effect-smol pins this.
- **pnpm dedup creates two `drizzle-orm` installs** with different peer combos (TS sees two `SQL<unknown>` types) → `pnpm-workspace.yaml` has `overrides: { drizzle-orm: ^0.45.2 }` to force a single version.
- **Drizzle-kit resets custom migration SQL files** on `generate --custom` — re-write the SQL body after generation if drizzle-kit regenerates the journal.
