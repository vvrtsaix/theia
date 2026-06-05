import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import {
  Forbidden,
  InfrastructureError,
  NoActiveTenant,
  Unauthorized,
} from "#errors"
import { TicketEvent } from "#events/ticket"
import { TicketId } from "#ids"

const AuthErrors = [Unauthorized, NoActiveTenant, Forbidden, InfrastructureError] as const

/**
 * Audit log query. The `ticket_event` table IS the audit log — every state
 * change is persisted with the actor id, prior state, and a versioned envelope.
 *
 * Filters: by ticket, by actor, by time range, by event tag. Server enforces
 * tenant scope via RLS.
 */
export const AuditRpc = RpcGroup.make(
  Rpc.make("audit.list", {
    payload: {
      ticketId: Schema.optional(TicketId),
      /** ISO-8601 timestamps — decoded to DateTime.Utc at the handler. */
      since: Schema.optional(Schema.DateTimeUtcFromString),
      until: Schema.optional(Schema.DateTimeUtcFromString),
      cursor: Schema.optional(Schema.NonEmptyString),
      limit: Schema.optional(Schema.Int),
    },
    success: Schema.Struct({
      items: Schema.Array(TicketEvent),
      nextCursor: Schema.NullOr(Schema.String),
    }),
    error: Schema.Union(AuthErrors),
  }),
)
