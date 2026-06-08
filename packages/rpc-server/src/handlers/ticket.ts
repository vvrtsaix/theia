import { CurrentSession, Database, Schema as DbSchema } from "@theia/db"
import {
  ClusterMessages,
  Rpc as DomainRpc,
  Entities,
  Errors,
  type TenantId,
  type TicketId,
  type UserId,
} from "@theia/domain"
import { Events } from "@theia/domain"
import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm"
import { Effect, Ref, Schema, Stream } from "effect"
import { intoInfra } from "#handlers/_shared"

/**
 * Ticket RPC handlers.
 *
 *   - **Reads** (`list`, `get`, `listParticipants`) — Drizzle query builder
 *     inside `Database.tx` so RLS isolates rows.
 *
 *   - **Mutations** (`open`, `assign`, `transition`, ...) — delegated to the
 *     `TicketEntity` actor. The actor enforces workflow + version invariants
 *     and emits events. Cluster runtime layer is provided in Phase 5.
 *
 *   - **Streams** (`events`) — proxied through `TicketEntity.SubscribeEvents`.
 *
 * Cluster-layer errors (`MailboxFull`, `PersistenceError`, ...) are mapped to
 * `InfrastructureError` at this boundary so the RPC error union stays
 * domain-only.
 */

type TicketRow = typeof DbSchema.tickets.$inferSelect
type ParticipantRow = typeof DbSchema.ticketParticipants.$inferSelect

const decodeTicket = (row: TicketRow, tags: ReadonlyArray<string>) =>
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

const decodeSummary = (row: TicketRow & { tags: ReadonlyArray<string> }) =>
  Schema.decodeUnknownEffect(Entities.TicketSummary)({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    typeKey: row.typeKey,
    tags: row.tags,
    assigneeId: row.assigneeId,
    updatedAt: row.updatedAt.toISOString(),
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`ticket summary failed decode: ${String(e)}`)),
    ),
  )

const decodeParticipant = (row: ParticipantRow) =>
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

/**
 * Resolve the TicketEntity client for `(tenantId, ticketId)`.
 *
 * The cluster entity address is `<tenantId>:<ticketId>` — the actor parses
 * both halves out of `CurrentAddress` to bind RLS and target the row. The
 * RPC payloads only carry `ticketId`; tenant comes from `CurrentSession`.
 */
const entityFor = (tenantId: string, ticketId: TicketId) =>
  ClusterMessages.TicketEntity.client.pipe(
    Effect.map((clientFor) => clientFor(`${tenantId}:${ticketId}`)),
    Effect.mapError(intoInfra("ticket.entity-client")),
  )

/** Convenience: pull the active tenant from session + build the entity client. */
const entityForCurrent = (ticketId: TicketId) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    return yield* entityFor(session.activeOrganizationId as unknown as string, ticketId)
  })

