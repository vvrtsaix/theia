import { CurrentSession, Database, Schema as DbSchema } from "@theia/db"
import { Rpc as DomainRpc, Entities } from "@theia/domain"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

/**
 * Tenant-scoped ticket search.
 *
 * Two-pass query:
 *   1. Full-text rank against the `search_vector` generated column
 *      (`tsvector` with title weight A + description weight B) using
 *      `websearch_to_tsquery` — the user-friendly query parser.
 *   2. Fall back to trigram similarity on `title` when the FTS result set is
 *      empty (typo tolerance via `pg_trgm` gin index).
 *
 * RLS enforces tenant scope inside `Database.tx`; the explicit `tenantId`
 * filter is a defense-in-depth belt.
 */

type SummaryRow = typeof DbSchema.tickets.$inferSelect & {
  rank?: number
  tags?: ReadonlyArray<string>
}

const decodeSummary = (row: SummaryRow) =>
  Schema.decodeUnknownEffect(Entities.TicketSummary)({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    typeKey: row.typeKey,
    tags: row.tags ?? [],
    assigneeId: row.assigneeId,
    updatedAt: row.updatedAt.toISOString(),
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`ticket search summary failed decode: ${String(e)}`)),
    ),
  )

export const SearchHandlers = DomainRpc.SearchRpc.toLayer({
  "ticket.search": (payload) =>
    Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const limit = payload.limit ?? 25
      const q = payload.query

      const { rows, tagsByTicket } = yield* db.tx(async (tx) => {
        const tenantFilter = eq(DbSchema.tickets.tenantId, session.activeOrganizationId)

        // FTS pass — `websearch_to_tsquery` understands quotes / OR / -.
        const fts = sql<number>`ts_rank(${sql.raw("ticket.search_vector")}, websearch_to_tsquery('english', ${q}))`
        let rows = await tx
          .select({ row: DbSchema.tickets, rank: fts })
          .from(DbSchema.tickets)
          .where(
            and(
              tenantFilter,
              sql`${sql.raw("ticket.search_vector")} @@ websearch_to_tsquery('english', ${q})`,
            ),
          )
          .orderBy(desc(fts))
          .limit(limit)

        // Trigram fallback — similarity on title only.
        if (rows.length === 0) {
          const sim = sql<number>`similarity(${DbSchema.tickets.title}, ${q})`
          rows = await tx
            .select({ row: DbSchema.tickets, rank: sim })
            .from(DbSchema.tickets)
            .where(and(tenantFilter, sql`${DbSchema.tickets.title} % ${q}`))
            .orderBy(desc(sim))
            .limit(limit)
        }

        const flat = rows.map((r) => ({ ...r.row, rank: r.rank }))
        if (flat.length === 0) return { rows: flat, tagsByTicket: new Map<string, Array<string>>() }
        const ids = flat.map((r) => r.id)
        const tagRows = await tx
          .select({
            ticketId: DbSchema.ticketTagAssignments.ticketId,
            tag: DbSchema.ticketTagAssignments.tag,
          })
          .from(DbSchema.ticketTagAssignments)
          .where(inArray(DbSchema.ticketTagAssignments.ticketId, ids))

        const tagsByTicket = new Map<string, Array<string>>()
        for (const t of tagRows) {
          const list = tagsByTicket.get(t.ticketId) ?? []
          list.push(t.tag)
          tagsByTicket.set(t.ticketId, list)
        }
        return { rows: flat, tagsByTicket }
      })

      const items = yield* Effect.forEach(rows, (row) =>
        decodeSummary({ ...row, tags: tagsByTicket.get(row.id) ?? [] }),
      )
      return { items }
    }),
})
