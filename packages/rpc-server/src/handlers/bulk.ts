import { CurrentSession, Database, Schema as DbSchema } from "@theia/db"
import {
  ClusterMessages,
  Rpc as DomainRpc,
  Entities,
  type TenantId,
  type TicketId,
} from "@theia/domain"
import { and, eq, inArray } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { intoInfra } from "#handlers/_shared"

/**
 * Bulk RPC handlers — fan a single client call into N `TicketEntity`
 * messages and aggregate partial successes.
 *
 *   - `bulkAssign`           → `Assign` per id
 *   - `bulkTransition`       → `Transition` per id
 *   - `bulkChangePriority`   → `ChangePriority` per id
 *
 * `expectedVersion` is filled by reading the current row version inside
 * `Database.tx` before dispatch. This costs an extra round trip but avoids
 * forcing callers to pre-fetch versions.
 *
 * Fan-out concurrency is capped so a 500-id batch doesn't exhaust the DB
 * pool or the cluster runner.
 */

const FAN_OUT_CONCURRENCY = 8

interface FailureRow {
  readonly id: TicketId
  readonly message: string
}

const entityFor = (tenantId: TenantId, ticketId: TicketId) =>
  ClusterMessages.TicketEntity.client.pipe(
    Effect.map((clientFor) => clientFor(`${tenantId}:${ticketId}`)),
    Effect.mapError(intoInfra("ticket.entity-client")),
  )

/**
 * Look up the current `version` for each id so the actor's optimistic-lock
 * check is satisfied. Missing ids surface as failures with a clear message.
 */
const loadVersions = (ids: ReadonlyArray<TicketId>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const session = yield* CurrentSession
    // Filter by the requested ids — without `inArray` this loads every row
    // in the tenant just to look up a handful, which scales O(tenant.size)
    // and saturates the DB pool under any reasonable load.
    const rows =
      ids.length === 0
        ? []
        : yield* db.tx(async (tx) =>
            tx
              .select({ id: DbSchema.tickets.id, version: DbSchema.tickets.version })
              .from(DbSchema.tickets)
              .where(
                and(
                  eq(DbSchema.tickets.tenantId, session.activeOrganizationId),
                  inArray(DbSchema.tickets.id, ids as ReadonlyArray<string>),
                ),
              ),
          )
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.id, r.version)
    const present: Array<{ id: TicketId; version: number }> = []
    const missing: Array<FailureRow> = []
    for (const id of ids) {
      const v = map.get(id)
      if (v == null) missing.push({ id, message: "not found in active tenant" })
      else present.push({ id, version: v })
    }
    return { present, missing }
  })

const decodeTicket = (t: unknown) =>
  Schema.decodeUnknownEffect(Entities.Ticket)(t).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`bulk: ticket decode failed: ${String(e)}`)),
    ),
  )

/**
 * Drive one `(id, version) → Ticket` step, capturing failure as a
 * `FailureRow` instead of short-circuiting the whole batch.
 */
const stepResult = <A>(
  id: TicketId,
  effect: Effect.Effect<A, unknown>,
  decode: (a: A) => Effect.Effect<Entities.Ticket, never>,
) =>
  effect.pipe(
    Effect.flatMap(decode),
    Effect.map((ticket) => ({ id, ok: true as const, ticket })),
    Effect.catch((e) =>
      Effect.succeed({
        id,
        ok: false as const,
        message: String((e as { message?: string })?.message ?? e),
      }),
    ),
  )

/**
 * Cast: `ClusterMessages.TicketEntity.client` requires the `Sharding`
 * service, which is supplied at runtime by the Cluster layer mounted in
 * `apps/api`. The type leaks through `entityFor` because v4's cluster
 * helpers don't narrow it via `Layer.provide`. The runtime contract is
 * upheld; this cast strips the type-level requirement.
 */
const stripSharding = <A, E>(eff: Effect.Effect<A, E, unknown>) =>
  eff as unknown as Effect.Effect<A, E>

export const BulkHandlers = DomainRpc.BulkRpc.toLayer({
  "ticket.bulkAssign": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const tenantId = session.activeOrganizationId as unknown as TenantId
      const { present, missing } = yield* loadVersions(payload.ids)
      const steps = yield* Effect.forEach(
        present,
        ({ id, version }) =>
          stepResult(
            id,
            stripSharding(
              entityFor(tenantId, id).pipe(
                Effect.flatMap((entity) =>
                  entity.Assign({
                    assigneeId: payload.assigneeId,
                    actorId: session.userId,
                    expectedVersion: version,
                  }),
                ),
              ),
            ),
            decodeTicket,
          ),
        { concurrency: FAN_OUT_CONCURRENCY },
      )
      return foldResults(steps, missing)
    }),

  "ticket.bulkTransition": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const tenantId = session.activeOrganizationId as unknown as TenantId
      const { present, missing } = yield* loadVersions(payload.ids)
      const steps = yield* Effect.forEach(
        present,
        ({ id, version }) =>
          stepResult(
            id,
            stripSharding(
              entityFor(tenantId, id).pipe(
                Effect.flatMap((entity) =>
                  entity.Transition({
                    to: payload.to,
                    actorId: session.userId,
                    expectedVersion: version,
                  }),
                ),
              ),
            ),
            decodeTicket,
          ),
        { concurrency: FAN_OUT_CONCURRENCY },
      )
      return foldResults(steps, missing)
    }),

  "ticket.bulkChangePriority": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const tenantId = session.activeOrganizationId as unknown as TenantId
      const { present, missing } = yield* loadVersions(payload.ids)
      const steps = yield* Effect.forEach(
        present,
        ({ id, version }) =>
          stepResult(
            id,
            stripSharding(
              entityFor(tenantId, id).pipe(
                Effect.flatMap((entity) =>
                  entity.ChangePriority({
                    to: payload.to,
                    actorId: session.userId,
                    expectedVersion: version,
                  }),
                ),
              ),
            ),
            decodeTicket,
          ),
        { concurrency: FAN_OUT_CONCURRENCY },
      )
      return foldResults(steps, missing)
    }),
})

const foldResults = (
  steps: ReadonlyArray<
    | { id: TicketId; ok: true; ticket: Entities.Ticket }
    | { id: TicketId; ok: false; message: string }
  >,
  missing: ReadonlyArray<FailureRow>,
): { succeeded: ReadonlyArray<Entities.Ticket>; failed: ReadonlyArray<FailureRow> } => {
  const succeeded: Array<Entities.Ticket> = []
  const failed: Array<FailureRow> = [...missing]
  for (const s of steps) {
    if (s.ok) succeeded.push(s.ticket)
    else failed.push({ id: s.id, message: s.message })
  }
  return { succeeded, failed }
}
