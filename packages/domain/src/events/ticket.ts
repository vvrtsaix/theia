import { Schema } from "effect"
import { TicketPriority, TicketStatus, TicketTag, TicketType } from "#entities/Workflow"
import { TenantId, TicketEventId, TicketId, UserId } from "#ids"

/**
 * Domain events emitted by the TicketEntity actor.
 *
 * Versioned via the `v` field so consumers can detect schema drift; bump `v`
 * (and add a new tag) for breaking changes — never mutate an existing event in
 * place. Event stream is also the audit log (see Phase 9 in ARCHITECTURE.md).
 */
const EventEnvelope = {
  eventId: TicketEventId,
  ticketId: TicketId,
  tenantId: TenantId,
  occurredAt: Schema.DateTimeUtcFromString,
  /** Actor version after this event was applied. */
  version: Schema.Int,
  /** Schema version of the event payload — bump on breaking change. */
  v: Schema.Int,
}

export const TicketOpened = Schema.TaggedStruct("TicketOpened", {
  ...EventEnvelope,
  reporterId: UserId,
  title: Schema.NonEmptyString,
  description: Schema.String,
  priority: TicketPriority,
  typeKey: Schema.NullOr(TicketType),
})

export const TicketAssigned = Schema.TaggedStruct("TicketAssigned", {
  ...EventEnvelope,
  assigneeId: UserId,
  assignedBy: UserId,
})

export const TicketUnassigned = Schema.TaggedStruct("TicketUnassigned", {
  ...EventEnvelope,
  unassignedBy: UserId,
})

export const TicketTransitioned = Schema.TaggedStruct("TicketTransitioned", {
  ...EventEnvelope,
  from: TicketStatus,
  to: TicketStatus,
  actorId: UserId,
})

export const TicketCommented = Schema.TaggedStruct("TicketCommented", {
  ...EventEnvelope,
  authorId: UserId,
  body: Schema.NonEmptyString,
  /** Users explicitly @mentioned in the body. Auto-subscribed by the entity. */
  mentions: Schema.Array(UserId),
})

export const TicketPriorityChanged = Schema.TaggedStruct("TicketPriorityChanged", {
  ...EventEnvelope,
  from: TicketPriority,
  to: TicketPriority,
  actorId: UserId,
})

export const TicketTypeChanged = Schema.TaggedStruct("TicketTypeChanged", {
  ...EventEnvelope,
  from: Schema.NullOr(TicketType),
  to: Schema.NullOr(TicketType),
  actorId: UserId,
})

export const TicketTagAdded = Schema.TaggedStruct("TicketTagAdded", {
  ...EventEnvelope,
  tag: TicketTag,
  actorId: UserId,
})

export const TicketTagRemoved = Schema.TaggedStruct("TicketTagRemoved", {
  ...EventEnvelope,
  tag: TicketTag,
  actorId: UserId,
})

export const TicketParticipantJoined = Schema.TaggedStruct("TicketParticipantJoined", {
  ...EventEnvelope,
  userId: UserId,
  /** Role that pulled them in. Multiple roles accumulate across events. */
  role: Schema.Literals(["reporter", "assignee", "commenter", "mentioned", "watcher"]),
})

export const TicketSubscribed = Schema.TaggedStruct("TicketSubscribed", {
  ...EventEnvelope,
  userId: UserId,
  /** True if subscribed via the explicit watch RPC; false for auto-subscribe. */
  explicit: Schema.Boolean,
})

export const TicketUnsubscribed = Schema.TaggedStruct("TicketUnsubscribed", {
  ...EventEnvelope,
  userId: UserId,
})

export const TicketEvent = Schema.Union([
  TicketOpened,
  TicketAssigned,
  TicketUnassigned,
  TicketTransitioned,
  TicketCommented,
  TicketPriorityChanged,
  TicketTypeChanged,
  TicketTagAdded,
  TicketTagRemoved,
  TicketParticipantJoined,
  TicketSubscribed,
  TicketUnsubscribed,
])
export type TicketEvent = typeof TicketEvent.Type
