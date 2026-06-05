import { sql } from "drizzle-orm"
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import type { SystemConfigValue } from "@theia/domain/entities"
import { users } from "#schema/auth"

/**
 * System-wide configuration. Single row per `key`. NOT tenant-scoped — no
 * RLS. Read at tenant-creation time to seed the tenant's `workflow` row;
 * subsequent tenant edits only touch the tenant's own row.
 *
 * `key` matches the `_tag` of `SystemConfigValue` in domain (parity test
 * enforces this). Future config categories add a new row with a new key,
 * no schema change required.
 */
export const systemConfig = pgTable("system_config", {
  /** Matches `value._tag` — e.g. `"workflow_defaults"`. */
  key: text().primaryKey(),
  value: jsonb().$type<SystemConfigValue>().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`),
  updatedBy: uuid().references(() => users.id, { onDelete: "set null" }),
})
