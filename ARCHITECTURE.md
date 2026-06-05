# Theia — Multi-tenant Ticket CRM

Architecture plan. Effect-TS v4 (effect-smol) + SolidJS SPA + Postgres + OpenTelemetry + Effect Cluster.

## Locked decisions

| Decision           | Choice                                                     |
| ------------------ | ---------------------------------------------------------- |
| Tenancy isolation  | Row-level (`tenant_id` column + Postgres RLS)              |
| Frontend           | Solid SPA + `@effect/rpc` (no SSR)                         |
| Cluster posture    | Single-node MVP, Cluster + Actor APIs wired from day one   |
| Auth               | `better-auth` (with Drizzle adapter + organizations plugin)|
| Backend runtime    | Bun (Node fallback supported)                              |
| DB                 | Postgres 18 (native `uuidv7()` for time-ordered keys)      |
| Schema/migrations  | Drizzle (chosen for better-auth adapter compatibility)     |
| Tracing            | OpenTelemetry via `@effect/opentelemetry` → OTLP           |

---

## Dependency manifest

### Frontend — SPA runtime & routing

| Package                            | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `solid-js`                         | Fine-grained reactive UI runtime; compiles to direct DOM updates             |
| `@solidjs/router`                  | Official client-side router for SPA navigation                               |

### Frontend — UI, layout, styling

| Package                            | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `@kobalte/core`                    | Headless WAI-ARIA primitives (dialog, dropdown, popover) — keyboard-correct  |
| `@tanstack/solid-table`            | Headless data-grid: sort, filter, paginate; pairs with Kobalte cells         |
| `tailwindcss`                      | Utility-first CSS; applied directly to Kobalte/table primitives              |
| `lucide-solid`                     | Tree-shakable SVG icon components                                            |
| `solid-transition-group`           | Mount/unmount animations for panels and dialogs                              |

### Frontend — state, forms, schema

| Package                            | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `modular-forms`                    | Fine-grained form state — per-field reactivity, no re-render storms          |
| `@solidjs-community/solid-primitives` | Reactive utilities: element tracking, listeners, debounce                 |

### Network & auth

| Package                            | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `@effect/rpc` + `@effect/rpc-http` | End-to-end type-safe RPC transport (SPA ↔ Effect backend)                    |
| `better-auth`                      | Server: session cookies + Postgres adapter. Client SDK: reactive user state  |

### Backend & data (v4 reality — verified against `~/Workspaces/oss/effect-smol`)

v4 collapses most former `@effect/*` packages into the `effect` mega-package under the `unstable/` namespace. Only platform drivers, Pg client, OTel, and Vitest stay as separate packages.

