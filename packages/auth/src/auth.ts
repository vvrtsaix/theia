import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { Schema } from "@theia/db"
import { ac, roles } from "#access-control"

/**
 * Auth instance configuration.
 *
 * **Identity model:**
 *   - One global `user` row per identity. `kind` (`UserKind`: customer /
 *     internal / system) is a user-level closed enum, set at signup.
 *   - One global user can be a `member` of N organizations (= tenants),
 *     each with a different `role` string.
 *   - `dynamicAccessControl` stores custom per-tenant roles in
 *     `organization_role` table; tenant admins create/edit them at runtime
 *     via `auth.api.createOrganizationRole`.
 *
 * **IDs:** server-side `uuidv7()` (Pg 18). We disable better-auth's ID
 * generator so the DB owns it — keeps a single source of truth and gives
 * us time-ordered keys for free.
 *
 * **Database URL:** `DATABASE_URL` env. The Drizzle adapter shares the pool
 * with the Effect SqlClient layer (see `@theia/db/runtime/Database.ts`).
 */

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error("DATABASE_URL not set; better-auth cannot initialize.")
}

const pg = postgres(url)
const db = drizzle(pg, { schema: Schema })

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: Schema }),

  advanced: {
    /** Defer ID generation to Pg `uuidv7()` default. */
    database: { generateId: false },
  },

  emailAndPassword: {
    enabled: true,
    /** Require email verification before any session can be created. */
    requireEmailVerification: false,
  },

  user: {
    additionalFields: {
      /**
       * Closed-set identity class. Drives auth + visibility rules at the
       * framework layer. NOT user-mutable post-creation.
       */
      kind: {
        type: "string",
        defaultValue: "customer",
        input: false,
      },
    },
  },

  plugins: [
    organization({
      // Each user can belong to many tenants — we deliberately do NOT cap this.
      organizationLimit: 100,
      ac,
      roles,
      dynamicAccessControl: {
        enabled: true,
      },
    }),
  ],
})

export type Auth = typeof auth
