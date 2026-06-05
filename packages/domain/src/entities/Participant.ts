import { Schema } from "effect"
import { TenantId, TicketId, UserId } from "#ids"

/**
 * Why this user is involved on this ticket. Multi-set — a user can be both
 * `reporter` and `commenter` (they opened the ticket AND replied), or both
 * `assignee` and `mentioned`.
 *
 * Roles accumulate over time and are NEVER removed (audit history); unsub-
 * scribing flips the boolean flag, it does NOT trim roles.
 */
export const ParticipantRole = Schema.Literals([
  "reporter",
  "assignee",
  "commenter",
  "mentioned",
  "watcher",
])
export type ParticipantRole = typeof ParticipantRole.Type

export class TicketParticipant extends Schema.Class<TicketParticipant>("TicketParticipant")({
  ticketId: TicketId,
  tenantId: TenantId,
  userId: UserId,
  roles: Schema.Array(ParticipantRole),
  /** Whether this participant receives notifications. */
  subscribed: Schema.Boolean,
  joinedAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
}) {}
