import { CurrentSession, Database, Schema as DbSchema } from "@theia/db"
import { Rpc as DomainRpc, Events } from "@theia/domain"
import { and, desc, eq, gte, lt, lte, or } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"

/**
 * Audit RPC handlers — read `ticket_event` log.
 *
 * The event log is the immutable audit trail. Each mutation through the
 * `TicketEntity` actor appends a versioned event row scoped by `tenant_id`
 * (RLS-isolated). This handler is read-only; events are produced by the
 * actor, never by clients.
 *
 * Cursor format: `<isoOccurredAt>|<rowId>`. Pagination keys on the
 * `(occurredAt, id)` tuple so that events sharing a millisecond (e.g. one
 * bulk transition emitting many rows from the same `now()` call) cannot
 * straddle a page boundary and disappear. `id` is a `uuidv7` so its order
 * matches insert order even when occurredAt collides.
 */

type EventRow = typeof DbSchema.ticketEvents.$inferSelect

const parseCursor = (raw: string | undefined): { occurredAt: Date; id: string } | null => {
  if (!raw) return null
  const sep = raw.lastIndexOf("|")
  if (sep <= 0) return null
  const occurredAt = new Date(raw.slice(0, sep))
  if (Number.isNaN(occurredAt.getTime())) return null
  return { occurredAt, id: raw.slice(sep + 1) }
}

const decodeEvent = (row: EventRow) =>
  Schema.decodeUnknownEffect(Events.TicketEvent)(row.event).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`ticket_event row failed domain decode: ${String(e)}`)),
    ),
  )

export const AuditHandlers = DomainRpc.AuditRpc.toLayer({
  "audit.list": (payload) =>
    Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const limit = payload.limit ?? 50
      const cursor = parseCursor(payload.cursor)

      const rows = yield* db.tx(async (tx) => {
        const conditions = [eq(DbSchema.ticketEvents.tenantId, session.activeOrganizationId)]
        if (payload.ticketId) {
          conditions.push(eq(DbSchema.ticketEvents.ticketId, payload.ticketId))
        }
        if (payload.since) {
          conditions.push(gte(DbSchema.ticketEvents.occurredAt, DateTime.toDate(payload.since)))
        }
        if (payload.until) {
          conditions.push(lte(DbSchema.ticketEvents.occurredAt, DateTime.toDate(payload.until)))
        }
        if (cursor) {
          // Composite keyset: rows older than the cursor timestamp, or rows
          // at the same timestamp with a lower id (since id is `uuidv7`,
          // lexicographic order matches insert order). Without this clause
          // a same-millisecond burst would silently lose rows on page flip.
          conditions.push(
            or(
              lt(DbSchema.ticketEvents.occurredAt, cursor.occurredAt),
              and(
                eq(DbSchema.ticketEvents.occurredAt, cursor.occurredAt),
                lt(DbSchema.ticketEvents.id, cursor.id),
              ),
            )!,
          )
        }
        return await tx
          .select()
          .from(DbSchema.ticketEvents)
          .where(and(...conditions))
          .orderBy(desc(DbSchema.ticketEvents.occurredAt), desc(DbSchema.ticketEvents.id))
          .limit(limit + 1)
      })

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const items = yield* Effect.forEach(page, decodeEvent)
      const last = page.at(-1)
      return {
        items,
        nextCursor: hasMore && last ? `${last.occurredAt.toISOString()}|${last.id}` : null,
      }
    }),
})
