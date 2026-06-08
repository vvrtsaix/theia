import { sql } from "drizzle-orm"
import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * better-auth core tables — no RLS, no `tenant_id`.
 *
 * IDs are server-side `uuidv7()` (Pg 18 native) so better-auth must be
 * configured with `advanced.database.generateId: false` to defer ID generation
 * to the database.
 *
 * Field names match better-auth defaults; column names use `snake_case` via
 * `drizzle.config.ts` casing option.
 */

export const users = pgTable("user", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  name: text().notNull(),
  image: text(),
  /**
   * Domain `UserKind` — `"customer" | "internal" | "system"`. Closed enum,
   * not customizable per tenant. Drives auth + visibility rules.
   */
  kind: text().notNull().default("customer"),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

export const sessions = pgTable("session", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  /** Active organization for this session — drives `app.tenant_id` binding. */
  activeOrganizationId: uuid(),
  ipAddress: text(),
  userAgent: text(),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

export const accounts = pgTable("account", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** OAuth provider account ID; for password accounts equals userId. */
  accountId: text().notNull(),
  providerId: text().notNull(),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
  scope: text(),
  /** Bcrypt hash for password accounts. */
  password: text(),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

export const verifications = pgTable("verification", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

/**
 * `organization` IS the tenant. All app rows with `tenant_id` FK this table.
 * better-auth owns CRUD; `additionalFields` (none yet) would land here.
 */
export const organizations = pgTable("organization", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  metadata: jsonb(),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

/** (user, organization) row. `role` is a per-tenant role string (custom roles allowed). */
export const members = pgTable("member", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  role: text().notNull(),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

export const invitations = pgTable("invitation", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text().notNull(),
  role: text().notNull(),
  /** `"pending" | "accepted" | "rejected" | "expired"` */
  status: text().notNull().default("pending"),
  inviterId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  /**
   * better-auth reads this column on every invitation create / lookup; the
   * field must exist even though we don't reference it from app code. Default
   * to `now()` so existing rows backfill cleanly when the migration runs.
   */
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

/**
 * `dynamicAccessControl` plugin table — runtime-created roles + their
 * permission statement. Each org defines its own roles.
 */
export const organizationRoles = pgTable("organization_role", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /**
   * Role identifier. better-auth's `dynamicAccessControl` plugin reads this
   * as the `role` field on the `organizationRole` model — keep both the JS
   * key and DB column named `role` so the adapter's generated SQL resolves.
   */
  role: text().notNull(),
  /**
   * Permission object: `{ resource: ["action", ...], ... }`. Stored as TEXT
   * (JSON-serialized) — NOT JSONB — because better-auth's `hasPermission`
   * runtime calls `JSON.parse(permissionsString)` directly. Drizzle's `jsonb`
   * column type auto-parses on read, which would feed an object into
   * `JSON.parse` and blow up with `Unexpected identifier "object"`.
   */
  permission: text().notNull(),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
})
