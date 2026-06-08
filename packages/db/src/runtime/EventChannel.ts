import { Events } from "@theia/domain"
import { Config, Context, Effect, Layer, PubSub, Redacted, Result, Schema, Stream } from "effect"
import postgres from "postgres"

/**
 * Real-time event channel backed by Pg LISTEN/NOTIFY.
 *
 * The `0003_listen_notify_triggers.sql` migration fires `pg_notify` on every
 * insert into `ticket_event` (channel `ticket_event_inserted`, payload =
 * full domain `TicketEvent` JSON) and `notification` (channel
 * `notification_inserted`, payload = `{id, recipient_id}` — full row is
 * fetched on demand because pg_notify payloads cap at ~8KB).
 *
 * `EventChannelLive` opens a dedicated postgres-js connection (LISTEN holds
 * the connection open, so it cannot share the request pool), decodes each
 * NOTIFY payload, and publishes to an unbounded Effect `PubSub`. Consumers
 * attach via `Stream.fromPubSub` and filter client-side.
 *
 * `EventChannelTestLive` is a silent channel — used by tests and by
 * environments without a Pg connection.
 */

export interface NotificationNotice {
  readonly id: string
  readonly recipientId: string
}

const NotificationNoticeSchema = Schema.Struct({
  id: Schema.String,
  recipient_id: Schema.String,
})

export class EventChannel extends Context.Service<
  EventChannel,
  {
    readonly ticketEvents: Stream.Stream<Events.TicketEvent>
    readonly notifications: Stream.Stream<NotificationNotice>
  }
>()("@theia/db/EventChannel") {}

const PgUrl = Config.redacted("DATABASE_URL")

/**
 * Parse a pg_notify payload + decode via the given schema. Returns the
 * decoded value or null. Failures are logged at warn level (synchronous —
 * the listener callback runs on the postgres-js socket loop, so we can't
 * yield through Effect here, but a `console.warn` surfaces silently dropped
 * payloads to operators).
 */
const parseNotify = <A>(
  channel: string,
  payload: string,
  decode: (u: unknown) => Result.Result<A, unknown>,
): A | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (e) {
    console.warn(`[event-channel] ${channel}: invalid JSON payload`, e)
    return null
  }
  const result = decode(parsed)
  if (Result.isSuccess(result)) return result.success
  console.warn(`[event-channel] ${channel}: schema decode failed`, result.failure)
  return null
}

export const EventChannelLive = Layer.effect(
  EventChannel,
  Effect.gen(function* () {
    const url = yield* PgUrl
    const ticketPubsub = yield* PubSub.unbounded<Events.TicketEvent>()
    const notificationPubsub = yield* PubSub.unbounded<NotificationNotice>()
    const decodeTicketEvent = Schema.decodeUnknownResult(Events.TicketEvent)
    const decodeNotice = Schema.decodeUnknownResult(NotificationNoticeSchema)

    const sql = yield* Effect.acquireRelease(
      Effect.sync(() =>
        postgres(Redacted.value(url), {
          max: 1,
          connection: { application_name: "theia-api-listener" },
        }),
      ),
      (client) => Effect.promise(() => client.end({ timeout: 5 })),
    )

    yield* Effect.acquireRelease(
      Effect.promise(() =>
        sql.listen("ticket_event_inserted", (payload) => {
          const event = parseNotify("ticket_event_inserted", payload, decodeTicketEvent)
          if (event) PubSub.publishUnsafe(ticketPubsub, event)
        }),
      ),
      (req) => Effect.promise(() => req.unlisten()),
    )

    yield* Effect.acquireRelease(
      Effect.promise(() =>
        sql.listen("notification_inserted", (payload) => {
          const notice = parseNotify("notification_inserted", payload, decodeNotice)
          if (notice) {
            PubSub.publishUnsafe(notificationPubsub, {
              id: notice.id,
              recipientId: notice.recipient_id,
            })
          }
        }),
      ),
      (req) => Effect.promise(() => req.unlisten()),
    )

    return EventChannel.of({
      ticketEvents: Stream.fromPubSub(ticketPubsub),
      notifications: Stream.fromPubSub(notificationPubsub),
    })
  }),
)

export const EventChannelTestLive = Layer.succeed(
  EventChannel,
  EventChannel.of({
    ticketEvents: Stream.empty,
    notifications: Stream.empty,
  }),
)
