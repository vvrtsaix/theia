import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import type { TicketEvent } from "@theia/domain/events"
import { organizations, users } from "#schema/auth"

/**
 * Tickets — RLS-enabled, tenant-scoped.
 *
 * `status` / `priority` / `typeKey` stored as plain `text` (branded
 * NonEmptyString at the domain layer). TicketEntity validates each value
 * against the tenant's Workflow before any write reaches this table. `tags`
 * is the source-of-truth join table `ticket_tag_assignment`; the `Ticket`
 * domain projection denormalizes for read paths.
 */
export const tickets = pgTable(
  "ticket",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull().default(""),
    status: text().notNull(),
    priority: text().notNull(),
    typeKey: text(),
    assigneeId: uuid().references(() => users.id, { onDelete: "set null" }),
    reporterId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Monotonic actor version; optimistic-concurrency guard. */
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("ticket_tenant_status_updated_idx").on(t.tenantId, t.status, t.updatedAt),
    index("ticket_tenant_assignee_idx").on(t.tenantId, t.assigneeId),
    index("ticket_tenant_type_idx").on(t.tenantId, t.typeKey),
  ],
)

/**
 * Many-to-many tag assignments. Composite PK on (ticket_id, tag) — same tag
 * can't be added twice. `tenant_id` carried for RLS isolation.
 */
export const ticketTagAssignments = pgTable(
  "ticket_tag_assignment",
  {
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    tag: text().notNull(),
    tenantId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.tag] }),
    index("ticket_tag_assignment_tenant_tag_idx").on(t.tenantId, t.tag),
  ],
)

/**
 * One row per (ticket × user). Tracks every actor's involvement plus their
 * subscription flag. Unsubscribing keeps the row (audit) and flips
 * `subscribed=false`.
 */
export const ticketParticipants = pgTable(
  "ticket_participant",
  {
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * Accumulating set of roles — text array because the underlying enum is
     * closed and small. Domain `ParticipantRole` validates values.
     */
    roles: text().array().notNull().default(sql`'{}'::text[]`),
    subscribed: text().notNull().default("true"),
    joinedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.userId] }),
    index("ticket_participant_user_idx").on(t.userId),
    index("ticket_participant_subscribed_idx").on(t.tenantId, t.subscribed),
  ],
)

/**
 * Append-only event log. Doubles as the audit log (Phase 9).
 *
 * `event` JSONB column stores a discriminated union (`TicketEvent` from
 * domain). Indexed by ticket for stream replay, by tenant + occurred_at for
 * audit queries.
 */
export const ticketEvents = pgTable(
  "ticket_event",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    tenantId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Discriminated union — see `@theia/domain/events`. */
    event: jsonb().$type<TicketEvent>().notNull(),
    /** Schema version of the event payload — mirrors `event.v`. */
    v: integer().notNull(),
    /** Actor version AFTER this event was applied. */
    version: integer().notNull(),
    occurredAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("ticket_event_ticket_version_idx").on(t.ticketId, t.version),
    index("ticket_event_tenant_occurred_idx").on(t.tenantId, t.occurredAt),
  ],
)
