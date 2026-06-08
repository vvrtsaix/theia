import { CurrentSession, Database, Schema as DbSchema, EventChannel } from "@theia/db"
import { Rpc as DomainRpc, Entities, Errors } from "@theia/domain"
import { and, count, desc, eq, isNull, lt } from "drizzle-orm"
import { DateTime, Effect, Schema, Stream } from "effect"

/**
 * Per-user notification feed. RLS pins tenant; handler also filters by
 * `recipient_id = session.userId` (defense in depth).
 */

type NotificationRow = typeof DbSchema.notifications.$inferSelect

const decodeNotification = (row: NotificationRow) =>
  Schema.decodeUnknownEffect(Entities.Notification)({
    id: row.id,
    tenantId: row.tenantId,
    recipientId: row.recipientId,
    ticketId: row.ticketId,
    eventId: row.eventId,
    channel: row.channel,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
  }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`notification row failed domain decode: ${String(e)}`)),
    ),
  )

export const NotificationHandlers = DomainRpc.NotificationRpc.toLayer({
  "notification.list": (payload) =>
    Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const limit = payload.limit ?? 50
      const cursorDate = payload.cursor ? new Date(payload.cursor) : null

      const { rows, unreadCount } = yield* db.tx(async (tx) => {
        const conditions = [eq(DbSchema.notifications.recipientId, session.userId)]
        if (cursorDate) conditions.push(lt(DbSchema.notifications.createdAt, cursorDate))
        if (payload.onlyUnread) conditions.push(isNull(DbSchema.notifications.readAt))

        const rows = await tx
          .select()
          .from(DbSchema.notifications)
          .where(and(...conditions))
          .orderBy(desc(DbSchema.notifications.createdAt))
          .limit(limit + 1)

        const unreadRows = await tx
          .select({ value: count() })
          .from(DbSchema.notifications)
          .where(
            and(
              eq(DbSchema.notifications.recipientId, session.userId),
              isNull(DbSchema.notifications.readAt),
            ),
          )

        return { rows, unreadCount: unreadRows[0]?.value ?? 0 }
      })

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const decoded = yield* Effect.forEach(page, decodeNotification)
      const last = page.at(-1)
      return {
        items: decoded,
        nextCursor: hasMore && last ? last.createdAt.toISOString() : null,
        unreadCount,
      }
    }),

  "notification.markRead": (payload) =>
    Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const now = yield* DateTime.now
      const row = yield* db.tx(async (tx) => {
        const updated = await tx
          .update(DbSchema.notifications)
          .set({ readAt: DateTime.toDate(now) })
          .where(
            and(
              eq(DbSchema.notifications.id, payload.id),
              eq(DbSchema.notifications.recipientId, session.userId),
            ),
          )
          .returning()
        return updated[0] ?? null
      })
      if (!row) {
        return yield* new Errors.NotFound({ resource: "notification", id: payload.id })
      }
      return yield* decodeNotification(row)
    }),

  "notification.markAllRead": () =>
    Effect.gen(function* () {
      const db = yield* Database
      const session = yield* CurrentSession
      const now = yield* DateTime.now
      const updatedIds = yield* db.tx(async (tx) =>
        tx
          .update(DbSchema.notifications)
          .set({ readAt: DateTime.toDate(now) })
          .where(
            and(
              eq(DbSchema.notifications.recipientId, session.userId),
              isNull(DbSchema.notifications.readAt),
            ),
          )
          .returning({ id: DbSchema.notifications.id }),
      )
      return { updated: updatedIds.length }
    }),

  "notification.stream": () => {
    // Pg LISTEN/NOTIFY surfaces only `{id, recipientId}` (payload cap). On
    // each notice for this user we fetch the full row by id — the SELECT
    // runs inside `Database.tx`, so RLS scopes the lookup to the active
    // tenant; cross-tenant ids cannot leak even if the notice were spoofed.
    const build = Effect.gen(function* () {
      const db = yield* Database
      const channel = yield* EventChannel
      const session = yield* CurrentSession
      return channel.notifications.pipe(
        Stream.filter((notice) => notice.recipientId === session.userId),
        Stream.flatMap((notice) =>
          Stream.unwrap(
            db
              .tx(async (tx) => {
                const rows = await tx
                  .select()
                  .from(DbSchema.notifications)
                  .where(eq(DbSchema.notifications.id, notice.id))
                  .limit(1)
                return rows[0] ?? null
              })
              .pipe(
                Effect.map((row) =>
                  row ? Stream.fromEffect(decodeNotification(row)) : Stream.empty,
                ),
                // Per-notice fetch failures (transient DB error, RLS shift,
                // row deleted between notice + select) must NOT kill the
                // long-lived subscriber stream. Log + swallow → empty stream
                // for this notice; the next notice still flows.
                Effect.catch((e: { message: string }) =>
                  Effect.logWarning(
                    `notification.stream: fetch failed for ${notice.id}: ${e.message}`,
                  ).pipe(Effect.as(Stream.empty)),
                ),
              ),
          ),
        ),
      )
    })
    return Stream.unwrap(build as never) as never
  },
})
