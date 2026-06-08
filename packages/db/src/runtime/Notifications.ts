import type { Events } from "@theia/domain"
import { and, eq, ne } from "drizzle-orm"
import { Cause, Context, Effect, Layer, Stream } from "effect"
import { Database, type DrizzleTx } from "#runtime/Database"
import { EventChannel } from "#runtime/EventChannel"
import * as DbSchema from "#schema"

interface RenderedEvent {
  readonly title: string
  readonly body: string | null
  /** Actor whose action shouldn't notify themselves. `null` for system events. */
  readonly actor: string | null
}

/**
 * Notification fan-out.
 *
 *   `NotificationDispatcher` — background fiber that subscribes to
 *   `EventChannel.ticketEvents` and inserts one `notification` row per
 *   (subscribed participant ≠ actor) for each event. The insert fires the
 *   `notification_inserted` pg_notify trigger (migration 0003), which
 *   feeds the `notification.stream` RPC consumers via `EventChannel`.
 *
 *   `NotificationSink` — abstract external transport (email / webhook).
 *   `LoggerSinkLive` logs each notice; production swaps in `SmtpSinkLive`
 *   or `WebhookSinkLive`. The sink runs as a separate fiber off the same
 *   `EventChannel.notifications` stream so an external outage doesn't
 *   stall in-app delivery.
 *
 * Both services live in `@theia/db` because they need DB write access +
 * the existing `EventChannel`. They run as scoped fibers — the layer
 * acquires them at startup and interrupts on shutdown.
 */

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * Single switch produces both copy and the actor to exclude. Combining
 * `renderEvent` + `actorOf` halves the per-event work and keeps both
 * outputs in lock-step when new event tags land. Empty title means "no
 * notification" (membership events are bookkeeping only).
 */
const renderEvent = (event: Events.TicketEvent): RenderedEvent => {
  switch (event._tag) {
    case "TicketOpened":
      return {
        title: `Opened: ${event.title}`,
        body: event.description || null,
        actor: event.reporterId,
      }
    case "TicketAssigned":
      return {
        title: "Assigned",
        body: `Assigned by ${event.assignedBy}`,
        actor: event.assignedBy,
      }
    case "TicketUnassigned":
      return { title: "Unassigned", body: null, actor: event.unassignedBy }
    case "TicketTransitioned":
      return { title: `Status: ${event.from} → ${event.to}`, body: null, actor: event.actorId }
    case "TicketCommented":
      return { title: "New comment", body: event.body.slice(0, 280), actor: event.authorId }
    case "TicketPriorityChanged":
      return { title: `Priority: ${event.from} → ${event.to}`, body: null, actor: event.actorId }
    case "TicketTypeChanged":
      return {
        title: `Type: ${event.from ?? "—"} → ${event.to ?? "—"}`,
        body: null,
        actor: event.actorId,
      }
    case "TicketTagAdded":
      return { title: `Tag added: ${event.tag}`, body: null, actor: event.actorId }
    case "TicketTagRemoved":
      return { title: `Tag removed: ${event.tag}`, body: null, actor: event.actorId }
    case "TicketSubscribed":
    case "TicketUnsubscribed":
    case "TicketParticipantJoined":
      return { title: "", body: null, actor: event.userId }
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export const NotificationDispatcherLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database
    const channel = yield* EventChannel

    yield* channel.ticketEvents.pipe(
      Stream.runForEach((event: Events.TicketEvent) => {
        const rendered = renderEvent(event)
        if (rendered.title === "") return Effect.void
        return db
          .txAs(event.tenantId, async (tx: DrizzleTx) => {
            const recipients = await tx
              .select({ userId: DbSchema.ticketParticipants.userId })
              .from(DbSchema.ticketParticipants)
              .where(
                and(
                  eq(DbSchema.ticketParticipants.ticketId, event.ticketId),
                  eq(DbSchema.ticketParticipants.subscribed, "true"),
                  rendered.actor
                    ? ne(DbSchema.ticketParticipants.userId, rendered.actor)
                    : undefined,
                ),
              )

            if (recipients.length === 0) return

            await tx.insert(DbSchema.notifications).values(
              recipients.map((r: { userId: string }) => ({
                tenantId: event.tenantId,
                recipientId: r.userId,
                ticketId: event.ticketId,
                eventId: event.eventId,
                channel: "in_app",
                title: rendered.title,
                body: rendered.body,
              })),
            )
          })
          .pipe(
            Effect.catch((e: { message: string }) =>
              Effect.logWarning(
                `notification dispatch failed for event ${event.eventId}: ${e.message}`,
              ),
            ),
          )
      }),
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.logError("NotificationDispatcher crashed", Cause.pretty(cause)),
      ),
      Effect.forkScoped,
    )
  }),
)

// ─── External delivery sink ────────────────────────────────────────────────

export class NotificationSink extends Context.Service<
  NotificationSink,
  {
    /** Deliver a single notification through the external channel. */
    readonly deliver: (n: {
      readonly id: string
      readonly recipientId: string
      readonly title: string
      readonly body: string | null
    }) => Effect.Effect<void>
  }
>()("@theia/db/NotificationSink") {}

/**
 * Stub sink — logs only. Use in dev / when no transport is configured.
 * Replace with `SmtpSinkLive` / `WebhookSinkLive` in prod.
 */
export const LoggerSinkLive = Layer.succeed(
  NotificationSink,
  NotificationSink.of({
    deliver: (n) => Effect.logInfo(`[sink] → user=${n.recipientId} title="${n.title}"`),
  }),
)

/**
 * Sink fan-out fiber: subscribes to `EventChannel.notifications`, fetches
 * the row, hands it to the configured `NotificationSink`. Runs as a
 * background fiber via `Layer.scopedDiscard` so a sink stall doesn't
 * affect the request path.
 */
export const NotificationSinkRunnerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database
    const channel = yield* EventChannel
    const sink = yield* NotificationSink

    // Tenant-less lookup: notification ids are UUIDv7-unique globally, and
    // the sink only needs delivery metadata. Bypass RLS by going through
    // `db.db` directly — the sink is system-side, not request-scoped.
    yield* channel.notifications.pipe(
      Stream.runForEach((notice) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db.db
              .select({
                id: DbSchema.notifications.id,
                recipientId: DbSchema.notifications.recipientId,
                title: DbSchema.notifications.title,
                body: DbSchema.notifications.body,
              })
              .from(DbSchema.notifications)
              .where(eq(DbSchema.notifications.id, notice.id))
              .limit(1)
            return rows[0] ?? null
          },
          catch: (e) => new Error(String(e)),
        }).pipe(
          Effect.flatMap((row) => (row ? sink.deliver(row) : Effect.void)),
          Effect.catch((e: { message: string }) =>
            Effect.logWarning(`sink delivery failed for ${notice.id}: ${e.message}`),
          ),
        ),
      ),
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.logError("NotificationSinkRunner crashed", Cause.pretty(cause)),
      ),
      Effect.forkScoped,
    )
  }),
)
