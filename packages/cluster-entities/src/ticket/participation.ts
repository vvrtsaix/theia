import { Effect } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { Schema as DbSchema, type DrizzleTx } from "@theia/db"
import { Errors, type TenantId, type TicketId, type UserId } from "@theia/domain"

/**
 * Auto-participation helper. Upserts a `ticket_participant` row, appending
 * `role` to the existing `roles` array (idempotent — pg array_append +
 * array_distinct kept in app-land for simplicity), and sets `subscribed = true`
 * on first add or when `subscribe = true`.
 *
 * Returns true if the row was newly inserted (caller can emit
 * `TicketParticipantJoined` only on first add to avoid duplicate events).
 */
export const upsertParticipant = (
  tx: DrizzleTx,
  params: {
    ticketId: TicketId
    tenantId: TenantId
    userId: UserId
    role: "reporter" | "assignee" | "commenter" | "mentioned" | "watcher"
    subscribe: boolean
    now: Date
  },
) =>
  Effect.tryPromise({
    try: async () => {
      // Upsert: insert with single-role array OR append-distinct on conflict.
      const insertedRows = await tx
        .insert(DbSchema.ticketParticipants)
        .values({
          ticketId: params.ticketId,
          tenantId: params.tenantId,
          userId: params.userId,
          roles: [params.role],
          subscribed: params.subscribe ? "true" : "false",
          joinedAt: params.now,
          updatedAt: params.now,
        })
        .onConflictDoUpdate({
          target: [DbSchema.ticketParticipants.ticketId, DbSchema.ticketParticipants.userId],
          set: {
            // append role if missing; keep existing subscription unless this call escalates to true
            roles: sql`(
              SELECT ARRAY(SELECT DISTINCT unnest(${DbSchema.ticketParticipants.roles} || ${[params.role]}::text[]))
            )`,
            subscribed: params.subscribe ? "true" : DbSchema.ticketParticipants.subscribed,
            updatedAt: params.now,
          },
        })
        .returning({
          xmax: sql<string>`xmax`,
        })
      // Pg `xmax = 0` on the returning row means a fresh insert (no prior row).
      return insertedRows[0]?.xmax === "0"
    },
    catch: (e) =>
      new Errors.InfrastructureError({
        component: "ticket.upsertParticipant",
        message: String(e),
      }),
  })

/** Toggle the explicit subscription flag. */
export const setSubscription = (
  tx: DrizzleTx,
  params: { ticketId: TicketId; userId: UserId; subscribed: boolean; now: Date },
) =>
  Effect.tryPromise({
    try: async () => {
      const rows = await tx
        .update(DbSchema.ticketParticipants)
        .set({
          subscribed: params.subscribed ? "true" : "false",
          updatedAt: params.now,
        })
        .where(
          and(
            eq(DbSchema.ticketParticipants.ticketId, params.ticketId),
            eq(DbSchema.ticketParticipants.userId, params.userId),
          ),
        )
        .returning()
      return rows[0] ?? null
    },
    catch: (e) =>
      new Errors.InfrastructureError({
        component: "ticket.setSubscription",
        message: String(e),
      }),
  })
