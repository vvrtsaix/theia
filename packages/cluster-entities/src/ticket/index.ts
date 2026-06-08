import { Database, Schema as DbSchema, type DrizzleTx } from "@theia/db"
import {
  ClusterMessages,
  type Entities,
  Errors,
  Events,
  type TenantId,
  type TicketEventId,
  type TicketId,
  type UserId,
} from "@theia/domain"
import { and, eq } from "drizzle-orm"
import { DateTime, Effect, Schema, Stream } from "effect"
import { Entity } from "effect/unstable/cluster"
import { appendEvent } from "#ticket/events"
import { setSubscription, upsertParticipant } from "#ticket/participation"
import { decodeParticipant, decodeTicket, loadWorkflow } from "#ticket/state"

/**
 * `TicketEntity` Behavior — one actor per ticket.
 *
 * Address shape: `<tenantId>:<ticketId>`. The entity reads both halves from
 * its `CurrentAddress` so it can bind `app.tenant_id` for RLS and target the
 * right row.
 *
 * Each handler:
 *   1. Opens a tx via `Database.txAs(tenantId, ...)`.
 *   2. Loads current ticket row + tags + participants.
 *   3. Reads the tenant `Workflow` (fresh — admin may have edited mid-flight).
 *   4. Validates `expectedVersion` and message-specific invariants.
 *   5. Writes through (ticket row + ticket_event log + participant rows) in
 *      one atomic tx → bumps `ticket.version` by 1.
 *   6. Returns the updated `Ticket` projection.
 */

// ────────────────────────────────────────────────────────────────────────────
// Address parsing
// ────────────────────────────────────────────────────────────────────────────

const parseAddress = Effect.gen(function* () {
  const addr = yield* Entity.CurrentAddress
  const id = String(addr.entityId)
  const idx = id.indexOf(":")
  if (idx <= 0 || idx === id.length - 1) {
    return yield* Effect.die(
      new Error(`TicketEntity address must be "<tenantId>:<ticketId>", got: ${id}`),
    )
  }
  return {
    tenantId: id.slice(0, idx) as TenantId,
    ticketId: id.slice(idx + 1) as TicketId,
  }
})

// ────────────────────────────────────────────────────────────────────────────
// State load + version guard
// ────────────────────────────────────────────────────────────────────────────

interface LoadedState {
  readonly ticket: typeof DbSchema.tickets.$inferSelect
  readonly tags: ReadonlyArray<string>
}

const loadOrFail = (tx: DrizzleTx, ticketId: TicketId): Promise<LoadedState | null> =>
  (async () => {
    const tickets = await tx
      .select()
      .from(DbSchema.tickets)
      .where(eq(DbSchema.tickets.id, ticketId))
      .limit(1)
    if (tickets.length === 0) return null
    const tagRows = await tx
      .select({ tag: DbSchema.ticketTagAssignments.tag })
      .from(DbSchema.ticketTagAssignments)
      .where(eq(DbSchema.ticketTagAssignments.ticketId, ticketId))
    return { ticket: tickets[0]!, tags: tagRows.map((t) => t.tag) }
  })()

const ensureVersion = (
  ticketId: TicketId,
  actual: number,
  expected: number,
): Errors.StaleVersion | null =>
  actual === expected ? null : new Errors.StaleVersion({ ticketId, expected, actual })

// ────────────────────────────────────────────────────────────────────────────
// Event helpers
// ────────────────────────────────────────────────────────────────────────────

const newEventId = () => crypto.randomUUID() as TicketEventId

const envelope = (tenantId: TenantId, ticketId: TicketId, version: number, occurredAt: Date) => ({
  eventId: newEventId(),
  ticketId,
  tenantId,
  occurredAt: occurredAt.toISOString() as unknown as Events.TicketEvent extends {
    occurredAt: infer T
  }
    ? T
    : never,
  version,
  v: 1 as const,
})

// ────────────────────────────────────────────────────────────────────────────
// Handler scaffolding — load → validate → mutate → emit → return
// ────────────────────────────────────────────────────────────────────────────

