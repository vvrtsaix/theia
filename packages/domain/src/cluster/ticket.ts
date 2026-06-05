import { Schema } from "effect"
import { ClusterSchema, Entity } from "effect/unstable/cluster"
import { Rpc } from "effect/unstable/rpc"
import { TicketParticipant } from "#entities/Participant"
import {
  Ticket,
  TicketPriority,
  TicketTag,
  TicketType,
} from "#entities/Ticket"
import {
  AlreadySubscribed,
  InfrastructureError,
  InvalidTag,
  InvalidTransition,
  InvalidType,
  NotFound,
  NotSubscribed,
  StaleVersion,
  ValidationError,
} from "#errors"
import { TicketEvent } from "#events/ticket"
import { TenantId, UserId } from "#ids"

/**
 * TicketEntity messages. Each Rpc here is a message the actor can receive.
 *
 * State-mutating messages annotated `ClusterSchema.Persisted = true` so they
 * survive entity passivation / runner crashes. Reads + subscriptions are
 * volatile.
 *
 * Auto-participation rules are enforced by the actor:
 *   - Open       → adds reporter + auto-subscribes
 *   - Assign     → adds assignee + auto-subscribes
 *   - Comment    → adds author + auto-subscribes (+ mentioned users)
 *   - Subscribe  → adds watcher + sets subscribed=true
 *   - Unsubscribe → flips subscribed=false; participant row stays for audit
 */

export const OpenTicket = Rpc.make("Open", {
  payload: {
    tenantId: TenantId,
    reporterId: UserId,
    title: Schema.NonEmptyString,
    description: Schema.String,
    priority: TicketPriority,
    typeKey: Schema.NullOr(TicketType),
    tags: Schema.Array(TicketTag),
  },
  success: Ticket,
  error: Schema.Union([ValidationError, InvalidType, InvalidTag, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const GetTicket = Rpc.make("Get", {
  success: Ticket,
  error: Schema.Union([NotFound, InfrastructureError]),
})

export const AssignTicket = Rpc.make("Assign", {
  payload: { assigneeId: UserId, actorId: UserId, expectedVersion: Schema.Int },
  success: Ticket,
  error: Schema.Union([NotFound, StaleVersion, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const UnassignTicket = Rpc.make("Unassign", {
  payload: { actorId: UserId, expectedVersion: Schema.Int },
  success: Ticket,
  error: Schema.Union([NotFound, StaleVersion, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const TransitionTicket = Rpc.make("Transition", {
  payload: {
    to: Ticket.fields.status,
    actorId: UserId,
    expectedVersion: Schema.Int,
  },
  success: Ticket,
  error: Schema.Union([NotFound, InvalidTransition, StaleVersion, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const ChangeTicketPriority = Rpc.make("ChangePriority", {
  payload: { to: TicketPriority, actorId: UserId, expectedVersion: Schema.Int },
  success: Ticket,
  error: Schema.Union([NotFound, StaleVersion, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const ChangeTicketType = Rpc.make("ChangeType", {
  payload: {
    to: Schema.NullOr(TicketType),
    actorId: UserId,
    expectedVersion: Schema.Int,
  },
  success: Ticket,
  error: Schema.Union([NotFound, InvalidType, StaleVersion, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const AddTicketTag = Rpc.make("AddTag", {
  payload: { tag: TicketTag, actorId: UserId },
  success: Ticket,
  error: Schema.Union([NotFound, InvalidTag, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const RemoveTicketTag = Rpc.make("RemoveTag", {
  payload: { tag: TicketTag, actorId: UserId },
  success: Ticket,
  error: Schema.Union([NotFound, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const CommentTicket = Rpc.make("Comment", {
  payload: {
    authorId: UserId,
    body: Schema.NonEmptyString,
    mentions: Schema.Array(UserId),
  },
  success: Ticket,
  error: Schema.Union([NotFound, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

// ─── Participants + subscriptions ───────────────────────────────────────────

export const SubscribeTicket = Rpc.make("Subscribe", {
  payload: { userId: UserId },
  success: TicketParticipant,
  error: Schema.Union([NotFound, AlreadySubscribed, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const UnsubscribeTicket = Rpc.make("Unsubscribe", {
  payload: { userId: UserId },
  success: TicketParticipant,
  error: Schema.Union([NotFound, NotSubscribed, InfrastructureError]),
}).annotate(ClusterSchema.Persisted, true)

export const ListParticipants = Rpc.make("ListParticipants", {
  success: Schema.Array(TicketParticipant),
  error: Schema.Union([NotFound, InfrastructureError]),
})

/** Subscribe to the ticket's event stream. Volatile (does not need persistence). */
export const SubscribeEvents = Rpc.make("SubscribeEvents", {
  success: TicketEvent,
  error: Schema.Union([NotFound, InfrastructureError]),
  stream: true,
})

export const TicketEntity = Entity.make("Ticket", [
  OpenTicket,
  GetTicket,
  AssignTicket,
  UnassignTicket,
  TransitionTicket,
  ChangeTicketPriority,
  ChangeTicketType,
  AddTicketTag,
  RemoveTicketTag,
  CommentTicket,
  SubscribeTicket,
  UnsubscribeTicket,
  ListParticipants,
  SubscribeEvents,
])

export type TicketEntity = typeof TicketEntity