export const TicketHandlers = DomainRpc.TicketRpc.toLayer({
  "ticket.list": (payload) =>
    Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const limit = payload.limit ?? 50
      const cursorDate = payload.cursor ? new Date(payload.cursor) : null

      const { rows, tagsByTicket } = yield* db.tx(async (tx) => {
        const conditions = [eq(DbSchema.tickets.tenantId, session.activeOrganizationId)]
        if (cursorDate) conditions.push(lt(DbSchema.tickets.updatedAt, cursorDate))
        if (session.userKind === "customer") {
          const visible = or(
            eq(DbSchema.tickets.reporterId, session.userId),
            eq(DbSchema.tickets.assigneeId, session.userId),
          )
          if (visible) conditions.push(visible)
        }

        const rows = await tx
          .select()
          .from(DbSchema.tickets)
          .where(and(...conditions))
          .orderBy(desc(DbSchema.tickets.updatedAt))
          .limit(limit + 1)

        if (rows.length === 0) {
          return { rows, tagsByTicket: new Map<string, Array<string>>() }
        }
        const ids = rows.map((r) => r.id)
        const tagRows = await tx
          .select({
            ticketId: DbSchema.ticketTagAssignments.ticketId,
            tag: DbSchema.ticketTagAssignments.tag,
          })
          .from(DbSchema.ticketTagAssignments)
          .where(inArray(DbSchema.ticketTagAssignments.ticketId, ids))

        const tagsByTicket = new Map<string, Array<string>>()
        for (const t of tagRows) {
          const list = tagsByTicket.get(t.ticketId) ?? []
          list.push(t.tag)
          tagsByTicket.set(t.ticketId, list)
        }
        return { rows, tagsByTicket }
      })

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const items = yield* Effect.forEach(page, (row) =>
        decodeSummary({ ...row, tags: tagsByTicket.get(row.id) ?? [] }),
      )
      const last = page.at(-1)
      return {
        items,
        nextCursor: hasMore && last ? last.updatedAt.toISOString() : null,
      }
    }),

  "ticket.get": (payload) =>
    Effect.gen(function* () {
      const db = yield* Database
      const result = yield* db.tx(async (tx) => {
        const ticketRows = await tx
          .select()
          .from(DbSchema.tickets)
          .where(eq(DbSchema.tickets.id, payload.id))
          .limit(1)
        if (ticketRows.length === 0) return null
        const tagRows = await tx
          .select({ tag: DbSchema.ticketTagAssignments.tag })
          .from(DbSchema.ticketTagAssignments)
          .where(eq(DbSchema.ticketTagAssignments.ticketId, payload.id))
        return { row: ticketRows[0]!, tags: tagRows.map((t) => t.tag) }
      })
      if (!result) {
        return yield* new Errors.NotFound({ resource: "ticket", id: payload.id })
      }
      return yield* decodeTicket(result.row, result.tags)
    }),

  // ─── Mutations — delegate to TicketEntity actor (Phase 5 wires runtime) ──

  "ticket.open": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      // `TicketEntity` address shape is `<tenantId>:<ticketId>` — the actor
      // parses both halves in `parseAddress`. Generate the ticket id here so
      // the success response can return it without a second round-trip.
      const ticketId = crypto.randomUUID() as TicketId
      // better-auth models tenants as Organizations; the domain model uses
      // TenantId. Identifiers are isomorphic at runtime — cast at this
      // boundary instead of leaking the duplicate brand through handlers.
      const tenantId = session.activeOrganizationId as unknown as TenantId
      const address = `${tenantId}:${ticketId}`
      const clientFor = yield* ClusterMessages.TicketEntity.client.pipe(
        Effect.mapError(intoInfra("ticket.entity-client")),
      )
      const entity = clientFor(address)
      return yield* entity
        .Open({
          tenantId,
          reporterId: session.userId,
          title: payload.title,
          description: payload.description,
          priority: payload.priority,
          typeKey: payload.typeKey,
          tags: payload.tags ?? [],
        })
        .pipe(
          Effect.catchTags({
            ValidationError: Effect.fail,
            InvalidType: Effect.fail,
            InvalidTag: Effect.fail,
          }),
          Effect.catch((e) => Effect.fail(intoInfra("ticket.open")(e))),
        )
    }),

  "ticket.assign": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket
        .Assign({
          assigneeId: payload.assigneeId,
          actorId: session.userId,
          expectedVersion: payload.expectedVersion,
        })
        .pipe(
          Effect.catchTags({ NotFound: Effect.fail, StaleVersion: Effect.fail }),
          Effect.catch((e) => Effect.fail(intoInfra("ticket.assign")(e))),
        )
    }),

  "ticket.unassign": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket
        .Unassign({ actorId: session.userId, expectedVersion: payload.expectedVersion })
        .pipe(
          Effect.catchTags({ NotFound: Effect.fail, StaleVersion: Effect.fail }),
          Effect.catch((e) => Effect.fail(intoInfra("ticket.unassign")(e))),
        )
    }),

  "ticket.transition": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket
        .Transition({
          to: payload.to,
          actorId: session.userId,
          expectedVersion: payload.expectedVersion,
        })
        .pipe(
          Effect.catchTags({
            NotFound: Effect.fail,
            StaleVersion: Effect.fail,
            InvalidTransition: Effect.fail,
          }),
          Effect.catch((e) => Effect.fail(intoInfra("ticket.transition")(e))),
        )
    }),

  "ticket.changePriority": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket
        .ChangePriority({
          to: payload.to,
          actorId: session.userId,
          expectedVersion: payload.expectedVersion,
        })
        .pipe(
          Effect.catchTags({ NotFound: Effect.fail, StaleVersion: Effect.fail }),
          Effect.catch((e) => Effect.fail(intoInfra("ticket.changePriority")(e))),
        )
    }),

  "ticket.setType": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket
        .ChangeType({
          to: payload.to,
          actorId: session.userId,
          expectedVersion: payload.expectedVersion,
        })
        .pipe(
          Effect.catchTags({
            NotFound: Effect.fail,
            InvalidType: Effect.fail,
            StaleVersion: Effect.fail,
          }),
          Effect.catch((e) => Effect.fail(intoInfra("ticket.setType")(e))),
        )
    }),

  "ticket.addTag": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket.AddTag({ tag: payload.tag, actorId: session.userId }).pipe(
        Effect.catchTags({ NotFound: Effect.fail, InvalidTag: Effect.fail }),
        Effect.catch((e) => Effect.fail(intoInfra("ticket.addTag")(e))),
      )
    }),

  "ticket.removeTag": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket.RemoveTag({ tag: payload.tag, actorId: session.userId }).pipe(
        Effect.catchTag("NotFound", Effect.fail),
        Effect.catch((e) => Effect.fail(intoInfra("ticket.removeTag")(e))),
      )
    }),

  "ticket.comment": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      const mentions: ReadonlyArray<UserId> = [] // @mention parsing → Phase 5
      return yield* ticket.Comment({ authorId: session.userId, body: payload.body, mentions }).pipe(
        Effect.catchTag("NotFound", Effect.fail),
        Effect.catch((e) => Effect.fail(intoInfra("ticket.comment")(e))),
      )
    }),

  // ─── Participants + subscriptions ─────────────────────────────────────────

  "ticket.listParticipants": (payload) =>
    Effect.gen(function* () {
      const db = yield* Database
      const result = yield* db.tx(async (tx) => {
        const ticketExists = await tx
          .select({ id: DbSchema.tickets.id })
          .from(DbSchema.tickets)
          .where(eq(DbSchema.tickets.id, payload.id))
          .limit(1)
        if (ticketExists.length === 0) return null
        const rows = await tx
          .select()
          .from(DbSchema.ticketParticipants)
          .where(eq(DbSchema.ticketParticipants.ticketId, payload.id))
        return rows
      })
      if (!result) {
        return yield* new Errors.NotFound({ resource: "ticket", id: payload.id })
      }
      return yield* Effect.forEach(result, decodeParticipant)
    }),

  "ticket.subscribe": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket.Subscribe({ userId: session.userId }).pipe(
        Effect.catchTags({ NotFound: Effect.fail, AlreadySubscribed: Effect.fail }),
        Effect.catch((e) => Effect.fail(intoInfra("ticket.subscribe")(e))),
      )
    }),

  "ticket.unsubscribe": (payload) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      const ticket = yield* entityForCurrent(payload.id)
      return yield* ticket.Unsubscribe({ userId: session.userId }).pipe(
        Effect.catchTags({ NotFound: Effect.fail, NotSubscribed: Effect.fail }),
        Effect.catch((e) => Effect.fail(intoInfra("ticket.unsubscribe")(e))),
      )
    }),

  "ticket.events": (payload) => {
    // Cast: handler-signature inference narrows the Stream error channel to
    // `NotFound`, but the RPC contract's union (`AuthErrors ∪ NotFound`)
    // also covers `InfrastructureError` from the DB layer. Runtime contract
    // holds — the casts just satisfy the call site.
    const build = Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const ticketId = payload.id

      // Membership guard — ticket must belong to the active tenant. RLS
      // would mask cross-tenant rows but we want to return `NotFound`
      // explicitly so clients distinguish from "exists but empty log".
      const exists = yield* db.tx(async (tx) =>
        tx
          .select({ id: DbSchema.tickets.id })
          .from(DbSchema.tickets)
          .where(
            and(
              eq(DbSchema.tickets.id, ticketId),
              eq(DbSchema.tickets.tenantId, session.activeOrganizationId),
            ),
          )
          .limit(1),
      )
      if (exists.length === 0) {
        return Stream.fail(new Errors.NotFound({ resource: "ticket", id: ticketId }))
      }

      const decode = (row: typeof DbSchema.ticketEvents.$inferSelect) =>
        Schema.decodeUnknownEffect(Events.TicketEvent)(row.event).pipe(
          Effect.catchTag("SchemaError", (e) =>
            Effect.die(new Error(`ticket_event row failed decode: ${String(e)}`)),
          ),
        )

      // Historical replay — every persisted event in version order.
      const history = yield* db.tx(async (tx) =>
        tx
          .select()
          .from(DbSchema.ticketEvents)
          .where(eq(DbSchema.ticketEvents.ticketId, ticketId))
          .orderBy(asc(DbSchema.ticketEvents.version)),
      )
      const past = yield* Effect.forEach(history, decode)
      const lastVersion = yield* Ref.make(past.length > 0 ? past[past.length - 1]!.version : 0)

      // Live tail — poll the event log every 2 seconds for new rows. Pg
      // LISTEN/NOTIFY (already triggered by `0003_listen_notify_triggers.sql`)
      // is a follow-up optimisation; polling keeps the wire format identical.
      const tail = Stream.tick("2 seconds").pipe(
        Stream.mapEffect(() =>
          Effect.gen(function* () {
            const since = yield* Ref.get(lastVersion)
            const rows = yield* db.tx(async (tx) =>
              tx
                .select()
                .from(DbSchema.ticketEvents)
                .where(
                  and(
                    eq(DbSchema.ticketEvents.ticketId, ticketId),
                    gt(DbSchema.ticketEvents.version, since),
                  ),
                )
                .orderBy(asc(DbSchema.ticketEvents.version)),
            )
            const decoded = yield* Effect.forEach(rows, decode)
            if (decoded.length > 0) {
              yield* Ref.set(lastVersion, decoded[decoded.length - 1]!.version)
            }
            return decoded as ReadonlyArray<Events.TicketEvent>
          }),
        ),
        Stream.flatMap((chunk) => Stream.fromIterable(chunk)),
      )

      return Stream.concat(Stream.fromIterable(past), tail)
    })
    return Stream.unwrap(build as never) as never
  },
})
