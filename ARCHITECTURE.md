# Theia — Multi-tenant Ticket CRM

Architecture plan. Effect-TS v4 (effect-smol) + SolidJS SPA + Postgres 18 + OpenTelemetry + Effect Cluster.

> **Status:** phases 0–9 committed. See "Phase plan" + "Current boundary" at the bottom.

## Locked decisions

| Decision           | Choice                                                     |
| ------------------ | ---------------------------------------------------------- |
| Tenancy isolation  | Row-level (`tenant_id` column + Postgres RLS)              |
| Frontend           | Solid SPA + `effect/unstable/rpc` (no SSR)                 |
| Cluster posture    | Single-node MVP, Cluster + Actor APIs wired from day one   |
| Auth               | `better-auth` (with Drizzle adapter + organizations plugin)|
| Backend runtime    | Bun (Node fallback supported)                              |
| DB                 | Postgres 18 (native `uuidv7()` for time-ordered keys)      |
| Schema/migrations  | Drizzle (chosen for better-auth adapter compatibility)     |
| DB driver          | `postgres-js` directly (NOT `@effect/sql-pg`)              |
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
| `solid-transition-group`           | Mount/unmount animations for panels and dialogs _(declared; first use Phase 6.x)_ |

### Frontend — state, forms, schema

| Package                            | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `@modular-forms/solid`             | Fine-grained form state — per-field reactivity; driven via the `effectSchema` adapter (`apps/web/src/lib/effect-form.ts`) so domain Schemas are the SINGLE source of validation truth |

> Forms use Effect Schema, NOT valibot/zod. modular-forms' built-in `valiForm`/`zodForm` adapters are bypassed by `effectSchema(domainSchema)`. valibot + zod only remain as upstream transitives of `@modular-forms/solid` and `better-auth` respectively — not in our direct dep graph.

### Network & auth (client)

| Package                            | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `effect` (via `effect/unstable/rpc`) | RPC client — `RpcClient.make(group)` + `layerProtocolHttp({ url })`        |
| `better-auth`                      | Server: session cookies + Drizzle adapter. Client SDK: `createAuthClient` + reactive session |

### Backend & data (v4 reality — verified against `~/Workspaces/oss/effect-smol`)

v4 collapses most former `@effect/*` packages into the `effect` mega-package under the `unstable/` namespace. Only platform drivers, OTel, and Vitest stay as separate packages.

