import { Schema } from "effect"
import { TenantId, TicketId, UserId } from "#ids"
import {
  TicketPriority,
  TicketStatus,
  TicketTag,
  TicketType,
} from "#entities/Workflow"

// Re-export so existing imports of `TicketStatus`/`TicketPriority`/`TicketType`/
// `TicketTag` from `#entities/Ticket` keep working (canonical home: Workflow.ts).
export { TicketStatus, TicketPriority, TicketType, TicketTag }

export class Ticket extends Schema.Class<Ticket>("Ticket")({
  id: TicketId,
  tenantId: TenantId,
  title: Schema.NonEmptyString,
  description: Schema.String,
  /** Opaque branded string. Validated against the tenant's Workflow at write time. */
  status: TicketStatus,
  /** Opaque branded string. Validated against the tenant's Workflow at write time. */
  priority: TicketPriority,
  /** Optional ticket type. Validated against the tenant's Workflow if set. */
  typeKey: Schema.NullOr(TicketType),
  /** Denormalized set of tag keys; canonical store is `ticket_tag_assignment`. */
  tags: Schema.Array(TicketTag),
  assigneeId: Schema.NullOr(UserId),
  reporterId: UserId,
  /** Monotonic actor version; used for optimistic concurrency in the entity. */
  version: Schema.Int,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
}) {}

/** Slim projection used in list views. */
export class TicketSummary extends Schema.Class<TicketSummary>("TicketSummary")({
  id: TicketId,
  title: Schema.NonEmptyString,
  status: TicketStatus,
  priority: TicketPriority,
  typeKey: Schema.NullOr(TicketType),
  tags: Schema.Array(TicketTag),
  assigneeId: Schema.NullOr(UserId),
  updatedAt: Schema.DateTimeUtcFromString,
}) {}