/** Auto-participation: idempotent add + escalate subscription. */
const autoParticipate = (
  tx: DrizzleTx,
  tenantId: TenantId,
  ticketId: TicketId,
  userId: UserId,
  role: "reporter" | "assignee" | "commenter" | "mentioned" | "watcher",
  now: Date,
) =>
  upsertParticipant(tx, {
    ticketId,
    tenantId,
    userId,
    role,
    subscribe: true,
    now,
  })

// ────────────────────────────────────────────────────────────────────────────
// Behavior
// ────────────────────────────────────────────────────────────────────────────

export const TicketEntityLive = ClusterMessages.TicketEntity.toLayer(
  Effect.gen(function* () {
    const db = yield* Database

    return ClusterMessages.TicketEntity.of({
      // ─── reads ────────────────────────────────────────────────────────────
      Get: () =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          return yield* decodeTicket(state.ticket, state.tags)
        }),

      // ─── creation ─────────────────────────────────────────────────────────
      Open: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const result = yield* db.txAs(tenantId, async (tx) => {
            // Concurrent Open guard — Pg PK on ticket.id rejects duplicates.
            const exists = await tx
              .select({ id: DbSchema.tickets.id })
              .from(DbSchema.tickets)
              .where(eq(DbSchema.tickets.id, ticketId))
              .limit(1)
            if (exists.length > 0) return { kind: "duplicate" as const }

            return { kind: "ok" as const, nowDate }
          })

          if (result.kind === "duplicate") {
            return yield* new Errors.ValidationError({
              field: "id",
              message: `ticket ${ticketId} already exists`,
            })
          }

          // Workflow validation (fresh).
          const workflow = yield* db
            .txAs(tenantId, (tx) => Promise.resolve(tx))
            .pipe(
              Effect.flatMap((tx) => loadWorkflow(tx, payload.tenantId)),
              Effect.catchTag("NotFound", () =>
                Effect.fail(
                  new Errors.ValidationError({
                    field: "tenantId",
                    message: "tenant workflow not seeded",
                  }),
                ),
              ),
            )
          if (!workflow.priorities.some((p) => p.key === payload.priority)) {
            return yield* new Errors.ValidationError({
              field: "priority",
              message: `unknown priority ${payload.priority}`,
            })
          }
          if (payload.typeKey !== null && !workflow.types.some((t) => t.key === payload.typeKey)) {
            return yield* new Errors.InvalidType({
              tenantId: payload.tenantId,
              type: payload.typeKey,
            })
          }
          for (const tag of payload.tags) {
            if (!workflow.tags.some((wt) => wt.key === tag)) {
              return yield* new Errors.InvalidTag({ tenantId: payload.tenantId, tag })
            }
          }

          // Atomic write: ticket + tags + reporter participant + opened event.
          const event = {
            ...envelope(payload.tenantId, ticketId, 1, nowDate),
            _tag: "TicketOpened" as const,
            reporterId: payload.reporterId,
            title: payload.title,
            description: payload.description,
            priority: payload.priority,
            typeKey: payload.typeKey,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(payload.tenantId, async (tx) => {
            const insertedTickets = await tx
              .insert(DbSchema.tickets)
              .values({
                id: ticketId,
                tenantId: payload.tenantId,
                title: payload.title,
                description: payload.description,
                status: workflow.defaultStatus,
                priority: payload.priority,
                typeKey: payload.typeKey,
                assigneeId: null,
                reporterId: payload.reporterId,
                version: 1,
                createdAt: nowDate,
                updatedAt: nowDate,
              })
              .returning()

            if (payload.tags.length > 0) {
              await tx.insert(DbSchema.ticketTagAssignments).values(
                payload.tags.map((tag) => ({
                  ticketId,
                  tag,
                  tenantId: payload.tenantId,
                })),
              )
            }

            await tx.insert(DbSchema.ticketParticipants).values({
              ticketId,
              tenantId: payload.tenantId,
              userId: payload.reporterId,
              roles: ["reporter"],
              subscribed: "true",
              joinedAt: nowDate,
              updatedAt: nowDate,
            })

            return insertedTickets[0]!
          })

          yield* db.txAs(payload.tenantId, (tx) => Effect.runPromise(appendEvent(tx, event)))
          return yield* decodeTicket(updated, payload.tags as ReadonlyArray<string>)
        }),

      // ─── assign / unassign ────────────────────────────────────────────────
      Assign: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          const versionErr = ensureVersion(ticketId, state.ticket.version, payload.expectedVersion)
          if (versionErr) return yield* versionErr

          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketAssigned" as const,
            assigneeId: payload.assigneeId,
            assignedBy: payload.actorId,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            const rows = await tx
              .update(DbSchema.tickets)
              .set({
                assigneeId: payload.assigneeId,
                version: nextVersion,
                updatedAt: nowDate,
              })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            return rows[0]!
          })
          yield* db.txAs(tenantId, async (tx) => {
            await Effect.runPromise(
              autoParticipate(tx, tenantId, ticketId, payload.assigneeId, "assignee", nowDate),
            )
            await Effect.runPromise(appendEvent(tx, event))
          })

          return yield* decodeTicket(updated, state.tags)
        }),

      Unassign: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          const versionErr = ensureVersion(ticketId, state.ticket.version, payload.expectedVersion)
          if (versionErr) return yield* versionErr

          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketUnassigned" as const,
            unassignedBy: payload.actorId,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            const rows = await tx
              .update(DbSchema.tickets)
              .set({ assigneeId: null, version: nextVersion, updatedAt: nowDate })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })
          return yield* decodeTicket(updated, state.tags)
        }),

      // ─── transition ───────────────────────────────────────────────────────
      Transition: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          const versionErr = ensureVersion(ticketId, state.ticket.version, payload.expectedVersion)
          if (versionErr) return yield* versionErr

          const workflow = yield* db
            .txAs(tenantId, (tx) => Promise.resolve(tx))
            .pipe(Effect.flatMap((tx) => loadWorkflow(tx, tenantId)))

          const from = state.ticket.status as Entities.TicketStatus
          const to = payload.to
          if (from !== to && !workflow.transitions.some((t) => t.from === from && t.to === to)) {
            return yield* new Errors.InvalidTransition({ ticketId, from, to })
          }
          if (!workflow.statuses.some((s) => s.key === to)) {
            return yield* new Errors.InvalidTransition({ ticketId, from, to })
          }

          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketTransitioned" as const,
            from,
            to,
            actorId: payload.actorId,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            const rows = await tx
              .update(DbSchema.tickets)
              .set({ status: to, version: nextVersion, updatedAt: nowDate })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })
          return yield* decodeTicket(updated, state.tags)
        }),

      // ─── change priority / type ───────────────────────────────────────────
      ChangePriority: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          const versionErr = ensureVersion(ticketId, state.ticket.version, payload.expectedVersion)
          if (versionErr) return yield* versionErr

          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketPriorityChanged" as const,
            from: state.ticket.priority as Entities.TicketPriority,
            to: payload.to,
            actorId: payload.actorId,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            const rows = await tx
              .update(DbSchema.tickets)
              .set({ priority: payload.to, version: nextVersion, updatedAt: nowDate })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })
          return yield* decodeTicket(updated, state.tags)
        }),

      ChangeType: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          const versionErr = ensureVersion(ticketId, state.ticket.version, payload.expectedVersion)
          if (versionErr) return yield* versionErr

          if (payload.to !== null) {
            const workflow = yield* db
              .txAs(tenantId, (tx) => Promise.resolve(tx))
              .pipe(Effect.flatMap((tx) => loadWorkflow(tx, tenantId)))
            if (!workflow.types.some((t) => t.key === payload.to)) {
              return yield* new Errors.InvalidType({ tenantId, type: payload.to })
            }
          }

          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketTypeChanged" as const,
            from: state.ticket.typeKey as Entities.TicketType | null,
            to: payload.to,
            actorId: payload.actorId,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            const rows = await tx
              .update(DbSchema.tickets)
              .set({ typeKey: payload.to, version: nextVersion, updatedAt: nowDate })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })
          return yield* decodeTicket(updated, state.tags)
        }),

      // ─── tag mutations ────────────────────────────────────────────────────
      AddTag: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          // Validate tag against workflow.
          const workflow = yield* db
            .txAs(tenantId, (tx) => Promise.resolve(tx))
            .pipe(Effect.flatMap((tx) => loadWorkflow(tx, tenantId)))
          if (!workflow.tags.some((t) => t.key === payload.tag)) {
            return yield* new Errors.InvalidTag({ tenantId, tag: payload.tag })
          }
          // Idempotent: if already present, return unchanged ticket.
          if (state.tags.includes(payload.tag)) {
            return yield* decodeTicket(state.ticket, state.tags)
          }

          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketTagAdded" as const,
            tag: payload.tag,
            actorId: payload.actorId,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            await tx.insert(DbSchema.ticketTagAssignments).values({
              ticketId,
              tenantId,
              tag: payload.tag,
            })
            const rows = await tx
              .update(DbSchema.tickets)
              .set({ version: nextVersion, updatedAt: nowDate })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })
          return yield* decodeTicket(updated, [...state.tags, payload.tag])
        }),

      RemoveTag: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          if (!state.tags.includes(payload.tag)) {
            return yield* decodeTicket(state.ticket, state.tags)
          }
          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketTagRemoved" as const,
            tag: payload.tag,
            actorId: payload.actorId,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            await tx
              .delete(DbSchema.ticketTagAssignments)
              .where(
                and(
                  eq(DbSchema.ticketTagAssignments.ticketId, ticketId),
                  eq(DbSchema.ticketTagAssignments.tag, payload.tag),
                ),
              )
            const rows = await tx
              .update(DbSchema.tickets)
              .set({ version: nextVersion, updatedAt: nowDate })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })
          return yield* decodeTicket(
            updated,
            state.tags.filter((t) => t !== payload.tag),
          )
        }),

      // ─── comments ─────────────────────────────────────────────────────────
      Comment: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }

          const nextVersion = state.ticket.version + 1
          const event = {
            ...envelope(tenantId, ticketId, nextVersion, nowDate),
            _tag: "TicketCommented" as const,
            authorId: payload.authorId,
            body: payload.body,
            mentions: payload.mentions,
          } satisfies Events.TicketEvent

          const updated = yield* db.txAs(tenantId, async (tx) => {
            // Bump version + updated_at.
            const rows = await tx
              .update(DbSchema.tickets)
              .set({ version: nextVersion, updatedAt: nowDate })
              .where(eq(DbSchema.tickets.id, ticketId))
              .returning()
            // Auto-participate author + mentions.
            await Effect.runPromise(
              autoParticipate(tx, tenantId, ticketId, payload.authorId, "commenter", nowDate),
            )
            for (const mention of payload.mentions) {
              await Effect.runPromise(
                autoParticipate(tx, tenantId, ticketId, mention, "mentioned", nowDate),
              )
            }
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })
          return yield* decodeTicket(updated, state.tags)
        }),

      // ─── subscriptions ────────────────────────────────────────────────────
      Subscribe: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }

          // Check existing subscription state.
          const existing = yield* db.txAs(tenantId, (tx) =>
            tx
              .select()
              .from(DbSchema.ticketParticipants)
              .where(
                and(
                  eq(DbSchema.ticketParticipants.ticketId, ticketId),
                  eq(DbSchema.ticketParticipants.userId, payload.userId),
                ),
              )
              .limit(1),
          )
          if (existing.length > 0 && existing[0]?.subscribed === "true") {
            return yield* new Errors.AlreadySubscribed({ ticketId, userId: payload.userId })
          }

          const event = {
            ...envelope(tenantId, ticketId, state.ticket.version, nowDate),
            _tag: "TicketSubscribed" as const,
            userId: payload.userId,
            explicit: true,
          } satisfies Events.TicketEvent

          const updatedRow = yield* db.txAs(tenantId, async (tx) => {
            await Effect.runPromise(
              autoParticipate(tx, tenantId, ticketId, payload.userId, "watcher", nowDate),
            )
            const rows = await tx
              .select()
              .from(DbSchema.ticketParticipants)
              .where(
                and(
                  eq(DbSchema.ticketParticipants.ticketId, ticketId),
                  eq(DbSchema.ticketParticipants.userId, payload.userId),
                ),
              )
              .limit(1)
            await Effect.runPromise(appendEvent(tx, event))
            return rows[0]!
          })

          return yield* decodeParticipant(updatedRow)
        }),

      Unsubscribe: ({ payload }) =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const now = yield* DateTime.now
          const nowDate = DateTime.toDate(now)

          const state = yield* db.txAs(tenantId, (tx) => loadOrFail(tx, ticketId))
          if (!state) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }

          const existing = yield* db.txAs(tenantId, (tx) =>
            tx
              .select()
              .from(DbSchema.ticketParticipants)
              .where(
                and(
                  eq(DbSchema.ticketParticipants.ticketId, ticketId),
                  eq(DbSchema.ticketParticipants.userId, payload.userId),
                ),
              )
              .limit(1),
          )
          if (existing.length === 0 || existing[0]?.subscribed === "false") {
            return yield* new Errors.NotSubscribed({ ticketId, userId: payload.userId })
          }

          const updated = yield* db.txAs(tenantId, (tx) =>
            Effect.runPromise(
              setSubscription(tx, {
                ticketId,
                userId: payload.userId,
                subscribed: false,
                now: nowDate,
              }),
            ),
          )
          if (!updated) {
            return yield* new Errors.NotSubscribed({ ticketId, userId: payload.userId })
          }

          const event = {
            ...envelope(tenantId, ticketId, state.ticket.version, nowDate),
            _tag: "TicketUnsubscribed" as const,
            userId: payload.userId,
          } satisfies Events.TicketEvent

          yield* db.txAs(tenantId, (tx) => Effect.runPromise(appendEvent(tx, event)))
          return yield* decodeParticipant(updated)
        }),

      // ─── participants list ────────────────────────────────────────────────
      ListParticipants: () =>
        Effect.gen(function* () {
          const { tenantId, ticketId } = yield* parseAddress
          const exists = yield* db.txAs(tenantId, (tx) =>
            tx
              .select({ id: DbSchema.tickets.id })
              .from(DbSchema.tickets)
              .where(eq(DbSchema.tickets.id, ticketId))
              .limit(1),
          )
          if (exists.length === 0) {
            return yield* new Errors.NotFound({ resource: "ticket", id: ticketId })
          }
          const rows = yield* db.txAs(tenantId, (tx) =>
            tx
              .select()
              .from(DbSchema.ticketParticipants)
              .where(eq(DbSchema.ticketParticipants.ticketId, ticketId)),
          )
          return yield* Effect.forEach(rows, decodeParticipant)
        }),

      // ─── event stream ─────────────────────────────────────────────────────
      //
      // Pull-style stream: replay all persisted events for this ticket. Live
      // tailing for the RPC boundary lives in `rpc-server/handlers/ticket.ts`
      // via the `@theia/db` `EventChannel` (Pg LISTEN/NOTIFY → PubSub).
      //
      // `Stream.unwrap` flattens an `Effect<Stream>` into a `Stream` so the
      // existence check + DB load happen inside the stream's error channel.
      SubscribeEvents: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { tenantId, ticketId } = yield* parseAddress
            const exists = yield* db.txAs(tenantId, (tx) =>
              tx
                .select({ id: DbSchema.tickets.id })
                .from(DbSchema.tickets)
                .where(eq(DbSchema.tickets.id, ticketId))
                .limit(1),
            )
            if (exists.length === 0) {
              return Stream.fail(new Errors.NotFound({ resource: "ticket", id: ticketId }))
            }
            const rows = yield* db.txAs(tenantId, (tx) =>
              tx
                .select()
                .from(DbSchema.ticketEvents)
                .where(eq(DbSchema.ticketEvents.ticketId, ticketId))
                .orderBy(DbSchema.ticketEvents.version),
            )
            return Stream.fromIterable(rows.map((r) => r.event)).pipe(
              Stream.mapEffect((event) => Schema.decodeUnknownEffect(Events.TicketEvent)(event)),
              Stream.catchTag("SchemaError", (e) =>
                Stream.die(new Error(`ticket_event row failed decode: ${String(e)}`)),
              ),
            )
          }),
        ),
    })
  }),
  { maxIdleTime: "10 minutes" },
)

export * from "#ticket/events"
export * from "#ticket/participation"
export * from "#ticket/state"
