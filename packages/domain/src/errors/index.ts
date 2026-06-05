import { Schema } from "effect"
import { TicketStatus, TicketTag, TicketType } from "#entities/Workflow"
import { TenantId, TicketId, UserId } from "#ids"

/** Caller is not authenticated, or session has expired. */
export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()("Unauthorized", {
  reason: Schema.String,
}) {}

/** Authenticated but no active tenant binding (e.g., user belongs to none, or hasn't selected). */
export class NoActiveTenant extends Schema.TaggedErrorClass<NoActiveTenant>()("NoActiveTenant", {
  userId: UserId,
}) {}

/** Caller authenticated but lacks permission for this operation in this tenant. */
export class Forbidden extends Schema.TaggedErrorClass<Forbidden>()("Forbidden", {
  tenantId: TenantId,
  userId: UserId,
  action: Schema.String,
}) {}

/** Generic "entity not found" — used by ticket reads and by entity routing. */
export class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  resource: Schema.String,
  id: Schema.String,
}) {}

/** Payload failed Schema decode at an RPC or HTTP boundary. */
export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "ValidationError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

/** Ticket cannot transition from `from` to `to`. Enforced by the TicketEntity actor. */
export class InvalidTransition extends Schema.TaggedErrorClass<InvalidTransition>()(
  "InvalidTransition",
  {
    ticketId: TicketId,
    from: TicketStatus,
    to: TicketStatus,
  },
) {}

/** Optimistic-concurrency mismatch: the actor's version differs from the caller's. */
export class StaleVersion extends Schema.TaggedErrorClass<StaleVersion>()("StaleVersion", {
  ticketId: TicketId,
  expected: Schema.Int,
  actual: Schema.Int,
}) {}

/** Tenant slug or other unique key already in use. */
export class Conflict extends Schema.TaggedErrorClass<Conflict>()("Conflict", {
  resource: Schema.String,
  field: Schema.String,
}) {}

/** Tried to subscribe a user who is already subscribed. */
export class AlreadySubscribed extends Schema.TaggedErrorClass<AlreadySubscribed>()(
  "AlreadySubscribed",
  {
    ticketId: TicketId,
    userId: UserId,
  },
) {}

/** Tried to unsubscribe a user who is not subscribed. */
export class NotSubscribed extends Schema.TaggedErrorClass<NotSubscribed>()("NotSubscribed", {
  ticketId: TicketId,
  userId: UserId,
}) {}

/** Tag key not present in tenant's `Workflow.tags`. */
export class InvalidTag extends Schema.TaggedErrorClass<InvalidTag>()("InvalidTag", {
  tenantId: TenantId,
  tag: TicketTag,
}) {}

/** Type key not present in tenant's `Workflow.types`. */
export class InvalidType extends Schema.TaggedErrorClass<InvalidType>()("InvalidType", {
  tenantId: TenantId,
  type: TicketType,
}) {}

/** A downstream dependency (DB / external API / cluster runner) failed unexpectedly. */
export class InfrastructureError extends Schema.TaggedErrorClass<InfrastructureError>()(
  "InfrastructureError",
  {
    component: Schema.String,
    message: Schema.String,
  },
) {}

/** Union of all errors that can flow out of an RPC. */
export const DomainError = Schema.Union([
  Unauthorized,
  NoActiveTenant,
  Forbidden,
  NotFound,
  ValidationError,
  InvalidTransition,
  StaleVersion,
  Conflict,
  AlreadySubscribed,
  NotSubscribed,
  InvalidTag,
  InvalidType,
  InfrastructureError,
])
export type DomainError = typeof DomainError.Type