| Package + module                                | Purpose                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `effect` (root)                                 | Effect, Layer, Context, Stream, Schema, ManagedRuntime, Queue, ...           |
| `effect/unstable/cluster`                       | `Entity`, `EntityAddress`, `Sharding`, `ClusterSchema`, `TestRunner`         |
| `effect/unstable/rpc`                           | `Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`, `RpcSerialization`              |
| `effect/unstable/http`                          | `HttpRouter`, `HttpServer`, `HttpClient`, `FetchHttpClient` (client transport) |
| `effect/unstable/httpapi`                       | `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `OpenApi` _(not used yet)_     |
| `effect/unstable/sql`                           | `SqlClient`, `Statement` _(not used — Drizzle owns SQL in this codebase)_   |
| `@effect/platform-bun`                          | `BunRuntime`, `BunClusterSocket`, Bun HTTP server adapter                    |
| `@effect/opentelemetry`                         | `NodeSdk.layer` for OTel SDK                                                 |
| `@effect/vitest` (dev)                          | `it.effect`, `it.scoped`, `TestClock`-friendly test helpers                  |
| `drizzle-orm`                                   | Type-safe SQL builder + schema mapping                                       |
| `drizzle-kit` (dev)                             | Migration generator from JS schema                                           |
| `postgres` (`postgres-js`)                      | Native Pg driver; Drizzle sits on top of this                                |
| `better-auth` + `@better-auth/drizzle-adapter`  | Auth + Drizzle adapter (pulled in via better-auth's peer)                    |

**Pinned versions (`pnpm-workspace.yaml` catalog):** `effect@4.0.0-beta.78` + all `@effect/*` siblings at the same beta. `drizzle-orm: ^0.45.2` is forced via `pnpm overrides` (dedupes peer ranges with better-auth + drizzle-kit).

### Postgres 18

Native `uuidv7()` function: time-ordered UUIDs as primary keys → no B-tree fragmentation on high-concurrency writes, monotonic insert performance.

```sql
CREATE TABLE tickets (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL REFERENCES organization(id),
  -- ...
);
```

Drizzle column form:

```ts
id: uuid().primaryKey().default(sql`uuidv7()`),
```

### Schema package note (v4)

`@effect/schema` was a separate package in v3. In v4, `Schema` is exported from `effect` directly:

```ts
import { Schema } from "effect"   // ✅ v4
// not: import * as Schema from "@effect/schema"
```

---

## Repo layout (pnpm workspace)

```
theia/
├── apps/
│   ├── api/                   # Bun entrypoint — wires DB + Cluster + OTel (HTTP TBD Phase 7.x)
│   └── web/                   # Solid SPA (Vite)
├── packages/
│   ├── domain/                # Schemas, errors, events, RPC groups, cluster messages
│   ├── db/                    # Drizzle schema + migrations + Database service (tenant-bound tx)
│   ├── auth/                  # better-auth wiring + access control + Effect session middleware
│   ├── cluster-entities/      # TicketEntity Behavior
│   ├── rpc-server/            # RPC handler implementations
│   ├── rpc-client/            # RpcClient.make wrappers for the SPA
│   └── otel/                  # @effect/opentelemetry NodeSdk layer
├── infra/
│   ├── docker-compose.yaml    # Postgres 18 + OTel collector + Jaeger
│   ├── 00-bootstrap.sql       # CREATE ROLE app_user (NOBYPASSRLS); Pg18 version check
│   └── otel-collector.yaml
├── ARCHITECTURE.md            # this file
├── AGENT.md                   # AI-agent guidance
├── CLAUDE.md                  # Claude Code variant
├── README.md                  # human runbook
├── biome.json                 # lint + format
├── package.json
├── pnpm-workspace.yaml        # catalog + overrides
├── tsconfig.base.json
└── tsconfig.json
```

Every package uses **Node subpath imports** (`#name` in `package.json` `imports`) for intra-package paths. Cross-package uses workspace names (`@theia/<pkg>` via `exports`). See "Import conventions" below.

---

## Customization — per-tenant Workflow + dynamic roles

### Status, priority, type, tag

All four are **opaque branded strings** at the domain layer (`NonEmptyString` + `Schema.brand`). Their valid values are defined per tenant in a `Workflow` config row, seeded from `system_config.workflow_defaults` at tenant creation. The TicketEntity actor validates each incoming value against the tenant's Workflow at runtime — bad values raise `ValidationError` / `InvalidType` / `InvalidTag`.

```ts
class Workflow extends Schema.Class<Workflow>("Workflow")({
  tenantId: TenantId,
  statuses:   Schema.Array(WorkflowStatus),    // [{ key, label, color, terminal }]
  priorities: Schema.Array(WorkflowPriority),  // [{ key, label, color, weight }]
  transitions: Schema.Array(WorkflowTransition), // { from, to }
  types:       Schema.Array(WorkflowType),     // [{ key, label, color, icon, defaultPriority }]
  tags:        Schema.Array(WorkflowTag),      // [{ key, label, color }]
  defaultStatus: TicketStatus,
  defaultPriority: TicketPriority,
  defaultTypeKey: Schema.NullOr(TicketType),
  updatedAt: Schema.DateTimeUtcFromString,
})
```

Tenant admins edit via the `workflow.*` RPC group. Invariants enforced server-side:

1. At least one status with `terminal: true` exists.
2. `defaultStatus` / `defaultPriority` / (optional) `defaultTypeKey` exist in their respective arrays.
3. A status / priority / type cannot be removed if it's the configured default.

### User identity model — two orthogonal axes

```
UserKind   = "customer" | "internal" | "system"   ← global, closed literal (column on `user`)
UserRole   = branded NonEmptyString               ← per-tenant, dynamic (column on `member`)
```

- **`UserKind`** is fixed at user creation. Drives auth + visibility rules at the framework layer (customers can't see internal users; system accounts bypass interactive auth and may write to `system_config`).
- **`UserRole`** is per-tenant. The same user can be a member of multiple tenants with a different role in each. Role names + their permissions are stored in better-auth's `organization_role` table (`dynamicAccessControl`).

### Auth + permissions via better-auth

- One global `user` row per identity. Many `member` rows (one per tenant the user belongs to), each with a `role` string.
- `dynamicAccessControl` stores roles + their statement-based permissions in the `organization_role` table — tenant admins create/edit roles at runtime.
- `auth.api.hasPermission({ permissions: { ticket: ["transition"] } })` checks against the active member's role.

Domain defines the **Permission statement** (`packages/domain/src/entities/Permission.ts`) — the schema better-auth's AC enforces against. Built-in roles: `owner`, `admin`, `agent`, `customer` (`packages/auth/src/access-control.ts`).

### Customer scope — multi-tenant identity

Customers and internals share the same `user` table. A user can be a customer of Tenant A and an agent at Tenant B — different `member` rows, different roles, different visibility. The session's `activeOrganizationId` decides which tenant context the request runs under (and which `app.tenant_id` GUC is bound).

### System-wide defaults — `system_config` table

System-wide configuration that seeds new tenants but is freely editable per tenant after creation. Lives in `system_config` (single non-tenant-scoped table, no RLS) as a `(key, value JSONB)` store. Domain typing via a `SystemConfig` discriminated union — adding a new config category = adding a new variant.

| Key                | Value Schema                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `workflow_defaults`| `SystemConfig.WorkflowDefaults` — statuses/priorities/types/tags/transitions/defaultStatus/defaultPriority/defaultTypeKey |
| _(future)_         | `SystemConfig.FeatureFlags`, `SystemConfig.Limits`, ...             |

**Bootstrap:** migration `0002_seed_system_config.sql` inserts the `workflow_defaults` row.

**Tenant creation flow:** on `organization.create`, the handler reads `system_config.workflow_defaults` and INSERTs a per-tenant `workflow` row. Subsequent edits via `workflow.*` RPCs mutate the tenant's own row only — system defaults never re-sync.

**Updating system defaults:** super-admin RPC (`UserKind === "system"`). Only affects **future** tenants — existing tenants keep their copy.

---

### Participants, subscriptions, tags, types

| Concept                | Model                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `TicketParticipant`    | Row per (ticket × user). Audit of every actor. `roles: Array<ParticipantRole>` accumulates as they interact (`reporter`, `assignee`, `commenter`, `mentioned`, `watcher`). |
| Subscription           | Flag on `TicketParticipant`: `subscribed: boolean`. Reporter/assignee/commenter auto-subscribe; explicit `subscribe`/`unsubscribe` RPC overrides. |
| `TicketTag`            | Branded `NonEmptyString`. Tenant-defined list lives in `Workflow.tags`. Many-to-many via `ticket_tag_assignment`. |
| `TicketType`           | Branded `NonEmptyString`. Tenant-defined list in `Workflow.types`. Single optional FK on `ticket.typeKey`. |
| `Notification`         | Row per (recipient × event). Generated when a TicketEvent fires and matching subscribers exist. Delivery (email / webhook / in-app stream) lives in Phase 8. |

**Auto-participation rules** (enforced by `TicketEntity`):

- `OpenTicket` → add reporter with role `reporter`, `subscribed: true`.
- `AssignTicket` → add assignee with role `assignee`, `subscribed: true`.
- `CommentTicket` → add author with role `commenter`, `subscribed: true`. Each `@mention` adds user with role `mentioned`, `subscribed: true`.
- Explicit `SubscribeTicket` → add user with role `watcher`, `subscribed: true`.

Unsubscribing flips `subscribed: false` but keeps the participant row — audit history preserved.

**Per-type workflows (deferred):** v0 assumes one `Workflow` covers all ticket types. Future: pull `statuses` + `transitions` per-`TicketType`.

---

## Multi-tenancy: RLS strategy

Every tenant-scoped table:

```sql
ALTER TABLE ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket FORCE ROW LEVEL SECURITY;
CREATE POLICY ticket_tenant_isolation ON ticket
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket TO app_user;
```

`app_user` connects as a `NOBYPASSRLS` role (created by `infra/00-bootstrap.sql`). Every transaction issues:

```sql
SET LOCAL app.tenant_id = $1;
```

via `Database.tx(...)` or `Database.txAs(tenantId, ...)`. With `current_setting('app.tenant_id', true)` the `true` flag makes the GUC return NULL when unset → policy is false for every row → zero rows returned, no crash.

**Tables WITHOUT RLS (intentional):**
- better-auth-owned: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `organization_role` — better-auth enforces authorization at the application layer.
- `system_config` — system-wide; super-admin gated at the handler layer.

**Defense in depth:** handlers also filter by `tenant_id` in WHERE — RLS is the backstop, not the only line.

---

## Auth: better-auth + Effect

```ts
// packages/auth/src/auth.ts (excerpt)
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: Schema }),
  advanced: { database: { generateId: false } }, // defer to Pg uuidv7()
  emailAndPassword: { enabled: true },
  user: { additionalFields: { kind: { type: "string", defaultValue: "customer", input: false } } },
  plugins: [organization({ ac, roles, dynamicAccessControl: { enabled: true } })],
})
```

Effect side (`packages/auth/src/middleware.ts`) — `resolveSession(headers)` returns an `Effect<CurrentSession, SessionInvalid | NoActiveOrganization>` that:

1. Calls `auth.api.getSession({ headers })`.
2. Decodes `userId` + `activeOrganizationId` + `userKind` (from `user.kind` additional field).
3. Pulls the active member's role via `auth.api.getActiveMemberRole({ headers })`.
4. Provides `CurrentSession` to downstream handlers.

`CurrentSession.activeOrganizationId` is what `Database.tx` binds as `app.tenant_id` for RLS.

> **Verify on integration (Phase 7.x):** confirm the exact HTTP adapter path for mounting `auth.handler` under `/api/auth/*` once the `effect/unstable/http` API stabilises.

---

## Effect Cluster + Actor pattern

`effect/unstable/cluster` provides sharded entities (actor-like). Each entity:
- Has an address (`<tenantId>:<ticketId>` for `TicketEntity`).
- Has typed messages via `Rpc.make(...)`.
- Maintains in-memory state across messages — mailbox-serialized.
- State-mutating messages annotated `ClusterSchema.Persisted = true` survive runner crashes.

### Entities

**`TicketEntity`** (one actor per ticket) — all 14 messages implemented:
- Reads: `Get`, `ListParticipants`, `SubscribeEvents`
- Mutations: `Open`, `Assign`, `Unassign`, `Transition`, `ChangePriority`, `ChangeType`, `AddTag`, `RemoveTag`, `Comment`, `Subscribe`, `Unsubscribe`

Each handler: open `Database.txAs(tenantId, async tx => ...)` → load ticket+tags+participants → load `Workflow` (fresh, no cache) → validate version + workflow → write ticket row + event log + participants in same tx → bump `version` → return updated `Ticket`.

### Storage (current)

`TestRunner.layer` (in-memory, single-process). Wired in `packages/cluster-entities/src/runtime.ts`. Production swap point flagged — `ClusterProdLive` will use a Bun/Node cluster socket layer + Pg-backed `MessageStorage` / `RunnerStorage`.

### Actor wiring (current code)

```ts
// packages/domain/src/cluster/ticket.ts
export const OpenTicket = Rpc.make("Open", {
  payload: { tenantId, reporterId, title, description, priority, typeKey, tags },
  success: Ticket,
  error: Schema.Union([ValidationError, InvalidType, InvalidTag, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)
// ... 13 more messages

export const TicketEntity = Entity.make("Ticket", [OpenTicket, /* ... */])

