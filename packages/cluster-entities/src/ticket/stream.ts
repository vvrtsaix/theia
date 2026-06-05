import { Effect, Queue, Schema, Stream } from "effect"
import { Events } from "@theia/domain"

/**
 * Real-time tail of `ticket_event` via Pg LISTEN/NOTIFY.
 *
 * The channel `ticket_event_inserted` carries the full event JSONB (set up by
 * `drizzle/0003_listen_notify_triggers.sql`). Consumers filter client-side by
 * `ticketId` since pg_notify payloads are limited to ~8KB and we want one
 * channel for all tickets.
 *
 * Wiring lives here because the cluster entity already maintains a Pg
 * connection via the shared pool; we open a dedicated listener via
 * `postgres-js`' `listen()` API for the lifetime of the stream subscriber.
 *
 * For Phase 8 MVP: pass a `subscribeFn` factory; production wiring composes
 * this with `Stream.unwrap` inside the entity's `SubscribeEvents`. Local +
 * test runners can swap in an in-memory pub/sub.
 */
export interface EventChannel {
  readonly subscribe: () => Stream.Stream<Events.TicketEvent, never>
}

export const decodeNotifyPayload = (payload: string) =>
  Schema.decodeUnknownEffect(Events.TicketEvent)(JSON.parse(payload)).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.die(new Error(`malformed ticket_event_inserted payload: ${String(e)}`)),
    ),
  )

/**
 * In-memory channel — used by `TestRunner.layer` so unit tests don't need a
 * real Pg LISTEN. Production code provides a Pg-backed implementation.
 */
export class InMemoryEventChannel implements EventChannel {
  private subscribers: Array<(event: Events.TicketEvent) => void> = []

  emit(event: Events.TicketEvent): void {
    for (const fn of this.subscribers) fn(event)
  }

  subscribe(): Stream.Stream<Events.TicketEvent, never> {
    return Stream.callback<Events.TicketEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const fn = (event: Events.TicketEvent) => {
            // Sync push into the stream's queue. `unsafeOffer` is the
            // sync escape hatch; `Queue.offer` returns an Effect that
            // would have to be run from inside this callback — discarding
            // it (as the previous version did) silently drops events.
            Queue.offerUnsafe(queue, event)
          }
          this.subscribers.push(fn)
          return fn
        }),
        (fn) =>
          Effect.sync(() => {
            this.subscribers = this.subscribers.filter((f) => f !== fn)
          }),
      ),
    )
  }
}