| Package + module                                | Purpose                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `effect` (root)                                 | Effect, Layer, Context, Stream, Schema, ManagedRuntime, ...                  |
| `effect/unstable/cluster`                       | `Entity`, `EntityAddress`, `Sharding`, `MessageStorage`, `ClusterSchema`     |
| `effect/unstable/rpc`                           | `Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`, `RpcMiddleware`                 |
| `effect/unstable/httpapi`                       | `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `OpenApi` (free OpenAPI spec)  |
| `effect/unstable/http`                          | `HttpRouter`, `HttpServer`, `HttpClient`, low-level HTTP                     |
| `effect/unstable/sql`                           | `SqlClient`, `Statement`, `Migrator`, `SqlSchema` (DB-driver agnostic core)  |
| `effect/unstable/observability`                 | OTel integration (used with `@effect/opentelemetry`)                         |
| `effect/unstable/eventlog`                      | Event log primitives (audit log / event sourcing)                            |
| `effect/unstable/reactivity`                    | Reactive primitives (Atom)                                                   |
| `@effect/platform-bun`                          | Bun runtime adapter: `BunRuntime`, `BunClusterSocket`, Bun HTTP server       |
| `@effect/sql-pg`                                | Postgres driver for `effect/unstable/sql` (`PgClient`, `SqlError`)           |
| `@effect/opentelemetry`                         | OTel SDK layer factory                                                       |
| `@effect/vitest` (dev)                          | `it.effect`, `it.scoped`, `TestClock`-friendly test helpers                  |
| `@effect/atom-solid`                            | Effect Atom → Solid signals binding for the SPA                              |
| `drizzle-orm`                                   | Type-safe SQL builder + schema mapping                                       |
| `drizzle-kit` (dev)                             | Migration generator from JS schema                                           |

**Pinned version (Phase 0):** `effect@4.0.0-beta.78` + all `@effect/*` siblings at the same beta. Pin exact via pnpm `catalog:` to keep all packages in lockstep.

### Postgres 18

Native `uuidv7()` function: time-ordered UUIDs as primary keys → no B-tree fragmentation on high-concurrency writes, monotonic insert performance. Use `gen_random_uuidv7()` (or `uuidv7()` per final naming) as column default.

```sql
CREATE TABLE tickets (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  ...
);
```

Drizzle column form:

```ts
id: uuid("id").primaryKey().default(sql`uuidv7()`),
```

### Schema package note (v4)

`@effect/schema` was a separate package in v3. In v4 (effect-smol), `Schema` is exported from `effect` directly:

```ts
import { Schema } from "effect"   // ✅ v4
// not: import * as Schema from "@effect/schema"
```

If `@effect/schema` still publishes as a transitional alias, do not depend on it — use the canonical import.

---

## Repo layout (pnpm workspace)

```
theia/
├── apps/
│   ├── api/                   # Effect HTTP + RPC + Cluster node
│   └── web/                   # Solid SPA (Vite)
├── packages/
│   ├── domain/                # Schema types, errors, RPC contracts (shared FE+BE)
│   ├── db/                    # Drizzle schema + migrations + Pg layer
│   ├── auth/                  # better-auth wiring + Effect session middleware
│   ├── cluster-entities/      # TicketEntity, TenantEntity (actor logic)
│   ├── rpc-server/            # Handler implementations
│   ├── rpc-client/            # Type-safe client for Solid
│   └── otel/                  # OpenTelemetry layer
├── infra/
│   ├── docker-compose.yaml    # Postgres + Jaeger/Tempo + OTel collector
│   └── migrations/            # SQL bootstrap (RLS roles, extensions)
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Customization — per-tenant Workflow + dynamic roles

### Status + priority

`TicketStatus` and `TicketPriority` are **opaque branded strings** at the domain layer (`NonEmptyString` + `Schema.brand`). Their valid values are defined per tenant in a `Workflow` config row, seeded with defaults on tenant creation. The TicketEntity actor validates each incoming `status`/`priority` against the tenant's Workflow at runtime — bad values raise `ValidationError`.

`Workflow` shape (stored as one row per tenant):

```ts
class Workflow extends Schema.Class<Workflow>("Workflow")({
  tenantId: TenantId,
  statuses:   Schema.Array(WorkflowStatus),    // [{ key, label, color, terminal }]
  priorities: Schema.Array(WorkflowPriority),  // [{ key, label, color, weight }]
  transitions: Schema.Array(Schema.Tuple([TicketStatus, TicketStatus])),
  defaultStatus: TicketStatus,
  defaultPriority: TicketPriority,
  updatedAt: Schema.DateTimeUtcFromString,
})
```

Seeded defaults (mirror prior closed enums) — tenants can add, edit labels/colors, or remove. Two invariants the system enforces:

1. At least one status with `terminal: true` must exist.
2. `defaultStatus` and `defaultPriority` must exist in `statuses`/`priorities`.

Workflow CRUD is admin-only (permission: `workflow:update`).

### User identity model — two orthogonal axes

```
UserKind   = "customer" | "internal" | "system"   ← global, closed literal
UserRole   = branded NonEmptyString               ← per-tenant, dynamic
```

- **`UserKind`** is fixed at user creation. Drives auth + visibility rules at the framework layer (customers can't see internal users; system accounts bypass interactive auth).
- **`UserRole`** is per-tenant. The same user can be a member of multiple tenants with a different role in each. Role names + their permissions are defined per tenant (e.g. `agent`, `L2`, `manager`).

### Auth + permissions via better-auth

The better-auth **organization plugin** + **`dynamicAccessControl`** option give us this for free:

- One user account, many `Member` rows (one per tenant they belong to), each with a `role` string + per-member `additionalFields` (e.g. `kind: UserKind`).
- `dynamicAccessControl` stores roles + their statement-based permissions in DB tables — tenant admins create/edit roles at runtime.
- `auth.api.hasPermission({ permissions: { ticket: ["transition"] } })` checks against the active member's role on every request.

Domain defines the **Permission statement** (resource × action shape) — that's the schema better-auth's AC enforces against. See `packages/domain/src/entities/Permission.ts`.

### Customer scope — multi-tenant identity

Customers and internals share the same `users` table. A user can be a customer of Tenant A and an agent at Tenant B — different `Member` rows, different roles, different visibility. The session's `activeOrganizationId` decides which tenant context the request runs under (and therefore which `SET LOCAL app.tenant_id` value).

### System-wide defaults — `system_config` table

System-wide configuration that seeds new tenants but is freely editable per tenant after creation. Lives in `system_config` (single non-tenant-scoped table, no RLS) as a `(key, value JSONB)` store. Domain typing via a `SystemConfig` discriminated union — adding a new config category = adding a new variant.

| Key                | Value Schema                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `workflow_defaults`| `SystemConfig.WorkflowDefaults` — statuses/priorities/types/tags/transitions/defaultStatus/defaultPriority/defaultTypeKey |
| _(future)_         | `SystemConfig.FeatureFlags`, `SystemConfig.Limits`, ...             |

**Bootstrap:** seed migration inserts `workflow_defaults` row with values mirroring the old `defaultWorkflowSeed` constant.

**Tenant creation flow:** on `organization.create`, the handler reads `system_config.workflow_defaults` and INSERTs a per-tenant `workflow` row. Subsequent edits via `workflow.*` RPCs mutate the tenant's own row only — system defaults never re-sync.

**Updating system defaults:** super-admin RPC (`UserKind = "system"`). Only affects **future** tenants — existing tenants keep their copy.

---

### Participants, subscriptions, tags, types

| Concept                | Model                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `TicketParticipant`    | Row per (ticket × user). Audit of every actor. `roles: Set<ParticipantRole>` accumulates as they interact (`reporter`, `assignee`, `commenter`, `mentioned`, `watcher`). |
| Subscription           | Flag on `TicketParticipant`: `subscribed: boolean`. Reporter/assignee/commenter auto-subscribe; explicit `subscribe`/`unsubscribe` RPC overrides. |
| `TicketTag`            | Branded `NonEmptyString`. Tenant-defined closed list lives in `Workflow.tags`. Many-to-many via `ticket_tag_assignment` join table. |
| `TicketType`           | Branded `NonEmptyString`. Tenant-defined closed list in `Workflow.types`. Single optional FK on `ticket.typeKey`. |
| `Notification`         | Row per (recipient × event). Generated when a TicketEvent fires and matching subscribers exist. Delivery (email / webhook / in-app stream) lives in Phase 8. |

**Auto-participation rules** (enforced by `TicketEntity`):

- `OpenTicket` → add reporter with role `reporter`, `subscribed: true`.
- `AssignTicket` → add assignee with role `assignee`, `subscribed: true`.
- `CommentTicket` → add author with role `commenter`, `subscribed: true`.
- `@mention` in a comment body → add mentioned user with role `mentioned`, `subscribed: true`.
- Explicit `SubscribeTicket` RPC → add user with role `watcher`, `subscribed: true`.

Unsubscribing flips `subscribed: false` but keeps the participant row — audit history is preserved.

**Per-type workflows (deferred):** v0 assumes one `Workflow` covers all ticket types. Real-world CRMs eventually need Bug-vs-Feature-vs-Incident to follow different state machines. Future migration path: pull `statuses` + `transitions` out of `Workflow` into a per-`TicketType` `WorkflowDef`; `Workflow` becomes a holder for tenant-wide tags + priorities + types.

---

## Multi-tenancy: RLS strategy

Every tenant-scoped table:

```sql
CREATE TABLE tickets (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  -- ...
);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tickets_tenant_isolation ON tickets
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Application connects as `app_user` (no `BYPASSRLS`). Every transaction starts with:

```sql
SET LOCAL app.tenant_id = $1;
```

Effect middleware enforces this at the SqlClient layer — no handler can run a query without an active tenant binding.

**Defense in depth:** application also filters by `tenant_id` in every query. RLS is the backstop, not the only line.

**Schema-owned tables** (no `tenant_id`): `tenants`, `users`, `sessions`, `accounts` — better-auth owns these. RLS off.

---

## Auth: better-auth + Effect

better-auth provides:
- Email/password, OAuth providers, magic links
- Drizzle Postgres adapter
- `organizations` plugin → maps 1:1 to **tenants**
- Single `auth.handler(request)` style handler (Fetch API shaped)

Integration:

```ts
// packages/auth/src/auth.ts
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [organization()],
})
```

Mount as a catch-all under `/api/auth/*` in the Effect HTTP server (`@effect/platform/HttpRouter`).

Effect-side session middleware (sketch):

```ts
// packages/auth/src/CurrentSession.ts
import { Context, Effect, Layer } from "effect"
import { HttpServerRequest } from "@effect/platform"

export class CurrentSession extends Context.Service<CurrentSession, {
  readonly userId: string
  readonly activeOrganizationId: string  // = tenantId
  readonly roles: ReadonlyArray<string>
}>()("app/CurrentSession") {}

export const SessionMiddleware = HttpApiMiddleware.Tag<SessionMiddleware>()(
  "SessionMiddleware",
  {
    provides: CurrentSession,
    failure: Schema.Union(Unauthorized, NoActiveTenant),
  },
)
```

Handler resolves the cookie → `auth.api.getSession({ headers })` → constructs `CurrentSession` → also calls `SET LOCAL app.tenant_id` on the active Pg transaction.

> **Verify on integration:** confirm better-auth's exact `getSession` API surface and Drizzle adapter import path against current docs — both moved in 2025.

---

## Effect Cluster + Actor pattern

`@effect/cluster` provides sharded entities (actor-like). Each entity:
- Has a unique ID (`EntityAddress`)
- Has typed messages (request/reply)
- Has state managed by a `Behavior`
- Is mailbox-serialized — one message at a time per entity

### Entities

**`TicketEntity`** (one actor per ticket)
- State: `{ status, assigneeId, version, lastEvent }`
- Messages: `Open`, `Assign`, `Comment`, `Transition(to)`, `Close`, `Subscribe`
- Enforces state machine: `open → in_progress → waiting_on_customer → resolved → closed`
- Emits domain events to `ticket_events` table + cluster pub/sub
- `Subscribe` returns a `Stream` of events for live UI

**`TenantEntity`** (one actor per tenant)
- State: `{ activeUsers, presence, settings }`
- Messages: `Touch(userId)`, `GetPresence`, `BroadcastNotification`

### Storage

`PgClusterStorage` (Postgres-backed shard/state store). Tables created via `@effect/cluster` migrations. Same DB as app data initially; can split later.

### Single-node deploy

`apps/api` runs both `Cluster.ShardManager` and a sharding node. No external coordinator. Code uses `Cluster.Sharded.send(entity, message)` — when scaled out, only the storage backend changes.

### Actor wiring (v4-correct, verified against effect-smol)

An entity is a set of `Rpc.make(...)` definitions packaged via `Entity.make(type, [rpcs])`. The handler layer carries the in-memory state (Ref/SubscriptionRef). Cluster takes care of routing, mailbox serialization, and passivation.

```ts
import { Entity, ClusterSchema } from "effect/unstable/cluster"
import { Rpc } from "effect/unstable/rpc"
import { Effect, Ref, Schema } from "effect"

// 1) Messages (RPCs) — defined in `packages/domain/cluster/ticket.ts`
export const OpenTicket = Rpc.make("Open", {
  payload: { title: Schema.String, description: Schema.String },
  success: Ticket,
  error: AlreadyOpen,
}).annotate(ClusterSchema.Persisted, true)

export const Assign = Rpc.make("Assign", {
  payload: { assigneeId: UserId },
  success: Ticket,
})

export const SubscribeEvents = Rpc.make("SubscribeEvents", {
  success: TicketEvent,
  stream: true,
})

// 2) Entity definition (also in `domain`)
export const TicketEntity = Entity.make("Ticket", [OpenTicket, Assign, SubscribeEvents])

// 3) Handler layer (in `packages/cluster-entities/`)
export const TicketEntityLive = TicketEntity.toLayer(
  Effect.gen(function* () {
    const state = yield* Ref.make<TicketState>(initial)
    return TicketEntity.of({
      Open:   ({ payload }) => ...,
      Assign: ({ payload }) => ...,
      SubscribeEvents: () => streamOfEvents.pipe(Rpc.fork),
    })
  }),
  { maxIdleTime: "10 minutes" },
)

// 4) Client (from anywhere with the cluster layer)
const program = Effect.gen(function* () {
  const clientFor = yield* TicketEntity.client
  const ticket    = clientFor(ticketId)
  yield* ticket.Assign({ assigneeId: userId })
})
```

Cluster transport (single-node MVP): `BunClusterSocket.layer()` from `@effect/platform-bun`, backed by `@effect/sql-pg` for `MessageStorage` + `RunnerStorage`. For tests: `TestRunner.layer` from `effect/unstable/cluster`.

---

## RPC layer (`effect/unstable/rpc`)

Contracts in `packages/domain` — single source of truth, shared FE+BE.

```ts
// packages/domain/src/rpc/ticket.ts
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export class TicketRpc extends RpcGroup.make(
  Rpc.make("ticket.list", {
    success: Schema.Array(TicketSummary),
    error: Unauthorized,
    payload: { cursor: Schema.optional(Schema.String) },
  }),
  Rpc.make("ticket.open", {
    success: Ticket,
    error: Schema.Union(Unauthorized, ValidationError),
    payload: { title: Schema.String, description: Schema.String },
  }),
  Rpc.make("ticket.events", {
    success: TicketEvent,
    error: Unauthorized,
    payload: { ticketId: TicketId },
    stream: true,
  }),
) {}
```

Server (`packages/rpc-server`) provides implementations using services + Cluster entities. Client (`packages/rpc-client`) is generated, type-safe, and used directly from Solid via signals.

Transport: HTTP + SSE for streaming (mounted on `/api/rpc/*`).

---

## OpenTelemetry

```ts
// packages/otel/src/Otel.ts
import { NodeSdk } from "@effect/opentelemetry"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"

export const OtelLive = NodeSdk.layer(() => ({
  resource: { serviceName: "theia-api" },
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  ),
}))
```

What gets traced automatically:
- Every `Effect.gen` block — fiber-level spans
- Every Pg query via `@effect/sql-pg` (parameterized, no PII)
- Every HTTP handler and RPC method
- Every Cluster entity message

Add custom spans inside handlers with `Effect.withSpan("ticket.open", { attributes: { tenantId } })`.

Local dev: OTel collector + Jaeger in docker-compose. Prod: OTLP → Tempo/Honeycomb/Grafana Cloud.

---

## Layer composition

```ts
// apps/api/src/AppLive.ts
const AppLive = Layer.mergeAll(
  // observability first — wraps everything below
  OtelLive,

  // config + DB
  ConfigLive,
  PgLive,                         // Pg pool, sets SET LOCAL on each tx

  // auth
  AuthLive.pipe(Layer.provide(PgLive)),

  // cluster
  ClusterStorageLive,             // PgClusterStorage
  ShardManagerLive.pipe(Layer.provide(ClusterStorageLive)),
  TicketEntityLive,
  TenantEntityLive,

  // RPC + HTTP
  RpcHandlersLive,
  HttpServerLive,
)

NodeRuntime.runMain(Layer.launch(AppLive))
```

---

## Solid frontend

```
apps/web/
├── src/
│   ├── lib/
│   │   ├── rpc.ts           # generated rpc-client + auth-aware fetch
│   │   └── auth.ts          # better-auth/solid client
│   ├── routes/              # @solidjs/router file-based routes
│   ├── components/
│   ├── features/
│   │   ├── tickets/
│   │   └── tenant/
│   └── app.tsx
├── index.html
└── vite.config.ts
```

State: Solid signals + resources for one-shot queries; RPC stream subscriptions via `createResource` + AbortController.

No SSR — auth-gated SPA. Static assets served by the Effect HTTP server (or a CDN in prod).

---

## Import conventions — Node subpath imports (`#`)

Every package uses Node subpath imports (`#name` in `package.json` `imports`) for **intra-package** references. Cross-package imports use the workspace name (`@theia/<pkg>` via `exports` map).

### Why not relative paths (`../ids.js`)?

- Brittle on move/rename.
- Hard to grep for.
- Mixed with `node_modules` paths in reviews.

### Why not TS `paths`?

TypeScript `paths` is compile-time only. `tsc` emit preserves the alias, so any downstream package consuming the `.d.ts` cannot resolve it. Subpath imports are resolved by Node/Bun at runtime relative to the **source file's** nearest `package.json` — cross-package consumption stays correct, no `tsc-alias` post-processor required.

### Pattern

```jsonc
// packages/<pkg>/package.json
{
  "exports": {                                  // ← cross-package surface
    ".":         "./src/index.ts",
    "./errors":  "./src/errors/index.ts"
  },
  "imports": {                                  // ← intra-package surface
    "#ids":         "./src/ids.ts",
    "#entities":    "./src/entities/index.ts",
    "#entities/*":  "./src/entities/*.ts",
    "#errors":      "./src/errors/index.ts"
  }
}
```

```ts
// inside @theia/domain
import { TicketId } from "#ids"
import { Ticket }   from "#entities/Ticket"

// inside @theia/api (consumer)
import { Ticket } from "@theia/domain/entities"
```

### Rules

1. **Never** use `../*.js` or `./*.js` for cross-directory imports inside a package — use `#name`.
2. Same-directory imports (`./Sibling.ts`) are fine.
3. Every new package gets its own `imports` map covering every top-level src directory.
4. Tooling: TS `NodeNext`/`Bundler` resolution + Bun runtime both resolve `#x` natively. No extra plugin.

---

## Contract-First Workflow

Contracts are the source of truth. Server + client + DB + docs all derive from `packages/domain`. No feature work begins without a merged contract PR.

### Layered package dependency rule

```
domain  ──→  (depends on nothing app-specific; only `effect` + Schema)
  ▲
  ├── db              (maps domain types ↔ Drizzle tables; cannot widen domain)
  ├── auth            (uses domain Session/User/Tenant types)
  ├── cluster-entities (Behavior over domain types)
  ├── rpc-server      (implements contracts; cannot change shapes)
  └── rpc-client      (generated from contracts; consumed by web)
              ▲
              └── apps/web (no direct access to db/cluster — only rpc-client)
```

`domain` has zero runtime deps beyond `effect`. Imports from `domain` flow strictly outward.

### Definition order (per feature)

1. **Entity Schema** (`domain/src/entities/`) — `TicketId` brand, `Ticket` Schema.Class, `TicketStatus` literal union.
2. **Domain errors** (`domain/src/errors/`) — `Schema.TaggedErrorClass` per failure mode (`NotFound`, `Unauthorized`, `InvalidTransition`, etc.).
3. **Events** (`domain/src/events/`) — `Schema.TaggedStruct` per domain event (`TicketOpened`, `TicketAssigned`, ...). Versioned.
4. **RPC group** (`domain/src/rpc/`) — `Rpc.make(name, { payload, success, error, stream? })`. Names are stable wire identifiers.
5. **Cluster messages** (`domain/src/cluster/`) — `Schema.TaggedStruct` for actor mailbox messages, paired with reply types.
6. **Review + merge** the domain PR. Implementation PRs follow.

### Enforcement

- `domain` is referenced by `tsconfig` path aliases; lint rule rejects cross-package imports that bypass it.
- CI step: `pnpm --filter domain build && pnpm --filter '*' typecheck` — any contract change forces dependents to update or fail.
- Contract changes that break the wire (rename/remove field, change error tag) require a **versioned migration** (introduce v2 RPC, deprecate v1, dual-handle for one release).

### What you get for free

- **Type-safe RPC end-to-end** — `@effect/rpc` derives client signatures from the group definition; no manual SDK.
- **OpenAPI** — `@effect/rpc` group → JSON Schema export for external consumers / docs site.
- **Cluster reply types** — same Schemas used for actor messages serialize across nodes when sharding scales out.
- **Form validation** — `modular-forms` consumes the same `Schema` as the RPC payload; one validation rule, two enforcement points.
- **DB ↔ domain parity** — Drizzle table types are asserted against `domain` Schemas in a unit test; mismatches fail CI (see Phase 0).

### Anti-patterns

- Server handler returning a wider shape than the contract success Schema. Fix: tighten the Schema or narrow the return.
- Client casting RPC errors to `any` to handle them. Fix: every error is a `Schema.TaggedErrorClass` — match on `_tag`.
- DB type leaks into the RPC contract (e.g. a `Date` column exposed as JS `Date` over the wire). Fix: contract uses `Schema.Date` (ISO string); db layer encodes.
- Adding an entity field directly in `drizzle/schema.ts` without first updating `domain`. Fix: domain PR → db PR → migration PR.

---

## Phase plan (contract-first reorder)

| Phase | Deliverable                                                              |
| ----- | ------------------------------------------------------------------------ |
| 0     | pnpm monorepo + `domain` package skeleton + tsconfig path aliases + lint |
| 1     | **Domain contracts v0**: `Tenant`, `User`, `Ticket`, `TicketEvent`, errors, RPC group stubs, cluster message Schemas — merged before any handler exists |
| 2     | Postgres 18 + Drizzle schema mirroring `domain` + RLS bootstrap + parity test (`domain ↔ db`) |
| 3     | better-auth + organizations + Effect `CurrentSession` middleware (using domain `Session`) |
| 4     | `@effect/rpc` server: implement Phase 1 contracts (handlers return contract shapes only) |
| 5     | Cluster + `TicketEntity` Behavior over domain messages + event log table |
| 6     | Solid SPA: `rpc-client` consumed via `modular-forms` + `@tanstack/solid-table` |
| 7     | OpenTelemetry + local Jaeger + span attributes derived from contract names |
| 8     | Real-time: entity event Stream → RPC stream contract → Solid signals     |
| 9     | Polish: search (pg_trgm), bulk ops, audit log (events table is the audit log) |

---

## Open questions / pre-build verifications

1. ~~**Cluster v4 API surface**~~ — **resolved**: `Entity.make(type, [rpcs])` + `entity.toLayer(impl, opts)`. Source: `effect/unstable/cluster/Entity.ts`.
2. **better-auth + Effect** — confirm: does `auth.handler` accept Fetch `Request`? Does the organizations plugin expose `activeOrganizationId` on the session? Read current better-auth docs before phase 3.
3. **Cluster + better-auth coexistence** — sessions must be valid before any entity message is routed. Use `RpcMiddleware` to enforce.
4. **RLS and connection pooling** — `SET LOCAL` is transaction-scoped. With pgBouncer in transaction-pooling mode this works; in session mode it would leak. Pin pgBouncer mode in infra.
5. **RPC streaming over HTTP** — `Rpc.make(..., { stream: true })` + `RpcSerialization` confirmed. Transport choice (SSE vs WS) determined by `RpcServer` layer + platform-bun adapter.

---

## Reference source

Effect v4 source cloned at `~/Workspaces/oss/effect-smol`. Use it — not training data or pre-2026 docs — for every API question.

Lookup order:
1. `packages/<pkg>/src/` — canonical signatures.
2. `packages/<pkg>/test/` — runnable behavior.
3. `migration/v3-to-v4.md` + `migration/*.md` — porting v3 code.
4. `ai-docs/src/**/*.ts` — short idiomatic examples by topic.

Cross-check every Effect API name against the source before merging.