// packages/cluster-entities/src/ticket/index.ts
export const TicketEntityLive = ClusterMessages.TicketEntity.toLayer(
  Effect.gen(function* () {
    const db = yield* Database
    return ClusterMessages.TicketEntity.of({
      Open: ({ payload }) => /* validate workflow + insert ticket + event + participant */,
      Assign: ({ payload }) => /* version guard + update + event + auto-participate */,
      // ... 12 more
    })
  }),
  { maxIdleTime: "10 minutes" },
)

// Client (from anywhere with the cluster layer + tenant context)
const clientFor = yield* ClusterMessages.TicketEntity.client
const ticket = clientFor(`${tenantId}:${ticketId}`)
yield* ticket.Assign({ assigneeId, actorId, expectedVersion })
```

> **v4 quirk:** `Entity.toLayer`'s `HandlerServices` type does not currently exclude `CurrentAddress` from inferred `R`. `apps/api/src/main.ts` casts `AppLive` to `Layer<never, unknown, never>` until effect-smol pins this.

---

## RPC layer (`effect/unstable/rpc`)

Contracts in `packages/domain/src/rpc/*.ts` — single source of truth, shared FE+BE. Every RPC error union includes `InfrastructureError` so handlers can map `SqlError` / cluster errors at the boundary.

```ts
export const TicketRpc = RpcGroup.make(
  Rpc.make("ticket.list", { payload: {...}, success: {...}, error: Schema.Union(AuthErrors) }),
  Rpc.make("ticket.events", { payload: { id: TicketId }, success: TicketEvent, error: ..., stream: true }),
  // ...
)
```

Groups:
- `TicketRpc` — ticket CRUD + participants + subscribe + events stream
- `WorkflowRpc` — admin CRUD on the tenant Workflow row
- `NotificationRpc` — per-user feed
- `SystemConfigRpc` — super-admin only
- `SearchRpc` — `ticket.search` (Phase 9)
- `BulkRpc` — bulk transition/assign/changePriority (Phase 9)
- `AuditRpc` — query against `ticket_event` (Phase 9)

Server (`packages/rpc-server`) — handlers go through `Database.tx` (RLS-bound) for direct DB queries; mutation handlers delegate to `TicketEntity.client` for ticket state changes. Drizzle query builder for all SQL (`#handlers/_shared.ts` has helpers).

Client (`packages/rpc-client`) — `RpcClient.make(group)` per group + `layerProtocolHttp({ url })` + `FetchHttpClient.layer` + JSON serialization. Wrapped in one `ManagedRuntime` per SPA process.

Transport: HTTP (mounted at `/rpc/<group>` once Phase 7.x lands). Stream RPCs use HTTP chunked / SSE.

---

## OpenTelemetry

```ts
// packages/otel/src/index.ts
const OtelConfig = Config.all({
  endpoint: Config.string("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(Config.withDefault("http://localhost:4318/v1/traces")),
  serviceName: Config.string("OTEL_SERVICE_NAME").pipe(Config.withDefault("theia-api")),
  serviceVersion: Config.string("OTEL_SERVICE_VERSION").pipe(Config.withDefault("0.0.0")),
})

export const OtelLive = NodeSdk.layer(
  Effect.map(OtelConfig, (c) => ({
    resource: { serviceName: c.serviceName, serviceVersion: c.serviceVersion },
    spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({ url: c.endpoint })),
  })),
)
```

Wraps the entire `AppLive` stack — every Effect fiber, Drizzle query, HTTP handler, cluster entity message produces a span. Local dev: OTel collector + Jaeger via `infra/docker-compose.yaml`. Prod: OTLP → Tempo / Honeycomb / Grafana Cloud.

Add custom spans inside handlers with `Effect.withSpan("ticket.open", { attributes: { tenantId } })`.

---

## Layer composition (current `apps/api/src/main.ts`)

```ts
const AppLive: Layer.Layer<never, unknown, never> = ClusterTestLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(OtelLive),
) as unknown as Layer.Layer<never, unknown, never>

const program = Effect.gen(function* () {
  yield* Effect.logInfo("theia api: layers built; waiting for HTTP wiring (Phase 7.x)")
  yield* Effect.never
}).pipe(Effect.provide(AppLive)) as Effect.Effect<never, unknown, never>

BunRuntime.runMain(program)
```

The cast unblocks the build pending the effect-smol `Entity.toLayer` fix. HTTP server + RPC mount + better-auth handler land in Phase 7.x.

---

## Solid frontend

```
apps/web/
├── src/
│   ├── lib/
│   │   └── rpc.ts                # getClients() + run(Effect) over ManagedRuntime
│   ├── auth/
│   │   ├── client.ts             # createAuthClient + organizationClient
│   │   └── session.ts            # createResource over authClient.getSession()
│   ├── lib/
│   │   ├── rpc.ts                # (above)
│   │   └── effect-form.ts        # modular-forms validate adapter over Effect Schema
│   ├── routes/
│   │   ├── login.tsx             # modular-forms + Effect Schema (effectSchema adapter)
│   │   ├── tickets.tsx           # @tanstack/solid-table over TicketRpc.list
│   │   ├── ticket-detail.tsx     # createResource on TicketRpc.get
│   │   └── settings.tsx          # stub
│   ├── app.tsx                   # route tree + sidebar shell
│   ├── entry.tsx                 # <Router><App/></Router>
│   └── styles.css                # @import "tailwindcss"
├── index.html
└── vite.config.ts                # proxy /api + /rpc → :3000
```

State: Solid signals + `createResource` for one-shot queries. RPC stream subscriptions (Phase 6.x): `createResource` + AbortController, or `@effect/atom-solid` for atom-based reactivity.

No SSR — auth-gated SPA. Static assets served by the Bun HTTP server in prod (Phase 7.x) or a CDN.

---

## Import conventions — Node subpath imports (`#`)

Every package uses Node subpath imports for **intra-package** references. Cross-package imports use workspace names (`@theia/<pkg>` via `exports` map).

### Why not relative paths (`../ids.js`)?

- Brittle on move/rename.
- Hard to grep.
- Mixed with `node_modules` paths in reviews.

### Why not TS `paths`?

TypeScript `paths` is compile-time only. `tsc` emit preserves the alias → downstream consumers break. Subpath imports resolve at runtime relative to the **source file's** nearest `package.json` — cross-package consumption stays correct, no `tsc-alias` plugin needed.

### Pattern

```jsonc
// packages/<pkg>/package.json
{
  "exports": {                              // ← cross-package surface
    ".":         "./src/index.ts",
    "./errors":  "./src/errors/index.ts"
  },
  "imports": {                              // ← intra-package surface
    "#ids":         "./src/ids.ts",
    "#entities":    "./src/entities/index.ts",
    "#entities/*":  "./src/entities/*.ts"
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
4. Tooling: TS `NodeNext` resolution + Bun + Node 18+ all resolve `#x` natively.

---

## Contract-First Workflow

Contracts are the source of truth. Server + client + DB + docs all derive from `packages/domain`. No feature work begins without a merged contract PR.

### Layered package dependency rule

```
domain  ──→  (depends only on `effect`)
  ▲
  ├── db              (Drizzle tables mirror domain Schemas; parity test enforces)
  ├── auth            (uses domain UserKind/UserRole/Session types)
  ├── cluster-entities (Behavior over domain messages)
  ├── rpc-server      (implements contracts; cannot change shapes)
  ├── rpc-client      (RpcClient.make wraps domain groups)
  └── otel            (no domain coupling; OTel SDK only)
              ▲
              └── apps/web (no direct access to db/cluster — only rpc-client)
```

### Definition order (per feature)

1. **Entity Schema** (`domain/src/entities/`) — branded ID + `Schema.Class`.
2. **Domain errors** (`domain/src/errors/`) — `Schema.TaggedErrorClass` per failure mode.
3. **Events** (`domain/src/events/`) — `Schema.TaggedStruct` per domain event, versioned via `v` field.
4. **RPC group** (`domain/src/rpc/`) — `Rpc.make(name, { payload, success, error, stream? })`.
5. **Cluster messages** (`domain/src/cluster/`) — `Rpc.make` for actor mailbox; `Entity.make(name, [rpcs])`.
6. **Review + merge** the domain PR. Implementation PRs follow.

### Enforcement

- `tsconfig` project refs make `domain` build first; downstream typecheck fails on any breaking contract change.
- DB ↔ domain parity test in `packages/db/test/parity.test.ts` runs on every CI.
- Contract changes that break the wire (rename/remove field, change error tag) require a versioned migration.

### Anti-patterns

- Server handler returning a wider shape than the contract `success` Schema. Fix: tighten the Schema or narrow the return.
- Client casting RPC errors to `any`. Fix: every error is a `Schema.TaggedErrorClass` — match on `_tag`.
- DB type leaks into the RPC contract (e.g. raw JS `Date` over the wire). Fix: contract uses `Schema.DateTimeUtcFromString`; db layer encodes.
- Adding an entity field directly in `drizzle/schema.ts` without first updating `domain`. Fix: domain PR → db PR → migration PR.

---

## Phase plan

| Phase | Deliverable                                                              | Status |
| ----- | ------------------------------------------------------------------------ | ------ |
| 0     | pnpm monorepo + `domain` package skeleton + tsconfig + lint              | ✅ done |
| 1     | Domain contracts: entities, errors, events, RPC groups, cluster messages | ✅ done |
| 2     | Postgres 18 + Drizzle schema + RLS bootstrap + domain↔db parity test     | ✅ done |
| 3     | better-auth + organizations + Effect `CurrentSession` middleware         | ✅ done |
| 4     | `effect/unstable/rpc` server: handlers + per-group HTTP layer            | ✅ done (compiles; HTTP mount pending Phase 7.x) |
| 5     | Cluster + `TicketEntity` Behavior + event log table                      | ✅ done (TestRunner; Pg storage = Phase 5.x) |
| 6     | Solid SPA: `rpc-client` + auth + ticket list/detail + `modular-forms` (login)| ✅ done (atom-solid reactive session binding = Phase 6.x) |
| 7     | OpenTelemetry + local Jaeger + `apps/api` HTTP server                    | 🟡 OTel done; HTTP server wiring = Phase 7.x |
| 8     | Real-time: entity event Stream → RPC stream → Solid signals              | 🟡 in-memory channel + Pg LISTEN/NOTIFY triggers wired; Stream consumer = Phase 8.x |
| 9     | Polish: pg_trgm search + bulk ops + audit log                            | 🟡 contracts + migrations done; handler impls = Phase 9.x |

### Current boundary (Phase 7.x → 9.x slices)

- **Phase 7.x:** `apps/api/src/main.ts` mounts `BunHttpServer` + `RpcServer.layerHttp` per group + `auth.handler` at `/api/auth/*`. Blocker: `effect/unstable/http` API still moving between betas.
- **Phase 5.x:** `ticket.open` RPC handler currently dies — needs to construct a fresh `<tenantId>:<ticketId>` address and forward to `TicketEntity.client`.
- **Phase 8.x:** Pg-backed `EventChannel` consuming `LISTEN ticket_event_inserted` via `postgres-js` `listen()`.
- **Phase 6.x:** workflow editor + ticket create dialog forms (login already wired with `modular-forms` + Effect Schema via `effectSchema` adapter); `@effect/atom-solid` reactive session binding.
- **Phase 9.x:** real handler impls for `ticket.search`, `ticket.bulk*`, `audit.list`.

---

## Forms — single source of validation truth

The web app uses `@modular-forms/solid` for form state but drives validation
through **domain Schemas** via a tiny adapter:

```ts
// apps/web/src/lib/effect-form.ts
export const effectSchema = <S extends Schema.Top>(schema: S) =>
  (values: unknown): Record<string, string> => {
    try {
      Schema.decodeUnknownSync(schema as never)(values)
      return {}
    } catch (e) {
      const errors: Record<string, string> = {}
      walkIssue((e as { cause?: unknown }).cause ?? e, errors)
      return errors
    }
  }
```

Pattern (login):

```ts
const LoginSchema = Schema.Struct({
  email:    Schema.NonEmptyString.check(Schema.isMinLength(3)),
  password: Schema.NonEmptyString.check(Schema.isMinLength(8)),
})

const [form, { Form, Field }] = createForm<LoginInput>({
  validate: effectSchema(LoginSchema),
  validateOn: "blur",
  revalidateOn: "input",
})
```

**No valibot, no zod, no parallel client schemas.** modular-forms' built-in
`valiForm`/`zodForm` adapters are bypassed. valibot + zod remain in
`pnpm-lock.yaml` only as upstream transitives (`@modular-forms/solid` peer +
`better-auth` internal); our source imports neither.

Future forms (workflow editor, ticket create dialog) reuse domain Schemas
the same way — same Schema that the RPC contract uses.

---

## v4 quirks logged (cross-reference)

- `Schema.Union([...])` takes an array, not spread.
- `Effect.catchAll` → `Effect.catch`. `Layer.scoped` → `Layer.effect`.
- `Either` → `Result.Result`. `Mailbox` → `Queue.Queue`. `Scope.extend` → `Scope.provide`.
- `Stream.async` → `Stream.callback`; callback receives `Queue.Queue<A>`. Sync push: `Queue.offerUnsafe(queue, value)` (note suffix order).
- `Schema.decode(s)` is a schema combinator. For Effect-returning decode use `Schema.decodeEffect(s)(v)` / `Schema.decodeUnknownEffect(s)(v)`. Decode failure tag is `"SchemaError"` not `"ParseError"`.
- `RpcGroup.toLayer` handlers receive `(payload, options?) => Effect` — payload directly, NOT `({ payload })`. (Entity handlers DO use `({ payload })`.)
- `Entity.toLayer` HandlerServices type currently leaks `CurrentAddress` into Layer R — workaround documented in `apps/api/src/main.ts`.
- pnpm dedup creates multiple drizzle-orm installs unless `pnpm-workspace.yaml` `overrides: { drizzle-orm: ^0.45.2 }` is set.
- drizzle-kit `generate --custom` resets the SQL file on regeneration — re-write content after running it.

---

## Reference source

Effect v4 source cloned at `~/Workspaces/oss/effect-smol`. Use it — not training data or pre-2026 docs — for every API question.

Lookup order:
1. `packages/<pkg>/src/` — canonical signatures.
2. `packages/<pkg>/test/` — runnable behavior.
3. `migration/v3-to-v4.md` + `migration/*.md` — porting v3 code.
4. `ai-docs/src/**/*.ts` — short idiomatic examples by topic.

Cross-check every Effect API name against the source before merging.
