import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { TicketParticipant } from "#entities/Participant"
import { Ticket, TicketPriority, TicketSummary, TicketTag, TicketType } from "#entities/Ticket"
import {
  AlreadySubscribed,
  Forbidden,
  InfrastructureError,
  InvalidTag,
  InvalidTransition,
  InvalidType,
  NoActiveTenant,
  NotFound,
  NotSubscribed,
  StaleVersion,
  Unauthorized,
  ValidationError,
} from "#errors"
import { TicketEvent } from "#events/ticket"
import { TicketId, UserId } from "#ids"

/**
 * Every RPC declares `InfrastructureError` so handlers can map SqlError /
 * cluster errors (MailboxFull, PersistenceError, ...) into a single domain
 * tag. Clients always pattern-match on a domain-level union.
 */
const AuthErrors = [Unauthorized, NoActiveTenant, Forbidden, InfrastructureError] as const

export const TicketRpc = RpcGroup.make(
  Rpc.make("ticket.list", {
    payload: {
      cursor: Schema.optional(Schema.NonEmptyString),
      limit: Schema.optional(Schema.Int),
    },
    success: Schema.Struct({
      items: Schema.Array(TicketSummary),
      nextCursor: Schema.NullOr(Schema.String),
    }),
    error: Schema.Union(AuthErrors),
  }),

  Rpc.make("ticket.get", {
    payload: { id: TicketId },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound]),
  }),

  Rpc.make("ticket.open", {
    payload: {
      title: Schema.NonEmptyString,
      description: Schema.String,
      priority: TicketPriority,
      typeKey: Schema.NullOr(TicketType),
      tags: Schema.optional(Schema.Array(TicketTag)),
    },
    success: Ticket,
    error: Schema.Union([...AuthErrors, ValidationError, InvalidType, InvalidTag]),
  }),

  Rpc.make("ticket.assign", {
    payload: {
      id: TicketId,
      assigneeId: UserId,
      expectedVersion: Schema.Int,
    },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound, StaleVersion]),
  }),

  Rpc.make("ticket.unassign", {
    payload: { id: TicketId, expectedVersion: Schema.Int },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound, StaleVersion]),
  }),

  Rpc.make("ticket.transition", {
    payload: {
      id: TicketId,
      to: Ticket.fields.status,
      expectedVersion: Schema.Int,
    },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound, InvalidTransition, StaleVersion]),
  }),

  Rpc.make("ticket.changePriority", {
    payload: {
      id: TicketId,
      to: TicketPriority,
      expectedVersion: Schema.Int,
    },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound, StaleVersion]),
  }),

  Rpc.make("ticket.setType", {
    payload: {
      id: TicketId,
      to: Schema.NullOr(TicketType),
      expectedVersion: Schema.Int,
    },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound, InvalidType, StaleVersion]),
  }),

  Rpc.make("ticket.addTag", {
    payload: { id: TicketId, tag: TicketTag },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound, InvalidTag]),
  }),

  Rpc.make("ticket.removeTag", {
    payload: { id: TicketId, tag: TicketTag },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound]),
  }),

  Rpc.make("ticket.comment", {
    payload: {
      id: TicketId,
      body: Schema.NonEmptyString,
    },
    success: Ticket,
    error: Schema.Union([...AuthErrors, NotFound]),
  }),

  // ─── Participants + subscriptions ─────────────────────────────────────────

  Rpc.make("ticket.listParticipants", {
    payload: { id: TicketId },
    success: Schema.Array(TicketParticipant),
    error: Schema.Union([...AuthErrors, NotFound]),
  }),

  Rpc.make("ticket.subscribe", {
    payload: { id: TicketId },
    success: TicketParticipant,
    error: Schema.Union([...AuthErrors, NotFound, AlreadySubscribed]),
  }),

  Rpc.make("ticket.unsubscribe", {
    payload: { id: TicketId },
    success: TicketParticipant,
    error: Schema.Union([...AuthErrors, NotFound, NotSubscribed]),
  }),

  /** Live event stream for a single ticket (driven by the TicketEntity actor). */
  Rpc.make("ticket.events", {
    payload: { id: TicketId },
    success: TicketEvent,
    error: Schema.Union([...AuthErrors, NotFound]),
    stream: true,
  }),
)
