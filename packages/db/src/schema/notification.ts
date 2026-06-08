import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { organizations, users } from "#schema/auth"
import { ticketEvents, tickets } from "#schema/ticket"

/**
 * In-flight notifications. One row per (recipient × event).
 *
 * Created by the TicketEntity actor (via the cluster-entities package) when
 * a TicketEvent fires and matching subscribers exist. Delivery (email /
 * webhook) lives in Phase 8; in-app reads only need this table.
 *
 * RLS-enabled. Indexed by recipient × (unread, createdAt) for fast feed.
 */
export const notifications = pgTable(
  "notification",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    eventId: uuid()
      .notNull()
      .references(() => ticketEvents.id, { onDelete: "cascade" }),
    /** `"in_app" | "email" | "webhook"` */
    channel: text().notNull().default("in_app"),
    title: text().notNull(),
    body: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    readAt: timestamp({ withTimezone: true, mode: "date" }),
    deliveredAt: timestamp({ withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("notification_recipient_read_created_idx").on(t.recipientId, t.readAt, t.createdAt),
    index("notification_ticket_idx").on(t.ticketId),
  ],
)
