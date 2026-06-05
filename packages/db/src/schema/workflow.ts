import { sql } from "drizzle-orm"
import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core"
import type { Workflow as DomainWorkflow } from "@theia/domain/entities"
import { organizations } from "#schema/auth"

/**
 * Per-tenant Workflow row. Single row per tenant.
 *
 * Statuses / priorities / transitions / types / tags live in JSONB columns
 * because they are always read as one unit by the TicketEntity actor — no
 * benefit to normalizing into separate rows + joins. Schema parity with
 * `@theia/domain` Workflow is enforced by `domain↔db parity test`.
 *
 * RLS-enabled. Tenant binding via `tenant_id` (= `organization_id`).
 */
export const workflows = pgTable("workflow", {
  tenantId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  statuses: jsonb()
    .$type<ReadonlyArray<DomainWorkflow["statuses"][number]>>()
    .notNull(),
  priorities: jsonb()
    .$type<ReadonlyArray<DomainWorkflow["priorities"][number]>>()
    .notNull(),
  transitions: jsonb()
    .$type<ReadonlyArray<DomainWorkflow["transitions"][number]>>()
    .notNull(),
  types: jsonb()
    .$type<ReadonlyArray<DomainWorkflow["types"][number]>>()
    .notNull(),
  tags: jsonb()
    .$type<ReadonlyArray<DomainWorkflow["tags"][number]>>()
    .notNull(),
  defaultStatus: jsonb()
    .$type<DomainWorkflow["defaultStatus"]>()
    .notNull(),
  defaultPriority: jsonb()
    .$type<DomainWorkflow["defaultPriority"]>()
    .notNull(),
  defaultTypeKey: jsonb().$type<DomainWorkflow["defaultTypeKey"]>(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`),
})
