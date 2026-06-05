import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { Ticket, TicketPriority } from "#entities/Ticket"
import {
  Forbidden,
  InfrastructureError,
  NoActiveTenant,
  Unauthorized,
} from "#errors"
import { TicketId, UserId } from "#ids"

const AuthErrors = [Unauthorized, NoActiveTenant, Forbidden, InfrastructureError] as const

/**
 * Bulk operations on tickets. Backend fans out individual TicketEntity
 * messages internally — caller sees one RPC, one Effect, one result aggregate.
 *
 * Failures are partial: result includes both `succeeded` ticket projections
 * and `failed` (id + error message). Callers decide retry policy.
 */
const BulkResult = Schema.Struct({
  succeeded: Schema.Array(Ticket),
  failed: Schema.Array(
    Schema.Struct({
      id: TicketId,
      message: Schema.String,
    }),
  ),
})

/**
 * Cap the per-call fan-out. Without this a caller could send 50k ids and
 * spawn 50k entity messages, exhausting the DB pool / OOMing the runner.
 */
const BulkIds = Schema.Array(TicketId).check(Schema.isMaxLength(500))

export const BulkRpc = RpcGroup.make(
  Rpc.make("ticket.bulkAssign", {
    payload: { ids: BulkIds, assigneeId: UserId },
    success: BulkResult,
    error: Schema.Union(AuthErrors),
  }),
  Rpc.make("ticket.bulkTransition", {
    payload: { ids: BulkIds, to: Ticket.fields.status },
    success: BulkResult,
    error: Schema.Union(AuthErrors),
  }),
  Rpc.make("ticket.bulkChangePriority", {
    payload: { ids: BulkIds, to: TicketPriority },
    success: BulkResult,
    error: Schema.Union(AuthErrors),
  }),
)
