import { Schema } from "effect"

const Uuid = Schema.String.check(Schema.isMinLength(36)).check(Schema.isMaxLength(36))

export const TenantId = Uuid.pipe(Schema.brand("TenantId"))
export type TenantId = typeof TenantId.Type

export const UserId = Uuid.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const TicketId = Uuid.pipe(Schema.brand("TicketId"))
export type TicketId = typeof TicketId.Type

export const TicketEventId = Uuid.pipe(Schema.brand("TicketEventId"))
export type TicketEventId = typeof TicketEventId.Type

export const OrganizationId = Uuid.pipe(Schema.brand("OrganizationId"))
export type OrganizationId = typeof OrganizationId.Type

export const SessionId = Schema.NonEmptyString.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type
