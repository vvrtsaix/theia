import { Effect } from "effect"
import { Schema as DbSchema, type DrizzleTx } from "@theia/db"
import { Errors, Events } from "@theia/domain"

type TicketEvent = Events.TicketEvent

/** Append a single event to `ticket_event`. Returns the persisted row id. */
export const appendEvent = (
  tx: DrizzleTx,
  event: TicketEvent,
) =>
  Effect.tryPromise({
    try: async () => {
      const rows = await tx
        .insert(DbSchema.ticketEvents)
        .values({
          id: event.eventId,
          ticketId: event.ticketId,
          tenantId: event.tenantId,
          event,
          v: event.v,
          version: event.version,
          occurredAt: new Date(event.occurredAt as unknown as string),
        })
        .returning({ id: DbSchema.ticketEvents.id })
      return rows[0]!.id
    },
    catch: (e) =>
      new Errors.InfrastructureError({
        component: "ticket.appendEvent",
        message: String(e),
      }),
  })
