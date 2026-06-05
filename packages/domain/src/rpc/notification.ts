import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { Notification } from "#entities/Notification"
import { Forbidden, InfrastructureError, NoActiveTenant, NotFound, Unauthorized } from "#errors"

const AuthErrors = [Unauthorized, NoActiveTenant, Forbidden, InfrastructureError] as const

/**
 * Per-user notification feed. Scoped to the active session's `userId`.
 *
 * Delivery (email, webhook) lives in Phase 8 — this group only exposes the
 * in-app feed (list, mark-read).
 */
export const NotificationRpc = RpcGroup.make(
  Rpc.make("notification.list", {
    payload: {
      cursor: Schema.optional(Schema.NonEmptyString),
      limit: Schema.optional(Schema.Int),
      onlyUnread: Schema.optional(Schema.Boolean),
    },
    success: Schema.Struct({
      items: Schema.Array(Notification),
      nextCursor: Schema.NullOr(Schema.String),
      unreadCount: Schema.Int,
    }),
    error: Schema.Union(AuthErrors),
  }),

  Rpc.make("notification.markRead", {
    payload: { id: Schema.NonEmptyString },
    success: Notification,
    error: Schema.Union([...AuthErrors, NotFound]),
  }),

  Rpc.make("notification.markAllRead", {
    success: Schema.Struct({ updated: Schema.Int }),
    error: Schema.Union(AuthErrors),
  }),

  /** Push stream of newly-created notifications for the active session's user. */
  Rpc.make("notification.stream", {
    success: Notification,
    error: Schema.Union(AuthErrors),
    stream: true,
  }),
)
