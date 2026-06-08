import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { TicketSummary } from "#entities/Ticket"
import { Forbidden, InfrastructureError, NoActiveTenant, Unauthorized } from "#errors"

const AuthErrors = [Unauthorized, NoActiveTenant, Forbidden, InfrastructureError] as const

/**
 * Tenant-scoped ticket search.
 *
 * Backed by Pg `tsvector` (full-text) + `pg_trgm` (typo-tolerance) via the
 * `ticket.search_vector` generated column (see `drizzle/0004_*.sql`).
 *
 * `query` accepts websearch-style syntax (`"exact phrase" OR keyword -excluded`).
 * Results ranked by ts_rank desc; falls back to trigram similarity when no FTS
 * match.
 */
export const SearchRpc = RpcGroup.make(
  Rpc.make("ticket.search", {
    payload: {
      query: Schema.NonEmptyString,
      limit: Schema.optional(Schema.Int),
    },
    success: Schema.Struct({
      items: Schema.Array(TicketSummary),
    }),
    error: Schema.Union(AuthErrors),
  }),
)
