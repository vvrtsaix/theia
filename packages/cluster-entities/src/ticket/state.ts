import { Schema as DbSchema, type DrizzleTx } from "@theia/db"
import { Entities, Errors, type TenantId, type TicketId } from "@theia/domain"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

/**
 * In-memory state held by the `TicketEntity` actor between messages. The
 * actor loads it from the DB on its first message and writes through on each
 * mutation; a stale `expectedVersion` from the caller raises `StaleVersion`.
 *
 * Workflow is re-read on every mutation — admins can change it mid-flight,
 * and validation must use the current rules. Cached lookups would be racy.
 */
export interface TicketState {
  readonly ticket: Entities.Ticket
  readonly tags: ReadonlyArray<Entities.TicketTag>
  readonly participants: ReadonlyMap<string, Entities.TicketParticipant>
}

/** Load a ticket + its tags + participants from the DB. Returns null when absent. */
export const loadState = (tx: DrizzleTx, ticketId: TicketId) =>
  Effect.tryPromise({
    try: async () => {
      const tickets = await tx
        .select()
        .from(DbSchema.tickets)
        .where(eq(DbSchema.tickets.id, ticketId))
        .limit(1)
      if (tickets.length === 0) return null
      const ticket = tickets[0]!

      const [tagRows, participantRows] = await Promise.all([
        tx
          .select({ tag: DbSchema.ticketTagAssignments.tag })
          .from(DbSchema.ticketTagAssignments)
          .where(eq(DbSchema.ticketTagAssignments.ticketId, ticketId)),
        tx
          .select()
          .from(DbSchema.ticketParticipants)
          .where(eq(DbSchema.ticketParticipants.ticketId, ticketId)),
      ])

      return { ticket, tags: tagRows.map((t) => t.tag), participantRows }
    },
    catch: (e) =>
      new Errors.InfrastructureError({ component: "ticket.loadState", message: String(e) }),
  })

/** Load the tenant's Workflow row. Validation against this happens on every mutation. */
export const loadWorkflow = (tx: DrizzleTx, tenantId: TenantId) =>
  Effect.gen(function* () {
    const rows = yield* Effect.tryPromise({
      try: () =>
        tx
          .select()
          .from(DbSchema.workflows)
          .where(eq(DbSchema.workflows.tenantId, tenantId))
          .limit(1),
      catch: (e) =>
        new Errors.InfrastructureError({
          component: "ticket.loadWorkflow",
          message: String(e),
        }),
    })
    if (rows.length === 0) {
      return yield* new Errors.NotFound({ resource: "workflow", id: tenantId })
    }
    const row = rows[0]!
    return yield* Schema.decodeUnknownEffect(Entities.Workflow)({
      tenantId: row.tenantId,
      statuses: row.statuses,
      priorities: row.priorities,
      transitions: row.transitions,
      types: row.types,
      tags: row.tags,
      defaultStatus: row.defaultStatus,
      defaultPriority: row.defaultPriority,
      defaultTypeKey: row.defaultTypeKey,
      updatedAt: row.updatedAt.toISOString(),
    }).pipe(
      Effect.catchTag("SchemaError", (e) =>
        Effect.die(new Error(`workflow row failed domain decode: ${String(e)}`)),
      ),
    )
  })

export const decodeTicket = (
  row: typeof DbSchema.tickets.$inferSelect,
  tags: ReadonlyArray<string>,
) =>
  Schema.decodeUnknownEffect(Entities.Ticket)({
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    typeKey: row.typeKey,
    tags,
    assigneeId: row.assigneeId,
    reporterId: row.reporterId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`ticket row failed domain decode: ${String(e)}`)),
    ),
  )

export const decodeParticipant = (row: typeof DbSchema.ticketParticipants.$inferSelect) =>
  Schema.decodeUnknownEffect(Entities.TicketParticipant)({
    ticketId: row.ticketId,
    tenantId: row.tenantId,
    userId: row.userId,
    roles: row.roles,
    subscribed: row.subscribed === "true",
    joinedAt: row.joinedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`participant row failed decode: ${String(e)}`)),
    ),
  )
